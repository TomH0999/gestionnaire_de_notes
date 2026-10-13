/**
 * Export / import JSON manuel (Réglages).
 *
 * Export (format v2) : toutes les entrées vivantes (notes, devoirs, réglages hors lien ADE
 * personnel) + le journal des conflits. Import : accepte ce format ET l'ancien format
 * (tableau de notes de la version d'origine). L'import FUSIONNE (ajoute ou met à jour par
 * identifiant), il ne supprime jamais rien.
 */
import { validateHomeworkInput, sanitizeLegacyGrade } from "../core/validation.js";
import { isUuid } from "../core/uuid.js";
import { planLegacyGrades } from "./migration.js";
import { deepEqual } from "./merge.js";
import { settingId } from "./repository.js";

export const EXPORT_FORMAT = "gestionnaire-de-notes";
/** Réglages jamais exportés (jeton personnel). */
const PRIVATE_SETTINGS = new Set(["edtUrl"]);

export function buildExport(repo, { appVersion = "2", now = () => Date.now() } = {}) {
    const grades = repo.list("grades").map(({ id, ...data }) => ({ id, ...data }));
    const homework = repo.list("homework").map(({ id, ...data }) => ({ id, ...data }));
    const settings = repo
        .list("settings")
        .filter((s) => !PRIVATE_SETTINGS.has(s.key))
        .map((s) => ({ key: s.key, value: s.value }));
    return {
        format: EXPORT_FORMAT,
        version: 2,
        app: appVersion,
        exportedAt: new Date(now()).toISOString(),
        collections: { grades, homework, settings },
        conflicts: repo.conflictLog()
    };
}

export function exportFileName(now = Date.now()) {
    return `notes_BUT1_sauvegarde_${new Date(now).toISOString().slice(0, 10)}.json`;
}

function sanitizeV2Grade(raw) {
    const s = sanitizeLegacyGrade(raw);
    if (!s.ok) return s;
    if (!isUuid(raw.id)) return { ok: false, reason: "identifiant invalide" };
    const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
    const data = { name: s.grade.name, subjectCode: s.grade.subjectCode, score: s.grade.score, max: s.grade.max, coeff: s.grade.coeff, createdAt };
    if (raw.legacyId !== undefined && raw.legacyId !== null) data.legacyId = String(raw.legacyId).slice(0, 100);
    return { ok: true, id: raw.id, data };
}

function sanitizeV2Homework(raw) {
    if (!raw || typeof raw !== "object" || !isUuid(raw.id)) return { ok: false, reason: "identifiant invalide" };
    const v = validateHomeworkInput(raw);
    if (!v.ok) return { ok: false, reason: Object.values(v.errors)[0] };
    const data = { ...v.value, createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0 };
    if (raw.doneAt) data.doneAt = String(raw.doneAt).slice(0, 40);
    return { ok: true, id: raw.id, data };
}

/** Analyse un fichier importé (texte). Ne modifie rien. */
export function planImport(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { error: "Fichier illisible : ce n'est pas du JSON valide." };
    }
    if (Array.isArray(parsed)) {
        const legacy = planLegacyGrades(parsed);
        return { kind: "legacy", error: legacy.error, grades: legacy.grades, homework: [], settings: [], rejected: legacy.rejected.length, skippedSamples: legacy.skippedSamples };
    }
    if (!parsed || parsed.format !== EXPORT_FORMAT || !parsed.collections) {
        return { error: "Format non reconnu : utilisez un export de cette application." };
    }
    const c = parsed.collections;
    const grades = [];
    const homework = [];
    const settings = [];
    let rejected = 0;
    for (const raw of Array.isArray(c.grades) ? c.grades : []) {
        const s = sanitizeV2Grade(raw);
        if (s.ok) grades.push({ id: s.id, data: s.data });
        else rejected++;
    }
    for (const raw of Array.isArray(c.homework) ? c.homework : []) {
        const s = sanitizeV2Homework(raw);
        if (s.ok) homework.push({ id: s.id, data: s.data });
        else rejected++;
    }
    for (const raw of Array.isArray(c.settings) ? c.settings : []) {
        if (raw && typeof raw.key === "string" && raw.key.length <= 60 && !PRIVATE_SETTINGS.has(raw.key) && JSON.stringify(raw.value ?? null).length < 2000) {
            settings.push({ key: raw.key, value: raw.value ?? null });
        } else rejected++;
    }
    return { kind: "v2", error: null, grades, homework, settings, rejected, skippedSamples: 0 };
}

/** Applique un import planifié : ajout ou mise à jour par identifiant, jamais de suppression. */
export function applyImport(repo, plan) {
    const report = { added: 0, updated: 0, unchanged: 0, rejected: plan.rejected || 0 };
    repo.batch(() => {
        const upsert = (collection, id, data, clientUpdatedAt) => {
            const rec = repo.getRecord(id);
            if (!rec) {
                repo.create(collection, data, clientUpdatedAt === undefined ? { id } : { id, clientUpdatedAt });
                report.added++;
            } else if (rec.deleted) {
                repo.create(collection, data, { id }); // restauration explicite par l'utilisateur
                report.added++;
            } else if (!deepEqual(rec.data, data)) {
                repo.update(id, data);
                report.updated++;
            } else {
                report.unchanged++;
            }
        };
        for (const g of plan.grades) upsert("grades", g.id, g.data, plan.kind === "legacy" ? g.clientUpdatedAt : undefined);
        for (const h of plan.homework) upsert("homework", h.id, h.data);
        for (const s of plan.settings) upsert("settings", settingId(s.key), { key: s.key, value: s.value });
    });
    return report;
}
