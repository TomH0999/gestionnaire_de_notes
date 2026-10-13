/**
 * Serveur local pour les tests E2E et l'aperçu.
 *
 *  --static : sert le site tel que GitHub Pages (même sous-chemin /gestionnaire_de_notes/,
 *             Cache-Control: max-age=600, vrai config.js). C'est la « version de production ».
 *  (défaut) : idem + mode test : config.js de test, API de synchronisation émulée
 *             (MemoryServer partagé entre tous les navigateurs = plusieurs « appareils »),
 *             temps réel par Server-Sent Events, et la VRAIE fonction edt-proxy
 *             (supabase/functions/edt-proxy/index.ts) branchée sur une fixture ADE.
 *
 * Usage : node tests/mock-server/server.mjs [--static] [--port 4173]
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MemoryServer } from "../../js/data/backends/memory-server.js";
import { handleRequest as edtProxy } from "../../supabase/functions/edt-proxy/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const STATIC_ONLY = args.includes("--static");
const PORT = Number(args[args.indexOf("--port") + 1]) || Number(process.env.PORT) || 4173;
export const BASE = "/gestionnaire_de_notes/";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".ics": "text/calendar; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8"
};

const FIXTURES = path.join(root, "tests", "fixtures", "edt");
const fixture = (name) => readFileSync(path.join(FIXTURES, name), "utf8");

let state;
function reset() {
    const server = new MemoryServer();
    server.signUp("tom@example.com", "motdepasse");
    server.signUp("autre@example.com", "motdepasse2");
    state = { server, edtMode: "ok", edtCalls: 0, edtCache: new Map(), streams: new Set(), apiDelayMs: 0 };
}
reset();

const TEST_CONFIG = `window.GDN_CONFIG = { testBackend: { module: "tests/mock-server/http-test-backend.js", baseUrl: "__test/api" } };\n`;

function send(res, status, body, headers = {}) {
    res.writeHead(status, { "Cache-Control": "no-store", ...headers });
    res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8" });

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : {};
}

function tokenOf(req, url) {
    const h = req.headers.authorization || "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1] : url.searchParams.get("token");
}

function errorStatus(e) {
    if (e && e.kind === "auth") return e.status || 401;
    return e && e.status ? e.status : 500;
}

async function handleApi(req, res, url, sub) {
    if (state.apiDelayMs) await new Promise((r) => setTimeout(r, state.apiDelayMs));
    const s = state.server;
    try {
        if (sub === "stream") {
            const userToken = tokenOf(req, url);
            let unsubscribe;
            try {
                unsubscribe = s.subscribe(userToken, (row) => res.write(`data: ${JSON.stringify(row)}\n\n`));
            } catch (e) {
                return json(res, 401, { message: e.message });
            }
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
            res.write(": ok\n\n");
            const ping = setInterval(() => res.write(": ping\n\n"), 15000);
            const entry = { res, close: () => res.end() };
            state.streams.add(entry);
            req.on("close", () => {
                clearInterval(ping);
                unsubscribe();
                state.streams.delete(entry);
            });
            return;
        }
        const body = req.method === "POST" ? await readBody(req) : {};
        const token = tokenOf(req, url);
        switch (sub) {
            case "auth/signin":
                return json(res, 200, s.signIn(body.email, body.password));
            case "auth/signup":
                return json(res, 200, s.signUp(body.email, body.password));
            case "auth/signout":
                s.signOut(token);
                return json(res, 200, {});
            case "auth/check":
                s.authenticate(token);
                return json(res, 200, { ok: true });
            case "time":
                return json(res, 200, { time: s.serverTime(token) });
            case "pull":
                return json(res, 200, { rows: s.select(token, { since: body.since ?? null, limit: body.limit ?? 500 }) });
            case "insert":
                return json(res, 200, { rows: s.insertMany(token, body.rows || []) });
            case "update":
                return json(res, 200, { row: s.updateIf(token, body.row, body.base) });
            case "get":
                return json(res, 200, { row: s.get(token, body.id) });
            default:
                return json(res, 404, { message: "API inconnue" });
        }
    } catch (e) {
        return json(res, errorStatus(e), { message: e.message, code: e.code || null, kind: e.kind || null });
    }
}

/** La vraie fonction edt-proxy, avec une « source ADE » simulée selon le mode choisi par le test. */
async function handleEdt(req, res, origin) {
    const body = await new Promise((resolve) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    const headers = {};
    for (const name of ["authorization", "content-type", "origin"]) if (req.headers[name]) headers[name] = req.headers[name];
    const request = new Request(`${origin}/functions/v1/edt-proxy`, { method: req.method, headers, body: req.method === "POST" ? body : undefined });
    const deps = {
        env: { get: (k) => ({ SUPABASE_URL: `${origin}/__test/supabase`, SUPABASE_ANON_KEY: "cle-publique-de-test", ALLOWED_ORIGINS: origin })[k] },
        now: () => Date.now(),
        cache: state.edtCache,
        fetch: async (target, init = {}) => {
            if (target.startsWith(`${origin}/__test/supabase/auth/v1/user`)) {
                const tk = (init.headers.Authorization || "").replace(/^Bearer\s+/i, "");
                try {
                    return new Response(JSON.stringify({ id: state.server.authenticate(tk) }), { status: 200 });
                } catch {
                    return new Response("{}", { status: 401 });
                }
            }
            state.edtCalls++;
            const mode = state.edtMode;
            if (mode === "down") throw new TypeError("connexion refusée");
            if (mode === "timeout") {
                const e = new Error("délai");
                e.name = "AbortError";
                throw e;
            }
            if (mode === "html") return new Response(fixture("ade-page-direct.html"), { status: 200 });
            if (mode === "empty") return new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n", { status: 200 });
            if (mode === "edge") return new Response(fixture("cas-limites.ics"), { status: 200 });
            if (mode === "both") return new Response(fixture("ade-semestre-anonymise.ics").replace(/END:VCALENDAR\s*$/, "") + fixture("cas-limites.ics").replace(/^[\s\S]*?(?=BEGIN:VEVENT)/, ""), { status: 200 });
            return new Response(fixture("ade-semestre-anonymise.ics"), { status: 200 });
        }
    };
    const response = await edtProxy(request, deps);
    send(res, response.status, Buffer.from(await response.arrayBuffer()), Object.fromEntries(response.headers.entries()));
}

async function handleControl(req, res, sub) {
    const body = req.method === "POST" ? await readBody(req) : {};
    if (sub === "reset") {
        for (const s of state.streams) s.close();
        reset();
        return json(res, 200, { ok: true });
    }
    if (sub === "edt-mode") {
        state.edtMode = body.mode || "ok";
        state.edtCache.clear();
        return json(res, 200, { ok: true });
    }
    if (sub === "edt-calls") return json(res, 200, { calls: state.edtCalls });
    if (sub === "expire-tokens") {
        for (const token of state.server.sessions.keys()) state.server.expireToken(token);
        return json(res, 200, { ok: true });
    }
    if (sub === "api-delay") {
        state.apiDelayMs = Number(body.ms) || 0;
        return json(res, 200, { ok: true });
    }
    if (sub === "rows") {
        const user = state.server.users.get(body.email || "tom@example.com");
        return json(res, 200, { rows: user ? state.server.rowsOf(user.id) : [] });
    }
    return json(res, 404, { message: "contrôle inconnu" });
}

async function serveFile(req, res, relPath) {
    let rel = decodeURIComponent(relPath);
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || rel.includes("node_modules") || rel.startsWith(".git")) return send(res, 403, "Interdit");
    if (!existsSync(file)) return send(res, 404, "Introuvable", { "Content-Type": "text/plain; charset=utf-8" });
    const data = await readFile(file);
    send(res, 200, data, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "max-age=600" });
}

const httpServer = http.createServer(async (req, res) => {
    try {
        const origin = `http://${req.headers.host}`;
        const url = new URL(req.url, origin);
        if (url.pathname === "/" || url.pathname === BASE.slice(0, -1)) return send(res, 302, "", { Location: BASE });
        if (!STATIC_ONLY) {
            if (url.pathname.startsWith("/__test/api/")) return handleApi(req, res, url, url.pathname.slice("/__test/api/".length));
            if (url.pathname.startsWith(`${BASE}__test/api/`)) return handleApi(req, res, url, url.pathname.slice(`${BASE}__test/api/`.length));
            if (url.pathname.startsWith(`${BASE}__test/edt`)) return handleEdt(req, res, origin);
            if (url.pathname.startsWith("/__test/control/")) return handleControl(req, res, url.pathname.slice("/__test/control/".length));
            if (url.pathname === `${BASE}config.js`) return send(res, 200, TEST_CONFIG, { "Content-Type": MIME[".js"], "Cache-Control": "max-age=600" });
        }
        if (!url.pathname.startsWith(BASE)) return send(res, 404, "Introuvable");
        return serveFile(req, res, url.pathname.slice(BASE.length));
    } catch (e) {
        console.error(e);
        send(res, 500, "Erreur serveur");
    }
});

httpServer.listen(PORT, "127.0.0.1", () => {
    console.log(`Serveur ${STATIC_ONLY ? "statique (production)" : "de test"} : http://127.0.0.1:${PORT}${BASE}`);
});
