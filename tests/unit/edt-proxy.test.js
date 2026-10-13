/**
 * Fonction Edge edt-proxy (supabase/functions/edt-proxy/index.ts) testée sans réseau :
 * fetch, variables d'environnement et horloge sont injectés.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleRequest, buildIcsUrl, corsHeaders, CACHE_TTL_MS } from "../../supabase/functions/edt-proxy/index.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "edt");
const ICS = readFileSync(path.join(fixtures, "ade-semestre-anonymise.ics"), "utf8");
const HTML = readFileSync(path.join(fixtures, "ade-page-direct.html"), "utf8");
const TOKEN = "ab12".repeat(40);
const SOURCE = `https://proseconsult.umontpellier.fr/direct/?data=${TOKEN},1`;
const ORIGIN = "https://tomh0999.github.io";

function makeDeps({ upstream = () => new Response(ICS, { status: 200 }), userOk = true } = {}) {
    const calls = [];
    let t = Date.parse("2026-10-13T08:00:00Z");
    const deps = {
        calls,
        advance: (ms) => (t += ms),
        env: { get: (k) => ({ SUPABASE_URL: "https://projet.supabase.co", SUPABASE_ANON_KEY: "cle-publique" })[k] },
        now: () => t,
        cache: new Map(),
        fetch: async (url, init = {}) => {
            calls.push({ url, init });
            if (url === "https://projet.supabase.co/auth/v1/user") {
                return userOk && init.headers.Authorization === "Bearer jeton.utilisateur" ? new Response(JSON.stringify({ id: "u1" }), { status: 200 }) : new Response("{}", { status: 401 });
            }
            return upstream(url, init);
        }
    };
    return deps;
}

const request = (body, { auth = "Bearer jeton.utilisateur", method = "POST", origin = ORIGIN } = {}) =>
    new Request("https://projet.supabase.co/functions/v1/edt-proxy", {
        method,
        headers: { ...(auth ? { Authorization: auth } : {}), "Content-Type": "application/json", Origin: origin },
        body: method === "POST" ? JSON.stringify(body) : undefined
    });

const validBody = { url: SOURCE, from: "2026-09-28", to: "2027-01-31" };

describe("Construction de l'URL ADE (liste blanche)", () => {
    it("lien direct → export iCalendar avec plage de dates", () => {
        const r = buildIcsUrl(SOURCE, "2026-09-28", "2027-01-31");
        expect(r.ok).toBe(true);
        const u = new URL(r.url);
        expect(u.origin).toBe("https://proseconsult.umontpellier.fr");
        expect(u.pathname).toBe("/jsp/custom/modules/plannings/direct_cal.jsp");
        expect(u.searchParams.get("data")).toBe(`${TOKEN},1`);
        expect([...u.searchParams.keys()].sort()).toEqual(["data", "firstDate", "lastDate"]);
    });
    it.each([
        ["https://evil.example.com/direct/?data=" + TOKEN, "forbidden-url"],
        ["https://proseconsult.umontpellier.fr.evil.com/direct/?data=" + TOKEN, "forbidden-url"],
        ["http://proseconsult.umontpellier.fr/direct/?data=" + TOKEN, "forbidden-url"],
        ["https://proseconsult.umontpellier.fr:8443/direct/?data=" + TOKEN, "forbidden-url"],
        ["https://user:pass@proseconsult.umontpellier.fr/direct/?data=" + TOKEN, "forbidden-url"],
        ["https://proseconsult.umontpellier.fr/jsp/admin.jsp?data=" + TOKEN, "forbidden-url"],
        ["https://proseconsult.umontpellier.fr/direct/?data=../../etc", "forbidden-url"],
        ["https://proseconsult.umontpellier.fr/direct/", "forbidden-url"],
        ["pas une url", "forbidden-url"],
        [undefined, "no-url"]
    ])("refuse %s", (url, code) => {
        expect(buildIcsUrl(url, "2026-09-28", "2026-10-28")).toMatchObject({ ok: false, code });
    });
    it("paramètres supplémentaires ignorés (pas d'injection)", () => {
        const r = buildIcsUrl(`${SOURCE}&resources=1&projectId=2&firstDate=1900-01-01`, "2026-09-28", "2026-10-01");
        expect([...new URL(r.url).searchParams.keys()].sort()).toEqual(["data", "firstDate", "lastDate"]);
        expect(new URL(r.url).searchParams.get("firstDate")).toBe("2026-09-28");
    });
    it("plage de dates invalide ou trop grande refusée", () => {
        expect(buildIcsUrl(SOURCE, "2026-02-30", "2026-03-01")).toMatchObject({ ok: false, code: "bad-range" });
        expect(buildIcsUrl(SOURCE, "2026-10-01", "2026-09-01")).toMatchObject({ ok: false, code: "bad-range" });
        expect(buildIcsUrl(SOURCE, "2026-01-01", "2028-01-01")).toMatchObject({ ok: false, code: "bad-range" });
    });
});

describe("Requêtes", () => {
    let deps;
    beforeEach(() => {
        deps = makeDeps();
    });

    it("utilisateur connecté → calendrier, cache 12 min, puis rafraîchi", async () => {
        const r1 = await handleRequest(request(validBody), deps);
        expect(r1.status).toBe(200);
        expect(r1.headers.get("Content-Type")).toMatch(/text\/calendar/);
        expect(r1.headers.get("X-Edt-Cache")).toBe("MISS");
        expect(r1.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
        expect(await r1.text()).toBe(ICS);
        const upstreamCalls = () => deps.calls.filter((c) => c.url.startsWith("https://proseconsult")).length;
        expect(upstreamCalls()).toBe(1);
        deps.advance(CACHE_TTL_MS - 1000);
        const r2 = await handleRequest(request(validBody), deps);
        expect(r2.headers.get("X-Edt-Cache")).toBe("HIT");
        expect(upstreamCalls()).toBe(1);
        deps.advance(2000);
        await handleRequest(request(validBody), deps);
        expect(upstreamCalls()).toBe(2);
        // Pas de redirection suivie (SSRF), délai max via AbortController
        const call = deps.calls.find((c) => c.url.startsWith("https://proseconsult"));
        expect(call.init.redirect).toBe("manual");
        expect(call.init.signal).toBeDefined();
    });
    it("anonyme (sans jeton ou clé publique seule) → 401, aucune requête vers ADE", async () => {
        for (const auth of [null, "Bearer cle-publique", "Basic xxx"]) {
            const r = await handleRequest(request(validBody, { auth }), deps);
            expect(r.status).toBe(401);
        }
        expect(deps.calls.some((c) => c.url.startsWith("https://proseconsult"))).toBe(false);
    });
    it("hôte non autorisé → 400, aucune requête sortante", async () => {
        const r = await handleRequest(request({ ...validBody, url: "https://evil.example.com/direct/?data=" + TOKEN }), deps);
        expect(r.status).toBe(400);
        expect((await r.json()).code).toBe("forbidden-url");
        expect(deps.calls.some((c) => !c.url.includes("supabase.co"))).toBe(false);
    });
    it("source indisponible / lente / page HTML / erreur HTTP → messages clairs", async () => {
        const cases = [
            [() => { throw new TypeError("connexion refusée"); }, 502, "unreachable"],
            [() => { const e = new Error("abandon"); e.name = "AbortError"; throw e; }, 504, "timeout"],
            [() => new Response(HTML, { status: 200 }), 502, "format"],
            [() => new Response("", { status: 302, headers: { Location: "https://ailleurs.example" } }), 502, "upstream"],
            [() => new Response("erreur", { status: 500 }), 502, "upstream"]
        ];
        for (const [upstream, status, code] of cases) {
            const d = makeDeps({ upstream });
            const r = await handleRequest(request(validBody), d);
            expect(r.status).toBe(status);
            const body = await r.json();
            expect(body.code).toBe(code);
            expect(body.message).toBeTruthy();
            expect(JSON.stringify(body)).not.toContain(TOKEN); // le jeton n'est jamais renvoyé
        }
    });
    it("source en panne mais cache existant → ancienne version servie (STALE)", async () => {
        let fail = false;
        const d = makeDeps({ upstream: () => { if (fail) throw new TypeError("panne"); return new Response(ICS, { status: 200 }); } });
        await handleRequest(request(validBody), d);
        d.advance(CACHE_TTL_MS + 1);
        fail = true;
        const r = await handleRequest(request(validBody), d);
        expect(r.status).toBe(200);
        expect(r.headers.get("X-Edt-Cache")).toBe("STALE");
    });
    it("lien par défaut côté serveur (EDT_SOURCE_URL) si l'application n'en envoie pas", async () => {
        const d = makeDeps();
        d.env = { get: (k) => ({ SUPABASE_URL: "https://projet.supabase.co", SUPABASE_ANON_KEY: "k", EDT_SOURCE_URL: SOURCE })[k] };
        const r = await handleRequest(request({ from: "2026-09-28", to: "2026-10-28" }), d);
        expect(r.status).toBe(200);
        const r2 = await handleRequest(request({ from: "2026-09-28", to: "2026-10-28" }), makeDeps());
        expect((await r2.json()).code).toBe("no-url");
    });
    it("préflight CORS, méthode refusée, corps invalide, origine non autorisée", async () => {
        const pre = await handleRequest(new Request("https://x/functions/v1/edt-proxy", { method: "OPTIONS", headers: { Origin: ORIGIN } }), deps);
        expect(pre.status).toBe(204);
        expect(pre.headers.get("Access-Control-Allow-Headers")).toMatch(/authorization/);
        expect((await handleRequest(request(null, { method: "GET" }), deps)).status).toBe(405);
        const bad = new Request("https://x", { method: "POST", headers: { Authorization: "Bearer jeton.utilisateur", "Content-Type": "application/json" }, body: "{pas json" });
        expect((await handleRequest(bad, deps)).status).toBe(400);
        expect(corsHeaders("https://evil.example.com", deps.env)["Access-Control-Allow-Origin"]).toBeUndefined();
    });
});
