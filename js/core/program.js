/**
 * Configuration & Coefficients BUT1 Informatique S1
 * (repris à l'identique de la version d'origine — script.js)
 */
export const PROGRAM_S1 = {
    ressources: [
        { code: "R1.01", name: "Initiation au développement" },
        { code: "R1.02", name: "Développement d'interfaces web" },
        { code: "R1.03", name: "Introduction à l'architecture des ordinateurs" },
        { code: "R1.04", name: "Introduction aux systèmes d'exploitation" },
        { code: "R1.05", name: "Introduction aux bases de données" },
        { code: "R1.06", name: "Mathématiques discrètes" },
        { code: "R1.07", name: "Outils mathématiques fondamentaux" },
        { code: "R1.08", name: "Gestion de projet & Organisation" },
        { code: "R1.09", name: "Économie durable et numérique" },
        { code: "R1.10", name: "Anglais technique" },
        { code: "R1.11", name: "Bases de la communication" },
        { code: "R1.12", name: "PPP - Projet Personnel et Professionnel" }
    ],
    saes: [
        { code: "SAE 1.01", name: "Implémentation d'un besoin client" },
        { code: "SAE 1.02", name: "Comparaison d'approches algorithmiques" },
        { code: "SAE 1.03", name: "Installation d'un poste pour le dev." },
        { code: "SAE 1.04", name: "Création d'une base de données" },
        { code: "SAE 1.05", name: "Recueil de besoins" },
        { code: "SAE 1.06", name: "Découverte de l'environnement éco." }
    ],
    ues: [
        { code: "UE 1.1", name: "Réaliser un développement d'application" },
        { code: "UE 1.2", name: "Optimiser des applications" },
        { code: "UE 1.3", name: "Administrer des systèmes informatiques" },
        { code: "UE 1.4", name: "Gérer des données de l'information" },
        { code: "UE 1.5", name: "Conduire un projet" },
        { code: "UE 1.6", name: "Travailler dans une équipe informatique" }
    ]
};

// Matrice des coefficients stricts par UE
export const COEFFICIENTS_UE = {
    "UE 1.1": { "SAE 1.01": 40, "R1.01": 42, "R1.02": 12, "R1.10": 6 },
    "UE 1.2": { "SAE 1.02": 40, "R1.01": 24, "R1.03": 3, "R1.04": 3, "R1.06": 15, "R1.07": 15 },
    "UE 1.3": { "SAE 1.03": 40, "R1.03": 21, "R1.04": 21, "R1.10": 12, "R1.11": 6 },
    "UE 1.4": { "SAE 1.04": 40, "R1.05": 36, "R1.06": 18, "R1.09": 6 },
    "UE 1.5": { "SAE 1.05": 40, "R1.02": 18, "R1.08": 27, "R1.11": 15 },
    "UE 1.6": { "SAE 1.06": 40, "R1.02": 5, "R1.08": 11, "R1.09": 11, "R1.10": 11, "R1.11": 11, "R1.12": 11 }
};

/** Toutes les matières notables (ressources puis SAÉ), dans l'ordre du programme. */
export const ALL_SUBJECTS = [...PROGRAM_S1.ressources, ...PROGRAM_S1.saes];

const SUBJECT_BY_CODE = new Map(ALL_SUBJECTS.map((s) => [s.code, s]));

export function isKnownSubject(code) {
    return SUBJECT_BY_CODE.has(code);
}

export function subjectName(code) {
    const s = SUBJECT_BY_CODE.get(code);
    return s ? s.name : null;
}

export function isSae(code) {
    return typeof code === "string" && code.startsWith("SAE");
}
