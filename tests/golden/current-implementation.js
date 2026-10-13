/**
 * Adaptateur vers l'implémentation ACTUELLE du calcul des moyennes.
 *
 * C'est le seul fichier des tests golden qui suit l'évolution du code : il pointe vers
 * l'endroit où vit aujourd'hui calculateAllAverages(). Les valeurs attendues
 * (golden-expected.json) ne changent jamais.
 *
 * Historique :
 *  - Phase 0 (avant refonte) : le calcul vivait dans script.js (fonctions globales),
 *    exécuté via legacy-harness.js → 71 tests verts.
 *  - v2 : le calcul est un module ES (js/core/grades-calc.js), corps repris à l'identique.
 */
import { calculateAllAverages } from "../../js/core/grades-calc.js";

export const IMPLEMENTATION = "js/core/grades-calc.js (module v2)";

export function calculateWithCurrentImplementation(grades) {
    // Même isolation que le harnais d'origine : copie profonde en entrée, résultat sérialisé.
    return JSON.parse(JSON.stringify(calculateAllAverages(JSON.parse(JSON.stringify(grades)))));
}
