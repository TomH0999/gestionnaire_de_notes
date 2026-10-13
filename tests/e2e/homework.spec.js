/** Calendrier des devoirs, SAÉ, tests et contrôles. */
import { test, expect, openApp, isMobile, tapOrClick, shot, expectNoHorizontalOverflow } from "./helpers.js";

async function addItem(page, { title, type, date, time = null, importance = null, anticipation = null, subject = null }) {
    await tapOrClick(page.locator("[data-action=add]").first());
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#hw-title")).toBeFocused(); // mise au point automatique terminée
    await dialog.locator("#hw-title").fill(title);
    if (type) await dialog.locator("#hw-type").selectOption(type);
    if (subject) await dialog.locator("#hw-subject").selectOption(subject);
    await dialog.locator("#hw-date").fill(date);
    if (time) await dialog.locator("#hw-time").fill(time);
    if (importance) await dialog.locator(`input[name=importance][value="${importance}"]`).check({ force: true });
    if (anticipation !== null) await dialog.locator("#hw-anticipation").selectOption(String(anticipation));
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(dialog).toHaveCount(0);
}

test("valeurs par défaut selon le type (SAÉ = haute + 2 semaines), modifiables", async ({ page, problems }) => {
    await openApp(page, "#/devoirs");
    await tapOrClick(page.locator("[data-action=add]").first());
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#hw-title")).toBeFocused();
    await expect(dialog.locator("input[name=importance][value='2']")).toBeChecked();
    await expect(dialog.locator("#hw-anticipation")).toHaveValue("2");
    await dialog.locator("#hw-type").selectOption("sae");
    await expect(dialog.locator("input[name=importance][value='3']")).toBeChecked();
    await expect(dialog.locator("#hw-anticipation")).toHaveValue("14");
    await dialog.locator("#hw-type").selectOption("controle");
    await expect(dialog.locator("input[name=importance][value='4']")).toBeChecked();
    await expect(dialog.locator("#hw-anticipation")).toHaveValue("7");
    await expect(dialog.locator("#hw-time")).toHaveValue("08:00");
    // Une valeur modifiée à la main n'est plus écrasée par le changement de type
    await dialog.locator("input[name=importance][value='1']").check({ force: true });
    await dialog.locator("#hw-type").selectOption("sae");
    await expect(dialog.locator("input[name=importance][value='1']")).toBeChecked();
    await dialog.locator("#hw-date").fill("2026-10-16");
    await expect(dialog.getByText(/Date de début conseillée déjà passée/)).toBeVisible();
    await page.keyboard.press("Escape");
    expect(problems).toEqual([]);
});

test("vue Mois : période d'anticipation et échéance aux couleurs de l'importance, clic sur un jour", async ({ page, problems }) => {
    await openApp(page, "#/devoirs");
    await addItem(page, { title: "Rendu SAE 1.05", type: "sae", date: "2026-10-30", subject: "SAE 1.05" });
    const dueCell = page.locator('.cal-cell[data-day="2026-10-30"]');
    if (isMobile()) await expect(dueCell.locator(".cal-due-dot.bg-amber-400")).toHaveCount(1);
    else {
        await expect(dueCell.locator(".cal-due")).toContainText("Rendu SAE 1.05");
        await expect(dueCell.locator(".cal-due")).toHaveClass(/amber/);
        await expect(dueCell.locator(".cal-due i")).toHaveClass(/fa-angle-up/);
    }
    // Période d'anticipation : 16/10 → 29/10 (14 jours avant)
    for (const day of ["2026-10-16", "2026-10-20", "2026-10-29"]) await expect(page.locator(`.cal-cell[data-day="${day}"] .cal-bar.bg-amber-400`)).toHaveCount(1);
    await expect(page.locator('.cal-cell[data-day="2026-10-15"] .cal-bar')).toHaveCount(0);
    await tapOrClick(page.locator('.cal-cell[data-day="2026-10-20"]'));
    const panel = page.locator("[data-day-panel]");
    await expect(panel).toContainText("Mardi 20 octobre 2026");
    await expect(panel).toContainText("Rendu SAE 1.05");
    await tapOrClick(page.locator('.cal-cell[data-day="2026-10-30"]'));
    await expect(panel.getByText("Rendu SAE 1.05")).toBeVisible();
    // Ajouter pour ce jour : date pré-remplie
    await tapOrClick(panel.getByRole("button", { name: "Ajouter ce jour" }));
    await expect(page.getByRole("dialog").locator("#hw-date")).toHaveValue("2026-10-30");
    await page.keyboard.press("Escape");
    await shot(page, "devoirs-mois");
    await expectNoHorizontalOverflow(page);
    expect(problems).toEqual([]);
});

test("vue Liste : tri par urgence, fait / à faire, modification, suppression et annulation", async ({ page, problems }) => {
    await openApp(page, "#/devoirs");
    await addItem(page, { title: "SAE lointaine", type: "sae", date: "2026-12-15" });
    await addItem(page, { title: "Devoir en retard", type: "devoir", date: "2026-10-12" });
    await addItem(page, { title: "Contrôle critique", type: "controle", date: "2026-10-20" });
    await addItem(page, { title: "Devoir faible demain", type: "devoir", date: "2026-10-14", importance: "1" });
    await tapOrClick(page.locator('[data-view="list"]'));
    const titles = page.locator("[data-hw-list] li p.text-sm");
    await expect(titles).toHaveText(["Devoir en retard", "Contrôle critique", "Devoir faible demain", "SAE lointaine"]);
    await expect(page.locator("[data-hw-list] li").first()).toContainText("En retard");
    await page.locator("#hw-sort").selectOption("due");
    await expect(titles).toHaveText(["Devoir en retard", "Devoir faible demain", "Contrôle critique", "SAE lointaine"]);
    // Fait en un tap
    const first = page.locator("[data-hw-list] li").filter({ hasText: "Devoir en retard" });
    // Clic simple : l'élément quitte aussitôt la liste « À faire » (check() vérifierait un état disparu)
    await tapOrClick(first.locator("input[type=checkbox]"));
    await expect(page.getByText("« Devoir en retard » : fait.")).toBeVisible();
    await expect(titles).toHaveCount(3);
    await page.locator("#hw-filter").selectOption("done");
    await expect(titles).toHaveText(["Devoir en retard"]);
    await page.locator("#hw-filter").selectOption("todo");
    // Modification : importance → Critique
    await tapOrClick(page.getByRole("button", { name: "Modifier SAE lointaine" }));
    await page.getByRole("dialog").locator("input[name=importance][value='4']").check({ force: true });
    await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("[data-hw-list] li").filter({ hasText: "SAE lointaine" })).toContainText("Critique");
    // Suppression avec confirmation puis annulation
    await tapOrClick(page.getByRole("button", { name: "Supprimer Contrôle critique" }));
    await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
    await expect(titles).toHaveCount(2);
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(titles).toHaveCount(3);
    await shot(page, "devoirs-liste");
    expect(problems).toEqual([]);
});

test("validation : titre vide et date invalide refusés, devoir sans matière accepté", async ({ page, problems }) => {
    await openApp(page, "#/devoirs");
    await tapOrClick(page.locator("[data-action=add]").first());
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#hw-title")).toBeFocused();
    await dialog.locator("#hw-date").fill("2026-10-20");
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(dialog.getByText("Indiquez un titre.")).toBeVisible();
    await dialog.locator("#hw-title").fill("Lire le chapitre 3");
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(dialog).toHaveCount(0);
    await tapOrClick(page.locator('[data-view="list"]'));
    await expect(page.locator("[data-hw-list]")).toContainText("Sans matière");
    expect(problems).toEqual([]);
});
