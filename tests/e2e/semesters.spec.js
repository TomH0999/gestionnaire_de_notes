/**
 * Semestres S1 à S6 : changement de semestre, parcours, saisie, détail des UE et tableau de bord.
 */
import { test, expect, openApp, shot } from "./helpers.js";

async function addGrade(page, subject, score, { max = "20", coeff = "1", name = "Éval" } = {}) {
    const form = page.locator("#add-grade-form");
    await form.locator("#grade-name").fill(name);
    await form.locator("#grade-subject").selectOption(subject);
    await form.locator("#grade-score").fill(score);
    await form.locator("#grade-max").fill(max);
    await form.locator("#grade-coeff").fill(coeff);
    await form.getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByText("Note ajoutée avec succès !").last()).toBeVisible();
}

const semesterButton = (page, n, scope = "#notes-semester") => page.locator(`${scope} [data-action=set-semester][data-semester="${n}"]`);

test("changer de semestre en un toucher : UE, matières et saisie suivent", async ({ page, problems }) => {
    await openApp(page, "#/notes");
    await expect(semesterButton(page, 1)).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#ue-averages-grid [data-ue]")).toHaveCount(6);
    await expect(page.locator("#sem-badge")).toHaveText("Semestre 1");

    await semesterButton(page, 2).click();
    await expect(semesterButton(page, 2)).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#sem-badge")).toHaveText("Semestre 2");
    await expect(page.getByText("Ressources (R2.01 à R2.14)")).toBeVisible();
    await expect(page.locator("#ue-averages-grid [data-ue]")).toHaveText([/UE 2\.1/, /UE 2\.2/, /UE 2\.3/, /UE 2\.4/, /UE 2\.5/, /UE 2\.6/]);
    await expect(page.locator("#grade-subject option").first()).toHaveText("R2.01 - Dev. Objets");

    // UE 2.1 : module SAÉ (40) = 10, module ressources (60) = R2.01 seule = 16 → 13.60
    await addGrade(page, "SAE 2.01", "10");
    await addGrade(page, "R2.01", "16");
    const ue21 = page.locator('#ue-averages-grid [data-ue="UE 2.1"]');
    await expect(ue21.locator("[data-ue-value]")).toHaveText("13.60");
    await ue21.hover();
    const tip = page.locator('[role="tooltip"]');
    await expect(tip.locator("[data-ue-detail-result]")).toHaveText("13.60");
    await expect(tip).toContainText("module, coeff. 40");
    await expect(tip).toContainText("module, coeff. 60");
    await page.keyboard.press("Escape");

    // Les notes du S2 n'apparaissent pas au S1, et inversement
    await semesterButton(page, 1).click();
    await expect(page.locator("#overall-average")).toHaveText("--");
    await expect(page.locator("#total-evals-count")).toHaveText("0 évaluation(s) saisie(s)");
    // Pastille sur le S2 : notes saisies
    await expect(semesterButton(page, 2).locator("span")).toHaveCount(1);

    // Le choix est mémorisé (réglage synchronisé)
    await semesterButton(page, 2).click();
    await page.reload();
    await expect(page.locator("html[data-ready=true]")).toHaveCount(1);
    await expect(page.locator("#sem-badge")).toHaveText("Semestre 2");
    expect(problems).toEqual([]);
});

test("au clavier : flèches gauche / droite sur le sélecteur", async ({ page, problems }) => {
    await openApp(page, "#/notes");
    await semesterButton(page, 1).focus();
    await page.keyboard.press("ArrowRight");
    await expect(semesterButton(page, 2)).toHaveAttribute("aria-checked", "true");
    await expect(semesterButton(page, 2)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#sem-badge")).toHaveText("Semestre 3");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#sem-badge")).toHaveText("Semestre 2");
    expect(problems).toEqual([]);
});

test("S4 : parcours demandé, puis UE et coefficients du parcours", async ({ page, problems }) => {
    await openApp(page, "#/notes");
    await semesterButton(page, 4).click();
    await expect(page.locator("[data-parcours-notice]")).toBeVisible();
    await expect(page.locator("#ue-averages-grid [data-ue]")).toHaveCount(0);
    // Toutes les matières du S4 restent saisissables avant le choix
    await addGrade(page, "Stage S4", "16", { name: "Stage" });

    await page.locator("#notes-semester [data-action=set-parcours]").selectOption("RACDV");
    await expect(page.locator("[data-parcours-notice]")).toHaveCount(0);
    await expect(page.locator("#sem-badge")).toHaveText("Semestre 4 · RACDV");
    await expect(page.locator("#ue-averages-grid [data-ue]")).toHaveCount(6);
    // Stage seul : module A = 16, module B absent → toutes les UE à 16
    await expect(page.locator('#ue-averages-grid [data-ue="UE 4.1"] [data-ue-value]')).toHaveText("16.00");
    await addGrade(page, "R4.01", "8", { name: "Archi" });
    // UE 4.1 : (16 × 60 + 8 × 40) / 100 = 12.80
    await expect(page.locator('#ue-averages-grid [data-ue="UE 4.1"] [data-ue-value]')).toHaveText("12.80");

    await semesterButton(page, 5).click();
    await expect(page.locator("#ue-averages-grid [data-ue]")).toHaveText([/UE 5\.1/, /UE 5\.2/, /UE 5\.6/]);
    await page.locator("#notes-semester [data-action=set-parcours]").selectOption("IAMSI");
    await expect(page.locator("#ue-averages-grid [data-ue]")).toHaveText([/UE 5\.1/, /UE 5\.5/, /UE 5\.6/]);
    await shot(page, "notes-s5-iamsi");
    expect(problems).toEqual([]);
});

test("tableau de bord : moyenne globale, compétences, meilleures matières, détail par semestre", async ({ page, problems }) => {
    await openApp(page, "#/notes");
    await addGrade(page, "R1.01", "14");
    await addGrade(page, "SAE 1.01", "12");
    await semesterButton(page, 2).click();
    await addGrade(page, "R2.07", "18");
    await addGrade(page, "SAE 2.02", "9");

    await page.goto("#/bilan");
    await expect(page.locator("#page-title")).toHaveText("Tableau de bord");
    const s1 = await page.evaluate(async () => {
        const { buildDashboard } = await import("./js/core/semester-calc.js");
        const grades = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(":records"))));
        const list = Object.values(grades).filter((r) => r.collection === "grades" && !r.deleted).map((r) => ({ ...r.data, id: r.id }));
        const d = buildDashboard(list, null);
        return { global: d.globalAverage.toFixed(2), best: d.bestSubject.code, worst: d.worstSubject.code };
    });
    await expect(page.getByTestId("global-average")).toHaveText(s1.global);
    await expect(page.locator("[data-dashboard]")).toContainText("Meilleures matières");
    await expect(page.locator("[data-dashboard] ol li").first()).toContainText(s1.best);
    await expect(page.locator('[data-semester-bar="1"]')).toHaveAttribute("aria-label", /Semestre 1 : \d+\.\d\d sur 20/);
    await expect(page.locator('[data-semester-bar="3"]')).toHaveAttribute("aria-label", "Semestre 3 : pas de moyenne");
    await expect(page.locator('[data-competence="1"]')).not.toHaveText("--");

    // Détail du semestre choisi (même sélecteur, même réglage)
    await expect(page.locator("#dash-sem-title")).toHaveText("Semestre 2");
    await page.locator('#dash-semester [data-action=set-semester][data-semester="1"]').click();
    await expect(page.locator("#dash-sem-title")).toHaveText("Semestre 1");
    await expect(page.getByTestId("semester-average")).not.toHaveText("--");
    await shot(page, "tableau-de-bord");
    expect(problems).toEqual([]);
});

test("accueil : le sélecteur change les UE affichées et les matières de la saisie rapide", async ({ page, problems }) => {
    await openApp(page);
    await expect(page.locator("#quick-grade-subject option").first()).toHaveText(/^R1\.01/);
    await page.locator('#home-semester [data-action=set-semester][data-semester="3"]').click();
    await expect(page.locator("[data-home-ue] [data-ue]")).toHaveCount(6);
    await expect(page.locator('[data-home-ue] [data-ue="UE 3.1"]')).toBeVisible();
    await expect(page.locator("#quick-grade-subject option").first()).toHaveText(/^R3\.01/);
    await page.locator('#home-semester [data-action=set-semester][data-semester="6"]').click();
    await expect(page.locator("[data-home-ue] [data-parcours-notice]")).toBeVisible();
    expect(problems).toEqual([]);
});
