/**
 * Règles de fusion de la synchronisation (fonctions pures, testées unitairement).
 *
 * RÉSOLUTION DES CONFLITS — voir aussi docs/SYNCHRONISATION.md
 *  1. L'ORDRE des versions est donné par l'horloge du SERVEUR (`updated_at`, posé par un
 *     trigger Postgres) : c'est lui qui sert aux curseurs et à détecter qu'une entrée a
 *     changé depuis la dernière version connue (mise à jour conditionnelle).
 *  2. Quand une entrée a été modifiée des deux côtés, on fait une FUSION 3 VOIES PAR CHAMP
 *     à partir de la dernière version serveur connue (« base ») :
 *       - champ modifié d'un seul côté → cette modification est gardée ;
 *       - champ modifié des deux côtés différemment → la modification la plus récente gagne,
 *         d'après l'horodatage d'édition (`client_updated_at` : horloge de l'appareil corrigée
 *         de l'écart mesuré avec le serveur, et plafonnée côté serveur à now() + 1 min) ;
 *         égalité parfaite → départage déterministe par identifiant d'appareil.
 *  3. Suppression (logique) contre modification : la plus récente gagne.
 *  4. Toute modification locale perdante est archivée dans le journal des conflits
 *     (aucune perte silencieuse).
 */

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** Horodatage serveur (ISO, microsecondes) → { ms, micro } ; null si illisible. */
export function parseServerTs(ts) {
    if (typeof ts !== "string") return null;
    const m = TS_RE.exec(ts.trim());
    if (!m) return null;
    let offsetMin = 0;
    const tz = m[8];
    if (tz && tz !== "Z") {
        const sign = tz[0] === "-" ? -1 : 1;
        const digits = tz.slice(1).replace(":", "");
        offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0));
    }
    const frac = (m[7] || "").padEnd(6, "0").slice(0, 6);
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) - offsetMin * 60000 + Number(frac.slice(0, 3));
    return { ms, micro: Number(frac.slice(3, 6)) };
}

/** Compare deux horodatages serveur (null/absent = plus ancien). */
export function compareServerTs(a, b) {
    const pa = parseServerTs(a);
    const pb = parseServerTs(b);
    if (!pa && !pb) return 0;
    if (!pa) return -1;
    if (!pb) return 1;
    if (pa.ms !== pb.ms) return pa.ms < pb.ms ? -1 : 1;
    if (pa.micro !== pb.micro) return pa.micro < pb.micro ? -1 : 1;
    return 0;
}

export function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/** Même contenu visible (données + état supprimé). */
export function sameContent(a, b) {
    return !!a && !!b && !!a.deleted === !!b.deleted && deepEqual(a.data || {}, b.data || {});
}

/** Champs techniques dont les divergences ne sont pas signalées comme conflits. */
const META_FIELDS = new Set(["createdAt", "legacyId"]);

/** Côté gagnant d'un vrai conflit : édition la plus récente, puis id d'appareil. */
export function newerSide(local, remote) {
    const lt = Number(local.clientUpdatedAt) || 0;
    const rt = Number(remote.clientUpdatedAt) || 0;
    if (lt !== rt) return lt > rt ? "local" : "remote";
    const ld = String(local.deviceId || "");
    const rd = String(remote.deviceId || "");
    if (ld !== rd) return ld > rd ? "local" : "remote";
    return "remote";
}

/**
 * Fusion 3 voies.
 * @param base   dernière version serveur connue localement { data, deleted } (null si jamais synchronisée)
 * @param local  { data, deleted, clientUpdatedAt, deviceId }
 * @param remote { data, deleted, clientUpdatedAt, deviceId }
 * @returns { data, deleted, conflicts: [{ field, local, remote, winner }] }
 */
export function merge3(base, local, remote) {
    const conflicts = [];
    const winner = newerSide(local, remote);
    const baseData = base ? base.data || {} : null;
    const localData = local.data || {};
    const remoteData = remote.data || {};
    const localChanged = baseData ? !deepEqual(localData, baseData) || !!local.deleted !== !!base.deleted : true;
    const remoteChanged = baseData ? !deepEqual(remoteData, baseData) || !!remote.deleted !== !!base.deleted : true;

    if (local.deleted || remote.deleted) {
        if (local.deleted && remote.deleted) {
            return { data: winner === "local" ? localData : remoteData, deleted: true, conflicts };
        }
        const localIsDeleter = !!local.deleted;
        const editorChanged = localIsDeleter ? remoteChanged : localChanged;
        const deleterChanged = localIsDeleter ? localChanged : remoteChanged;
        const editorSide = localIsDeleter ? "remote" : "local";
        // L'autre côté n'a pas bougé : la suppression (ou la restauration) s'applique simplement.
        if (!editorChanged) return { data: localIsDeleter ? localData : remoteData, deleted: true, conflicts };
        if (!deleterChanged) return { data: localIsDeleter ? remoteData : localData, deleted: false, conflicts };
        // Vrai conflit suppression / modification : la plus récente gagne.
        conflicts.push({ field: "(suppression)", local: !!local.deleted, remote: !!remote.deleted, winner });
        if (winner === editorSide) {
            return { data: editorSide === "local" ? localData : remoteData, deleted: false, conflicts };
        }
        return { data: localIsDeleter ? localData : remoteData, deleted: true, conflicts };
    }

    const keys = new Set([...Object.keys(localData), ...Object.keys(remoteData), ...(baseData ? Object.keys(baseData) : [])]);
    const out = {};
    for (const key of keys) {
        const lv = localData[key];
        const rv = remoteData[key];
        let value;
        if (deepEqual(lv, rv)) value = lv;
        else if (baseData && deepEqual(lv, baseData[key])) value = rv;
        else if (baseData && deepEqual(rv, baseData[key])) value = lv;
        else {
            value = winner === "local" ? lv : rv;
            if (!META_FIELDS.has(key)) conflicts.push({ field: key, local: lv, remote: rv, winner });
        }
        if (value !== undefined) out[key] = value;
    }
    return { data: out, deleted: false, conflicts };
}
