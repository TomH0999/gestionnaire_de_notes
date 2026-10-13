import { PROGRAM_S1, COEFFICIENTS_UE } from "./program.js";

/**
 * Calculs stricts conformes au fichier Excel BUT1
 *
 * Corps repris À L'IDENTIQUE de la version d'origine (script.js). Seule différence :
 * le tableau `grades` est passé en paramètre au lieu d'être une variable globale.
 * Ne pas modifier : protégé par les tests golden (tests/golden).
 */
export function calculateAllAverages(grades) {
    // 1. Calcul des moyennes individuelles des Matières (Ressources) et SAÉ
    const subjectAverages = {};
    const allItems = [...PROGRAM_S1.ressources, ...PROGRAM_S1.saes];

    allItems.forEach(item => {
        const itemGrades = grades.filter(g => g.subjectCode === item.code);
        if (itemGrades.length > 0) {
            let scoreSum = 0;
            let coeffSum = 0;
            itemGrades.forEach(g => {
                const normScore = (g.score / g.max) * 20;
                scoreSum += normScore * g.coeff;
                coeffSum += g.coeff;
            });
            subjectAverages[item.code] = coeffSum > 0 ? (scoreSum / coeffSum) : null;
        } else {
            subjectAverages[item.code] = null;
        }
    });

    // 2. Calcul des Moyennes d'UE (UE 1.1 à UE 1.6)
    const ueAverages = {};
    PROGRAM_S1.ues.forEach(ue => {
        const coeffsMap = COEFFICIENTS_UE[ue.code];
        let weightedSum = 0;
        let totalCoeffs = 0;

        for (const [subCode, coeff] of Object.entries(coeffsMap)) {
            const avg = subjectAverages[subCode];
            // Ignorer les éléments sans note dans le numérateur et le dénominateur
            if (avg !== null && avg !== undefined) {
                weightedSum += avg * coeff;
                totalCoeffs += coeff;
            }
        }

        ueAverages[ue.code] = totalCoeffs > 0 ? (weightedSum / totalCoeffs) : null;
    });

    // 3. Calcul de la Moyenne Générale (Moyenne simple des 6 UE)
    const validUeValues = Object.values(ueAverages).filter(val => val !== null);
    const globalAverage = validUeValues.length > 0
        ? validUeValues.reduce((a, b) => a + b, 0) / validUeValues.length
        : null;

    // 4. Détermination du Statut d'obtention
    let status = "Non calculé";
    let statusClass = "bg-slate-800 text-slate-400 border-slate-700";

    if (validUeValues.length === 6) {
        const countUnder10 = validUeValues.filter(v => v < 10).length;
        const hasUnder8 = validUeValues.some(v => v < 8);

        if (countUnder10 > 2 || hasUnder8) {
            status = "NON (Refusé)";
            statusClass = "bg-rose-500/20 text-rose-400 border-rose-500/30";
        } else if (countUnder10 >= 1) {
            status = "OUI avec rattrapage";
            statusClass = "bg-amber-500/20 text-amber-400 border-amber-500/30";
        } else {
            status = "OUI (Validé)";
            statusClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
        }
    } else if (validUeValues.length > 0) {
        status = "En cours d'évaluation";
        statusClass = "bg-brand-500/20 text-brand-400 border-brand-500/30";
    }

    return {
        subjectAverages,
        ueAverages,
        globalAverage,
        status,
        statusClass,
        totalEvals: grades.length
    };
}

/**
 * Détail du calcul d'une UE, pour l'infobulle.
 *
 * Reproduit EXACTEMENT la boucle de l'étape 2 ci-dessus (même ordre, mêmes opérations),
 * de sorte que `result` est strictement identique (au bit près) à `ueAverages[ueCode]`.
 * Un test vérifie cette égalité sur de nombreux jeux de données.
 */
export function computeUeBreakdown(subjectAverages, ueCode) {
    const ue = PROGRAM_S1.ues.find((u) => u.code === ueCode);
    const coeffsMap = COEFFICIENTS_UE[ueCode];
    if (!ue || !coeffsMap) return null;
    const allItems = [...PROGRAM_S1.ressources, ...PROGRAM_S1.saes];

    const rows = [];
    let weightedSum = 0;
    let totalCoeffs = 0;
    for (const [subCode, coeff] of Object.entries(coeffsMap)) {
        const avg = subjectAverages[subCode];
        const item = allItems.find((i) => i.code === subCode);
        const counted = avg !== null && avg !== undefined;
        let product = null;
        if (counted) {
            product = avg * coeff;
            weightedSum += avg * coeff;
            totalCoeffs += coeff;
        }
        rows.push({
            code: subCode,
            name: item ? item.name : subCode,
            kind: subCode.startsWith("SAE") ? "sae" : "ressource",
            average: counted ? avg : null,
            coeff,
            product,
            counted
        });
    }
    return {
        ueCode,
        ueName: ue.name,
        rows,
        weightedSum,
        totalCoeffs,
        totalProgramCoeffs: Object.values(coeffsMap).reduce((a, b) => a + b, 0),
        result: totalCoeffs > 0 ? (weightedSum / totalCoeffs) : null
    };
}

/**
 * Ordre déterministe des notes avant calcul (les sommes flottantes dépendent de l'ordre).
 * Reproduit l'ordre d'insertion de la version d'origine : date de création croissante
 * (pour les notes migrées : l'ancien identifiant `Date.now()`), puis identifiant.
 */
export function sortGradesForCalculation(grades) {
    return [...grades].sort((a, b) => {
        const ca = Number.isFinite(a.createdAt) ? a.createdAt : 0;
        const cb = Number.isFinite(b.createdAt) ? b.createdAt : 0;
        if (ca !== cb) return ca - cb;
        const ia = String(a.id);
        const ib = String(b.id);
        return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
}

/** Affichage d'une moyenne, identique à la version d'origine (2 décimales, point). */
export function formatAverage(value) {
    return value === null || value === undefined ? "--" : value.toFixed(2);
}

/** Note ramenée sur 20 (même formule que l'origine), pour la couleur des lignes. */
export function normalizedScore(grade) {
    return (grade.score / grade.max) * 20;
}
