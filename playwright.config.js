import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout.
 *  - desktop-chromium : Chrome desktop 1280×800 ;
 *  - iphone-webkit    : WebKit (moteur de Safari) avec le profil iPhone 13 (tactile, 390×844) ;
 *  - production       : site servi en statique comme GitHub Pages (vrai config.js, mode local).
 * Le serveur de test émule Supabase et exécute la vraie fonction edt-proxy sur une fixture :
 * aucun appel réseau réel. Les tests partagent l'état du serveur : exécution en série.
 */
const TEST_PORT = 4310;
const STATIC_PORT = 4311;

export default defineConfig({
    testDir: "tests/e2e",
    outputDir: "test-results/e2e",
    timeout: 60000,
    expect: { timeout: 8000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
    use: {
        baseURL: `http://127.0.0.1:${TEST_PORT}/gestionnaire_de_notes/`,
        locale: "fr-FR",
        timezoneId: "Europe/Paris",
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure"
    },
    projects: [
        {
            name: "desktop-chromium",
            // *.mobile.spec.js : scénarios tactiles propres à l'iPhone
            testIgnore: /production\.spec\.js|\.mobile\.spec\.js/,
            use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }
        },
        {
            name: "iphone-webkit",
            // *.desktop.spec.js : clavier, survol, supabase-js réel (réseau simulé par Chromium)
            testIgnore: /production\.spec\.js|\.desktop\.spec\.js/,
            use: { ...devices["iPhone 13"] }
        },
        {
            name: "production",
            testMatch: /production\.spec\.js/,
            use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${STATIC_PORT}/gestionnaire_de_notes/` }
        },
        {
            name: "production-iphone",
            testMatch: /production\.spec\.js/,
            use: { ...devices["iPhone 13"], baseURL: `http://127.0.0.1:${STATIC_PORT}/gestionnaire_de_notes/` }
        }
    ],
    webServer: [
        {
            command: `node tests/mock-server/server.mjs --port ${TEST_PORT}`,
            url: `http://127.0.0.1:${TEST_PORT}/gestionnaire_de_notes/`,
            reuseExistingServer: false,
            stdout: "ignore"
        },
        {
            command: `node tests/mock-server/server.mjs --static --port ${STATIC_PORT}`,
            url: `http://127.0.0.1:${STATIC_PORT}/gestionnaire_de_notes/`,
            reuseExistingServer: false,
            stdout: "ignore"
        }
    ]
});
