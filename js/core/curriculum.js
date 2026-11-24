/**
 * Programme complet du BUT Informatique (semestres 1 à 6) : semestres, parcours, matières, UE.
 *
 * Les coefficients viennent de curriculum-data.js (généré à partir des MCCC de l'IUT).
 * Le semestre 1 reste calculé par le code d'origine (grades-calc.js, protégé par les tests
 * « golden ») : ses coefficients sont identiques dans les deux fichiers (un test le vérifie).
 */
import { SUBJECTS, UE_TABLES, CURRICULUM_SOURCE } from "./curriculum-data.js";

export { CURRICULUM_SOURCE };

export const SEMESTERS = [1, 2, 3, 4, 5, 6];

/** Parcours proposés par l'IUT de Montpellier (lettre = lettre des codes de ressources, ex. R4.A.10). */
export const PARCOURS = [
    { id: "RACDV", letter: "A", label: "RACDV", name: "Réalisation d'applications : conception, développement, validation" },
    { id: "DACS", letter: "B", label: "DACS", name: "Déploiement d'applications communicantes et sécurisées" },
    { id: "IAMSI", letter: "D", label: "IAMSI", name: "Intégration d'applications et management du système d'information" }
];

/** Les 6 compétences du BUT Informatique : l'UE n.c d'un semestre relève de la compétence c. */
export const COMPETENCES = [
    { id: 1, name: "Réaliser un développement d'application", short: "Réaliser" },
    { id: 2, name: "Optimiser des applications", short: "Optimiser" },
    { id: 3, name: "Administrer des systèmes informatiques", short: "Administrer" },
    { id: 4, name: "Gérer des données de l'information", short: "Gérer" },
    { id: 5, name: "Conduire un projet", short: "Conduire" },
    { id: 6, name: "Travailler dans une équipe informatique", short: "Collaborer" }
];

const COMPETENCE_BY_ID = new Map(COMPETENCES.map((c) => [c.id, c]));
const SUBJECT_BY_CODE = new Map(SUBJECTS.map((s) => [s.code, s]));
const PARCOURS_IDS = new Set(PARCOURS.map((p) => p.id));

export function isSemester(value) {
    return Number.isInteger(value) && value >= 1 && value <= 6;
}

export function isParcours(value) {
    return PARCOURS_IDS.has(value);
}

export function parcoursInfo(id) {
    return PARCOURS.find((p) => p.id === id) || null;
}

/** À partir du semestre 4, les UE et les coefficients dépendent du parcours. */
export function needsParcours(semester) {
    return !UE_TABLES[semester] || !UE_TABLES[semester].common;
}

export function subjectInfo(code) {
    return SUBJECT_BY_CODE.get(code) || null;
}

export function semesterOfSubject(code) {
    const s = SUBJECT_BY_CODE.get(code);
    return s ? s.semester : null;
}

export function isKnownSubjectCode(code) {
    return SUBJECT_BY_CODE.has(code);
}

/** Type d'élément noté : ressource, SAÉ, stage ou portfolio. */
export function subjectKind(code) {
    if (/^R\d/.test(code)) return "ressource";
    if (/^Stage/.test(code)) return "stage";
    if (/^Portfolio/.test(code)) return "portfolio";
    return "sae";
}

/**
 * UE d'un semestre (avec modules et coefficients), ou null si le semestre dépend du parcours
 * et que le parcours n'est pas choisi.
 */
export function semesterUes(semester, parcours = null) {
    const table = UE_TABLES[semester];
    if (!table) return null;
    const list = table.common || (isParcours(parcours) ? table.parcours[parcours] : null);
    if (!list) return null;
    return list.map((ue) => ({ ...ue, name: COMPETENCE_BY_ID.get(ue.competence).name }));
}

/**
 * Matières notables d'un semestre, dans l'ordre d'affichage : ressources puis SAÉ, stage,
 * portfolio. Sans parcours (semestres 4 à 6), toutes les matières du semestre sont listées.
 */
export function semesterSubjects(semester, parcours = null) {
    const ues = semesterUes(semester, parcours);
    let codes;
    if (ues) {
        const used = new Set();
        for (const ue of ues) for (const m of ue.modules) for (const [code] of m.items) used.add(code);
        codes = SUBJECTS.filter((s) => used.has(s.code));
    } else {
        codes = SUBJECTS.filter((s) => s.semester === semester);
    }
    return codes.map((s) => ({ ...s, kind: subjectKind(s.code) }));
}

export function semesterLabel(semester) {
    return `Semestre ${semester}`;
}

/** Année de BUT d'un semestre (S1-S2 : BUT 1, S3-S4 : BUT 2, S5-S6 : BUT 3). */
export function butYear(semester) {
    return Math.ceil(semester / 2);
}
