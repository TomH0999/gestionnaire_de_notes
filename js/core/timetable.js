/**
 * Emploi du temps : analyse iCalendar (export ADE), normalisation et mise en page.
 *
 * Format réel observé (ADE 6.x, direct_cal.jsp) :
 *   DTSTART/DTEND en UTC (suffixe Z), SUMMARY = intitulé abrégé ("Intro. systèmes"),
 *   LOCATION = salle, DESCRIPTION = "\n\n<groupe>\n<statut>\n<NOM   PRÉNOM>\n(Exported :…)\n",
 *   lignes repliées (RFC 5545) et fins de ligne CRLF.
 * Le parseur reste tolérant : TZID, heures flottantes, VALUE=DATE, DURATION, STATUS:CANCELLED.
 */
import { zonedTimeToUtc, isValidTimeZone, isValidDayKey, parisStartOfDay, PARIS_TZ, DAY_MS } from "./dates.js";

export class TimetableFormatError extends Error {
    constructor(message, code = "format") {
        super(message);
        this.name = "TimetableFormatError";
        this.code = code;
    }
}

const MAX_INPUT_LENGTH = 5_000_000;
const MAX_EVENTS = 5000;
const MAX_TEXT = 2000;
const MIN_DURATION_MS = 15 * 60000;

export function unfoldLines(text) {
    const out = [];
    for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
        if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
            out[out.length - 1] += line.slice(1);
        } else {
            out.push(line);
        }
    }
    return out;
}

function splitOutsideQuotes(text, separator) {
    const parts = [];
    let current = "";
    let inQuote = false;
    for (const ch of text) {
        if (ch === '"') inQuote = !inQuote;
        if (ch === separator && !inQuote) {
            parts.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts;
}

/** "NOM;PARAM=VAL:valeur" → { name, params, value } (null si la ligne est invalide). */
export function parseContentLine(line) {
    let inQuote = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQuote = !inQuote;
        else if (ch === ":" && !inQuote) {
            colon = i;
            break;
        }
    }
    if (colon <= 0) return null;
    const segments = splitOutsideQuotes(line.slice(0, colon), ";");
    const name = segments[0].trim().toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(name)) return null;
    const params = {};
    for (const seg of segments.slice(1)) {
        const eq = seg.indexOf("=");
        if (eq > 0) params[seg.slice(0, eq).trim().toUpperCase()] = seg.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
    }
    return { name, params, value: line.slice(colon + 1) };
}

export function unescapeText(value) {
    return value.replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

/** DTSTART/DTEND → { ms, allDay } ou null. */
export function parseIcsDateTime(value, params = {}) {
    const v = String(value).trim();
    if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
        const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
        if (!m) return null;
        const key = `${m[1]}-${m[2]}-${m[3]}`;
        if (!isValidDayKey(key)) return null;
        return { ms: parisStartOfDay(key), allDay: true };
    }
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const h = Number(m[4]);
    const mi = Number(m[5]);
    const s = Number(m[6] || 0);
    if (!isValidDayKey(`${m[1]}-${m[2]}-${m[3]}`) || h > 23 || mi > 59 || s > 59) return null;
    if (m[7]) return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false };
    let tz = PARIS_TZ;
    if (params.TZID) {
        const candidate = params.TZID.replace(/^\//, "");
        if (isValidTimeZone(candidate)) tz = candidate;
    }
    return { ms: zonedTimeToUtc(y, mo, d, h, mi, s, tz), allDay: false };
}

export function parseDuration(value) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value).trim());
    if (!m || value.trim() === "P" || value.trim().endsWith("T")) return null;
    const seconds = (Number(m[2] || 0) * 7 + Number(m[3] || 0)) * 86400 + Number(m[4] || 0) * 3600 + Number(m[5] || 0) * 60 + Number(m[6] || 0);
    return (m[1] === "-" ? -1 : 1) * seconds * 1000;
}

const truncate = (text, max) => (text.length > max ? text.slice(0, max) : text);

function buildRawEvent(props, warnings) {
    const start = props.DTSTART ? parseIcsDateTime(props.DTSTART.value, props.DTSTART.params) : null;
    if (!start) {
        warnings.push("Événement sans date de début valide ignoré.");
        return null;
    }
    let end = null;
    if (props.DTEND) {
        const e = parseIcsDateTime(props.DTEND.value, props.DTEND.params);
        if (e) end = e.ms;
    }
    if (end === null && props.DURATION) {
        const d = parseDuration(props.DURATION.value);
        if (d !== null) end = start.ms + d;
    }
    if (end === null) end = start.ms + (start.allDay ? DAY_MS : 3600000);
    if (end <= start.ms) end = start.ms + (start.allDay ? DAY_MS : MIN_DURATION_MS);
    const text = (name) => (props[name] ? truncate(unescapeText(props[name].value).trim(), MAX_TEXT) : "");
    return {
        uid: text("UID"),
        summary: text("SUMMARY"),
        location: text("LOCATION"),
        description: text("DESCRIPTION"),
        status: props.STATUS ? props.STATUS.value.trim().toUpperCase() : "",
        start: start.ms,
        end,
        allDay: start.allDay
    };
}

/** Analyse un texte iCalendar. Lève TimetableFormatError si ce n'est pas un calendrier. */
export function parseICS(text) {
    if (typeof text !== "string" || text.trim() === "") {
        throw new TimetableFormatError("La source a renvoyé une réponse vide.", "empty");
    }
    if (text.length > MAX_INPUT_LENGTH) {
        throw new TimetableFormatError("L'emploi du temps reçu est anormalement volumineux.", "too-large");
    }
    const clean = text.replace(/^\uFEFF/, "");
    if (!/^\s*BEGIN:VCALENDAR/i.test(clean)) {
        const looksHtml = /<html|<!doctype|<body/i.test(clean);
        throw new TimetableFormatError(
            looksHtml
                ? "La source a renvoyé une page web au lieu d'un calendrier : le format a peut-être changé ou le lien a expiré."
                : "Le contenu reçu n'est pas un calendrier iCalendar (format inattendu).",
            looksHtml ? "html" : "not-ics"
        );
    }
    const events = [];
    const warnings = [];
    let current = null;
    let nested = 0;
    let sawEnd = false;
    for (const line of unfoldLines(clean)) {
        if (!line.trim()) continue;
        const prop = parseContentLine(line);
        if (!prop) {
            warnings.push("Ligne illisible ignorée.");
            continue;
        }
        if (prop.name === "BEGIN") {
            const comp = prop.value.trim().toUpperCase();
            if (current) nested++;
            else if (comp === "VEVENT") current = {};
            continue;
        }
        if (prop.name === "END") {
            const comp = prop.value.trim().toUpperCase();
            if (current && nested > 0) {
                nested--;
            } else if (current && comp === "VEVENT") {
                const ev = buildRawEvent(current, warnings);
                if (ev) events.push(ev);
                current = null;
                if (events.length >= MAX_EVENTS) {
                    warnings.push("Nombre maximal d'événements atteint : la suite est ignorée.");
                    break;
                }
            } else if (comp === "VCALENDAR") {
                sawEnd = true;
            }
            continue;
        }
        if (current && nested === 0 && !(prop.name in current)) current[prop.name] = prop;
    }
    if (current) warnings.push("Dernier événement incomplet ignoré.");
    if (!sawEnd) warnings.push("Fin du calendrier absente (contenu peut-être tronqué).");
    return { events, warnings };
}

// ---------- Normalisation ----------

const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const UPPER = "A-ZÀ-ÖØ-Þ";
const TEACHER_RE = new RegExp(`^[${UPPER}][${UPPER}'’\\-]*(?: [${UPPER}][${UPPER}'’\\-]*)*\\s{2,}[${UPPER}][${UPPER}'’\\- ]*$`);
const STATUS_LINE_RE = /^(a|à) valider$|^valid[ée]$/i;
const EXPORT_LINE_RE = /^\(export/i;

function capitalizeWords(text) {
    return text
        .toLowerCase()
        .split(/(\s+|-)/)
        .map((part) => (part.trim() && part !== "-" ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join("");
}

/** "BAZIN   ALEXANDRE" → "Alexandre BAZIN" */
export function formatTeacher(line) {
    const parts = line.trim().split(/\s{2,}/);
    const last = parts[0].trim();
    const first = parts.slice(1).join(" ").trim();
    return first ? `${capitalizeWords(first)} ${last}` : last;
}

const SUBJECT_RULES = [
    { re: /\bsae\b[^0-9]*?s?1\.?0?([1-6])\b/, code: (m) => `SAE 1.0${m[1]}` },
    { re: /initiation au dev/, code: "R1.01" },
    { re: /interfaces? web|\bdev\.? web/, code: "R1.02" },
    { re: /\barchi/, code: "R1.03" },
    { re: /\bsystemes?\b|\bsysteme d/, code: "R1.04" },
    { re: /\bb\.?\s?d\b|bases? de donnees/, code: "R1.05" },
    { re: /maths?\.? discr/, code: "R1.06" },
    { re: /outils maths?|maths?\.? fondamenta/, code: "R1.07" },
    { re: /\bgestion\b/, code: "R1.08" },
    { re: /\becono/, code: "R1.09" },
    { re: /\banglais\b/, code: "R1.10" },
    { re: /\bcomm(\.|unication|\b)/, code: "R1.11" },
    { re: /\bppp\b|projet perso/, code: "R1.12" }
];

/** Associe un intitulé ADE à une matière de l'application (null si inconnue). */
export function matchSubject(title) {
    const t = strip(title || "");
    for (const rule of SUBJECT_RULES) {
        const m = rule.re.exec(t);
        if (m) return typeof rule.code === "function" ? rule.code(m) : rule.code;
    }
    return null;
}

/** Type de séance déduit de l'intitulé (ADE ne le fournit pas explicitement ici). */
export function inferType(title) {
    const t = strip(title || "");
    if (/\bcm\b/.test(t)) return "CM";
    if (/\btd\b/.test(t)) return "TD";
    if (/\btp\b/.test(t)) return "TP";
    if (/\b(test|examen|controle|ds|partiel|rattrapage)\b/.test(t)) return "Évaluation";
    if (/autonomie/.test(t)) return "Autonomie";
    if (/\bsoutien\b/.test(t)) return "Soutien";
    if (/\bsae\b/.test(t)) return "SAÉ";
    return null;
}

function simpleHash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

export function normalizeEvent(raw) {
    const title = raw.summary || "Séance sans intitulé";
    const lines = raw.description
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !EXPORT_LINE_RE.test(l));
    const teachers = [];
    const groups = [];
    const remarks = [];
    for (const line of lines) {
        if (STATUS_LINE_RE.test(line)) continue;
        if (TEACHER_RE.test(line)) teachers.push(formatTeacher(line));
        else if (/annul|report/i.test(line)) remarks.push(line);
        else groups.push(line);
    }
    const cancelled = raw.status === "CANCELLED" || /\bannul/i.test(strip(title)) || remarks.some((r) => /annul/i.test(r));
    return {
        id: raw.uid || `ev-${raw.start}-${simpleHash(title)}`,
        title,
        subjectCode: matchSubject(title),
        type: inferType(title),
        room: raw.location || "",
        teachers,
        groups,
        remarks,
        start: raw.start,
        end: raw.end,
        allDay: raw.allDay,
        cancelled
    };
}

/** Analyse + normalisation + tri chronologique + dédoublonnage par identifiant. */
export function parseTimetable(text) {
    const { events, warnings } = parseICS(text);
    const byId = new Map();
    for (const raw of events) {
        const ev = normalizeEvent(raw);
        let id = ev.id;
        // Identifiants en double (rare) : on garde les deux en suffixant
        let n = 1;
        while (byId.has(id)) id = `${ev.id}#${n++}`;
        byId.set(id, { ...ev, id });
    }
    const list = [...byId.values()].sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
    return { events: list, warnings };
}

// ---------- Mise en page et repères ----------

/**
 * Colonnes pour les cours qui se chevauchent (groupes en parallèle).
 * Renvoie [{ event, col, cols }] : `cols` = nombre de colonnes de la grappe.
 */
export function layoutOverlaps(events) {
    const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    let cluster = [];
    let clusterEnd = -Infinity;
    const flush = () => {
        const columnsEnd = [];
        const placed = [];
        for (const ev of cluster) {
            let col = columnsEnd.findIndex((end) => end <= ev.start);
            if (col === -1) {
                col = columnsEnd.length;
                columnsEnd.push(ev.end);
            } else {
                columnsEnd[col] = ev.end;
            }
            placed.push({ event: ev, col });
        }
        for (const p of placed) out.push({ ...p, cols: columnsEnd.length });
        cluster = [];
        clusterEnd = -Infinity;
    };
    for (const ev of sorted) {
        if (cluster.length > 0 && ev.start >= clusterEnd) flush();
        cluster.push(ev);
        clusterEnd = Math.max(clusterEnd, ev.end);
    }
    if (cluster.length > 0) flush();
    return out;
}

/** Cours en cours (peut y en avoir plusieurs) et prochain cours à partir de `now`. */
export function findCurrentAndNext(events, now) {
    const active = events.filter((e) => !e.cancelled && !e.allDay).sort((a, b) => a.start - b.start);
    return {
        current: active.filter((e) => e.start <= now && now < e.end),
        next: active.find((e) => e.start > now) || null
    };
}

/** Couleurs par matière (classes Tailwind complètes, lisibles sur fond sombre). */
export const SUBJECT_COLORS = {
    "R1.01": { block: "bg-blue-500/15 border-blue-400", dot: "bg-blue-400", text: "text-blue-300" },
    "R1.02": { block: "bg-cyan-500/15 border-cyan-400", dot: "bg-cyan-400", text: "text-cyan-300" },
    "R1.03": { block: "bg-teal-500/15 border-teal-400", dot: "bg-teal-400", text: "text-teal-300" },
    "R1.04": { block: "bg-emerald-500/15 border-emerald-400", dot: "bg-emerald-400", text: "text-emerald-300" },
    "R1.05": { block: "bg-lime-500/15 border-lime-400", dot: "bg-lime-400", text: "text-lime-300" },
    "R1.06": { block: "bg-violet-500/15 border-violet-400", dot: "bg-violet-400", text: "text-violet-300" },
    "R1.07": { block: "bg-purple-500/15 border-purple-400", dot: "bg-purple-400", text: "text-purple-300" },
    "R1.08": { block: "bg-amber-500/15 border-amber-400", dot: "bg-amber-400", text: "text-amber-300" },
    "R1.09": { block: "bg-orange-500/15 border-orange-400", dot: "bg-orange-400", text: "text-orange-300" },
    "R1.10": { block: "bg-pink-500/15 border-pink-400", dot: "bg-pink-400", text: "text-pink-300" },
    "R1.11": { block: "bg-rose-500/15 border-rose-400", dot: "bg-rose-400", text: "text-rose-300" },
    "R1.12": { block: "bg-fuchsia-500/15 border-fuchsia-400", dot: "bg-fuchsia-400", text: "text-fuchsia-300" },
    SAE: { block: "bg-indigo-500/15 border-indigo-400", dot: "bg-indigo-400", text: "text-indigo-300" }
};
const DEFAULT_COLOR = { block: "bg-slate-500/15 border-slate-400", dot: "bg-slate-400", text: "text-slate-300" };

export function subjectColor(code) {
    if (!code) return DEFAULT_COLOR;
    if (code.startsWith("SAE")) return SUBJECT_COLORS.SAE;
    return SUBJECT_COLORS[code] || DEFAULT_COLOR;
}
