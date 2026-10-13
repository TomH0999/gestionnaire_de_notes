/**
 * Harnais d'exécution de la version d'origine (script classique, fonctions globales).
 *
 *  - runLegacyCalc(source, grades) : exécute calculateAllAverages() du script d'origine
 *    dans un contexte isolé (vm) avec le tableau de notes fourni.
 *  - renderLegacyDisplay(htmlSource, scriptSource, grades) : charge la page d'origine dans
 *    jsdom, exécute le script, et relève les textes affichés (moyennes, statut, badges).
 */
import vm from "node:vm";
import { JSDOM } from "jsdom";

export function runLegacyCalc(scriptSource, grades) {
    const context = vm.createContext({
        window: { addEventListener() {} },
        console
    });
    const api = vm.runInContext(
        `${scriptSource}\n;({ calc: calculateAllAverages, setGrades: (g) => { grades = g; } })`,
        context,
        { filename: "script.legacy.js" }
    );
    // Copie profonde : le calcul d'origine ne modifie pas les notes, mais on isole quand même.
    api.setGrades(JSON.parse(JSON.stringify(grades)));
    return JSON.parse(JSON.stringify(api.calc()));
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);

export function renderLegacyDisplay(htmlSource, scriptSource, grades) {
    const dom = new JSDOM(htmlSource, { url: "https://exemple.test/", runScripts: "outside-only" });
    const { window } = dom;
    window.localStorage.setItem("BUT1_INFO_S1_GRADES", JSON.stringify(grades));
    window.eval(`${scriptSource}\n;loadLocalStorageData(); updateSubjectDropdowns(); renderApp();`);
    const doc = window.document;

    const ue = {};
    doc.querySelectorAll("#ue-averages-grid > div").forEach((card) => {
        const spans = card.querySelectorAll("span");
        ue[text(spans[0])] = text(spans[1]);
    });
    const ressources = {};
    doc.querySelectorAll("#ressources-accordion-container > details > summary").forEach((summary) => {
        const code = text(summary.querySelector("span.text-brand-400"));
        const badge = summary.lastElementChild;
        ressources[code] = text(badge);
    });
    const saes = {};
    doc.querySelectorAll("#saes-list-container > div").forEach((block) => {
        const header = block.firstElementChild;
        const code = text(header.querySelector("span.text-brand-400"));
        saes[code] = text(header.lastElementChild);
    });
    const result = {
        moyenneGenerale: text(doc.getElementById("overall-average")),
        statut: text(doc.getElementById("status-badge")),
        nombreEvaluations: text(doc.getElementById("total-evals-count")),
        ue,
        ressources,
        saes
    };
    window.close();
    return result;
}
