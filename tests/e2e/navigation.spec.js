/** Navigation : onglets (mobile) / barre latérale (desktop), URL par page, bouton retour, tailles tactiles. */
import { test, expect, openApp, isMobile, tapOrClick, expectNoHorizontalOverflow } from "./helpers.js";

const PAGES = [
    { id: "notes", title: "Notes & moyennes" },
    { id: "edt", title: "Emploi du temps" },
    { id: "devoirs", title: "Devoirs & évaluations" },
    { id: "reglages", title: "Réglages" },
    { id: "accueil", title: "Aujourd'hui", hash: "#/" }
];

test("une URL par page, navigation et bouton retour du navigateur", async ({ page, problems }) => {
    await openApp(page);
    const nav = isMobile() ? page.locator("#tabbar") : page.locator("#sidebar");
    await expect(nav).toBeVisible();
    await expect(isMobile() ? page.locator("#sidebar") : page.locator("#tabbar")).toBeHidden();
    for (const p of PAGES) {
        await tapOrClick(nav.locator(`a[data-nav="${p.id}"]`));
        await expect(page).toHaveURL(new RegExp(`${(p.hash || `#/${p.id}`).replace(/[#/]/g, "\\$&")}$`));
        await expect(page.locator("#page-title")).toHaveText(p.title);
        await expect(nav.locator(`a[data-nav="${p.id}"]`)).toHaveAttribute("aria-current", "page");
        await expect(page.locator(`[data-page="${p.id}"]`)).toBeVisible();
        await expectNoHorizontalOverflow(page);
    }
    await page.goBack();
    await expect(page.locator("#page-title")).toHaveText("Réglages");
    await page.goBack();
    await expect(page.locator("#page-title")).toHaveText("Devoirs & évaluations");
    await page.goForward();
    await expect(page.locator("#page-title")).toHaveText("Réglages");
    // Accès direct par URL (rechargement sur une page interne)
    await page.goto("#/edt");
    await page.reload();
    await expect(page.locator("#page-title")).toHaveText("Emploi du temps");
    expect(problems).toEqual([]);
});

test("zones tactiles d'au moins 44 px sur les éléments interactifs", async ({ page, problems }) => {
    await openApp(page);
    const violations = [];
    for (const hash of ["#/", "#/notes", "#/edt", "#/devoirs", "#/reglages"]) {
        await page.goto(hash);
        await page.waitForTimeout(200);
        const found = await page.evaluate(() => {
            const out = [];
            const els = document.querySelectorAll('main button, main a[href], main select, main input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not(.sr-only), main textarea, main summary, #tabbar a, header a');
            for (const el of els) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue; // masqué
                const style = getComputedStyle(el);
                if (style.visibility === "hidden") continue;
                // Liens dans une phrase : la hauteur de ligne fait foi (exception WCAG « inline »)
                if (el.tagName === "A" && style.display === "inline") continue;
                if (el.closest(".cal-cell") && el !== el.closest(".cal-cell")) continue;
                if (r.height < 43.5 && !(el.closest("label") && el.closest("label").getBoundingClientRect().height >= 43.5)) {
                    out.push(`${location.hash} ${el.tagName.toLowerCase()} « ${(el.getAttribute("aria-label") || el.textContent || el.id || "").trim().slice(0, 40)} » : ${Math.round(r.height)} px`);
                }
            }
            // Cases à cocher : la zone cliquable est leur <label>
            for (const box of document.querySelectorAll('main input[type="checkbox"]')) {
                const label = box.closest("label");
                const r = (label || box).getBoundingClientRect();
                if (r.width && r.height < 43.5) out.push(`${location.hash} case à cocher : ${Math.round(r.height)} px`);
            }
            return out;
        });
        violations.push(...found);
    }
    expect(violations).toEqual([]);
    expect(problems).toEqual([]);
});

test("encoche / safe-area : viewport-fit=cover, en-tête et barre d'onglets protégés", async ({ page }) => {
    await openApp(page);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
    await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute("content", /user-scalable=no|maximum-scale=1/);
    await expect(page.locator("header")).toHaveClass(/safe-top/);
    await expect(page.locator("#tabbar")).toHaveClass(/safe-bottom/);
    const rules = await page.evaluate(() => {
        const texts = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const r of sheet.cssRules) texts.push(r.cssText);
            } catch {
                /* feuille externe */
            }
        }
        return texts.join("\n");
    });
    expect(rules).toMatch(/\.safe-bottom\s*\{\s*padding-bottom:\s*env\(safe-area-inset-bottom\)/);
    expect(rules).toMatch(/\.safe-top\s*\{\s*padding-top:\s*env\(safe-area-inset-top\)/);
});
