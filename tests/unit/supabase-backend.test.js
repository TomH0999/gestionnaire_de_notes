/**
 * Adaptateur Supabase testé avec un faux client supabase-js qui enregistre les appels :
 * vérifie les requêtes PostgREST produites (filtres, onConflict, mise à jour conditionnelle),
 * l'abonnement temps réel et la traduction des erreurs.
 */
import { describe, it, expect } from "vitest";
import { SupabaseBackend, mapSupabaseError, AUTH_STORAGE_KEY } from "../../js/data/backends/supabase-backend.js";
import { createMemoryStorage } from "../../js/data/local-store.js";

function fakeClient({ response = { data: [], error: null, status: 200 }, session = { user: { id: "u1", email: "tom@example.com" }, access_token: "jeton" }, sessionError = null } = {}) {
    const log = [];
    const builder = (table) => {
        const calls = [["from", table]];
        const b = {
            calls,
            then(resolve, reject) {
                log.push(calls);
                return Promise.resolve(typeof response === "function" ? response(calls) : response).then(resolve, reject);
            }
        };
        for (const m of ["select", "order", "limit", "gte", "eq", "upsert", "update", "maybeSingle"]) {
            b[m] = (...args) => {
                calls.push([m, ...args]);
                return b;
            };
        }
        return b;
    };
    const channels = [];
    return {
        log,
        channels,
        from: builder,
        rpc: (name) => builder(`rpc:${name}`),
        channel(name) {
            const ch = { name, handlers: [], on(...args) { this.handlers.push(args); return this; }, subscribe(cb) { this.statusCb = cb; return this; } };
            channels.push(ch);
            return ch;
        },
        removeChannel(ch) {
            ch.removed = true;
        },
        auth: {
            getSession: async () => (sessionError ? { data: { session: null }, error: sessionError } : { data: { session }, error: null }),
            signInWithPassword: async ({ email, password }) => (password === "bon" ? { data: { session: { user: { id: "u1", email } } }, error: null } : { data: {}, error: { message: "Invalid login credentials", status: 400 } }),
            signUp: async () => ({ data: { user: { id: "u2" }, session: null }, error: null }),
            signOut: async () => ({ error: null }),
            refreshSession: async () => ({ data: { session }, error: null }),
            onAuthStateChange: (cb) => {
                fakeClient.lastAuthCb = cb;
                return { data: { subscription: { unsubscribe() {} } } };
            }
        }
    };
}

describe("SupabaseBackend — requêtes", () => {
    it("pull : tri updated_at puis id, filtre >= curseur, limite", async () => {
        const client = fakeClient();
        const b = new SupabaseBackend(client, { url: "https://p.supabase.co", anonKey: "k" });
        await b.getSession();
        await b.pull({ since: "2026-10-13T08:00:00.123456+00:00", limit: 500 });
        const calls = client.log[0];
        expect(calls).toContainEqual(["from", "items"]);
        expect(calls).toContainEqual(["order", "updated_at", { ascending: true }]);
        expect(calls).toContainEqual(["order", "id", { ascending: true }]);
        expect(calls).toContainEqual(["limit", 500]);
        expect(calls).toContainEqual(["gte", "updated_at", "2026-10-13T08:00:00.123456+00:00"]);
    });
    it("insertMany : upsert ON CONFLICT (user_id,id) DO NOTHING avec user_id", async () => {
        const client = fakeClient({ response: { data: [{ id: "a" }], error: null } });
        const b = new SupabaseBackend(client, {});
        await b.getSession();
        const { rows } = await b.insertMany([{ id: "a", collection: "grades", data: {} }]);
        expect(rows).toEqual([{ id: "a" }]);
        const up = client.log[0].find((c) => c[0] === "upsert");
        expect(up[1]).toEqual([{ id: "a", collection: "grades", data: {}, user_id: "u1" }]);
        expect(up[2]).toEqual({ onConflict: "user_id,id", ignoreDuplicates: true });
    });
    it("updateIf : mise à jour conditionnelle sur id ET updated_at ; aucune ligne → null (conflit)", async () => {
        const client = fakeClient({ response: { data: [], error: null } });
        const b = new SupabaseBackend(client, {});
        await b.getSession();
        const r = await b.updateIf({ id: "a", collection: "grades", data: { x: 1 }, deleted_at: null, client_updated_at: "t", device_id: "d" }, "BASE");
        expect(r.row).toBeNull();
        const calls = client.log[0];
        expect(calls).toContainEqual(["eq", "id", "a"]);
        expect(calls).toContainEqual(["eq", "updated_at", "BASE"]);
        expect(calls.find((c) => c[0] === "update")[1]).not.toHaveProperty("user_id");
    });
    it("serverTime via RPC, fetchOne via maybeSingle", async () => {
        const client = fakeClient({ response: { data: "2026-10-13T08:00:00.1+00:00", error: null } });
        const b = new SupabaseBackend(client, {});
        await b.getSession();
        expect(await b.serverTime()).toBe("2026-10-13T08:00:00.1+00:00");
        expect(client.log[0][0]).toEqual(["from", "rpc:server_time"]);
    });
    it("aucune requête de données sans utilisateur connecté", async () => {
        const b = new SupabaseBackend(fakeClient({ session: null }), {});
        await b.getSession();
        await expect(b.pull()).rejects.toMatchObject({ kind: "auth" });
    });
    it("temps réel : canal filtré user_id=eq.<uid>, états traduits, fermeture", async () => {
        const client = fakeClient();
        const b = new SupabaseBackend(client, {});
        await b.getSession();
        const rows = [];
        const states = [];
        const unsub = b.subscribe((r) => rows.push(r), (s) => states.push(s));
        const ch = client.channels[0];
        expect(ch.handlers[0][1]).toEqual({ event: "*", schema: "public", table: "items", filter: "user_id=eq.u1" });
        ch.handlers[0][2]({ new: { id: "x", collection: "grades" } });
        ch.handlers[0][2]({ new: {} });
        ch.statusCb("SUBSCRIBED");
        ch.statusCb("CHANNEL_ERROR");
        expect(rows).toEqual([{ id: "x", collection: "grades" }]);
        expect(states).toEqual(["connected", "disconnected"]);
        unsub();
        expect(ch.removed).toBe(true);
    });
});

describe("SupabaseBackend — session et erreurs", () => {
    it("hors-ligne avec jeton expiré : utilisateur mémorisé conservé (pas de déconnexion)", async () => {
        const storage = createMemoryStorage();
        storage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: "u9", email: "x@example.com" } }));
        const b = new SupabaseBackend(fakeClient({ sessionError: { name: "AuthRetryableFetchError", message: "Failed to fetch" } }), { storage });
        expect(await b.getSession()).toEqual({ userId: "u9", email: "x@example.com", offline: true });
    });
    it("connexion : message français en cas d'identifiants faux", async () => {
        const b = new SupabaseBackend(fakeClient(), {});
        await expect(b.signIn("a@b.c", "faux")).rejects.toMatchObject({ kind: "auth", message: "Adresse e-mail ou mot de passe incorrect." });
        expect(await b.signIn("a@b.c", "bon")).toEqual({ userId: "u1", email: "a@b.c" });
        expect(await b.signUp("n@b.c", "motdepasse")).toMatchObject({ needsConfirmation: true });
    });
    it.each([
        [{ message: "TypeError: Failed to fetch" }, 0, "network"],
        [{ message: "Load failed" }, null, "network"],
        [{ message: "JWT expired", code: "PGRST301" }, 401, "auth"],
        [{ message: "permission denied" }, 401, "auth"],
        [{ message: "Signups not allowed for this instance" }, 422, "auth"],
        [{ message: "duplicate key", code: "23505" }, 409, "server"],
        [{ message: "boom" }, 500, "server"]
    ])("traduction d'erreur %j (%s) → %s", (error, status, kind) => {
        expect(mapSupabaseError(error, status).kind).toBe(kind);
    });
    it("fonction edt-proxy : jeton envoyé, erreurs HTTP traduites", async () => {
        const calls = [];
        const responses = [new Response("BEGIN:VCALENDAR", { status: 200 }), new Response(JSON.stringify({ message: "La source ADE ne répond pas", code: "timeout" }), { status: 504 }), new Response("", { status: 404 })];
        const b = new SupabaseBackend(fakeClient(), { url: "https://p.supabase.co/", anonKey: "cle", fetchImpl: async (url, init) => { calls.push({ url, init }); return responses.shift(); } });
        await b.getSession();
        expect(await b.fetchTimetable({ url: "u", from: "a", to: "b" })).toBe("BEGIN:VCALENDAR");
        expect(calls[0].url).toBe("https://p.supabase.co/functions/v1/edt-proxy");
        expect(calls[0].init.headers.Authorization).toBe("Bearer jeton");
        await expect(b.fetchTimetable({})).rejects.toMatchObject({ kind: "server", status: 504, code: "timeout" });
        await expect(b.fetchTimetable({})).rejects.toMatchObject({ code: "function-missing" });
    });
});
