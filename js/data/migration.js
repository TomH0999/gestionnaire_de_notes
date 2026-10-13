/**
 * Migration des données de la version d'origine (clé localStorage BUT1_INFO_S1_GRADES).
 *
 *  - La clé d'origine n'est JAMAIS modifiée ni supprimée (retour arrière possible).
 *  - Une sauvegarde JSON est créée automatiquement avant la migration (téléchargeable
 *    depuis la bannière de migration et depuis Réglages > Sauvegardes).
 *  - Identifiants DÉTERMINISTES : UUID v5 du contenu de la note (matière, nom normalisé,
 *    note, barème, coefficient) + rang d'occurrence parmi les notes identiques. La même note
 *    migrée depuis deux appareils donne donc le même identifiant → aucun doublon dans le
 *    cloud ; deux notes identiques sur un même appareil restent deux notes.
 *  - Les 3 notes d'exemple créées automatiquement par l'ancienne version (ids "1", "2", "3",
 *    contenu inchangé) ne sont pas migrées : ce ne sont pas des saisies (elles restent dans
 *    la sauvegarde).
 *  - Idempotente : relancée à chaque démarrage, elle n'ajoute que les notes absentes (y
 *    compris celles ajoutées entre-temps par un ancien onglet resté ouvert) et ne ressuscite
 *    jamais une note supprimée (l'identifiant existe alors comme entrée supprimée).
 */
import { uuidv5 } from "../core/uuid.js";
import { sanitizeLegacyGrade } from "../core/validation.js";

export const LEGACY_KEY = "BUT1_INFO_S1_GRADES";

export const SAMPLE_GRADES = [
    { id: "1", name: "Contrôle TP1", subjectCode: "R1.01", score: 15, max: 20, coeff: 1 },
    { id: "2", name: "Projet HTML/CSS", subjectCode: "R1.02", score: 14, max: 20, coeff: 2 },
    { id: "3", name: "Evaluation SAE", subjectCode: "SAE 1.01", score: 16, max: 20, coeff: 1 }
];

export function isSampleGrade(g) {
    return SAMPLE_GRADES.some(
        (s) => String(g.id) === s.id && g.name === s.name && g.subjectCode === s.subjectCode && g.score === s.score && g.max === s.max && g.coeff === s.coeff
    );
}

const normName = (name) => String(name).normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

export function legacyContentKey(g) {
    return `${g.subjectCode}|${normName(g.name)}|${Number(g.score)}|${Number(g.max)}|${Number(g.coeff)}`;
}

export function legacyGradeId(g, occurrence) {
    return uuidv5(`legacy-grade|${legacyContentKey(g)}|#${occurrence}`);
}

function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

/**
 * Prépare la migration (sans rien écrire).
 * Accepte un tableau (format d'origine ; aussi utilisé pour importer un ancien export).
 */
export function planLegacyGrades(list) {
    if (!Array.isArray(list)) return { error: "Format inattendu : un tableau de notes était attendu.", grades: [], rejected: [], skippedSamples: 0 };
    const grades = [];
    const rejected = [];
    let skippedSamples = 0;
    const occurrences = new Map();
    list.forEach((raw, index) => {
        const s = sanitizeLegacyGrade(raw);
        if (!s.ok) {
            rejected.push({ index, reason: s.reason });
            return;
        }
        const g = s.grade;
        if (isSampleGrade(g)) {
            skippedSamples++;
            return;
        }
        const key = legacyContentKey(g);
        const occurrence = occurrences.get(key) || 0;
        occurrences.set(key, occurrence + 1);
        const numericId = g.id !== null && /^\d{1,15}$/.test(g.id) ? Number(g.id) : NaN;
        const createdAt = Number.isFinite(numericId) ? numericId : index;
        grades.push({
            id: legacyGradeId(g, occurrence),
            // Horodatage d'édition ancien : toute modification ou suppression faite dans la v2
            // l'emporte sur une note migrée plus tard depuis un autre appareil.
            clientUpdatedAt: createdAt > 1e12 ? createdAt : 0,
            data: { name: g.name, subjectCode: g.subjectCode, score: g.score, max: g.max, coeff: g.coeff, createdAt, legacyId: g.id }
        });
    });
    return { error: null, grades, rejected, skippedSamples };
}

/** Ajoute au dépôt les notes planifiées absentes (identifiants déterministes). */
export function applyLegacyGrades(repo, plan) {
    let added = 0;
    let alreadyPresent = 0;
    repo.batch(() => {
        for (const g of plan.grades) {
            if (repo.has(g.id)) {
                alreadyPresent++;
                continue;
            }
            repo.create("grades", g.data, { id: g.id, clientUpdatedAt: g.clientUpdatedAt });
            added++;
        }
    });
    return { added, alreadyPresent };
}

/**
 * Exécutée à chaque démarrage. Renvoie un rapport (null si aucune donnée d'origine).
 * `store` : LocalStore (lecture brute de la clé d'origine + sauvegardes).
 */
export function runLegacyMigration({ store, repo, now = () => Date.now() }) {
    const raw = store.getRaw(LEGACY_KEY);
    if (raw === null || raw === undefined) return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { error: "Les anciennes données sont illisibles (JSON invalide) : elles sont conservées telles quelles.", added: 0 };
    }
    const plan = planLegacyGrades(parsed);
    if (plan.error) return { error: plan.error, added: 0 };

    const contentHash = hashString(raw);
    const backups = store.getJSON("backups", []);
    let backup = backups.find((b) => b.hash === contentHash);
    const missing = plan.grades.filter((g) => !repo.has(g.id));
    if (!backup && (missing.length > 0 || plan.skippedSamples > 0 || plan.rejected.length > 0)) {
        backup = {
            id: `legacy-${now()}`,
            hash: contentHash,
            createdAt: new Date(now()).toISOString(),
            kind: "legacy",
            fileName: `sauvegarde_notes_avant_v2_${new Date(now()).toISOString().slice(0, 10)}.json`,
            content: raw,
            count: Array.isArray(parsed) ? parsed.length : 0
        };
        backups.unshift(backup);
        if (!store.setJSON("backups", backups.slice(0, 10))) backup.unsaved = true;
    }
    const result = applyLegacyGrades(repo, plan);
    const meta = store.getJSON("migration", {});
    const firstTime = !meta.doneAt && result.added > 0;
    if (result.added > 0 || !meta.doneAt) {
        store.setJSON("migration", { ...meta, doneAt: meta.doneAt || new Date(now()).toISOString(), lastAdded: result.added, bannerPending: firstTime || meta.bannerPending || false });
    }
    return { error: null, ...result, skippedSamples: plan.skippedSamples, rejected: plan.rejected.length, backup, firstTime };
}
