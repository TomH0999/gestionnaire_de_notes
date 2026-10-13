/** Page d'accueil « Aujourd'hui ». */
import { test, expect, openApp, signIn, setAdeUrl, isMobile, tapOrClick, shot, expectNoHorizontalOverflow } from "./helpers.js";

test("ordre des sections : date + synchro, cours, à faire, saisies rapides, UE, raccourcis", async ({ page, problems }) => {
    await openApp(page);
    await expect(page.locator("[data-home-date]")).toHaveText("Mardi 13 octobre");
    await expect(page.locator("[data-home-sync] [data-sync-state]")).toBeVisible();
    const order = await page.locator('[data-page="accueil"] > div > *').evaluateAll((els) =>
        els.map((el) => el.getAttribute("aria-labelledby") || el.getAttribute("aria-label") || el.tagName)
    );
    expect(order).toEqual(["home-date", "home-courses-title", "home-todo-title", "Saisies rapides", "home-ue-title", "Raccourcis"]);
    for (const [name, title] of [["Notes", "Notes & moyennes"], ["Emploi du temps", "Emploi du temps"], ["Devoirs", "Devoirs & évaluations"], ["Réglages", "Réglages"]]) {
        await page.goto("#/");
        await tapOrClick(page.getByRole("navigation", { name: "Raccourcis" }).getByRole("link", { name: new RegExp(`^${name}`) }));
        await expect(page.locator("#page-title")).toHaveText(title);
    }
    expect(problems).toEqual([]);
});

test("saisie rapide d'une note en 3 interactions (matière mémorisée, virgule française)", async ({ page, problems }) => {
    await openApp(page);
    const form = page.locator("#quick-grade-form");
    // Première saisie : on choisit la matière (elle sera mémorisée)
    await form.locator("#quick-grade-subject").selectOption("R1.05");
    await form.locator("#quick-grade-score").fill("15,5");
    await tapOrClick(form.getByRole("button", { name: "Ajouter la note" }));
    await expect(page.getByText("Note ajoutée en R1.05")).toBeVisible();
    await page.reload();
    // Saisie suivante : 1) toucher le champ note, 2) taper la note, 3) toucher « Ajouter »
    await expect(form.locator("#quick-grade-subject")).toHaveValue("R1.05");
    await tapOrClick(form.locator("#quick-grade-score"));
    await page.keyboard.type("8,25");
    await tapOrClick(form.getByRole("button", { name: "Ajouter la note" }));
    await expect(page.getByText("Note ajoutée en R1.05").first()).toBeVisible();
    // Clavier numérique avec virgule sur iPhone
    await expect(form.locator("#quick-grade-score")).toHaveAttribute("inputmode", "decimal");
    await page.goto("#/notes");
    await expect(page.locator('details[data-subject="R1.05"] summary')).toContainText(`${(((15.5 / 20) * 20 + (8.25 / 20) * 20) / 2).toFixed(2)} / 20`);
    await expect(page.locator("#total-evals-count")).toHaveText("2 évaluation(s) saisie(s)");
    expect(problems).toEqual([]);
});

test("saisie rapide d'un devoir (titre + Ajouter), puis « fait » en un tap avec annulation", async ({ page, problems }) => {
    await openApp(page);
    const form = page.locator("#quick-homework-form");
    await expect(form.locator("#quick-hw-date")).toHaveValue("2026-10-14");
    await form.locator("#quick-hw-type").selectOption("test");
    await expect(form.locator("#quick-hw-importance")).toHaveValue("3");
    await form.locator("#quick-hw-type").selectOption("devoir");
    await tapOrClick(form.locator("#quick-hw-title"));
    await page.keyboard.type("Rendu TP2");
    await tapOrClick(form.getByRole("button", { name: "Ajouter", exact: true }));
    await expect(page.getByText("« Rendu TP2 » ajouté — échéance demain à 23:59.")).toBeVisible();
    const todo = page.locator("[data-home-todo]");
    await expect(todo).toContainText("Rendu TP2");
    await expect(todo).toContainText("À commencer maintenant");
    await expect(todo).toContainText("Demain à 23:59");
    await tapOrClick(todo.getByLabel("Marquer « Rendu TP2 » comme fait"));
    await expect(todo).not.toContainText("Rendu TP2");
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(todo).toContainText("Rendu TP2");
    expect(problems).toEqual([]);
});

test("« À faire maintenant » : début conseillé atteint ou échéance proche, trié par urgence", async ({ page, problems }) => {
    await openApp(page, "#/devoirs");
    const add = async (title, type, date) => {
        await tapOrClick(page.locator("[data-action=add]").first());
        const d = page.getByRole("dialog");
        await expect(d.locator("#hw-title")).toBeFocused();
        await d.locator("#hw-title").fill(title);
        await d.locator("#hw-type").selectOption(type);
        await d.locator("#hw-date").fill(date);
        await d.getByRole("button", { name: "Enregistrer" }).click();
        await expect(d).toHaveCount(0);
    };
    await add("Contrôle dans 6 jours", "controle", "2026-10-19");
    await add("SAE dans 2 semaines", "sae", "2026-10-26");
    await add("SAE dans 2 mois", "sae", "2026-12-15");
    await add("Devoir d'hier", "devoir", "2026-10-12");
    await page.goto("#/");
    const titles = page.locator("[data-home-todo] li a > span:first-child");
    await expect(titles).toHaveText(["Devoir d'hier", "Contrôle dans 6 jours", "SAE dans 2 semaines"]);
    await expect(page.locator("[data-home-todo] li").first()).toContainText("En retard");
    await shot(page, "accueil-a-faire");
    expect(problems).toEqual([]);
});

test("cours restants aujourd'hui avec le prochain en évidence, détail au tap", async ({ page, problems }) => {
    await openApp(page);
    await signIn(page);
    await setAdeUrl(page);
    await page.goto("#/");
    const courses = page.locator("[data-home-courses]");
    await expect(courses.locator("li")).toHaveCount(4);
    await expect(courses.locator("li").first()).toContainText("En cours");
    await expect(courses.locator("li").first()).toContainText("Intro. systèmes");
    await expect(courses.locator("li").nth(1)).toContainText("Prochain cours");
    await expect(courses.locator("li").nth(1)).toContainText("10:15–12:15");
    await expect(courses.locator("li").nth(1)).toContainText("Salle 006");
    await tapOrClick(courses.locator("li").nth(1).getByRole("button"));
    await expect(page.getByRole("dialog", { name: "Détail de la séance" })).toContainText("Maths discrètes");
    await page.keyboard.press("Escape");
    await shot(page, "accueil-complet");
    await expectNoHorizontalOverflow(page);
    expect(problems).toEqual([]);
});

test("aperçu des UE : moyenne générale et détail au survol / tap", async ({ page, problems }) => {
    await page.addInitScript(() => {
        if (!sessionStorage.getItem("seeded")) {
            localStorage.setItem(
                "BUT1_INFO_S1_GRADES",
                JSON.stringify([
                    { id: "1700000000001", name: "DS1", subjectCode: "R1.01", score: 14, max: 20, coeff: 1 },
                    { id: "1700000000002", name: "Projet", subjectCode: "SAE 1.01", score: 12, max: 20, coeff: 1 }
                ])
            );
            sessionStorage.setItem("seeded", "1");
        }
    });
    await openApp(page);
    await expect(page.locator("[data-migration-banner]")).toContainText("Vos 2 note(s) de l'ancienne version ont été reprises");
    const card = page.locator('[data-home-ue] [data-ue="UE 1.1"]');
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    if (isMobile()) await card.tap();
    else await card.hover();
    const tip = page.locator('[role="tooltip"]');
    await expect(tip.locator("[data-ue-detail-result]")).toHaveText((await card.locator("[data-ue-value]").innerText()).trim());
    await expect(page.locator("[data-home-global]")).toHaveText("13.51"); // (UE 1.1 = 1068/82 ; UE 1.2 = 14) / 2
    expect(problems).toEqual([]);
});
