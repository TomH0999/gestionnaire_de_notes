/**
 * Dépôt local des données (cache hors-ligne + file d'attente des modifications).
 *
 * Chaque entrée est un « record » :
 *   { id (UUID), collection, data, deleted, clientUpdatedAt, deviceId,
 *     serverUpdatedAt (null = jamais confirmée par le serveur), dirty (à envoyer),
 *     localRev (compteur d'éditions locales), base (dernière version serveur connue
 *     au moment de la première édition locale non envoyée, pour la fusion 3 voies) }
 *
 * La « file d'attente » est l'ensemble des records `dirty` : rejouer un envoi est sans
 * risque (idempotent), on ne perd rien tant que le serveur n'a pas confirmé.
 * Les suppressions sont logiques (deleted = true), jamais physiques.
 */
import { uuidv4, uuidv5 } from "../core/uuid.js";
import { merge3, sameContent, compareServerTs } from "./merge.js";
import { sortGradesForCalculation } from "../core/grades-calc.js";

export const COLLECTIONS = ["grades", "homework", "settings"];
const MAX_CONFLICT_LOG = 100;

export function settingId(key) {
    return uuidv5(`setting:${key}`);
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Ligne serveur (snake_case) → champs de record. */
export function rowToRemote(row) {
    return {
        id: row.id,
        collection: row.collection,
        data: row.data && typeof row.data === "object" ? row.data : {},
        deleted: !!row.deleted_at,
        deletedAt: row.deleted_at || null,
        clientUpdatedAt: Date.parse(row.client_updated_at) || 0,
        deviceId: row.device_id || "",
        serverUpdatedAt: row.updated_at
    };
}

/** Record → ligne à envoyer au serveur (user_id ajouté par l'adaptateur). */
export function recordToRow(rec) {
    return {
        id: rec.id,
        collection: rec.collection,
        data: clone(rec.data),
        deleted_at: rec.deleted ? new Date(rec.deletedAt ? Date.parse(rec.deletedAt) || rec.clientUpdatedAt : rec.clientUpdatedAt).toISOString() : null,
        client_updated_at: new Date(rec.clientUpdatedAt).toISOString(),
        device_id: rec.deviceId
    };
}

export class Repository {
    /**
     * @param store    LocalStore
     * @param scope    "local" (aucun compte) ou identifiant utilisateur
     * @param deviceId identifiant stable de l'appareil
     * @param clock    () => horodatage d'édition (horloge corrigée du décalage serveur)
     */
    constructor({ store, scope = "local", deviceId, clock = () => Date.now() }) {
        this.store = store;
        this.scope = scope;
        this.deviceId = deviceId;
        this.clock = clock;
        this.records = new Map();
        this.listeners = new Set();
        this.batchDepth = 0;
        this.pendingNotify = null;
        this.persistFailed = false;
        this.load();
    }

    get key() {
        return `${this.scope}:records`;
    }

    /** Bascule vers les données d'un autre compte (ou « local ») sans changer d'objet. */
    setScope(scope) {
        if (scope === this.scope) return;
        this.scope = scope;
        this.load();
        this.notify({ source: "scope", ids: null });
    }

    load() {
        const raw = this.store.getJSON(this.key, {});
        this.records = new Map();
        if (raw && typeof raw === "object") {
            for (const [id, rec] of Object.entries(raw)) {
                if (rec && typeof rec === "object" && rec.id === id && COLLECTIONS.includes(rec.collection)) {
                    this.records.set(id, rec);
                }
            }
        }
    }

    /** Rechargement après modification par un autre onglet (événement « storage »). */
    reloadFromStorage() {
        this.load();
        this.notify({ source: "storage", ids: null });
    }

    persist() {
        const ok = this.store.setJSON(this.key, Object.fromEntries(this.records));
        this.persistFailed = !ok;
        return ok;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify(event) {
        if (this.batchDepth > 0) {
            const p = this.pendingNotify || { source: event.source, ids: new Set(), conflicts: [] };
            if (p.source !== event.source) p.source = "mixed";
            if (event.ids && p.ids) event.ids.forEach((id) => p.ids.add(id));
            else p.ids = null;
            if (event.conflicts) p.conflicts.push(...event.conflicts);
            this.pendingNotify = p;
            return;
        }
        for (const l of [...this.listeners]) {
            try {
                l(event);
            } catch (e) {
                console.error("Erreur dans un abonné du dépôt", e);
            }
        }
    }

    /** Regroupe plusieurs modifications : une seule écriture disque et une seule notification. */
    batch(fn) {
        this.batchDepth++;
        try {
            return fn();
        } finally {
            this.batchDepth--;
            if (this.batchDepth === 0) {
                this.persist();
                const p = this.pendingNotify;
                this.pendingNotify = null;
                if (p) this.notify({ source: p.source, ids: p.ids ? [...p.ids] : null, conflicts: p.conflicts });
            }
        }
    }

    commit(event) {
        if (this.batchDepth === 0) this.persist();
        this.notify(event);
    }

    // ---------- Lecture ----------

    getRecord(id) {
        return this.records.get(id) || null;
    }

    has(id) {
        return this.records.has(id);
    }

    /** Entrées vivantes d'une collection, sous forme { id, ...data }. */
    list(collection) {
        const out = [];
        for (const rec of this.records.values()) {
            if (rec.collection === collection && !rec.deleted) out.push({ ...rec.data, id: rec.id });
        }
        return out;
    }

    /** Notes dans l'ordre déterministe du calcul (reproduit l'ordre d'origine). */
    grades() {
        return sortGradesForCalculation(this.list("grades"));
    }

    homework() {
        return this.list("homework");
    }

    getSetting(key, fallback = null) {
        const rec = this.records.get(settingId(key));
        if (!rec || rec.deleted || !rec.data || !("value" in rec.data)) return fallback;
        return rec.data.value;
    }

    dirtyRecords() {
        return [...this.records.values()].filter((r) => r.dirty);
    }

    pendingCount() {
        let n = 0;
        for (const r of this.records.values()) if (r.dirty) n++;
        return n;
    }

    // ---------- Modifications locales ----------

    touch(rec) {
        if (!rec.dirty) {
            rec.base = rec.serverUpdatedAt ? { data: clone(rec.data), deleted: !!rec.deleted, clientUpdatedAt: rec.clientUpdatedAt, deviceId: rec.deviceId } : null;
        }
        rec.dirty = true;
        rec.localRev = (rec.localRev || 0) + 1;
        rec.clientUpdatedAt = Math.max(this.clock(), (rec.clientUpdatedAt || 0) + 1);
        rec.deviceId = this.deviceId;
    }

    create(collection, data, { id = uuidv4(), clientUpdatedAt = null } = {}) {
        if (!COLLECTIONS.includes(collection)) throw new Error(`Collection inconnue : ${collection}`);
        const existing = this.records.get(id);
        if (existing && !existing.deleted) throw new Error("Identifiant déjà utilisé");
        const rec = existing || { id, collection, data: {}, deleted: false, clientUpdatedAt: 0, deviceId: this.deviceId, serverUpdatedAt: null, dirty: false, localRev: 0, base: null };
        this.touch(rec);
        rec.collection = collection;
        rec.data = clone(data);
        rec.deleted = false;
        rec.deletedAt = null;
        if (clientUpdatedAt !== null) rec.clientUpdatedAt = clientUpdatedAt;
        this.records.set(id, rec);
        this.commit({ source: "local", ids: [id] });
        return { ...rec.data, id };
    }

    update(id, patch) {
        const rec = this.records.get(id);
        if (!rec || rec.deleted) throw new Error("Entrée introuvable (peut-être supprimée sur un autre appareil)");
        const next = { ...rec.data, ...clone(patch) };
        if (sameContent({ data: next, deleted: false }, rec)) return { ...rec.data, id };
        this.touch(rec);
        rec.data = next;
        this.commit({ source: "local", ids: [id] });
        return { ...rec.data, id };
    }

    remove(id) {
        const rec = this.records.get(id);
        if (!rec || rec.deleted) return false;
        this.touch(rec);
        rec.deleted = true;
        rec.deletedAt = new Date(rec.clientUpdatedAt).toISOString();
        this.commit({ source: "local", ids: [id] });
        return true;
    }

    setSetting(key, value) {
        const id = settingId(key);
        const rec = this.records.get(id);
        if (rec && !rec.deleted) {
            if (JSON.stringify(rec.data.value) === JSON.stringify(value)) return;
            return this.update(id, { key, value });
        }
        return this.create("settings", { key, value }, { id });
    }

    // ---------- Synchronisation ----------

    /**
     * Applique une ligne venant du serveur (pull ou temps réel). Idempotent.
     * Renvoie { changed, conflicts }.
     */
    applyRemote(row, { force = false } = {}) {
        if (!row || !row.id || !COLLECTIONS.includes(row.collection)) return { changed: false, conflicts: [] };
        const remote = rowToRemote(row);
        const local = this.records.get(remote.id);
        const asRecord = () => ({ ...remote, data: clone(remote.data), dirty: false, localRev: local ? local.localRev || 0 : 0, base: null });

        if (!local) {
            this.records.set(remote.id, asRecord());
            this.commit({ source: "remote", ids: [remote.id] });
            return { changed: true, conflicts: [] };
        }
        if (local.serverUpdatedAt) {
            const order = compareServerTs(remote.serverUpdatedAt, local.serverUpdatedAt);
            // Même version que celle déjà connue : rien de nouveau.
            if (order === 0) return { changed: false, conflicts: [] };
            // Version plus ancienne (événement en retard) : ignorée, sauf `force` = état serveur
            // actuel relu explicitement, qui devient la nouvelle base quoi qu'il arrive.
            if (order < 0 && !force) return { changed: false, conflicts: [] };
        }
        if (!local.dirty) {
            const visibleChange = !sameContent(local, remote);
            this.records.set(remote.id, asRecord());
            this.commit({ source: "remote", ids: visibleChange ? [remote.id] : [] });
            return { changed: visibleChange, conflicts: [] };
        }
        // Modifications locales en attente : écho de notre propre écriture ?
        if (sameContent(local, remote)) {
            const rec = asRecord();
            this.records.set(remote.id, rec);
            this.commit({ source: "remote", ids: [] });
            return { changed: false, conflicts: [] };
        }
        // Vraie divergence : fusion 3 voies
        const merged = merge3(local.base, local, remote);
        const lostLocal = merged.conflicts.filter((c) => c.winner === "remote");
        if (sameContent(merged, remote)) {
            this.records.set(remote.id, asRecord());
        } else {
            local.data = merged.data;
            local.deleted = merged.deleted;
            local.deletedAt = merged.deleted ? local.deletedAt || remote.deletedAt || new Date(local.clientUpdatedAt).toISOString() : null;
            local.base = { data: clone(remote.data), deleted: remote.deleted, clientUpdatedAt: remote.clientUpdatedAt, deviceId: remote.deviceId };
            local.serverUpdatedAt = remote.serverUpdatedAt;
            local.clientUpdatedAt = Math.max(local.clientUpdatedAt, remote.clientUpdatedAt);
            local.dirty = true;
            // Le contenu fusionné doit être renvoyé : un accusé de réception d'un envoi
            // antérieur (en vol) ne doit pas le marquer comme synchronisé.
            local.localRev = (local.localRev || 0) + 1;
        }
        const conflicts = lostLocal.length ? [this.logConflict(local, remote, lostLocal)] : [];
        this.commit({ source: "remote", ids: [remote.id], conflicts });
        return { changed: true, conflicts };
    }

    /**
     * Le serveur a accepté une écriture. Si l'entrée a encore été modifiée pendant l'envoi,
     * elle reste à envoyer avec pour base la version que le serveur vient d'enregistrer.
     */
    confirmPush(id, sentRev, sentRow, serverRow) {
        const rec = this.records.get(id);
        if (!rec) return;
        if (compareServerTs(serverRow.updated_at, rec.serverUpdatedAt) <= 0) {
            // Une version serveur plus récente a déjà été appliquée localement entre-temps :
            // l'état local (éventuellement fusionné et encore à envoyer) prime.
            return;
        }
        rec.serverUpdatedAt = serverRow.updated_at;
        if (rec.localRev === sentRev) {
            rec.dirty = false;
            rec.base = null;
            rec.clientUpdatedAt = Date.parse(serverRow.client_updated_at) || rec.clientUpdatedAt;
        } else {
            const sent = rowToRemote({ ...sentRow, updated_at: serverRow.updated_at });
            rec.base = { data: sent.data, deleted: sent.deleted, clientUpdatedAt: sent.clientUpdatedAt, deviceId: sent.deviceId };
        }
        this.commit({ source: "sync", ids: [] });
    }

    /** Recale l'horodatage d'édition des modifications en attente (nouvel écart d'horloge mesuré). */
    shiftDirtyEditTimes(deltaMs) {
        if (!deltaMs) return;
        let n = 0;
        for (const rec of this.records.values()) {
            // Seulement les éditions de cet appareil, horodatées par son horloge (0 = note migrée sans date)
            if (rec.dirty && rec.deviceId === this.deviceId && rec.clientUpdatedAt > 1e12) {
                rec.clientUpdatedAt += deltaMs;
                n++;
            }
        }
        if (n) this.commit({ source: "sync", ids: [] });
    }

    /** L'entrée n'existe plus côté serveur : on la renverra comme nouvelle. */
    markNeverSynced(id) {
        const rec = this.records.get(id);
        if (!rec) return;
        rec.serverUpdatedAt = null;
        rec.base = null;
        rec.dirty = true;
        this.commit({ source: "sync", ids: [] });
    }

    // ---------- Journal des conflits ----------

    logConflict(local, remote, conflicts) {
        const entry = {
            at: new Date().toISOString(),
            id: local.id,
            collection: local.collection,
            label: (local.data && (local.data.name || local.data.title || local.data.key)) || (remote.data && (remote.data.name || remote.data.title)) || local.id,
            fields: conflicts.map((c) => ({ field: c.field, valeurLocalePerdue: c.local, valeurGardee: c.remote }))
        };
        const key = `${this.scope}:conflicts`;
        const list = this.store.getJSON(key, []);
        list.unshift(entry);
        this.store.setJSON(key, list.slice(0, MAX_CONFLICT_LOG));
        return entry;
    }

    conflictLog() {
        return this.store.getJSON(`${this.scope}:conflicts`, []);
    }

    // ---------- Métadonnées de synchronisation ----------

    syncMeta() {
        return this.store.getJSON(`${this.scope}:sync`, { cursor: null, lastFullSyncAt: 0, lastSyncAt: 0 });
    }

    setSyncMeta(patch) {
        this.store.setJSON(`${this.scope}:sync`, { ...this.syncMeta(), ...patch });
    }
}

/**
 * Adoption des données saisies sans compte (portée « local ») par le premier compte
 * connecté sur cet appareil. Les entrées gardent leur identifiant (les identifiants
 * déterministes de la migration évitent les doublons entre appareils).
 */
export function adoptLocalRecords(store, fromScope, toScope) {
    const from = store.getJSON(`${fromScope}:records`, {});
    const to = store.getJSON(`${toScope}:records`, {});
    let adopted = 0;
    for (const [id, rec] of Object.entries(from || {})) {
        const existing = to[id];
        if (!existing || (!existing.dirty && rec.clientUpdatedAt > (existing.clientUpdatedAt || 0) && !existing.serverUpdatedAt)) {
            to[id] = { ...rec, serverUpdatedAt: null, base: null, dirty: true };
            adopted++;
        }
    }
    if (!store.setJSON(`${toScope}:records`, to)) return { adopted: 0, ok: false };
    store.remove(`${fromScope}:records`);
    store.remove(`${fromScope}:sync`);
    return { adopted, ok: true };
}
