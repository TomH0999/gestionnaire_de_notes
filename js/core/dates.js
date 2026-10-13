/**
 * Dates et heures en Europe/Paris, indépendamment du fuseau de l'appareil.
 *
 * Deux représentations :
 *  - instants absolus : millisecondes depuis l'époque (UTC), ex. début d'un cours ;
 *  - dates calendaires : clés "AAAA-MM-JJ" (pas de fuseau), ex. échéance d'un devoir.
 * L'arithmétique sur les dates calendaires se fait en UTC pur (pas de piège d'heure d'été).
 */
export const PARIS_TZ = "Europe/Paris";
export const DAY_MS = 86400000;

const pad2 = (n) => String(n).padStart(2, "0");
const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

const partsFormatters = new Map();
function partsFormatter(tz) {
    let f = partsFormatters.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            hourCycle: "h23",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
            weekday: "short"
        });
        partsFormatters.set(tz, f);
    }
    return f;
}

export function isValidTimeZone(tz) {
    try {
        partsFormatter(tz);
        return true;
    } catch {
        return false;
    }
}

/** Composantes de l'heure murale d'un instant dans un fuseau (Paris par défaut). */
export function zonedParts(ms, tz = PARIS_TZ) {
    const out = {};
    for (const p of partsFormatter(tz).formatToParts(new Date(ms))) out[p.type] = p.value;
    let hour = Number(out.hour);
    if (hour === 24) hour = 0; // anciens moteurs : minuit affiché « 24 »
    return {
        year: Number(out.year),
        month: Number(out.month),
        day: Number(out.day),
        hour,
        minute: Number(out.minute),
        second: Number(out.second),
        weekday: WEEKDAY_INDEX[out.weekday]
    };
}

/** Décalage (ms) du fuseau par rapport à UTC à un instant donné (+2 h l'été à Paris). */
export function tzOffset(ms, tz = PARIS_TZ) {
    const p = zonedParts(ms, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Instant correspondant à une heure murale dans un fuseau.
 * Heure inexistante (passage à l'heure d'été) : décalée d'une heure vers l'avant.
 * Heure ambiguë (passage à l'heure d'hiver) : seconde occurrence (heure d'hiver).
 */
export function zonedTimeToUtc(year, month, day, hour = 0, minute = 0, second = 0, tz = PARIS_TZ) {
    const wall = Date.UTC(year, month - 1, day, hour, minute, second);
    const o1 = tzOffset(wall, tz);
    let utc = wall - o1;
    const o2 = tzOffset(utc, tz);
    if (o2 !== o1) utc = wall - o2;
    return utc;
}

// ---------- Dates calendaires "AAAA-MM-JJ" ----------

export function dayKey(year, month, day) {
    return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

export function parseDayKey(key) {
    if (typeof key !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    return { year, month, day };
}

export function isValidDayKey(key) {
    return parseDayKey(key) !== null;
}

export function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function keyToUtcMs(key) {
    const p = parseDayKey(key);
    if (!p) throw new RangeError(`Date invalide : ${key}`);
    return Date.UTC(p.year, p.month - 1, p.day);
}

function utcMsToKey(ms) {
    const d = new Date(ms);
    return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(key, n) {
    return utcMsToKey(keyToUtcMs(key) + n * DAY_MS);
}

/** Nombre de jours calendaires de b à a (a - b). */
export function diffDays(a, b) {
    return Math.round((keyToUtcMs(a) - keyToUtcMs(b)) / DAY_MS);
}

/** Jour de la semaine, 0 = lundi … 6 = dimanche. */
export function weekdayOf(key) {
    return (new Date(keyToUtcMs(key)).getUTCDay() + 6) % 7;
}

export function startOfWeek(key) {
    return addDays(key, -weekdayOf(key));
}

export function addMonths(key, n) {
    const p = parseDayKey(key);
    const total = p.year * 12 + (p.month - 1) + n;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    return dayKey(year, month, Math.min(p.day, daysInMonth(year, month)));
}

/** Grille d'un mois (semaines complètes du lundi au dimanche). */
export function monthGrid(year, month) {
    const first = dayKey(year, month, 1);
    const last = dayKey(year, month, daysInMonth(year, month));
    const weeks = [];
    let cursor = startOfWeek(first);
    while (diffDays(cursor, last) <= 0) {
        const week = [];
        for (let i = 0; i < 7; i++) week.push(addDays(cursor, i));
        weeks.push(week);
        cursor = addDays(cursor, 7);
    }
    return weeks;
}

// ---------- Ponts instants ↔ dates calendaires (Paris) ----------

// Les conversions date calendaire → instant sont pures : mises en cache (tri de centaines de
// devoirs, grilles de calendrier), sans effet sur les résultats.
const instantCache = new Map();
function cachedInstant(cacheKey, compute) {
    let value = instantCache.get(cacheKey);
    if (value === undefined) {
        value = compute();
        if (instantCache.size > 20000) instantCache.clear();
        instantCache.set(cacheKey, value);
    }
    return value;
}

export function parisDayKey(ms) {
    const p = zonedParts(ms);
    return dayKey(p.year, p.month, p.day);
}

/** Instant de minuit (heure de Paris) au début d'une date calendaire. */
export function parisStartOfDay(key) {
    return cachedInstant(`d|${key}`, () => {
        const p = parseDayKey(key);
        if (!p) throw new RangeError(`Date invalide : ${key}`);
        return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0);
    });
}

export function parseTime(value) {
    if (typeof value !== "string") return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!m) return null;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
}

export function parisInstant(key, time = "00:00") {
    return cachedInstant(`i|${key}|${time}`, () => {
        const p = parseDayKey(key);
        const t = parseTime(time);
        if (!p || !t) return NaN;
        return zonedTimeToUtc(p.year, p.month, p.day, t.hour, t.minute, 0);
    });
}

export function parisTime(ms) {
    const p = zonedParts(ms);
    return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Minutes écoulées depuis minuit (heure murale de Paris). */
export function parisMinutesOfDay(ms) {
    const p = zonedParts(ms);
    return p.hour * 60 + p.minute;
}

// ---------- Formats français ----------

const frFormatters = new Map();
function frFormat(key, options) {
    let f = frFormatters.get(key);
    if (!f) {
        f = new Intl.DateTimeFormat("fr-FR", options);
        frFormatters.set(key, f);
    }
    return f;
}

const calendarDate = (key) => new Date(keyToUtcMs(key) + 12 * 3600000);

/** « mardi 13 octobre » */
export function formatLongDate(key, { withYear = false } = {}) {
    const opts = { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" };
    if (withYear) opts.year = "numeric";
    return frFormat(withYear ? "longY" : "long", opts).format(calendarDate(key));
}

/** « mar. 13 oct. » */
export function formatShortDate(key) {
    return frFormat("short", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(calendarDate(key));
}

/** « 13/10 » */
export function formatDayMonth(key) {
    const p = parseDayKey(key);
    return `${pad2(p.day)}/${pad2(p.month)}`;
}

/** « octobre 2026 » */
export function formatMonthYear(year, month) {
    return frFormat("monthYear", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 15)));
}

/** « lun. », « mar. »… pour un index 0 = lundi */
export function weekdayShortName(index) {
    return ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."][index];
}

/** « Aujourd'hui », « Demain », « Hier » ou « mar. 20 oct. » */
export function formatRelativeDay(key, todayKey) {
    const d = diffDays(key, todayKey);
    if (d === 0) return "Aujourd'hui";
    if (d === 1) return "Demain";
    if (d === -1) return "Hier";
    return formatShortDate(key);
}

/** « 13/10/2026 à 12:51 » (heure de Paris) */
export function formatDateTime(ms) {
    const p = zonedParts(ms);
    return `${pad2(p.day)}/${pad2(p.month)}/${p.year} à ${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
