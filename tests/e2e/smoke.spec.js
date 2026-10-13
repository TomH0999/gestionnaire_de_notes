import { test, expect, openApp, shot, expectNoHorizontalOverflow } from "./helpers.js";

test("chaque page s'affiche sans erreur (premier contrôle)", async ({ page, problems }) => {
    await openApp(page);
    for (const hash of ["#/", "#/notes", "#/edt", "#/devoirs", "#/reglages"]) {
        await page.goto(hash);
        await page.waitForTimeout(300);
        await expectNoHorizontalOverflow(page);
        await shot(page, `smoke-${hash.replace(/\W/g, "") || "accueil"}`);
    }
    expect(problems).toEqual([]);
});
