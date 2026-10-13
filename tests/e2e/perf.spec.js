/**
 * Performance : affichage de l'accueil depuis le cache local et fluidité avec 600 notes et
 * 600 devoirs (données injectées dans le cache local avant le chargement).
 */
import { test, expect } from "./helpers.js";
import { generateRandomGrades } from "../golden/datasets.js";

function buildRecords() {
    const records = {};
    const hex = (n) => n.toString(16).padStart(12, "0");
    generateRandomGrades(99, 600).forEach((g, i) => {
        const id = `00000000-0000-4000-8000-${hex(i)}`;
        records[id] = { id, collection: "grades", data: { name: g.name, subjectCode: g.subjectCode, score: g.score, max: g.max, coeff: g.coeff, createdAt: 1700000000000 + i }, deleted: false, clientUpdatedAt: 1700000000000 + i, deviceId: "seed", serverUpdatedAt: null, dirty: true, localRev: 1, base: null };
    });
    const types = ["devoir", "sae", "test", "controle", "autre"];
    for (let i = 0; i < 600; i++) {
        const id = `00000000-0000-4000-9000-${hex(i)}`;
        const day = new Date(Date.UTC(2026, 9, 1 + (i % 90)));
        records[id] = {
            id,
            collection: "homework",
            data: { title: `Travail ${i + 1}`, type: types[i % 5], subjectCode: null, dueDate: day.toISOString().slice(0, 10), dueTime: "23:59", importance: (i % 4) + 1, anticipationDays: [0, 2, 7, 14, 30][i % 5], notes: "", status: i % 7 === 0 ? "done" : "todo", createdAt: i },
            deleted: false,
            clientUpdatedAt: 1700000000000 + i,
            deviceId: "seed",
            serverUpdatedAt: null,
            dirty: true,
            localRev: 1,
            base: null
        };
    }
    return JSON.stringify(records);
}

const RECORDS = buildRecords();

test("accueil affiché depuis le cache en ~1 s et navigation fluide avec 600 notes + 600 devoirs", async ({ page, problems }, info) => {
    await page.addInitScript((data) => {
        if (!localStorage.getItem("gdn:v2:local:records")) localStorage.setItem("gdn:v2:local:records", data);
    }, RECORDS);
    // Horloge réelle : l'horloge simulée de Playwright neutralise aussi l'API performance
    await page.goto("#/");
    await expect(page.locator("html[data-ready=true]")).toHaveCount(1);
    const firstRender = await page.evaluate(() => performance.getEntriesByName("gdn-first-render")[0].startTime);
    info.annotations.push({ type: "performance", description: `premier affichage de l'accueil : ${Math.round(firstRender)} ms` });
    console.log(`[${info.project.name}] premier affichage de l'accueil (600 notes + 600 devoirs) : ${Math.round(firstRender)} ms`);
    expect(firstRender).toBeLessThan(1200);
    await expect(page.locator("[data-home-todo] li").first()).toBeVisible();

    const timings = {};
    for (const [hash, ready] of [
        ["#/notes", '#ressources-accordion-container details[data-subject="R1.01"]'],
        ["#/devoirs", ".cal-cell"],
        ["#/edt", "[data-edt-grid]"],
        ["#/", "[data-home-todo]"]
    ]) {
        timings[hash] = await page.evaluate(
            async ([h, sel]) => {
                const t0 = performance.now();
                location.hash = h;
                await new Promise((resolve) => {
                    const check = () => (document.querySelector(`[data-page="${h.replace("#/", "") || "accueil"}"] ${sel}`) || document.querySelector(sel) ? resolve() : requestAnimationFrame(check));
                    check();
                });
                await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
                return performance.now() - t0;
            },
            [hash, ready]
        );
    }
    console.log(`[${info.project.name}] changements de page :`, JSON.stringify(Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v)]))));
    for (const [hash, ms] of Object.entries(timings)) expect(ms, hash).toBeLessThan(600);

    // Vue liste des 600 devoirs, tri par urgence
    await page.goto("#/devoirs");
    const listMs = await page.evaluate(async () => {
        const t0 = performance.now();
        document.querySelector('[data-view="list"]').click();
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        return performance.now() - t0;
    });
    console.log(`[${info.project.name}] liste triée de 600 devoirs : ${Math.round(listMs)} ms`);
    expect(listMs).toBeLessThan(600);
    await expect(page.locator("[data-hw-list] li")).toHaveCount(600 - Math.ceil(600 / 7));

    // Ajout d'une note avec 600 notes existantes : recalcul et affichage
    await page.goto("#/notes");
    await page.locator("#grade-name").fill("Note 601");
    await page.locator("#grade-score").fill("15");
    const addMs = await page.evaluate(async () => {
        const t0 = performance.now();
        document.querySelector("#add-grade-form button[type=submit]").click();
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        return performance.now() - t0;
    });
    console.log(`[${info.project.name}] ajout d'une note (601e) : ${Math.round(addMs)} ms`);
    expect(addMs).toBeLessThan(400);
    await expect(page.locator("#total-evals-count")).toHaveText("601 évaluation(s) saisie(s)");
    expect(problems).toEqual([]);
});
