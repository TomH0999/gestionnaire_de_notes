/**
 * La VRAIE bibliothèque supabase-js (assets/vendor) et le VRAI adaptateur SupabaseBackend,
 * dans Chromium, sous la politique de sécurité (CSP) de la page, face à une API Supabase
 * simulée (GoTrue, PostgREST, Realtime, Functions). Vérifie la forme exacte des requêtes :
 * clé publique, jeton utilisateur, upsert ON CONFLICT DO NOTHING, mise à jour conditionnelle.
 */
import { readFileSync } from "node:fs";
import { test, expect, openApp, NOW, ADE_URL } from "./helpers.js";

const SUPA = "https://demo-projet.supabase.co";
const UID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c2lnbmF0dXJlLWRlLXRlc3Q`;
const EXP = Math.floor(NOW.getTime() / 1000) + 3600 * 24;
const ANON_KEY = jwt({ iss: "supabase", role: "anon", exp: EXP });
const ACCESS = jwt({ sub: UID, role: "authenticated", aud: "authenticated", email: "tom@example.com", exp: EXP, iat: EXP - 3600, session_id: "s1" });
const ICS = readFileSync(new URL("../fixtures/edt/ade-semestre-anonymise.ics", import.meta.url), "utf8");
const USER = { id: UID, aud: "authenticated", role: "authenticated", email: "tom@example.com", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS", "Access-Control-Expose-Headers": "*" };

function micros() {
    const d = new Date(Date.now());
    return `${d.toISOString().slice(0, 23)}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}+00:00`;
}

test("supabase-js réel : connexion, synchronisation (upsert, mise à jour conditionnelle), temps réel et EDT", async ({ page, problems }) => {
    const rows = new Map();
    const calls = [];
    let lastTs = "";
    const nextTs = () => {
        let ts = micros();
        if (ts <= lastTs) ts = lastTs.replace(/(\d{3})\+00:00$/, (m, n) => `${String(Number(n) + 1).padStart(3, "0")}+00:00`);
        lastTs = ts;
        return ts;
    };

    await page.route("**/config.js", (route) =>
        route.fulfill({ contentType: "text/javascript", body: `window.GDN_CONFIG = { supabaseUrl: "${SUPA}", supabaseKey: "${ANON_KEY}" };` })
    );
    await page.route(`${SUPA}/**`, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const headers = req.headers();
        if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: CORS });
        calls.push({ method: req.method(), path: url.pathname, search: url.search, headers, body: req.postData() });
        const json = (status, body, extra = {}) => route.fulfill({ status, headers: { ...CORS, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
        if (url.pathname === "/auth/v1/token") {
            const body = JSON.parse(req.postData());
            if (body.password !== "motdepasse") return json(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: "invalid_credentials" });
            return json(200, { access_token: ACCESS, token_type: "bearer", expires_in: 86400, expires_at: EXP, refresh_token: "jeton-de-rafraichissement", user: USER });
        }
        if (url.pathname === "/auth/v1/user") return json(200, USER);
        if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers: CORS });
        // Toutes les requêtes de données exigent la clé publique ET le jeton de l'utilisateur
        expect(headers.apikey).toBe(ANON_KEY);
        if (url.pathname.startsWith("/rest/v1") || url.pathname.startsWith("/functions/v1")) expect(headers.authorization).toBe(`Bearer ${ACCESS}`);
        if (url.pathname === "/rest/v1/rpc/server_time") return json(200, new Date(NOW.getTime()).toISOString().replace("Z", "000+00:00"));
        if (url.pathname === "/functions/v1/edt-proxy") return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "text/calendar; charset=utf-8" }, body: ICS });
        if (url.pathname === "/rest/v1/items") {
            const params = url.searchParams;
            if (req.method() === "GET") {
                let list = [...rows.values()];
                const gte = params.get("updated_at");
                if (gte && gte.startsWith("gte.")) list = list.filter((r) => r.updated_at >= gte.slice(4));
                const idEq = params.get("id");
                if (idEq && idEq.startsWith("eq.")) list = list.filter((r) => r.id === idEq.slice(3));
                list.sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1));
                return json(200, list);
            }
            if (req.method() === "POST") {
                const payload = JSON.parse(req.postData());
                const inserted = [];
                for (const r of payload) {
                    if (rows.has(r.id)) continue; // ON CONFLICT DO NOTHING
                    const ts = nextTs();
                    const row = { ...r, created_at: ts, updated_at: ts };
                    rows.set(r.id, row);
                    inserted.push(row);
                }
                return json(201, inserted);
            }
            if (req.method() === "PATCH") {
                const id = params.get("id").slice(3);
                const base = params.get("updated_at").slice(3);
                const current = rows.get(id);
                if (!current || current.updated_at !== base) return json(200, []);
                const row = { ...current, ...JSON.parse(req.postData()), updated_at: nextTs() };
                rows.set(id, row);
                return json(200, [row]);
            }
        }
        return json(404, { message: "route simulée inconnue" });
    });
    // Realtime (protocole Phoenix) : accepte l'abonnement aux changements de la table items
    const realtimeMessages = [];
    await page.routeWebSocket(/demo-projet\.supabase\.co\/realtime/, (ws) => {
        ws.onMessage((raw) => {
            const text = String(raw);
            realtimeMessages.push(text);
            const msg = JSON.parse(text);
            const isArray = Array.isArray(msg);
            const [joinRef, ref, topic, event, payload] = isArray ? msg : [msg.join_ref, msg.ref, msg.topic, msg.event, msg.payload];
            let response = {};
            if (event === "phx_join" && payload && payload.config && payload.config.postgres_changes) {
                response = { postgres_changes: payload.config.postgres_changes.map((c, i) => ({ id: 1000 + i, ...c })) };
            }
            if (event === "phx_join" || event === "heartbeat" || event === "access_token") {
                const reply = { status: "ok", response };
                ws.send(JSON.stringify(isArray ? [joinRef, ref, topic, "phx_reply", reply] : { topic, event: "phx_reply", payload: reply, ref, join_ref: joinRef }));
            }
        });
    });

    await openApp(page, "#/reglages");
    await expect(page.locator("#auth-form")).toBeVisible();
    // Mauvais mot de passe : message clair en français
    await page.locator("#auth-email").fill("tom@example.com");
    await page.locator("#auth-password").fill("faux");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("Adresse e-mail ou mot de passe incorrect.")).toBeVisible();
    await page.locator("#auth-password").fill("motdepasse");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("Connecté en tant que tom@example.com")).toBeVisible();
    await expect(page.locator("[data-sync-state=synced]:visible").first()).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.locator("#sidebar-sync [data-sync-state]").getAttribute("aria-label"), { timeout: 10000 }).toMatch(/Synchronisé/);

    // Création : upsert idempotent
    await page.goto("#/notes");
    await page.locator("#grade-name").fill("DS supabase");
    await page.locator("#grade-score").fill("14,5");
    await page.locator("#add-grade-form").getByRole("button", { name: "Ajouter" }).click();
    await expect.poll(() => [...rows.values()].filter((r) => r.collection === "grades").length, { timeout: 10000 }).toBe(1);
    const insert = calls.find((c) => c.method === "POST" && c.path === "/rest/v1/items" && c.body.includes("DS supabase"));
    expect(new URLSearchParams(insert.search).get("on_conflict")).toBe("user_id,id");
    expect(insert.headers.prefer).toMatch(/resolution=ignore-duplicates/);
    expect(insert.headers.prefer).toMatch(/return=representation/);
    const inserted = JSON.parse(insert.body)[0];
    expect(inserted).toMatchObject({ user_id: UID, collection: "grades", deleted_at: null, data: { name: "DS supabase", score: 14.5, max: 20, coeff: 1, subjectCode: "R1.01" } });
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);

    // Modification : PATCH conditionnel sur id ET updated_at, sans user_id
    await page.locator('details[data-subject="R1.01"] summary').click();
    await page.getByRole("button", { name: "Modifier DS supabase" }).click();
    await page.locator("#edit-grade-score").fill("16");
    await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
    await expect.poll(() => [...rows.values()].find((r) => r.collection === "grades").data.score, { timeout: 10000 }).toBe(16);
    const patch = calls.find((c) => c.method === "PATCH");
    const sp = new URLSearchParams(patch.search);
    expect(sp.get("id")).toBe(`eq.${inserted.id}`);
    expect(sp.get("updated_at")).toMatch(/^eq\.2026-10-13T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/);
    expect(JSON.parse(patch.body)).not.toHaveProperty("user_id");

    // Suppression logique : PATCH avec deleted_at
    await page.getByRole("button", { name: "Supprimer DS supabase" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
    await expect.poll(() => [...rows.values()].find((r) => r.collection === "grades").deleted_at, { timeout: 10000 }).not.toBeNull();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    // Emploi du temps via la fonction Edge (jeton utilisateur + clé publique)
    await page.goto("#/reglages");
    await page.locator("#edt-url").fill(ADE_URL);
    await page.getByRole("button", { name: "Enregistrer et actualiser" }).click();
    await page.goto("#/edt");
    await expect(page.locator(".edt-event").first()).toBeVisible({ timeout: 10000 });
    const fn = calls.find((c) => c.path === "/functions/v1/edt-proxy");
    expect(JSON.parse(fn.body)).toMatchObject({ url: ADE_URL, from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });

    // Temps réel : abonnement aux changements de la table items, filtrés sur l'utilisateur
    const joins = realtimeMessages.filter((m) => m.includes("phx_join") && m.includes("postgres_changes"));
    expect(joins.length).toBeGreaterThan(0);
    expect(joins[0]).toContain(`user_id=eq.${UID}`);
    expect(joins[0]).toContain('"table":"items"');

    // Aucune violation de la politique de sécurité (CSP), aucune erreur console
    expect(problems.filter((p) => !/HTTP 400 : .*auth\/v1\/token|status of 400/.test(p))).toEqual([]);
});
