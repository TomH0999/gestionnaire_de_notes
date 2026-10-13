/**
 * Synchronisation entre deux « appareils » = deux contextes de navigateur isolés (stockage
 * local séparé), connectés au même compte sur le serveur de test.
 */
import { test, expect, openApp, signIn, rows, TEST_ORIGIN, NOW } from "./helpers.js";
import { watchPage } from "./helpers.js";

const CONTEXT_KEYS = ["viewport", "userAgent", "deviceScaleFactor", "isMobile", "hasTouch", "locale", "timezoneId", "baseURL", "serviceWorkers"];

async function device(browser, legacy = null) {
    const use = test.info().project.use;
    const options = Object.fromEntries(CONTEXT_KEYS.filter((k) => use[k] !== undefined).map((k) => [k, use[k]]));
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const problems = watchPage(page, { allowFailed: [/__test\/api\/stream/] });
    if (legacy) {
        await page.addInitScript((v) => {
            if (!sessionStorage.getItem("seeded")) {
                localStorage.setItem("BUT1_INFO_S1_GRADES", v);
                sessionStorage.setItem("seeded", "1");
            }
        }, JSON.stringify(legacy));
    }
    await page.clock.setFixedTime(NOW);
    return { context, page, problems };
}

async function addGrade(page, name, score, subject = "R1.01") {
    // Navigation interne (changement d'ancre) : fonctionne aussi hors-ligne sous WebKit
    await page.evaluate(() => {
        if (location.hash !== "#/notes") location.hash = "#/notes";
    });
    await expect(page.locator("#page-title")).toHaveText("Notes & moyennes");
    await page.locator("#grade-name").fill(name);
    await page.locator("#grade-subject").selectOption(subject);
    await page.locator("#grade-score").fill(score);
    await page.locator("#add-grade-form").getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByText("Note ajoutée avec succès !").last()).toBeVisible();
}

const subjectSummary = (page, code) => page.locator(`details[data-subject="${code}"] summary`);

test("création, modification et suppression sur A → visibles sur B en temps réel (sans recharger)", async ({ browser }) => {
    const A = await device(browser);
    const B = await device(browser);
    await openApp(A.page);
    await openApp(B.page);
    await signIn(A.page);
    await signIn(B.page);
    await B.page.goto("#/notes");
    await addGrade(A.page, "DS synchro", "15,5");
    await expect(subjectSummary(B.page, "R1.01")).toContainText("15.50 / 20", { timeout: 10000 });
    // Modification sur B → A
    await B.page.locator('details[data-subject="R1.01"] summary').click();
    await B.page.getByRole("button", { name: "Modifier DS synchro" }).click();
    await B.page.locator("#edit-grade-score").fill("17");
    await B.page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
    await A.page.goto("#/notes");
    await expect(subjectSummary(A.page, "R1.01")).toContainText("17.00 / 20", { timeout: 10000 });
    // Suppression sur A → disparaît sur B
    await A.page.locator('details[data-subject="R1.01"] summary').click();
    await A.page.getByRole("button", { name: "Supprimer DS synchro" }).click();
    await A.page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
    await expect(subjectSummary(B.page, "R1.01")).toContainText("Sans note", { timeout: 10000 });
    // Devoir et réglage synchronisés aussi
    await A.page.goto("#/");
    await A.page.locator("#quick-hw-title").fill("Préparer l'oral");
    await A.page.locator("#quick-homework-form").getByRole("button", { name: "Ajouter", exact: true }).click();
    await B.page.goto("#/");
    await expect(B.page.locator("[data-home-todo]")).toContainText("Préparer l'oral", { timeout: 10000 });
    expect([...A.problems, ...B.problems]).toEqual([]);
    await A.context.close();
    await B.context.close();
});

test("A hors-ligne modifie, B modifie en ligne, A revient → fusion sans perte", async ({ browser, request }) => {
    const A = await device(browser);
    const B = await device(browser);
    await openApp(A.page);
    await openApp(B.page);
    await signIn(A.page);
    await signIn(B.page);
    await addGrade(A.page, "Projet", "10", "R1.02");
    await B.page.goto("#/notes");
    await expect(subjectSummary(B.page, "R1.02")).toContainText("10.00 / 20", { timeout: 10000 });
    await expect(A.page.locator("[data-sync-state=synced]:visible").first()).toBeVisible({ timeout: 10000 });

    await A.context.setOffline(true);
    await A.page.locator('details[data-subject="R1.02"] summary').click();
    await A.page.getByRole("button", { name: "Modifier Projet" }).click();
    await A.page.locator("#edit-grade-name").fill("Projet web (rendu final)");
    await A.page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
    await addGrade(A.page, "Créée hors-ligne", "12", "R1.03");
    await expect(A.page.locator("[data-sync-state=offline]:visible").first()).toBeVisible({ timeout: 15000 });

    await B.page.locator('details[data-subject="R1.02"] summary').click();
    await B.page.getByRole("button", { name: "Modifier Projet" }).click();
    await B.page.locator("#edit-grade-score").fill("16");
    await B.page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
    await expect(B.page.locator("[data-sync-state=synced]:visible").first()).toBeVisible({ timeout: 10000 });

    await A.context.setOffline(false);
    await A.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(A.page.locator("[data-sync-state=synced]:visible").first()).toBeVisible({ timeout: 20000 });
    for (const P of [A.page, B.page]) {
        await P.goto("#/notes");
        await expect(subjectSummary(P, "R1.02")).toContainText("16.00 / 20", { timeout: 10000 });
        await P.locator('details[data-subject="R1.02"] summary').click();
        await expect(P.locator('details[data-subject="R1.02"]')).toContainText("Projet web (rendu final)");
        await expect(subjectSummary(P, "R1.03")).toContainText("12.00 / 20", { timeout: 10000 });
    }
    const server = (await rows(request)).filter((r) => r.collection === "grades");
    expect(server.map((r) => r.data.name).sort()).toEqual(["Créée hors-ligne", "Projet web (rendu final)"]);
    const offlineNoise = /__test\/api|ERR_INTERNET_DISCONNECTED|Internet connection|offline|Load failed|network connection|WebKit encountered an internal error/i;
    expect([...A.problems.filter((p) => !offlineNoise.test(p)), ...B.problems]).toEqual([]);
    await A.context.close();
    await B.context.close();
});

test("migration depuis deux appareils ayant chacun des données locales → zéro doublon", async ({ browser, request }) => {
    const g1 = { id: "1696000000001", name: "DS1", subjectCode: "R1.01", score: 15, max: 20, coeff: 1 };
    const g2 = { id: "1696000000002", name: "TP", subjectCode: "R1.02", score: 7, max: 10, coeff: 2 };
    const g1Typed = { ...g1, id: "1696000099999", name: "ds1" }; // même note, saisie à la main sur l'autre appareil
    const g3 = { id: "1696000000003", name: "Oral", subjectCode: "R1.10", score: 16, max: 20, coeff: 1 };
    const samples = [
        { id: "1", name: "Contrôle TP1", subjectCode: "R1.01", score: 15, max: 20, coeff: 1 },
        { id: "2", name: "Projet HTML/CSS", subjectCode: "R1.02", score: 14, max: 20, coeff: 2 },
        { id: "3", name: "Evaluation SAE", subjectCode: "SAE 1.01", score: 16, max: 20, coeff: 1 }
    ];
    const A = await device(browser, [...samples, g1, g2]);
    const B = await device(browser, [g1Typed, g3]);
    await openApp(A.page);
    await openApp(B.page);
    // Sauvegarde automatique proposée au premier lancement
    await expect(A.page.locator("[data-migration-banner]")).toContainText("Vos 2 note(s) de l'ancienne version ont été reprises");
    const download = A.page.waitForEvent("download");
    await A.page.locator("[data-migration-banner]").getByRole("button", { name: "Télécharger la sauvegarde" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^sauvegarde_notes_avant_v2_\d{4}-\d{2}-\d{2}\.json$/);
    await signIn(A.page);
    await signIn(B.page);
    await A.page.goto("#/notes");
    await B.page.goto("#/notes");
    for (const P of [A.page, B.page]) await expect(P.locator("#total-evals-count")).toHaveText("3 évaluation(s) saisie(s)", { timeout: 15000 });
    const server = (await rows(request)).filter((r) => r.collection === "grades" && !r.deleted_at);
    expect(server).toHaveLength(3);
    expect(server.map((r) => r.data.name.toLowerCase()).sort()).toEqual(["ds1", "oral", "tp"]);
    expect([...A.problems, ...B.problems]).toEqual([]);
    await A.context.close();
    await B.context.close();
});

test("session expirée : indicateur, données et file conservées, envoi après reconnexion", async ({ browser, request }) => {
    const A = await device(browser);
    await openApp(A.page);
    await signIn(A.page);
    await request.post(`${TEST_ORIGIN}/__test/control/expire-tokens`);
    await addGrade(A.page, "Pendant expiration", "11");
    await expect(A.page.locator("[data-sync-state=expired]:visible").first()).toBeVisible({ timeout: 15000 });
    await A.page.goto("#/reglages");
    await expect(A.page.getByText("Votre session a expiré.")).toBeVisible();
    await A.page.locator("#auth-password").fill("motdepasse");
    await A.page.getByRole("button", { name: "Se connecter" }).click();
    await expect(A.page.locator("[data-sync-state=synced]:visible").first()).toBeVisible({ timeout: 15000 });
    expect((await rows(request)).map((r) => r.data.name)).toContain("Pendant expiration");
    expect(A.problems.filter((p) => !/HTTP 401|status of 401/.test(p))).toEqual([]);
    await A.context.close();
});

test("temps réel coupé (iOS en arrière-plan) → rattrapage au retour au premier plan", async ({ browser }) => {
    const A = await device(browser);
    const B = await device(browser);
    await openApp(A.page);
    await openApp(B.page);
    await signIn(A.page);
    await signIn(B.page);
    // B ne reçoit plus le temps réel (connexion coupée par le système)
    await B.page.route("**/__test/api/stream**", (route) => route.abort());
    await B.page.reload();
    await addGrade(A.page, "Pendant l'arrière-plan", "9", "R1.04");
    await B.page.goto("#/notes");
    await B.page.waitForTimeout(1500);
    await expect(subjectSummary(B.page, "R1.04")).toContainText("Sans note");
    // Retour au premier plan
    await B.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(subjectSummary(B.page, "R1.04")).toContainText("9.00 / 20", { timeout: 10000 });
    expect(A.problems).toEqual([]);
    await A.context.close();
    await B.context.close();
});
