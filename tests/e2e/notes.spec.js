import { readFileSync } from "node:fs";
import { test, expect, openApp, isMobile, tapOrClick, shot, expectNoHorizontalOverflow } from "./helpers.js";
import { DATASETS } from "../golden/datasets.js";

const golden = JSON.parse(readFileSync(new URL("../golden/golden-expected.json", import.meta.url), "utf8"));
const LEGACY_KEY = "BUT1_INFO_S1_GRADES";

async function seedLegacy(page, grades) {
    await page.addInitScript(
        ([key, value]) => {
            if (!sessionStorage.getItem("seeded")) {
                localStorage.clear();
                localStorage.setItem(key, value);
                sessionStorage.setItem("seeded", "1");
            }
        },
        [LEGACY_KEY, JSON.stringify(grades)]
    );
}

test.describe("Notes — même précision que la version d'origine", () => {
    for (const name of ["cas-normal", "notes-decimales", "rattrapage-bornes", "coefficient-zero", "volumineux-600"]) {
        test(`valeurs affichées identiques aux valeurs golden : ${name}`, async ({ page, problems }) => {
            await seedLegacy(page, DATASETS[name]);
            await openApp(page, "#/notes");
            const expected = golden.datasets[name].display;
            await expect(page.locator("#overall-average")).toHaveText(expected.moyenneGenerale);
            await expect(page.locator("#status-badge")).toHaveText(expected.statut);
            await expect(page.locator("#total-evals-count")).toHaveText(expected.nombreEvaluations);
            for (const [code, value] of Object.entries(expected.ue)) {
                await expect(page.locator(`#ue-averages-grid [data-ue="${code}"] [data-ue-value]`)).toHaveText(value);
            }
            for (const [code, value] of Object.entries(expected.ressources)) {
                await expect(page.locator(`details[data-subject="${code}"] summary > span`).last()).toHaveText(value);
            }
            for (const [code, value] of Object.entries(expected.saes)) {
                await expect(page.locator(`div[data-subject="${code}"] > div:first-child > span`).last()).toHaveText(value);
            }
            expect(problems).toEqual([]);
        });
    }

    test("ajout d'une note avec virgule française, validation hors barème", async ({ page, problems }) => {
        await openApp(page, "#/notes");
        const form = page.locator("#add-grade-form");
        await form.locator("#grade-name").fill("DS1");
        await form.locator("#grade-subject").selectOption("R1.01");
        await form.locator("#grade-score").fill("25");
        await form.locator("#grade-max").fill("20");
        await form.getByRole("button", { name: "Ajouter" }).click();
        await expect(form.getByText("La note dépasse le barème (20).")).toBeVisible();
        await form.locator("#grade-score").fill("12,5");
        await form.locator("#grade-coeff").fill("1,5");
        await form.getByRole("button", { name: "Ajouter" }).click();
        await expect(page.getByText("Note ajoutée avec succès !")).toBeVisible();
        await expect(page.locator('details[data-subject="R1.01"] summary')).toContainText("12.50 / 20");
        await tapOrClick(page.locator('details[data-subject="R1.01"] summary'));
        await expect(page.locator('details[data-subject="R1.01"]')).toContainText("12.5 / 20");
        await expect(page.locator('details[data-subject="R1.01"]')).toContainText("Coeff: 1.5");
        await expect(page.locator("#total-evals-count")).toHaveText("1 évaluation(s) saisie(s)");
        await expectNoHorizontalOverflow(page);
        expect(problems).toEqual([]);
    });

    test("modification et suppression (avec annulation)", async ({ page, problems }) => {
        await seedLegacy(page, DATASETS["cas-normal"]);
        await openApp(page, "#/notes");
        await tapOrClick(page.locator('details[data-subject="R1.05"] summary'));
        await tapOrClick(page.getByRole("button", { name: "Modifier Éval 9" }));
        const dialog = page.getByRole("dialog", { name: "Modifier l'évaluation" });
        await expect(dialog).toBeVisible();
        await dialog.locator("#edit-grade-score").fill("18,25");
        await dialog.getByRole("button", { name: "Enregistrer" }).click();
        await expect(page.getByText("Modification enregistrée.")).toBeVisible();
        await expect(page.locator('details[data-subject="R1.05"]')).toContainText("18.25 / 20");
        await tapOrClick(page.getByRole("button", { name: "Supprimer Éval 9" }));
        await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
        await expect(page.locator('details[data-subject="R1.05"] summary')).toContainText("Sans note");
        await page.getByRole("button", { name: "Annuler" }).click();
        await expect(page.locator('details[data-subject="R1.05"] summary')).toContainText("18.25 / 20");
        expect(problems).toEqual([]);
    });
});

test.describe("Détail du calcul des UE (infobulle)", () => {
    test("survol (desktop) ou tap (iPhone) : valeur identique à la carte, dans l'écran, fermeture Échap / tap extérieur", async ({ page, problems }) => {
        await seedLegacy(page, DATASETS["notes-manquantes"]);
        await openApp(page, "#/notes");
        for (const code of ["UE 1.1", "UE 1.2", "UE 1.3", "UE 1.4", "UE 1.5", "UE 1.6"]) {
            const card = page.locator(`#ue-averages-grid [data-ue="${code}"]`);
            const shown = (await card.locator("[data-ue-value]").innerText()).trim();
            await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
            if (isMobile()) await card.tap();
            else await card.hover();
            const tip = page.locator('[role="tooltip"]');
            await expect(tip).toBeVisible();
            await expect(tip).toContainText(code);
            if (shown === "--") await expect(tip).toContainText("moyenne non calculée");
            else await expect(tip.locator("[data-ue-detail-result]")).toHaveText(shown);
            await expect(card).toHaveAttribute("aria-expanded", "true");
            const id = await tip.getAttribute("id");
            await expect(card).toHaveAttribute("aria-describedby", id);
            const box = await tip.boundingBox();
            const vp = page.viewportSize();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
            expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
            if (code === "UE 1.1") {
                await expect(tip).toContainText("SAE 1.01");
                await expect(tip).toContainText("R1.02");
                await expect(tip).toContainText("sans note");
                await expect(tip).toContainText("ignorées");
                await shot(page, "notes-infobulle-ue");
            }
            if (isMobile()) {
                await page.locator("#page-title").tap(); // tap extérieur (en-tête toujours visible)
            } else {
                await page.keyboard.press("Escape");
            }
            await expect(tip).toHaveCount(0);
            await expect(card).toHaveAttribute("aria-expanded", "false");
        }
        expect(problems).toEqual([]);
    });

    test("ne déborde pas sur un petit écran (320 px)", async ({ page, problems }) => {
        await seedLegacy(page, DATASETS["cas-normal"]);
        await page.setViewportSize({ width: 320, height: 568 });
        await openApp(page, "#/notes");
        for (const code of ["UE 1.1", "UE 1.3", "UE 1.6"]) {
            const card = page.locator(`#ue-averages-grid [data-ue="${code}"]`);
            await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
            await card.click();
            const box = await page.locator('[role="tooltip"]').boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(320.5);
            expect(box.y + box.height).toBeLessThanOrEqual(568.5);
            await page.keyboard.press("Escape");
        }
        await expectNoHorizontalOverflow(page);
        expect(problems).toEqual([]);
    });
});
