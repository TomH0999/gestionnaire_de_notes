/**
 * Validation des saisies (formulaires) et assainissement des données importées.
 * Messages en français. Le calcul des moyennes n'est jamais modifié : on empêche
 * seulement l'enregistrement de valeurs absurdes.
 */
import { parseDecimal } from "./numbers.js";
import { isKnownSubject } from "./program.js";
import { isValidDayKey, parseTime } from "./dates.js";
import { HOMEWORK_TYPES, STATUSES } from "./homework.js";

export const LIMITS = { name: 120, title: 200, notes: 2000, maxScale: 1000, maxCoeff: 100 };

/**
 * Valide une note saisie. Les champs numériques acceptent « 12,5 » ou « 12.5 ».
 * Renvoie { ok, value, errors } ; value = { name, subjectCode, score, max, coeff }.
 */
export function validateGradeInput(input, { defaultName = null } = {}) {
    const errors = {};
    let name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
    if (!name && defaultName) name = defaultName;
    if (!name) errors.name = "Indiquez le nom de l'évaluation.";
    else if (name.length > LIMITS.name) errors.name = `Nom trop long (${LIMITS.name} caractères maximum).`;

    const subjectCode = input.subjectCode;
    if (!isKnownSubject(subjectCode)) errors.subjectCode = "Choisissez une matière ou une SAÉ.";

    const max = parseDecimal(input.max);
    if (Number.isNaN(max)) errors.max = "Barème invalide (ex. 20).";
    else if (max <= 0) errors.max = "Le barème doit être supérieur à 0.";
    else if (max > LIMITS.maxScale) errors.max = `Barème trop grand (${LIMITS.maxScale} maximum).`;

    const score = parseDecimal(input.score);
    if (input.score === "" || input.score === null || input.score === undefined) errors.score = "Indiquez la note.";
    else if (Number.isNaN(score)) errors.score = "Note invalide (ex. 12,5).";
    else if (score < 0) errors.score = "La note ne peut pas être négative.";
    else if (!errors.max && score > max) errors.score = `La note dépasse le barème (${String(max).replace(".", ",")}).`;

    const coeff = parseDecimal(input.coeff);
    if (Number.isNaN(coeff)) errors.coeff = "Coefficient invalide (ex. 1 ou 1,5).";
    else if (coeff <= 0) errors.coeff = "Le coefficient doit être supérieur à 0.";
    else if (coeff > LIMITS.maxCoeff) errors.coeff = `Coefficient trop grand (${LIMITS.maxCoeff} maximum).`;

    const ok = Object.keys(errors).length === 0;
    return { ok, errors, value: ok ? { name, subjectCode, score, max, coeff } : null };
}

/**
 * Assainit une note venant d'un import JSON ou de l'ancien stockage.
 * Conserve les valeurs historiques telles quelles (ex. 22/20 reste 22/20) mais rejette
 * ce qui casserait l'affichage ou le calcul : types invalides, barème ≤ 0, valeurs non finies.
 */
export function sanitizeLegacyGrade(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "entrée non objet" };
    const num = (v) => (typeof v === "number" ? v : typeof v === "string" ? parseDecimal(v) : NaN);
    const score = num(raw.score);
    const max = num(raw.max === undefined ? 20 : raw.max);
    const coeff = num(raw.coeff === undefined ? 1 : raw.coeff);
    if (!Number.isFinite(score)) return { ok: false, reason: "note invalide" };
    if (!Number.isFinite(max) || max <= 0) return { ok: false, reason: "barème invalide" };
    if (!Number.isFinite(coeff) || coeff < 0) return { ok: false, reason: "coefficient invalide" };
    if (typeof raw.subjectCode !== "string" || raw.subjectCode.length === 0 || raw.subjectCode.length > 40) {
        return { ok: false, reason: "matière invalide" };
    }
    const name = raw.name === undefined || raw.name === null ? "Évaluation" : String(raw.name).slice(0, 500);
    const id = raw.id === undefined || raw.id === null ? null : String(raw.id).slice(0, 100);
    return { ok: true, grade: { id, name, subjectCode: raw.subjectCode, score, max, coeff } };
}

const HOMEWORK_TYPE_IDS = new Set(HOMEWORK_TYPES.map((t) => t.id));
const STATUS_IDS = new Set(STATUSES.map((s) => s.id));

/** Valide un devoir saisi. Renvoie { ok, value, errors }. */
export function validateHomeworkInput(input) {
    const errors = {};
    const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
    if (!title) errors.title = "Indiquez un titre.";
    else if (title.length > LIMITS.title) errors.title = `Titre trop long (${LIMITS.title} caractères maximum).`;

    const type = HOMEWORK_TYPE_IDS.has(input.type) ? input.type : null;
    if (!type) errors.type = "Type inconnu.";

    let subjectCode = input.subjectCode || null;
    if (subjectCode !== null && !isKnownSubject(subjectCode)) errors.subjectCode = "Matière inconnue.";

    if (!isValidDayKey(input.dueDate)) errors.dueDate = "Date d'échéance invalide.";
    const dueTime = input.dueTime || "23:59";
    if (!parseTime(dueTime)) errors.dueTime = "Heure invalide (HH:MM).";

    const importance = Number(input.importance);
    if (!Number.isInteger(importance) || importance < 1 || importance > 4) errors.importance = "Importance invalide.";

    const anticipationDays = Number(input.anticipationDays);
    if (!Number.isInteger(anticipationDays) || anticipationDays < 0 || anticipationDays > 366) {
        errors.anticipationDays = "Anticipation invalide.";
    }

    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    if (notes.length > LIMITS.notes) errors.notes = `Notes trop longues (${LIMITS.notes} caractères maximum).`;

    const status = input.status || "todo";
    if (!STATUS_IDS.has(status)) errors.status = "Statut invalide.";

    const ok = Object.keys(errors).length === 0;
    return {
        ok,
        errors,
        value: ok
            ? { title, type, subjectCode, dueDate: input.dueDate, dueTime: parseTimeNormalized(dueTime), importance, anticipationDays, notes, status }
            : null
    };
}

function parseTimeNormalized(value) {
    const t = parseTime(value);
    return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}
