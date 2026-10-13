/**
 * Fonction Supabase Edge « edt-proxy » — récupère l'emploi du temps ADE côté serveur.
 *
 * Pourquoi : le serveur ADE de l'Université de Montpellier n'envoie aucun en-tête CORS,
 * le navigateur ne peut donc pas lire l'export iCalendar directement.
 *
 * Ce n'est PAS un proxy ouvert :
 *  - seul un utilisateur connecté au projet Supabase peut l'appeler (jeton vérifié auprès
 *    de Supabase Auth ; la clé anonyme seule est refusée) ;
 *  - une seule destination possible : https://proseconsult.umontpellier.fr, export
 *    iCalendar « direct_cal.jsp », paramètres en liste blanche (data, firstDate, lastDate) ;
 *  - plage de dates bornée, réponse limitée en taille, délai max 15 s ;
 *  - cache mémoire de 12 minutes par lien (et Cache-Control côté navigateur).
 *
 * Le lien personnel (jeton ADE) est envoyé par l'application depuis les réglages
 * synchronisés (protégés par la RLS) ; à défaut, la variable secrète EDT_SOURCE_URL est
 * utilisée. Le lien n'est jamais journalisé.
 *
 * Déploiement : voir docs/CONFIGURATION.md (étape « Emploi du temps »).
 * Fichier unique, sans dépendance : peut être collé dans l'éditeur de fonctions du tableau
 * de bord Supabase.
 */

export const ALLOWED_HOST = "proseconsult.umontpellier.fr";
const ICS_PATH = "/jsp/custom/modules/plannings/direct_cal.jsp";
const ALLOWED_INPUT_PATHS = ["/direct/", "/direct/index.jsp", ICS_PATH];
const DATA_RE = /^[0-9a-f]{16,2048}(,\d{1,3})?$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const CACHE_TTL_MS = 12 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 3_000_000;
const MAX_RANGE_DAYS = 400;
const MAX_CACHE_ENTRIES = 50;
const DEFAULT_ORIGINS = "https://tomh0999.github.io,http://localhost:4173,http://127.0.0.1:4173";

type EnvReader = { get(name: string): string | undefined };
type CacheEntry = { at: number; body: string };
export type Deps = {
    fetch: (input: string, init?: RequestInit) => Promise<Response>;
    env: EnvReader;
    now: () => number;
    cache: Map<string, CacheEntry>;
};

type UrlResult = { ok: true; url: string } | { ok: false; code: string; message: string };

function isRealDate(value: string): boolean {
    if (!DATE_RE.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Construit l'URL d'export iCalendar à partir du lien saisi (validation stricte). */
export function buildIcsUrl(sourceUrl: unknown, from: unknown, to: unknown): UrlResult {
    if (typeof sourceUrl !== "string" || sourceUrl.length > 4096) return { ok: false, code: "no-url", message: "Aucun lien d'emploi du temps configuré." };
    let parsed: URL;
    try {
        parsed = new URL(sourceUrl.trim());
    } catch {
        return { ok: false, code: "forbidden-url", message: "Lien d'emploi du temps invalide." };
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== ALLOWED_HOST || parsed.port !== "" || parsed.username || parsed.password) {
        return { ok: false, code: "forbidden-url", message: `Seuls les liens https://${ALLOWED_HOST} sont autorisés.` };
    }
    if (!ALLOWED_INPUT_PATHS.includes(parsed.pathname)) return { ok: false, code: "forbidden-url", message: "Ce lien ADE n'est pas un lien d'emploi du temps « direct »." };
    const data = parsed.searchParams.get("data");
    if (!data || !DATA_RE.test(data)) return { ok: false, code: "forbidden-url", message: "Paramètre « data » absent ou invalide." };
    if (typeof from !== "string" || typeof to !== "string" || !isRealDate(from) || !isRealDate(to)) {
        return { ok: false, code: "bad-range", message: "Plage de dates invalide (AAAA-MM-JJ attendu)." };
    }
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
    if (days < 0 || days > MAX_RANGE_DAYS) return { ok: false, code: "bad-range", message: `Plage de dates trop grande (${MAX_RANGE_DAYS} jours maximum).` };
    const out = new URL(`https://${ALLOWED_HOST}${ICS_PATH}`);
    out.searchParams.set("data", data);
    out.searchParams.set("firstDate", from);
    out.searchParams.set("lastDate", to);
    return { ok: true, url: out.toString() };
}

export function corsHeaders(origin: string | null, env: EnvReader): Record<string, string> {
    const allowed = (env.get("ALLOWED_ORIGINS") || DEFAULT_ORIGINS).split(",").map((o) => o.trim()).filter(Boolean);
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin"
    };
    if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
    return headers;
}

function json(status: number, body: Record<string, unknown>, cors: Record<string, string>): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Vérifie que l'appelant est un utilisateur connecté (la clé anonyme seule est refusée). */
export async function verifyUser(req: Request, deps: Deps): Promise<boolean> {
    const auth = req.headers.get("Authorization") || "";
    if (!/^Bearer\s+[\w.-]+$/i.test(auth)) return false;
    const base = (deps.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
    const key = deps.env.get("SUPABASE_ANON_KEY") || deps.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
    if (!base) return false;
    try {
        const res = await deps.fetch(`${base}/auth/v1/user`, { headers: { Authorization: auth, apikey: key } });
        if (!res.ok) return false;
        const user = await res.json();
        return !!(user && typeof user.id === "string" && user.id.length > 0);
    } catch {
        return false;
    }
}

function remember(cache: Map<string, CacheEntry>, key: string, entry: CacheEntry) {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
    const cors = corsHeaders(req.headers.get("Origin"), deps.env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json(405, { code: "method", message: "Méthode non autorisée." }, cors);

    if (!(await verifyUser(req, deps))) return json(401, { code: "unauthorized", message: "Connexion requise." }, cors);

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json(400, { code: "bad-request", message: "Requête invalide." }, cors);
    }
    if (!body || typeof body !== "object") return json(400, { code: "bad-request", message: "Requête invalide." }, cors);

    const source = typeof body.url === "string" && body.url.trim() ? body.url : deps.env.get("EDT_SOURCE_URL");
    const built = buildIcsUrl(source, body.from, body.to);
    if (!built.ok) return json(400, { code: built.code, message: built.message }, cors);

    const now = deps.now();
    const cached = deps.cache.get(built.url);
    if (cached && now - cached.at < CACHE_TTL_MS) return calendarResponse(cached, "HIT", cors);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let upstream: Response;
    try {
        upstream = await deps.fetch(built.url, {
            headers: { Accept: "text/calendar, text/plain;q=0.8", "User-Agent": "gestionnaire-de-notes/2 (edt-proxy)" },
            redirect: "manual",
            signal: controller.signal
        });
    } catch (e) {
        clearTimeout(timer);
        const timeout = e instanceof Error && e.name === "AbortError";
        if (cached) return calendarResponse(cached, "STALE", cors);
        return json(timeout ? 504 : 502, { code: timeout ? "timeout" : "unreachable", message: timeout ? "La source ADE ne répond pas (délai dépassé)." : "La source ADE est injoignable." }, cors);
    }
    let text: string;
    try {
        text = await upstream.text();
    } catch {
        text = "";
    } finally {
        clearTimeout(timer);
    }
    if (upstream.status !== 200) {
        if (cached) return calendarResponse(cached, "STALE", cors);
        return json(502, { code: "upstream", message: `La source ADE a répondu avec une erreur (HTTP ${upstream.status}).` }, cors);
    }
    if (text.length > MAX_BYTES) return json(502, { code: "too-large", message: "Réponse ADE anormalement volumineuse." }, cors);
    if (!/^﻿?\s*BEGIN:VCALENDAR/i.test(text)) {
        return json(502, { code: "format", message: "La source ADE n'a pas renvoyé de calendrier : le lien a peut-être expiré ou le format a changé." }, cors);
    }
    const entry = { at: now, body: text };
    remember(deps.cache, built.url, entry);
    return calendarResponse(entry, "MISS", cors);
}

function calendarResponse(entry: CacheEntry, cacheState: string, cors: Record<string, string>): Response {
    return new Response(entry.body, {
        status: 200,
        headers: {
            ...cors,
            "Content-Type": "text/calendar; charset=utf-8",
            "Cache-Control": "private, max-age=600",
            "X-Edt-Cache": cacheState,
            "X-Edt-Fetched-At": new Date(entry.at).toISOString(),
            "Access-Control-Expose-Headers": "X-Edt-Cache, X-Edt-Fetched-At"
        }
    });
}

// ---------- Point d'entrée Deno (Supabase Edge Runtime) ----------
declare const Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void; env: EnvReader } | undefined;
const sharedCache = new Map<string, CacheEntry>();
if (typeof Deno !== "undefined" && Deno && typeof Deno.serve === "function") {
    Deno.serve((req: Request) => handleRequest(req, { fetch: (input, init) => fetch(input, init), env: Deno!.env, now: () => Date.now(), cache: sharedCache }));
}
