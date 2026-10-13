/**
 * Tests « golden » de non-régression du calcul des moyennes.
 *
 * RÈGLE : les valeurs attendues (golden-expected.json) ont été générées depuis la version
 * d'origine avant toute modification. Elles ne doivent JAMAIS être modifiées pour faire
 * passer un test. Un échec ici signifie une régression du calcul.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DATASETS, generateRandomGrades } from "./datasets.js";
import { runLegacyCalc, renderLegacyDisplay } from "./legacy-harness.js";
import { calculateWithCurrentImplementation, IMPLEMENTATION } from "./current-implementation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(readFileSync(path.join(here, "golden-expected.json"), "utf8"));
const legacyScript = readFileSync(path.join(here, "legacy", "script.legacy.js"), "utf8");
const legacyHtml = readFileSync(path.join(here, "legacy", "index.legacy.html"), "utf8");

describe(`Golden — calcul des moyennes (${IMPLEMENTATION})`, () => {
    it("couvre tous les jeux de données figés", () => {
        expect(Object.keys(expected.datasets).sort()).toEqual(Object.keys(DATASETS).sort());
    });

    for (const [name, grades] of Object.entries(DATASETS)) {
        describe(name, () => {
            const frozen = expected.datasets[name];
            const actual = calculateWithCurrentImplementation(grades);

            it("moyennes des matières et SAÉ identiques au bit près", () => {
                expect(actual.subjectAverages).toStrictEqual(frozen.calc.subjectAverages);
            });
            it("moyennes d'UE identiques au bit près", () => {
                expect(actual.ueAverages).toStrictEqual(frozen.calc.ueAverages);
            });
            it("moyenne générale, statut et nombre d'évaluations identiques", () => {
                expect(actual.globalAverage).toStrictEqual(frozen.calc.globalAverage);
                expect(actual.status).toBe(frozen.calc.status);
                expect(actual.statusClass).toBe(frozen.calc.statusClass);
                expect(actual.totalEvals).toBe(frozen.calc.totalEvals);
            });
            it("arrondi d'affichage à 2 décimales identique (toFixed(2))", () => {
                for (const [code, value] of Object.entries(actual.ueAverages)) {
                    const shown = frozen.display.ue[code];
                    expect(value === null ? "--" : value.toFixed(2)).toBe(shown);
                }
                const g = actual.globalAverage;
                expect(g === null ? "--" : g.toFixed(2)).toBe(frozen.display.moyenneGenerale);
            });
        });
    }
});

describe("Golden — garde-fous sur la copie figée de la version d'origine", () => {
    it("la copie d'origine reproduit exactement les valeurs figées (calcul + affichage)", () => {
        for (const [name, grades] of Object.entries(DATASETS)) {
            expect(runLegacyCalc(legacyScript, grades), name).toStrictEqual(expected.datasets[name].calc);
        }
        // Le rendu DOM est plus lent : on vérifie un échantillon représentatif
        for (const name of ["exemple-initial", "aucune-note", "cas-normal", "notes-decimales", "rattrapage-bornes"]) {
            expect(renderLegacyDisplay(legacyHtml, legacyScript, DATASETS[name]), name).toStrictEqual(expected.datasets[name].display);
        }
    });

    it("différentiel : implémentation actuelle == version d'origine sur 300 jeux aléatoires", () => {
        for (let seed = 1000; seed < 1300; seed++) {
            const grades = generateRandomGrades(seed, 1 + (seed % 60), { allowZeroCoeff: seed % 3 === 0, decimals: seed % 2 === 0 });
            expect(calculateWithCurrentImplementation(grades), `seed ${seed}`).toStrictEqual(runLegacyCalc(legacyScript, grades));
        }
    });
});
