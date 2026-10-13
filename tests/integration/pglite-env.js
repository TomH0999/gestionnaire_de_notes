/**
 * Postgres réel (PGlite, Postgres 18 compilé en WebAssembly) avec une émulation minimale
 * de l'environnement Supabase : schéma `auth`, fonction auth.uid() (lue dans les claims JWT
 * comme sur Supabase), rôles `anon` / `authenticated`, privilèges par défaut identiques
 * (tout est accordé, la RLS fait le tri), publication `supabase_realtime`.
 *
 * Le schéma de production (supabase/schema.sql) y est exécuté tel quel. Chaque requête
 * « API » est exécutée comme PostgREST le ferait : transaction, `set local role`, claims JWT.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SyncError } from "../../js/data/sync-errors.js";
import { uuidv4 } from "../../js/core/uuid.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SCHEMA_SQL = readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");

const SUPABASE_EMULATION = `
set timezone = 'UTC';
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text unique);
create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                           (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
do $$ begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
`;

const COLS = `id, collection, data,
    to_json(deleted_at)#>>'{}' as deleted_at,
    to_json(client_updated_at)#>>'{}' as client_updated_at,
    device_id,
    to_json(updated_at)#>>'{}' as updated_at`;

export async function createPgliteDatabase() {
    const db = new PGlite();
    await db.exec(SUPABASE_EMULATION);
    await db.exec(SCHEMA_SQL);
    return db;
}

/** Exécute `fn(tx)` comme PostgREST : rôle + claims JWT, dans une transaction. */
export async function asRole(db, userId, fn) {
    return db.transaction(async (tx) => {
        await tx.exec("set local timezone = 'UTC'");
        if (userId) {
            await tx.exec("set local role authenticated");
            await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
        } else {
            await tx.exec("set local role anon");
        }
        return fn(tx);
    });
}

function mapPgError(e) {
    if (e instanceof SyncError) return e;
    const code = e && e.code;
    if (code === "42501") return new SyncError("server", e.message, { status: 403, code });
    return new SyncError("server", e && e.message ? e.message : String(e), { status: 400, code });
}

/** Environnement complet pour defineSyncScenarios. */
export async function createPgliteEnv(clock) {
    const db = await createPgliteDatabase();
    const users = new Map(); // email → { id, password }
    const sessions = new Map(); // token → userId
    const env = {
        db,
        clock,
        realtime: false,
        users,
        sessions,
        async createUser(email, password) {
            const id = uuidv4();
            users.set(email, { id, password });
            await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
            return id;
        },
        async rowsOf(email) {
            const u = users.get(email);
            const r = await asRole(db, u.id, (tx) => tx.query(`select ${COLS} from public.items order by updated_at, id`));
            return r.rows;
        },
        async expireSession(device) {
            sessions.delete(device.backend.token);
        },
        backendFactory: (name) => new PgliteBackend(env, name),
        async cleanup() {
            await db.close();
        }
    };
    return env;
}

/**
 * Adaptateur de synchronisation qui exécute le même SQL que PostgREST/Supabase
 * (sans filtre user_id explicite : seule la RLS isole les comptes).
 */
export class PgliteBackend {
    constructor(env, name) {
        this.env = env;
        this.name = name;
        this.token = null;
        this.session = null;
        this.online = true;
        this.failures = [];
        this.authListeners = new Set();
    }

    setOnline(online) {
        this.online = online;
    }

    failNext(op, when = "before") {
        this.failures.push({ op, when });
    }

    userId() {
        const id = this.token ? this.env.sessions.get(this.token) : null;
        if (!id) throw new SyncError("auth", "Session expirée.", { status: 401 });
        return id;
    }

    async call(op, fn) {
        await Promise.resolve();
        if (!this.online) throw new SyncError("network", "Hors-ligne (simulation).");
        const idx = this.failures.findIndex((f) => f.op === op);
        const failure = idx >= 0 ? this.failures.splice(idx, 1)[0] : null;
        if (failure && failure.when === "before") throw new SyncError("network", `Coupure avant ${op}.`);
        let result;
        try {
            result = await fn();
        } catch (e) {
            throw mapPgError(e);
        }
        if (failure && failure.when === "after") throw new SyncError("network", `Réponse perdue après ${op}.`);
        return result;
    }

    async getSession() {
        return this.session;
    }

    async signIn(email, password) {
        if (!this.online) throw new SyncError("network", "Hors-ligne (simulation).");
        const u = this.env.users.get(email);
        if (!u || u.password !== password) throw new SyncError("auth", "Adresse e-mail ou mot de passe incorrect.", { status: 400 });
        this.token = uuidv4();
        this.env.sessions.set(this.token, u.id);
        this.session = { userId: u.id, email };
        for (const l of this.authListeners) l("signed-in", this.session);
        return this.session;
    }

    async signUp() {
        throw new SyncError("auth", "Inscriptions désactivées.", { status: 422 });
    }

    async signOut() {
        this.env.sessions.delete(this.token);
        this.token = null;
        this.session = null;
        for (const l of this.authListeners) l("signed-out", null);
    }

    async refreshSession() {
        return this.token && this.env.sessions.has(this.token) ? this.session : null;
    }

    onAuthChange(listener) {
        this.authListeners.add(listener);
        return () => this.authListeners.delete(listener);
    }

    async serverTime() {
        return this.call("time", async () => {
            const r = await asRole(this.env.db, this.userId(), (tx) => tx.query("select to_json(public.server_time())#>>'{}' as t"));
            return r.rows[0].t;
        });
    }

    async pull({ since = null, limit = 500 } = {}) {
        return this.call("pull", async () => {
            const r = await asRole(this.env.db, this.userId(), (tx) =>
                tx.query(`select ${COLS} from public.items where ($1::timestamptz is null or updated_at >= $1::timestamptz) order by updated_at, id limit $2`, [since, limit])
            );
            return { rows: r.rows };
        });
    }

    async insertMany(rows) {
        return this.call("insert", async () => {
            const userId = this.userId();
            const inserted = await asRole(this.env.db, userId, async (tx) => {
                const out = [];
                for (const row of rows) {
                    const r = await tx.query(
                        `insert into public.items (user_id, id, collection, data, deleted_at, client_updated_at, device_id)
                         values ($1, $2, $3, $4::jsonb, $5, $6, $7)
                         on conflict (user_id, id) do nothing
                         returning ${COLS}`,
                        [userId, row.id, row.collection, JSON.stringify(row.data), row.deleted_at, row.client_updated_at, row.device_id]
                    );
                    out.push(...r.rows);
                }
                return out;
            });
            return { rows: inserted };
        });
    }

    async updateIf(row, baseUpdatedAt) {
        return this.call("update", async () => {
            const r = await asRole(this.env.db, this.userId(), (tx) =>
                tx.query(
                    `update public.items set collection = $2, data = $3::jsonb, deleted_at = $4, client_updated_at = $5, device_id = $6
                     where id = $1 and updated_at = $7::timestamptz
                     returning ${COLS}`,
                    [row.id, row.collection, JSON.stringify(row.data), row.deleted_at, row.client_updated_at, row.device_id, baseUpdatedAt]
                )
            );
            return { row: r.rows[0] || null };
        });
    }

    async fetchOne(id) {
        return this.call("fetch", async () => {
            const r = await asRole(this.env.db, this.userId(), (tx) => tx.query(`select ${COLS} from public.items where id = $1`, [id]));
            return { row: r.rows[0] || null };
        });
    }

    subscribe(onRow, onState) {
        queueMicrotask(() => onState("disconnected")); // pas de temps réel sur PGlite : rattrapage par pull
        return () => {};
    }
}
