/**
 * Adaptateur vers l'implémentation ACTUELLE du calcul des moyennes.
 *
 * C'est le seul fichier des tests golden qui suit l'évolution du code : il pointe vers
 * l'endroit où vit aujourd'hui calculateAllAverages(). Les valeurs attendues
 * (golden-expected.json) ne changent jamais.
 *
 * Phase 0 (avant refonte) : le calcul vit dans script.js (fonctions globales).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runLegacyCalc } from "./legacy-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(path.join(root, "script.js"), "utf8");

export const IMPLEMENTATION = "script.js (version d'origine)";

export function calculateWithCurrentImplementation(grades) {
    return runLegacyCalc(source, grades);
}
