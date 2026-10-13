/**
 * Aides communes aux tests E2E : horloge fixe (mardi 13/10/2026 09:00, Paris), surveillance
 * des erreurs console et des requêtes en échec, connexion, réglage du lien ADE, captures.
 */
import { test as base, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const NOW = new Date("2026-10-13T09:00:00+02:00");
export const ADE_URL = `https://proseconsult.umontpellier.fr/direct/?data=${"0a1b2c3d4e5f6789".repeat(6)},1`;
export const TEST_ORIGIN = "http://127.0.0.1:4310";
const SHOTS = path.resolve("test-results", "screenshots");

/** Erreurs console et requêtes échouées collectées pour chaque page ; vérifiées à la fin du test. */
export function watchPage(page, { allowConsole = [], allowFailed = [] } = {}) {
    const problems = [];
    page.on("console", (msg) => {
        if (msg.type() !== "error" && msg.type() !== "warning") return;
        const text = msg.text();
        if (allowConsole.some((re) => re.test(text))) return;
        // Message émis par Playwright lui-même quand l'option serviceWorkers: "block" est active
        if (text === "Service Worker registration blocked by Playwright") return;
        problems.push(`console.${msg.type()}: ${text}`);
    });
    page.on("pageerror", (err) => problems.push(`exception: ${err.message}`));
    page.on("requestfailed", (req) => {
        const url = req.url();
        const reason = req.failure() ? req.failure().errorText : "";
        if (allowFailed.some((re) => re.test(url) || re.test(reason))) return;
        // Fermeture volontaire du flux temps réel (navigation, déconnexion)
        if (/__test\/api\/stream/.test(url) && /ABORTED|cancelled|NS_BINDING_ABORTED|annul/i.test(reason)) return;
        problems.push(`requête en échec : ${url} (${reason})`);
    });
    page.on("response", (res) => {
        if (res.status() >= 400 && !allowFailed.some((re) => re.test(res.url()))) problems.push(`HTTP ${res.status()} : ${res.url()}`);
    });
    return problems;
}

export const test = base.extend({
    problems: async ({ page }, use) => {
        const list = watchPage(page, { allowConsole: [], allowFailed: [] });
        await use(list);
    },
    resetServer: [
        async ({ request }, use) => {
            await request.post(`${TEST_ORIGIN}/__test/control/reset`);
            await request.post(`${TEST_ORIGIN}/__test/control/edt-mode`, { data: { mode: "ok" } });
            await use(null);
        },
        { auto: true }
    ]
});

export { expect };

export async function openApp(page, hash = "#/", { time = NOW, fixedTime = true } = {}) {
    if (time && fixedTime) await page.clock.setFixedTime(time);
    await page.goto(hash);
    await expect(page.locator("html[data-ready=true]")).toHaveCount(1);
}

export async function signIn(page, email = "tom@example.com", password = "motdepasse") {
    await page.goto("#/reglages");
    await page.locator("#auth-email").fill(email);
    await page.locator("#auth-password").fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText(`Connecté en tant que ${email}`)).toBeVisible();
    await expect(page.locator("[data-sync-state=synced]:visible").first()).toBeVisible({ timeout: 15000 });
}

export async function setAdeUrl(page, url = ADE_URL) {
    await page.goto("#/reglages");
    await page.locator("#edt-url").fill(url);
    await page.getByRole("button", { name: "Enregistrer et actualiser" }).click();
    await expect(page.getByText(/Dernière mise à jour/)).toBeVisible({ timeout: 15000 });
}

export async function shot(page, name) {
    mkdirSync(SHOTS, { recursive: true });
    const project = test.info().project.name;
    await page.screenshot({ path: path.join(SHOTS, `${project}--${name}.png`), fullPage: true });
}

export function isMobile() {
    return test.info().project.name.startsWith("iphone");
}

/** Aucun défilement horizontal de la page (débordement). */
export async function expectNoHorizontalOverflow(page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "débordement horizontal de la page").toBeLessThanOrEqual(1);
}

/** Tap tactile sur iPhone, clic ailleurs. */
export async function tapOrClick(locator) {
    if (isMobile()) await locator.tap();
    else await locator.click();
}

export async function rows(request, email = "tom@example.com") {
    const res = await request.post(`${TEST_ORIGIN}/__test/control/rows`, { data: { email } });
    return (await res.json()).rows;
}
