/**
 * Tests SQL du schéma de production (supabase/schema.sql) sur un vrai Postgres (PGlite) :
 * idempotence, RLS, trigger, contraintes. Aucune simulation de la RLS : c'est Postgres
 * qui applique les politiques.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPgliteDatabase, asRole, SCHEMA_SQL } from "./pglite-env.js";
import { uuidv4 } from "../../js/core/uuid.js";

const A = uuidv4();
const B = uuidv4();
let db;

const insertAs = (user, row) =>
    asRole(db, user, (tx) =>
        tx.query(
            `insert into public.items (user_id, id, collection, data, client_updated_at, device_id)
             values ($1, $2, $3, $4::jsonb, $5, $6) returning id, to_json(updated_at)#>>'{}' as updated_at, to_json(client_updated_at)#>>'{}' as client_updated_at`,
            [row.user_id ?? user, row.id ?? uuidv4(), row.collection ?? "grades", JSON.stringify(row.data ?? { name: "x" }), row.client_updated_at ?? new Date().toISOString(), row.device_id ?? "test"]
        )
    );

beforeAll(async () => {
    db = await createPgliteDatabase();
    await db.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
});
afterAll(async () => {
    await db.close();
});

describe("schema.sql", () => {
    it("est idempotent : rejoué deux fois sans erreur ni perte", async () => {
        await insertAs(A, { data: { name: "avant rejeu" } });
        await db.exec(SCHEMA_SQL);
        await db.exec(SCHEMA_SQL);
        const r = await asRole(db, A, (tx) => tx.query("select data from public.items where data->>'name' = 'avant rejeu'"));
        expect(r.rows).toHaveLength(1);
    });

    it("RLS activée sur toutes les tables du schéma public", async () => {
        const r = await db.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'");
        expect(r.rows.length).toBeGreaterThan(0);
        for (const t of r.rows) expect(t.relrowsecurity, t.relname).toBe(true);
    });

    it("politiques basées sur auth.uid(), aucune politique DELETE", async () => {
        const r = await db.query("select policyname, cmd, qual, with_check, roles from pg_policies where schemaname = 'public' and tablename = 'items'");
        const cmds = r.rows.map((p) => p.cmd).sort();
        expect(cmds).toEqual(["INSERT", "SELECT", "UPDATE"]);
        for (const p of r.rows) expect(`${p.qual || ""} ${p.with_check || ""}`).toMatch(/auth\.uid\(\)/);
    });

    it("table publiée pour le temps réel", async () => {
        const r = await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime'");
        expect(r.rows.map((x) => x.tablename)).toContain("items");
    });
});

describe("RLS", () => {
    it("un utilisateur non authentifié (anon) ne lit rien et n'écrit rien", async () => {
        await insertAs(A, { data: { name: "secret A" } });
        await expect(asRole(db, null, (tx) => tx.query("select * from public.items"))).rejects.toThrow(/permission denied/);
        await expect(
            asRole(db, null, (tx) => tx.query("insert into public.items (user_id, id, collection, data) values ($1, $2, 'grades', '{}')", [A, uuidv4()]))
        ).rejects.toThrow(/permission denied/);
        await expect(asRole(db, null, (tx) => tx.query("select public.server_time()"))).rejects.toThrow(/permission denied/);
    });

    it("B ne voit pas les lignes de A", async () => {
        await insertAs(A, { data: { name: "privée A" } });
        const seenByB = await asRole(db, B, (tx) => tx.query("select data from public.items"));
        expect(seenByB.rows.find((r) => r.data.name === "privée A")).toBeUndefined();
        const seenByA = await asRole(db, A, (tx) => tx.query("select data from public.items"));
        expect(seenByA.rows.find((r) => r.data.name === "privée A")).toBeDefined();
    });

    it("B ne peut ni modifier une ligne de A, ni usurper user_id à l'insertion", async () => {
        const id = uuidv4();
        await insertAs(A, { id, data: { name: "intouchable" } });
        const upd = await asRole(db, B, (tx) => tx.query("update public.items set data = '{\"name\":\"piraté\"}' where id = $1 returning id", [id]));
        expect(upd.rows).toHaveLength(0);
        await expect(insertAs(B, { user_id: A, data: { name: "usurpation" } })).rejects.toThrow(/row-level security/);
        // Même identifiant chez B : ligne distincte (clé primaire user_id + id), A intacte
        await insertAs(B, { id, data: { name: "copie B" } });
        const a = await asRole(db, A, (tx) => tx.query("select data from public.items where id = $1", [id]));
        expect(a.rows[0].data.name).toBe("intouchable");
    });

    it("A ne peut pas transférer sa ligne à B (user_id immuable : le trigger rétablit le propriétaire)", async () => {
        const id = uuidv4();
        await insertAs(A, { id });
        // Selon l'ordre trigger/RLS, la requête est soit neutralisée soit refusée : dans les deux cas la ligne reste à A
        await asRole(db, A, (tx) => tx.query("update public.items set user_id = $2 where id = $1", [id, B])).catch(() => {});
        const r = await asRole(db, A, (tx) => tx.query("select user_id from public.items where id = $1", [id]));
        expect(r.rows[0].user_id).toBe(A);
        const seenByB = await asRole(db, B, (tx) => tx.query("select id from public.items where id = $1", [id]));
        expect(seenByB.rows).toHaveLength(0);
    });

    it("suppression physique impossible (suppression logique uniquement)", async () => {
        const id = uuidv4();
        await insertAs(A, { id });
        await expect(asRole(db, A, (tx) => tx.query("delete from public.items where id = $1", [id]))).rejects.toThrow(/permission denied/);
        const soft = await asRole(db, A, (tx) => tx.query("update public.items set deleted_at = now() where id = $1 returning deleted_at", [id]));
        expect(soft.rows[0].deleted_at).not.toBeNull();
    });
});

describe("Trigger et contraintes", () => {
    it("updated_at posé par le serveur (valeur client ignorée), strictement croissant, created_at immuable", async () => {
        const id = uuidv4();
        await asRole(db, A, (tx) =>
            tx.query("insert into public.items (user_id, id, collection, data, updated_at, created_at) values ($1, $2, 'grades', '{}', '2000-01-01', '2000-01-01')", [A, id])
        );
        const r1 = await asRole(db, A, (tx) => tx.query("select updated_at, created_at from public.items where id = $1", [id]));
        expect(r1.rows[0].updated_at.getFullYear()).toBeGreaterThan(2020);
        await asRole(db, A, (tx) => tx.query("update public.items set data = '{\"v\":2}', created_at = '1999-01-01' where id = $1", [id]));
        const r2 = await asRole(db, A, (tx) => tx.query("select updated_at, created_at from public.items where id = $1", [id]));
        expect(r2.rows[0].updated_at > r1.rows[0].updated_at).toBe(true);
        expect(r2.rows[0].created_at.getTime()).toBe(r1.rows[0].created_at.getTime());
    });

    it("mise à jour conditionnelle sur updated_at (détection de conflit)", async () => {
        const id = uuidv4();
        const ins = await insertAs(A, { id });
        const base = ins.rows[0].updated_at;
        const ok = await asRole(db, A, (tx) => tx.query("update public.items set data = '{\"v\":1}' where id = $1 and updated_at = $2::timestamptz returning id", [id, base]));
        expect(ok.rows).toHaveLength(1);
        const stale = await asRole(db, A, (tx) => tx.query("update public.items set data = '{\"v\":2}' where id = $1 and updated_at = $2::timestamptz returning id", [id, base]));
        expect(stale.rows).toHaveLength(0);
    });

    it("insertion idempotente : ON CONFLICT DO NOTHING ne renvoie rien", async () => {
        const id = uuidv4();
        await insertAs(A, { id });
        const again = await asRole(db, A, (tx) =>
            tx.query("insert into public.items (user_id, id, collection, data) values ($1, $2, 'grades', '{}') on conflict (user_id, id) do nothing returning id", [A, id])
        );
        expect(again.rows).toHaveLength(0);
    });

    it("horloge d'appareil en avance plafonnée à now() + 1 min", async () => {
        const future = new Date(Date.now() + 5 * 3600000).toISOString();
        const r = await insertAs(A, { client_updated_at: future });
        const clamped = Date.parse(r.rows[0].client_updated_at);
        expect(clamped).toBeLessThanOrEqual(Date.parse(r.rows[0].updated_at) + 60000 + 1);
        const past = "2020-01-01T00:00:00.000Z";
        const r2 = await insertAs(A, { client_updated_at: past });
        expect(Date.parse(r2.rows[0].client_updated_at)).toBe(Date.parse(past));
    });

    it("contraintes : collection inconnue, données non objet, entrée trop volumineuse refusées", async () => {
        await expect(insertAs(A, { collection: "hacks" })).rejects.toThrow(/items_collection_check/);
        await expect(
            asRole(db, A, (tx) => tx.query("insert into public.items (user_id, id, collection, data) values ($1, $2, 'grades', '[1,2]'::jsonb)", [A, uuidv4()]))
        ).rejects.toThrow(/items_data_object_check/);
        await expect(insertAs(A, { data: { big: "x".repeat(200000) } })).rejects.toThrow(/items_data_size_check/);
    });

    it("server_time() accessible aux comptes connectés", async () => {
        const r = await asRole(db, A, (tx) => tx.query("select to_json(public.server_time())#>>'{}' as t"));
        expect(Math.abs(Date.parse(r.rows[0].t) - Date.now())).toBeLessThan(60000);
    });
});
