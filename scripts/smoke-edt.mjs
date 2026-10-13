/**
 * Smoke test MANUEL contre la vraie source ADE (hors suite automatique : réseau réel).
 *
 * Le lien personnel n'est jamais écrit dans le dépôt : il est lu dans la variable
 * d'environnement EDT_URL (ou demandé dans le terminal).
 *
 *   Lien direct (depuis votre poste) :
 *     PowerShell : $env:EDT_URL="https://proseconsult.umontpellier.fr/direct/?data=…" ; npm run smoke:edt
 *     Bash       : EDT_URL="https://…" npm run smoke:edt
 *
 *   Via la fonction Supabase déployée (vérifie aussi le déploiement) :
 *     + SUPABASE_URL=https://xxxx.supabase.co  SUPABASE_ANON_KEY=…  SUPABASE_ACCESS_TOKEN=<jeton d'un utilisateur connecté>
 *     (jeton visible dans l'application : outils de développement → stockage local → gdn-supabase-auth → access_token)
 */
import { createInterface } from "node:readline/promises";
import { buildIcsUrl } from "../supabase/functions/edt-proxy/index.ts";
import { parseTimetable } from "../js/core/timetable.js";
import { parseEdtUrl } from "../js/core/edt-url.js";
import { addDays, startOfWeek, parisDayKey, parisTime, formatLongDate } from "../js/core/dates.js";

let url = process.env.EDT_URL;
if (!url) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    url = (await rl.question("Collez le lien ADE (il ne sera pas enregistré) : ")).trim();
    rl.close();
}
const parsed = parseEdtUrl(url);
if (!parsed.ok) {
    console.error(`Lien refusé : ${parsed.error}`);
    process.exit(1);
}
const today = parisDayKey(Date.now());
const from = addDays(startOfWeek(today), -7);
const to = addDays(startOfWeek(today), 7 * 3 - 1);

async function viaProxy() {
    const res = await fetch(`${process.env.SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/edt-proxy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, apikey: process.env.SUPABASE_ANON_KEY || "", "Content-Type": "application/json", Origin: "https://tomh0999.github.io" },
        body: JSON.stringify({ url, from, to })
    });
    console.log(`Fonction edt-proxy : HTTP ${res.status}, cache ${res.headers.get("x-edt-cache")}, CORS ${res.headers.get("access-control-allow-origin")}`);
    if (!res.ok) throw new Error(await res.text());
    return res.text();
}

async function direct() {
    const built = buildIcsUrl(url, from, to);
    if (!built.ok) throw new Error(built.message);
    const res = await fetch(built.url, { headers: { Origin: "https://tomh0999.github.io" }, redirect: "manual" });
    console.log(`Source ADE directe : HTTP ${res.status}, ${res.headers.get("content-type")}, en-tête CORS : ${res.headers.get("access-control-allow-origin") || "absent (proxy nécessaire)"}`);
    return res.text();
}

const started = Date.now();
const text = process.env.SUPABASE_URL && process.env.SUPABASE_ACCESS_TOKEN ? await viaProxy() : await direct();
const { events, warnings } = parseTimetable(text);
console.log(`Analyse : ${events.length} séance(s) du ${from} au ${to} en ${Date.now() - started} ms ; ${warnings.length} avertissement(s).`);
const unmatched = events.filter((e) => !e.subjectCode).map((e) => e.title);
console.log(`Séances non associées à une matière : ${unmatched.length}${unmatched.length ? ` (${[...new Set(unmatched)].slice(0, 8).join(" | ")})` : ""}`);
for (const e of events.filter((ev) => parisDayKey(ev.start) >= today).slice(0, 6)) {
    console.log(` - ${formatLongDate(parisDayKey(e.start))} ${parisTime(e.start)}–${parisTime(e.end)} ${e.title} [${e.subjectCode || "?"}] ${e.room}${e.cancelled ? " (ANNULÉ)" : ""}`);
}
if (events.length === 0) console.log("Aucune séance sur la période (vacances ?) : vérifiez une autre semaine dans l'application.");
console.log("Smoke test terminé.");
