/**
 * Version de production : site servi en statique comme sur GitHub Pages (même sous-chemin,
 * cache HTTP de 10 min, VRAI config.js vide = mode local), service worker actif.
 */
import { test, expect, openApp, expectNoHorizontalOverflow, shot } from "./helpers.js";

test.use({ serviceWorkers: "allow" });
const STATIC_ORIGIN = "http://127.0.0.1:4311";

async function waitForController(page) {
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15000 }).toBe(true);
}

const goHash = (page, hash) =>
    page.evaluate((h) => {
        location.hash = h;
    }, hash);

test("mode local (Supabase non configuré) : tout fonctionne sur l'appareil, sans erreur", async ({ page, problems }) => {
    await openApp(page);
    await expect(page.locator("[data-sync-state=local]:visible").first()).toBeVisible();
    await page.goto("#/notes");
    await page.locator("#grade-name").fill("DS local");
    await page.locator("#grade-score").fill("14,5");
    await page.locator("#add-grade-form").getByRole("button", { name: "Ajouter" }).click();
    await page.reload();
    await expect(page.locator('details[data-subject="R1.01"] summary')).toContainText("14.50 / 20");
    await page.goto("#/reglages");
    await expect(page.getByText("La synchronisation n'est pas encore configurée")).toBeVisible();
    await page.locator("#edt-url").fill(`https://proseconsult.umontpellier.fr/direct/?data=${"ab".repeat(40)},1`);
    await page.getByRole("button", { name: "Enregistrer et actualiser" }).click();
    await page.goto("#/edt");
    await expect(page.locator("[data-edt-status]").getByRole("alert")).toContainText("Synchronisation non configurée");
    for (const hash of ["#/", "#/notes", "#/edt", "#/devoirs", "#/reglages"]) {
        await page.goto(hash);
        await expectNoHorizontalOverflow(page);
    }
    expect(problems).toEqual([]);
});

test("PWA : l'application se charge hors-ligne après une première visite (toutes les pages)", async ({ page, context, problems }) => {
    await openApp(page);
    await waitForController(page);
    await page.goto("#/notes");
    await page.locator("#grade-name").fill("Avant coupure");
    await page.locator("#grade-score").fill("12");
    await page.locator("#add-grade-form").getByRole("button", { name: "Ajouter" }).click();
    expect(await page.evaluate(() => caches.keys())).toEqual(["gdn-static-2.0.0"]);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("html[data-ready=true]")).toHaveCount(1);
    for (const [hash, title] of [["#/", "Aujourd'hui"], ["#/notes", "Notes & moyennes"], ["#/edt", "Emploi du temps"], ["#/devoirs", "Devoirs & évaluations"], ["#/reglages", "Réglages"]]) {
        await goHash(page, hash);
        await expect(page.locator("#page-title")).toHaveText(title);
    }
    await goHash(page, "#/notes");
    await expect(page.locator('details[data-subject="R1.01"] summary')).toContainText("12.00 / 20");
    // Polices et icônes servies par le cache (pas de requête réseau échouée)
    const iconFont = await page.evaluate(() => document.fonts.check('900 16px "Font Awesome 6 Free"'));
    expect(iconFont).toBe(true);
    await shot(page, "production-hors-ligne");
    await context.setOffline(false);
    expect(problems).toEqual([]);
});

test("mise à jour du service worker : la nouvelle version remplace l'ancienne", async ({ page, request, problems }) => {
    await openApp(page);
    await waitForController(page);
    expect(await page.evaluate(() => caches.keys())).toEqual(["gdn-static-2.0.0"]);
    // Nouvelle publication : sw.js change (VERSION incrémentée)
    await request.get(`${STATIC_ORIGIN}/__test/control/sw-version?v=2.0.1-test`);
    try {
        await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
        await expect(page.getByText("Nouvelle version de l'application installée.")).toBeVisible({ timeout: 20000 });
        await expect.poll(() => page.evaluate(() => caches.keys()), { timeout: 15000 }).toEqual(["gdn-static-2.0.1-test"]);
        await page.getByRole("button", { name: "Recharger" }).click();
        await expect(page.locator("html[data-ready=true]")).toHaveCount(1);
        expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).toMatch(/sw\.js$/);
    } finally {
        await request.get(`${STATIC_ORIGIN}/__test/control/sw-version`);
    }
    expect(problems).toEqual([]);
});

test("migration de l'ancienne version : sauvegarde automatique et mêmes moyennes", async ({ page, problems }) => {
    await page.addInitScript(() => {
        if (!sessionStorage.getItem("seeded")) {
            localStorage.setItem(
                "BUT1_INFO_S1_GRADES",
                JSON.stringify([
                    { id: "1", name: "Contrôle TP1", subjectCode: "R1.01", score: 15, max: 20, coeff: 1 },
                    { id: "2", name: "Projet HTML/CSS", subjectCode: "R1.02", score: 14, max: 20, coeff: 2 },
                    { id: "3", name: "Evaluation SAE", subjectCode: "SAE 1.01", score: 16, max: 20, coeff: 1 },
                    { id: "1696000000001", name: "DS de maths", subjectCode: "R1.06", score: 13.5, max: 20, coeff: 2 }
                ])
            );
            sessionStorage.setItem("seeded", "1");
        }
    });
    await openApp(page);
    await expect(page.locator("[data-migration-banner]")).toContainText("Vos 1 note(s) de l'ancienne version ont été reprises");
    await page.goto("#/notes");
    await expect(page.locator('details[data-subject="R1.06"] summary')).toContainText("13.50 / 20");
    await expect(page.locator("#total-evals-count")).toHaveText("1 évaluation(s) saisie(s)");
    // La clé d'origine est conservée intacte (retour arrière possible)
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("BUT1_INFO_S1_GRADES")))).toHaveLength(4);
    await page.goto("#/reglages");
    await expect(page.getByText("Sauvegardes automatiques (avant migration)")).toBeVisible();
    expect(problems).toEqual([]);
});

function pngSize(buffer) {
    // Signature PNG puis bloc IHDR : largeur et hauteur sur 4 octets (gros-boutiste)
    expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("manifest valide et icônes servies aux bonnes dimensions", async ({ page, request, problems }) => {
    await openApp(page);
    const base = `${STATIC_ORIGIN}/gestionnaire_de_notes/`;
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    const res = await request.get(base + manifestHref);
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest).toMatchObject({ name: expect.any(String), short_name: "Notes BUT1", start_url: "./", scope: "./", display: "standalone", lang: "fr" });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    const purposes = manifest.icons.map((i) => i.purpose);
    expect(purposes).toContain("maskable");
    for (const icon of manifest.icons) {
        const r = await request.get(base + icon.src);
        expect(r.status(), icon.src).toBe(200);
        expect(r.headers()["content-type"]).toBe(icon.type);
        if (icon.type === "image/png") {
            const [w, h] = icon.sizes.split("x").map(Number);
            expect(pngSize(await r.body())).toEqual({ width: w, height: h });
        }
    }
    const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    const appleRes = await request.get(base + apple);
    expect(appleRes.headers()["content-type"]).toBe("image/png");
    expect(pngSize(await appleRes.body())).toEqual({ width: 180, height: 180 });
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", manifest.theme_color);
    expect(problems).toEqual([]);
});
