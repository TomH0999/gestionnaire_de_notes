/**
 * Captures d'écran de chaque page avec des données réalistes (desktop et iPhone), relues
 * manuellement : débordements, textes tronqués, safe-area, barre d'onglets, infobulle UE,
 * EDT zoomé. Vérifie aussi automatiquement l'absence de défilement horizontal.
 */
import { test, expect, openApp, signIn, setAdeUrl, shot, isMobile, expectNoHorizontalOverflow } from "./helpers.js";
import { DATASETS } from "../golden/datasets.js";

const HOMEWORK = [
    { title: "Rendu SAE 1.05 — dossier de recueil des besoins", type: "sae", subjectCode: "SAE 1.05", dueDate: "2026-10-23", dueTime: "23:59", importance: 3, anticipationDays: 14 },
    { title: "DS Maths discrètes", type: "controle", subjectCode: "R1.06", dueDate: "2026-10-19", dueTime: "08:00", importance: 4, anticipationDays: 7 },
    { title: "TP Bash à terminer", type: "devoir", subjectCode: "R1.04", dueDate: "2026-10-12", dueTime: "23:59", importance: 2, anticipationDays: 2 },
    { title: "QCM d'anglais", type: "test", subjectCode: "R1.10", dueDate: "2026-10-14", dueTime: "13:30", importance: 3, anticipationDays: 2 },
    { title: "Lire le chapitre 4", type: "autre", subjectCode: null, dueDate: "2026-11-04", dueTime: "23:59", importance: 1, anticipationDays: 0 }
];

function seedRecords() {
    const out = {};
    HOMEWORK.forEach((h, i) => {
        const id = `00000000-0000-4000-a000-${String(i).padStart(12, "0")}`;
        out[id] = { id, collection: "homework", data: { ...h, notes: "", status: "todo", createdAt: i }, deleted: false, clientUpdatedAt: 1760000000000 + i, deviceId: "seed", serverUpdatedAt: null, dirty: true, localRev: 1, base: null };
    });
    return JSON.stringify(out);
}

test("captures de toutes les pages avec données", async ({ page, problems }) => {
    test.setTimeout(120000);
    await page.addInitScript(
        ([legacy, records]) => {
            if (!sessionStorage.getItem("seeded")) {
                localStorage.setItem("BUT1_INFO_S1_GRADES", legacy);
                localStorage.setItem("gdn:v2:local:records", records);
                sessionStorage.setItem("seeded", "1");
            }
        },
        [JSON.stringify(DATASETS["cas-normal"]), seedRecords()]
    );
    await openApp(page);
    await signIn(page);
    await setAdeUrl(page);
    const pages = [
        ["accueil", "#/"],
        ["notes", "#/notes"],
        ["edt", "#/edt"],
        ["devoirs", "#/devoirs"],
        ["reglages", "#/reglages"]
    ];
    for (const [name, hash] of pages) {
        await page.goto(hash);
        await page.waitForTimeout(400);
        await expectNoHorizontalOverflow(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `test-results/screenshots/${test.info().project.name}--visuel-${name}-ecran.png` });
        await shot(page, `visuel-${name}-complet`);
    }
    // Infobulle UE ouverte
    await page.goto("#/notes");
    const card = page.locator('#ue-averages-grid [data-ue="UE 1.2"]');
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    if (isMobile()) await card.tap();
    else await card.hover();
    await expect(page.locator('[role="tooltip"]')).toBeVisible();
    await page.screenshot({ path: `test-results/screenshots/${test.info().project.name}--visuel-infobulle-ue.png` });
    await page.keyboard.press("Escape");
    // Emploi du temps zoomé (150 %) en vue semaine
    await page.goto("#/edt");
    await page.locator('[data-view="week"]').click();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Agrandir" }).click();
    await expect(page.locator("[data-zoom-value]")).toHaveText("150 %");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/screenshots/${test.info().project.name}--visuel-edt-semaine-zoom150.png` });
    await page.getByRole("button", { name: "Réinitialiser le zoom" }).click();
    // Liste des devoirs et formulaire
    await page.goto("#/devoirs");
    await page.locator('[data-view="list"]').click();
    await page.waitForTimeout(400); // fin de la transition de couleur des boutons
    await page.screenshot({ path: `test-results/screenshots/${test.info().project.name}--visuel-devoirs-liste.png` });
    await page.locator("[data-action=add]").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `test-results/screenshots/${test.info().project.name}--visuel-formulaire-devoir.png` });
    await page.keyboard.press("Escape");
    expect(problems).toEqual([]);
});
