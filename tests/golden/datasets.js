/**
 * Jeux de données des tests « golden » (non-régression du calcul des moyennes).
 *
 * Les valeurs attendues correspondantes sont figées dans golden-expected.json,
 * générées UNE SEULE FOIS depuis la version d'origine de l'application
 * (script.js du commit 3ec1d0c, copie verbatim dans legacy/script.legacy.js).
 *
 * Format d'une note (format historique, inchangé) :
 *   { id, name, subjectCode, score, max, coeff }
 */

let autoId = 1700000000000;
const g = (subjectCode, score, max = 20, coeff = 1, name = null) => {
    autoId += 1;
    return { id: String(autoId), name: name || `Éval ${autoId - 1700000000000}`, subjectCode, score, max, coeff };
};

// Générateur pseudo-aléatoire déterministe (mulberry32)
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const ALL_CODES = [
    "R1.01", "R1.02", "R1.03", "R1.04", "R1.05", "R1.06", "R1.07", "R1.08", "R1.09", "R1.10", "R1.11", "R1.12",
    "SAE 1.01", "SAE 1.02", "SAE 1.03", "SAE 1.04", "SAE 1.05", "SAE 1.06"
];

export function generateRandomGrades(seed, count, { decimals = true, allowZeroCoeff = false } = {}) {
    const rnd = mulberry32(seed);
    const maxes = [20, 20, 20, 10, 40, 100, 5];
    const coeffs = allowZeroCoeff ? [0, 0.5, 1, 1, 1.5, 2, 3] : [0.5, 1, 1, 1.5, 2, 3];
    const out = [];
    for (let i = 0; i < count; i++) {
        const subjectCode = ALL_CODES[Math.floor(rnd() * ALL_CODES.length)];
        const max = maxes[Math.floor(rnd() * maxes.length)];
        let score = rnd() * max;
        score = decimals ? Math.round(score * 100) / 100 : Math.round(score);
        const coeff = coeffs[Math.floor(rnd() * coeffs.length)];
        out.push({ id: String(1700000000000 + seed * 100000 + i), name: `Note ${i + 1}`, subjectCode, score, max, coeff });
    }
    return out;
}

export const DATASETS = {
    // Données d'exemple créées par l'application d'origine au premier lancement
    "exemple-initial": [
        { id: "1", name: "Contrôle TP1", subjectCode: "R1.01", score: 15, max: 20, coeff: 1 },
        { id: "2", name: "Projet HTML/CSS", subjectCode: "R1.02", score: 14, max: 20, coeff: 2 },
        { id: "3", name: "Evaluation SAE", subjectCode: "SAE 1.01", score: 16, max: 20, coeff: 1 }
    ],

    // Aucune note : toutes les matières « sans note »
    "aucune-note": [],

    // Cas normal : plusieurs notes par matière, barèmes et coefficients variés, toutes les UE calculées
    "cas-normal": [
        g("R1.01", 15, 20, 1, "DS1"), g("R1.01", 12.5, 20, 2, "DS2"), g("R1.01", 8, 10, 1, "TP noté"),
        g("R1.02", 14, 20, 1), g("R1.02", 31, 40, 1.5),
        g("R1.03", 11, 20, 1), g("R1.04", 9.5, 20, 1), g("R1.04", 13, 20, 1),
        g("R1.05", 16, 20, 2), g("R1.06", 7, 20, 1), g("R1.06", 12, 20, 3),
        g("R1.07", 10, 20, 1), g("R1.08", 15, 20, 1), g("R1.09", 13.5, 20, 1),
        g("R1.10", 17, 20, 1), g("R1.11", 12, 20, 1), g("R1.12", 14, 20, 1),
        g("SAE 1.01", 16, 20, 1), g("SAE 1.02", 11, 20, 1), g("SAE 1.03", 13, 20, 1),
        g("SAE 1.04", 15, 20, 1), g("SAE 1.05", 12, 20, 1), g("SAE 1.06", 14, 20, 1)
    ],

    // Notes manquantes : certaines matières sans note, l'UE 1.6 entièrement vide (aucune de ses matières notée)
    "notes-manquantes": [
        g("R1.01", 13, 20, 1), g("SAE 1.01", 9, 20, 1),
        g("R1.06", 11, 20, 1), g("R1.07", 6.5, 20, 1),
        g("R1.04", 15, 20, 1),
        g("R1.05", 12, 20, 1),
        g("SAE 1.05", 10, 20, 1)
    ],

    // Coefficient 0 : une matière avec uniquement des coeff 0 (=> traitée comme sans note), une autre mixte
    "coefficient-zero": [
        g("R1.01", 18, 20, 0), g("R1.01", 4, 20, 0),
        g("R1.02", 20, 20, 0), g("R1.02", 10, 20, 1),
        g("SAE 1.01", 12, 20, 1), g("R1.10", 15, 20, 2)
    ],

    // Notes décimales et pièges de l'arrondi flottant (0.1 + 0.2, 10.005, 1/3...)
    "notes-decimales": [
        g("R1.01", 0.1, 20, 1), g("R1.01", 0.2, 20, 1),
        g("R1.02", 10.005, 20, 1),
        g("R1.03", 13.333, 20, 1), g("R1.03", 13.334, 20, 2),
        g("R1.04", 2, 3, 1),
        g("R1.05", 12.75, 20, 0.5), g("R1.05", 14.25, 20, 1.5),
        g("R1.06", 9.995, 20, 1),
        g("SAE 1.01", 14.125, 20, 1), g("SAE 1.02", 7.777, 10, 1),
        g("SAE 1.03", 0.3, 0.6, 1), g("SAE 1.04", 16.666, 20, 1)
    ],

    // 0/20 partout (=> UE < 8 : refusé)
    "zero-sur-vingt": [
        g("R1.01", 0), g("R1.02", 0), g("R1.03", 0), g("R1.04", 0), g("R1.05", 0), g("R1.06", 0),
        g("R1.07", 0), g("R1.08", 0), g("R1.09", 0), g("R1.10", 0), g("R1.11", 0), g("R1.12", 0),
        g("SAE 1.01", 0), g("SAE 1.02", 0), g("SAE 1.03", 0), g("SAE 1.04", 0), g("SAE 1.05", 0), g("SAE 1.06", 0)
    ],

    // 20/20 partout (=> validé)
    "vingt-sur-vingt": [
        g("R1.01", 20), g("R1.02", 20), g("R1.03", 20), g("R1.04", 20), g("R1.05", 20), g("R1.06", 20),
        g("R1.07", 20), g("R1.08", 20), g("R1.09", 20), g("R1.10", 20), g("R1.11", 20), g("R1.12", 20),
        g("SAE 1.01", 20), g("SAE 1.02", 20), g("SAE 1.03", 20), g("SAE 1.04", 20), g("SAE 1.05", 20), g("SAE 1.06", 20)
    ],

    // Une seule matière notée, toutes les autres sans note (UE partielles, statut « en cours »)
    "matiere-sans-note": [g("R1.10", 12, 20, 1)],

    // Rattrapage : une UE entre 8 et 10, les autres >= 10 ; bornes exactes 10 et 8
    "rattrapage-bornes": [
        // UE 1.1 = 10 exactement (SAE 1.01, R1.01, R1.02, R1.10 à 10)
        g("SAE 1.01", 10), g("R1.01", 10), g("R1.02", 10), g("R1.10", 10),
        // UE 1.2 entre 8 et 10 (SAE 1.02 et R1.03..R1.07 à 8 ; R1.01 à 10 tire l'UE à 8,48)
        g("SAE 1.02", 8), g("R1.03", 8), g("R1.04", 8), g("R1.06", 8), g("R1.07", 8),
        g("SAE 1.03", 12), g("R1.11", 11),
        g("SAE 1.04", 14), g("R1.05", 13), g("R1.09", 12),
        g("SAE 1.05", 15), g("R1.08", 12),
        g("SAE 1.06", 13), g("R1.12", 16)
    ],

    // Borne exacte : UE 1.1 = 8,00 pile (pas « < 8 ») => rattrapage
    "borne-huit": [
        g("SAE 1.01", 8), g("R1.01", 8), g("R1.02", 8), g("R1.10", 8),
        g("SAE 1.02", 20), g("R1.03", 20), g("R1.04", 20), g("R1.06", 20), g("R1.07", 20),
        g("SAE 1.03", 20), g("R1.11", 20),
        g("SAE 1.04", 15), g("R1.05", 15), g("R1.09", 15),
        g("SAE 1.05", 20), g("R1.08", 20),
        g("SAE 1.06", 20), g("R1.12", 20)
    ],

    // Juste sous la borne : UE 1.1 = 7,96 => refusé
    "sous-huit": [
        g("SAE 1.01", 7.9), g("R1.01", 8), g("R1.02", 8), g("R1.10", 8),
        g("SAE 1.02", 20), g("R1.03", 20), g("R1.04", 20), g("R1.06", 20), g("R1.07", 20),
        g("SAE 1.03", 20), g("R1.11", 20),
        g("SAE 1.04", 15), g("R1.05", 15), g("R1.09", 15),
        g("SAE 1.05", 20), g("R1.08", 20),
        g("SAE 1.06", 20), g("R1.12", 20)
    ],

    // Trois UE sous 10 (mais toutes >= 8) => refusé
    "trois-ue-sous-dix": [
        g("SAE 1.01", 9), g("R1.01", 9), g("R1.02", 9), g("R1.10", 9),
        g("SAE 1.02", 9), g("R1.03", 9), g("R1.04", 9), g("R1.06", 9), g("R1.07", 9),
        g("SAE 1.03", 9), g("R1.11", 9),
        g("SAE 1.04", 15), g("R1.05", 15), g("R1.09", 15),
        g("SAE 1.05", 15), g("R1.08", 15),
        g("SAE 1.06", 15), g("R1.12", 15)
    ],

    // Barèmes variés et notes hors barème (comportement d'origine : aucune borne)
    "baremes-varies": [
        g("R1.01", 7, 10, 1), g("R1.01", 33, 40, 2), g("R1.01", 85, 100, 1),
        g("R1.02", 4.5, 5, 1), g("R1.02", 22, 20, 1),
        g("SAE 1.01", 1, 1, 1), g("SAE 1.01", 0.5, 2, 3)
    ],

    // Code matière inconnu : ignoré dans les moyennes mais compté dans le nombre d'évaluations
    "code-inconnu": [g("R9.99", 20, 20, 1), g("R1.01", 10, 20, 1), g("SAE 9.99", 0, 20, 5)],

    // Volumineux (600 notes déterministes) : précision des sommes flottantes
    "volumineux-600": generateRandomGrades(42, 600),

    // Aléatoire avec coefficients nuls possibles
    "aleatoire-coeff-zero": generateRandomGrades(7, 120, { allowZeroCoeff: true })
};
