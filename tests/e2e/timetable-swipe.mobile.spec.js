/** Swipe horizontal sur la grille de l'emploi du temps (iPhone) et pinch-to-zoom autorisé. */
import { test, expect, openApp, signIn, setAdeUrl } from "./helpers.js";

/**
 * Simule un glissé d'un doigt. WebKit n'autorise pas `new Touch()` depuis une page : on émet
 * des événements touchstart/touchend portant les mêmes propriétés (touches, changedTouches)
 * que ceux du système, ce que lit le gestionnaire de l'application.
 */
async function swipe(page, selector, dx, dy = 0) {
    await page.evaluate(
        ([sel, deltaX, deltaY]) => {
            const el = document.querySelector(sel);
            const r = el.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + Math.min(200, r.height / 2);
            const fire = (type, touches, changed) => {
                const ev = new Event(type, { bubbles: true, cancelable: true });
                Object.defineProperty(ev, "touches", { value: touches });
                Object.defineProperty(ev, "changedTouches", { value: changed });
                el.dispatchEvent(ev);
            };
            const start = { identifier: 1, clientX: x, clientY: y };
            const end = { identifier: 1, clientX: x + deltaX, clientY: y + deltaY };
            fire("touchstart", [start], [start]);
            fire("touchend", [], [end]);
        },
        [selector, dx, dy]
    );
}

test("glisser vers la gauche = jour suivant, vers la droite = jour précédent", async ({ page, problems }) => {
    await openApp(page);
    await signIn(page);
    await setAdeUrl(page);
    await page.goto("#/edt");
    await expect(page.locator("[data-edt-label]")).toHaveText("Mardi 13 octobre 2026");
    await swipe(page, "[data-edt-scroll]", -140);
    await expect(page.locator("[data-edt-label]")).toHaveText("Mercredi 14 octobre 2026");
    await swipe(page, "[data-edt-scroll]", 140);
    await swipe(page, "[data-edt-scroll]", 140);
    await expect(page.locator("[data-edt-label]")).toHaveText("Lundi 12 octobre 2026");
    // Trop court, ou surtout vertical (défilement de la grille) : pas de changement de jour
    await swipe(page, "[data-edt-scroll]", 30);
    await swipe(page, "[data-edt-scroll]", 90, 160);
    await expect(page.locator("[data-edt-label]")).toHaveText("Lundi 12 octobre 2026");
    // Pinch-to-zoom du navigateur non bloqué
    const touchAction = await page.locator("[data-edt-scroll]").evaluate((el) => getComputedStyle(el).touchAction);
    expect(touchAction).toMatch(/pinch-zoom|auto|manipulation/);
    await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute("content", /user-scalable=no/);
    expect(problems).toEqual([]);
});
