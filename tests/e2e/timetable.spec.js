/**
 * Emploi du temps (source simulée : vraie fonction edt-proxy + export ADE réel anonymisé).
 * Horloge fixée au mardi 13/10/2026 à 09:00 : Intro. systèmes (08:30–10:00) est en cours,
 * Maths discrètes (10:15) est le prochain cours.
 */
import { test, expect, openApp, signIn, setAdeUrl, isMobile, tapOrClick, shot, expectNoHorizontalOverflow, TEST_ORIGIN, rows } from "./helpers.js";

async function setup(page) {
    await openApp(page);
    await signIn(page);
    await setAdeUrl(page);
    await page.goto("#/edt");
    await expect(page.locator(".edt-event").first()).toBeVisible();
}

test("vue par défaut (jour sur iPhone, semaine sur desktop), cours en cours et prochain cours, détail au tap", async ({ page, problems }) => {
    await setup(page);
    if (isMobile()) await expect(page.locator("[data-edt-label]")).toHaveText("Mardi 13 octobre 2026");
    else await expect(page.locator("[data-edt-label]")).toHaveText("Semaine du 12/10 au 18/10");
    const current = page.locator('[data-day="2026-10-13"] .edt-event', { hasText: "Intro. systèmes" }).filter({ has: page.locator("text=en cours") });
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("aria-label", /08:30 à 10:00, salle Salle 006, en cours/);
    await expect(page.locator('[data-day="2026-10-13"] .edt-event[aria-label*="Maths discrètes, 10:15"]')).toHaveAttribute("aria-label", /prochain cours/);
    await expect(page.locator(".edt-now")).toHaveCount(1);
    await expect(page.locator("[data-edt-updated]")).toContainText("Dernière mise à jour");
    await shot(page, "edt-defaut");
    await tapOrClick(page.locator('[data-day="2026-10-13"] .edt-event[aria-label*="Maths discrètes, 10:15"]'));
    const dialog = page.getByRole("dialog", { name: "Détail de la séance" });
    await expect(dialog).toContainText("Maths discrètes");
    await expect(dialog).toContainText("10:15 – 12:15");
    await expect(dialog).toContainText("Salle 006");
    await expect(dialog).toContainText("R1.06 — Mathématiques discrètes");
    await expect(dialog).toContainText("Sète");
    await page.keyboard.press("Escape");
    await expectNoHorizontalOverflow(page);
    expect(problems).toEqual([]);
});

test("navigation précédent / suivant / aujourd'hui, jour ↔ semaine, semaine de vacances", async ({ page, problems }) => {
    await setup(page);
    await tapOrClick(page.locator('[data-view="day"]'));
    await expect(page.locator("[data-edt-label]")).toHaveText("Mardi 13 octobre 2026");
    await tapOrClick(page.locator("[data-action=next]"));
    await expect(page.locator("[data-edt-label]")).toHaveText("Mercredi 14 octobre 2026");
    await expect(page.locator(".edt-event", { hasText: "Initiation au dev." })).toHaveCount(1);
    await tapOrClick(page.locator("[data-action=today]"));
    await expect(page.locator("[data-edt-label]")).toHaveText("Mardi 13 octobre 2026");
    await tapOrClick(page.locator('[data-view="week"]'));
    await expect(page.locator("[data-edt-label]")).toHaveText("Semaine du 12/10 au 18/10");
    await tapOrClick(page.locator("[data-action=next]"));
    await tapOrClick(page.locator("[data-action=next]"));
    await expect(page.locator("[data-edt-label]")).toHaveText("Semaine du 26/10 au 01/11");
    await expect(page.locator("[data-edt-empty]")).toHaveText("Aucun cours cette semaine (vacances ?).");
    await tapOrClick(page.locator("[data-action=next]"));
    // Après le passage à l'heure d'hiver : le lundi 02/11 commence à 08:00
    await expect(page.locator('.edt-event[aria-label*="Gestion proj. orga., 08:00"]')).toHaveCount(1);
    expect(problems).toEqual([]);
});

test("zoom − / + / réinitialiser : grille et texte agrandis, valeur mémorisée", async ({ page, problems }) => {
    await setup(page);
    const scroll = page.locator("[data-edt-scroll]");
    const hour = async () => scroll.evaluate((el) => el.style.getPropertyValue("--edt-hour"));
    const eventBox = async () => (await page.locator('[data-day="2026-10-13"] .edt-event[aria-label*="Maths discrètes, 10:15"]').boundingBox()).height;
    const font = async () => page.locator('[data-day="2026-10-13"] .edt-event[aria-label*="Maths discrètes, 10:15"]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await hour()).toBe("56px");
    const h0 = await eventBox();
    const f0 = await font();
    await tapOrClick(page.getByRole("button", { name: "Agrandir" }));
    await tapOrClick(page.getByRole("button", { name: "Agrandir" }));
    await expect(page.locator("[data-zoom-value]")).toHaveText("130 %");
    expect(await hour()).toBe("73px");
    expect(await eventBox()).toBeGreaterThan(h0 * 1.25);
    expect(await font()).toBeGreaterThan(f0 * 1.25);
    await shot(page, "edt-zoom-130");
    await page.reload();
    await expect(page.locator("[data-zoom-value]")).toHaveText("130 %");
    await tapOrClick(page.getByRole("button", { name: "Réduire le zoom" }));
    await expect(page.locator("[data-zoom-value]")).toHaveText("115 %");
    await tapOrClick(page.getByRole("button", { name: "Réinitialiser le zoom" }));
    await expect(page.locator("[data-zoom-value]")).toHaveText("100 %");
    expect(await hour()).toBe("56px");
    for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "Agrandir" }).click({ force: true });
    await expect(page.locator("[data-zoom-value]")).toHaveText("200 %");
    await expect(page.getByRole("button", { name: "Agrandir" })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    expect(problems).toEqual([]);
});

test("source indisponible ou format changé : message clair, dernière version conservée", async ({ page, request, problems }) => {
    const expected = [];
    page.on("response", (r) => {
        if (r.url().includes("__test/edt") && r.status() >= 500) expected.push(r.status());
    });
    await setup(page);
    await request.post(`${TEST_ORIGIN}/__test/control/edt-mode`, { data: { mode: "down" } });
    await tapOrClick(page.locator("[data-action=refresh]").first());
    await expect(page.locator("[data-edt-status]").getByRole("alert")).toContainText("La source ADE est injoignable.");
    await expect(page.locator("[data-edt-status]").getByRole("alert")).toContainText("Affichage de la dernière version enregistrée.");
    await expect(page.locator(".edt-event").first()).toBeVisible();
    await request.post(`${TEST_ORIGIN}/__test/control/edt-mode`, { data: { mode: "html" } });
    await tapOrClick(page.locator("[data-action=refresh]").first());
    await expect(page.locator("[data-edt-status]").getByRole("alert")).toContainText("le lien a peut-être expiré ou le format a changé");
    await shot(page, "edt-erreur-source");
    await request.post(`${TEST_ORIGIN}/__test/control/edt-mode`, { data: { mode: "ok" } });
    await tapOrClick(page.getByRole("button", { name: "Réessayer" }));
    await expect(page.locator("[data-edt-status]").getByRole("alert")).toHaveCount(0);
    expect(expected).toEqual([502, 502]);
    // Seules les deux réponses 502 provoquées volontairement (source « en panne ») sont tolérées
    expect(problems.filter((p) => !/HTTP 502 : .*__test\/edt/.test(p) && !/status of 502/.test(p))).toEqual([]);
});

test("hors-ligne : emploi du temps consultable depuis le cache, note mise en attente puis envoyée", async ({ page, context, request, problems }) => {
    await setup(page);
    await expect(page.locator("[data-sync-state=synced]:visible").first()).toBeVisible({ timeout: 15000 });
    await context.setOffline(true);
    // Une note saisie hors-ligne est enregistrée sur l'appareil et mise en attente
    // (2 entrées : la note et la matière mémorisée pour la prochaine saisie)
    await page.goto("#/notes");
    await page.locator("#grade-name").fill("Note hors-ligne");
    await page.locator("#grade-score").fill("13,5");
    await page.locator("#add-grade-form").getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByText("Note ajoutée avec succès !")).toBeVisible();
    const pill = page.locator("[data-sync-state=offline]:visible").first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await expect(pill).toHaveAttribute("aria-label", /Hors-ligne · 2 en attente/);
    // L'emploi du temps reste consultable ; l'actualisation échoue proprement
    await page.goto("#/edt");
    await expect(page.locator(".edt-event").first()).toBeVisible();
    await page.locator("[data-action=refresh]").first().click();
    await expect(page.locator("[data-edt-status]").getByRole("alert")).toContainText("Hors-ligne : impossible de mettre à jour");
    await expect(page.locator("[data-edt-updated]")).toContainText("(hors-ligne)");
    await shot(page, "edt-hors-ligne");
    // Retour du réseau : la file d'attente part
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("[data-sync-state=synced]:visible").first()).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => (await rows(request)).filter((r) => r.data.name === "Note hors-ligne").length, { timeout: 10000 }).toBe(1);
    // Échecs réseau attendus pendant la coupure (requêtes de synchro et d'EDT ; libellé Chromium ou WebKit)
    expect(problems.filter((p) => !/__test\/(api|edt)|ERR_INTERNET_DISCONNECTED|Internet connection|offline|Load failed|network connection|WebKit encountered an internal error/i.test(p))).toEqual([]);
});

test("cas limites : chevauchements côte à côte, journée entière, annulé barré, contenu malveillant neutralisé", async ({ page, request, problems }) => {
    page.on("dialog", (d) => {
        problems.push(`boîte de dialogue inattendue : ${d.message()}`);
        d.dismiss();
    });
    await setup(page);
    await request.post(`${TEST_ORIGIN}/__test/control/edt-mode`, { data: { mode: "both" } });
    await tapOrClick(page.locator("[data-action=refresh]").first());
    await tapOrClick(page.locator('[data-view="week"]'));
    await expect(page.locator(".edt-event", { hasText: "Anglais TP groupe A" })).toBeVisible();
    const a = await page.locator(".edt-event", { hasText: "Anglais TP groupe A" }).boundingBox();
    const b = await page.locator(".edt-event", { hasText: "Anglais TP groupe B" }).boundingBox();
    expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1); // côte à côte, sans recouvrement
    await expect(page.locator(".edt-allday", { hasText: "Journée portes ouvertes" })).toBeVisible();
    await expect(page.locator(".edt-event", { hasText: "Intro. archi." }).locator(".edt-event-title")).toHaveClass(/line-through/);
    const evil = page.locator(".edt-event", { hasText: "Cours piégé" });
    await expect(evil).toContainText("<img src=x onerror=alert(1)>");
    await expect(page.locator("[data-edt-grid] img")).toHaveCount(0);
    await tapOrClick(page.locator(".edt-event", { hasText: "SAE - S1.05 - Recueil de besoins" }));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("ne tient absolument pas sur une seule ligne de la grille"); // intitulé complet
    await expect(dialog).toContainText("salle virtuelle numéro 42 avec un nom très long");
    await page.keyboard.press("Escape");
    await shot(page, "edt-cas-limites");
    expect(problems).toEqual([]);
});

test("sans lien ADE : invitation claire à le configurer", async ({ page, problems }) => {
    await openApp(page, "#/edt");
    await expect(page.getByText("Ajoutez le lien de votre emploi du temps ADE dans")).toBeVisible();
    await page.goto("#/reglages");
    await page.locator("#edt-url").fill("https://exemple.com/agenda.ics");
    await page.getByRole("button", { name: "Enregistrer et actualiser" }).click();
    await expect(page.getByText("Seuls les liens proseconsult.umontpellier.fr sont acceptés.")).toBeVisible();
    expect(problems).toEqual([]);
});
