/**
 * Cache local de l'emploi du temps (consultable hors-ligne) et récupération via la
 * fonction serveur edt-proxy. L'emploi du temps n'est pas synchronisé entre appareils :
 * seul le lien ADE l'est (réglage « edtUrl »), chaque appareil récupère sa copie.
 */
import { parseTimetable, TimetableFormatError } from "../core/timetable.js";
import { SyncError } from "./sync-errors.js";
import { addDays, startOfWeek, parisDayKey, parisStartOfDay, diffDays } from "../core/dates.js";

export const STALE_AFTER_MS = 60 * 60 * 1000; // rafraîchissement automatique à l'ouverture au-delà d'1 h

function hashUrl(url) {
    let h = 2166136261;
    for (let i = 0; i < url.length; i++) {
        h ^= url.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

/** Message clair en français pour chaque type d'échec. */
export function describeTimetableError(error) {
    if (error instanceof TimetableFormatError) return { code: error.code, message: error.message };
    if (error instanceof SyncError) {
        if (error.kind === "network") return { code: "offline", message: "Hors-ligne : impossible de mettre à jour l'emploi du temps pour le moment." };
        if (error.kind === "auth") return { code: "auth", message: error.message || "Connectez-vous (Réglages) pour actualiser l'emploi du temps." };
        if (error.kind === "config") return { code: "config", message: error.message };
        return { code: error.code || "server", message: error.message || "La source de l'emploi du temps est indisponible." };
    }
    return { code: "unknown", message: "Erreur inattendue lors de la récupération de l'emploi du temps." };
}

export class TimetableStore {
    constructor({ store, fetcher, now = () => Date.now(), scope = () => "local" }) {
        this.store = store;
        this.fetcher = fetcher;
        this.now = now;
        this.scope = scope;
        this.listeners = new Set();
        this.status = "idle"; // idle | loading | ok | error
        this.error = null;
        this.inflight = null;
        this.load();
    }

    get key() {
        return `${this.scope()}:edt`;
    }

    load() {
        const c = this.store.getJSON(this.key, null);
        this.cache = c && Array.isArray(c.events) && Array.isArray(c.ranges) ? c : { events: [], ranges: [], sourceKey: null };
        this.error = this.cache.lastError || null;
    }

    save() {
        this.store.setJSON(this.key, this.cache);
    }

    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit() {
        for (const l of [...this.listeners]) {
            try {
                l(this);
            } catch (e) {
                console.error(e);
            }
        }
    }

    /** Le lien a changé : l'ancien cache ne correspond plus. */
    setSource(url) {
        const key = url ? hashUrl(url) : null;
        if (key !== this.cache.sourceKey) {
            this.cache = { events: [], ranges: [], sourceKey: key, lastError: null };
            this.error = null;
            this.save();
            this.emit();
        }
    }

    hasData() {
        return this.cache.ranges.length > 0;
    }

    eventsBetween(startMs, endMs) {
        return this.cache.events.filter((e) => e.end > startMs && e.start < endMs);
    }

    eventsOfDay(dayKey) {
        const start = parisStartOfDay(dayKey);
        const end = parisStartOfDay(addDays(dayKey, 1));
        return this.eventsBetween(start, end).sort((a, b) => a.start - b.start);
    }

    covers(fromKey, toKey) {
        return this.cache.ranges.some((r) => diffDays(fromKey, r.from) >= 0 && diffDays(r.to, toKey) >= 0);
    }

    /** Date de récupération de la plage qui couvre ce jour (la plus récente). */
    fetchedAtFor(dayKey) {
        let best = null;
        for (const r of this.cache.ranges) {
            if (diffDays(dayKey, r.from) >= 0 && diffDays(r.to, dayKey) >= 0 && (best === null || r.fetchedAt > best)) best = r.fetchedAt;
        }
        return best;
    }

    lastFetchedAt() {
        return this.cache.ranges.reduce((m, r) => Math.max(m, r.fetchedAt), 0) || null;
    }

    isStale(dayKey = parisDayKey(this.now())) {
        const at = this.fetchedAtFor(dayKey);
        return at === null || this.now() - at > STALE_AFTER_MS;
    }

    /** Plage chargée par défaut : 2 semaines avant la semaine courante → 16 semaines après. */
    defaultRange(dayKey = parisDayKey(this.now())) {
        const monday = startOfWeek(dayKey);
        return { from: addDays(monday, -14), to: addDays(monday, 7 * 16 - 1) };
    }

    rangeAround(dayKey) {
        const monday = startOfWeek(dayKey);
        return { from: addDays(monday, -14), to: addDays(monday, 7 * 6 - 1) };
    }

    /** Récupère une plage ; en cas d'échec le cache précédent est conservé. */
    async refresh({ url, from, to } = {}) {
        if (!url) {
            this.status = "error";
            this.error = { code: "no-url", message: "Ajoutez le lien de votre emploi du temps ADE dans Réglages." };
            this.emit();
            return false;
        }
        this.setSource(url);
        const range = from && to ? { from, to } : this.defaultRange();
        if (this.inflight) return this.inflight;
        this.status = "loading";
        this.emit();
        this.inflight = (async () => {
            try {
                const text = await this.fetcher({ url, from: range.from, to: range.to });
                const { events, warnings } = parseTimetable(text);
                this.mergeRange(range, events);
                this.status = "ok";
                this.error = null;
                this.cache.lastError = null;
                this.cache.warnings = warnings.slice(0, 5);
                this.save();
                return true;
            } catch (e) {
                this.status = "error";
                this.error = describeTimetableError(e);
                this.cache.lastError = this.error;
                this.save();
                return false;
            } finally {
                this.inflight = null;
                this.emit();
            }
        })();
        return this.inflight;
    }

    mergeRange(range, events) {
        const start = parisStartOfDay(range.from);
        const end = parisStartOfDay(addDays(range.to, 1));
        const kept = this.cache.events.filter((e) => e.start < start || e.start >= end);
        this.cache.events = [...kept, ...events.filter((e) => e.start >= start && e.start < end)].sort((a, b) => a.start - b.start);
        const fetchedAt = this.now();
        this.cache.ranges = [...this.cache.ranges.filter((r) => !(diffDays(r.from, range.from) >= 0 && diffDays(range.to, r.to) >= 0)), { ...range, fetchedAt }];
    }
}
