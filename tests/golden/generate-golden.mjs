/**
 * Génération UNIQUE des valeurs attendues des tests golden.
 *
 * Exécuté une seule fois, AVANT toute modification de l'application, depuis la copie
 * verbatim de la version d'origine (legacy/script.legacy.js + legacy/index.legacy.html).
 *
 * Ne jamais relancer ce script pour « faire passer » un test : golden-expected.json est figé.
 * Le script refuse d'écraser un fichier existant.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DATASETS } from "./datasets.js";
import { runLegacyCalc, renderLegacyDisplay } from "./legacy-harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(here, "golden-expected.json");
if (existsSync(outFile)) {
    console.error("golden-expected.json existe déjà : les valeurs golden sont figées et ne doivent pas être régénérées.");
    process.exit(1);
}

const scriptSource = readFileSync(path.join(here, "legacy", "script.legacy.js"), "utf8");
const htmlSource = readFileSync(path.join(here, "legacy", "index.legacy.html"), "utf8");

const out = {
    _avertissement:
        "Valeurs figées générées depuis la version d'origine (script.js du commit 3ec1d0c) avant toute modification. NE JAMAIS MODIFIER NI RÉGÉNÉRER.",
    _genereLe: new Date().toISOString(),
    datasets: {}
};
for (const [name, grades] of Object.entries(DATASETS)) {
    out.datasets[name] = {
        calc: runLegacyCalc(scriptSource, grades),
        display: renderLegacyDisplay(htmlSource, scriptSource, grades)
    };
}
writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`Écrit ${outFile} (${Object.keys(out.datasets).length} jeux de données).`);
