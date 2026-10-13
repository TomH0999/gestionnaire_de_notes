/** Navigation au clavier (desktop) : lien d'évitement, barre latérale, infobulle UE au focus. */
import { readFileSync } from "node:fs";
import { test, expect, openApp } from "./helpers.js";
import { DATASETS } from "../golden/datasets.js";

const golden = JSON.parse(readFileSync(new URL("../golden/golden-expected.json", import.meta.url), "utf8"));

test("lien « Aller au contenu » puis navigation dans la barre latérale au clavier", async ({ page, problems }) => {
    await openApp(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('#sidebar-nav a[data-nav="accueil"]')).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator('#sidebar-nav a[data-nav="devoirs"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/devoirs$/);
    await expect(page.locator("#page-title")).toHaveText("Devoirs & évaluations");
    await expect(page.locator('#sidebar-nav a[data-nav="devoirs"]')).toHaveAttribute("aria-current", "page");
    expect(problems).toEqual([]);
});

test("infobulle UE au focus clavier : ouverture, valeur identique, Échap ferme et garde le focus", async ({ page, problems }) => {
    await page.addInitScript((v) => {
        if (!sessionStorage.getItem("seeded")) {
            localStorage.setItem("BUT1_INFO_S1_GRADES", v);
            sessionStorage.setItem("seeded", "1");
        }
    }, JSON.stringify(DATASETS["cas-normal"]));
    await openApp(page, "#/notes");
    await page.locator("#overall-average").click();
    let focused = null;
    for (let i = 0; i < 40 && !focused; i++) {
        await page.keyboard.press("Tab");
        focused = await page.evaluate(() => (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ue || null : null));
    }
    expect(focused).toBe("UE 1.1");
    const tip = page.locator('[role="tooltip"]');
    await expect(tip).toBeVisible();
    await expect(tip.locator("[data-ue-detail-result]")).toHaveText(golden.datasets["cas-normal"].display.ue["UE 1.1"]);
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement.dataset.ue)).toBe("UE 1.1");
    await page.keyboard.press("Tab");
    await expect(tip).toContainText("UE 1.2");
    await page.keyboard.press("Shift+Tab");
    await expect(tip).toContainText("UE 1.1");
    expect(problems).toEqual([]);
});

test("formulaire de note utilisable entièrement au clavier", async ({ page, problems }) => {
    await openApp(page, "#/notes");
    await page.locator("#grade-name").focus();
    await page.keyboard.type("Oral");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("16,5");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Note ajoutée avec succès !")).toBeVisible();
    await expect(page.locator("#total-evals-count")).toHaveText("1 évaluation(s) saisie(s)");
    expect(problems).toEqual([]);
});

test("fenêtre modale : focus piégé et Échap ferme en rendant le focus", async ({ page, problems }) => {
    await openApp(page, "#/devoirs");
    const add = page.locator("[data-action=add]").first();
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#hw-title")).toBeFocused();
    for (let i = 0; i < 30; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    expect(problems).toEqual([]);
});
