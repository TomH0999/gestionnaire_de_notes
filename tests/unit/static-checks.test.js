/**
 * Vérifications statiques du site publié : service worker (logique exécutée dans un
 * environnement simulé), versions, manifest, CSP, absence de secrets, Tailwind à jour.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const swSource = read("sw.js");
const indexHtml = read("index.html");

function precacheList() {
    const ctx = { self: { addEventListener() {}, location: { origin: "https://x" } }, caches: {}, URL, Request: class {}, fetch() {} };
    return vm.runInNewContext(`${swSource}\n;PRECACHE`, ctx);
}

/** Fichiers chargés par le site : index.html, graphe des imports ES depuis js/main.js, url() CSS, manifest. */
function referencedFiles() {
    const files = new Set(["index.html", "manifest.json"]);
    for (const m of indexHtml.matchAll(/(?:href|src)="([^"#:]+)"/g)) files.add(m[1].replace(/^\.\//, ""));
    const queue = ["js/main.js"];
    while (queue.length) {
        const file = queue.pop();
        if (files.has(file) && file !== "js/main.js") continue;
        files.add(file);
        const src = read(file);
        for (const m of src.matchAll(/(?:import|export)[^"']*?from\s*["'](\.[^"']+)["']/g)) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
            if (!files.has(target)) queue.push(target);
        }
    }
    files.add("assets/vendor/supabase/supabase.js"); // chargé dynamiquement par js/main.js
    for (const css of ["style.css", "assets/vendor/fontawesome/css/all.min.css"]) {
        for (const m of read(css).matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
            if (m[1].startsWith("data:")) continue;
            files.add(path.posix.normalize(path.posix.join(path.posix.dirname(css), m[1])));
        }
    }
    for (const icon of JSON.parse(read("manifest.json")).icons) files.add(icon.src);
    return files;
}

describe("Service worker", () => {
    it("la version du cache est celle de l'application (js/version.js)", () => {
        const swVersion = /const VERSION = "([^"]+)"/.exec(swSource)[1];
        const appVersion = /APP_VERSION = "([^"]+)"/.exec(read("js/version.js"))[1];
        expect(swVersion).toBe(appVersion);
        expect(JSON.parse(read("package.json")).version).toBe(appVersion);
    });

    it("pré-cache complet : chaque fichier chargé par le site est pré-caché, et chaque entrée existe", () => {
        const precached = new Set(precacheList().map((u) => u.replace(/^\.\//, "")).filter(Boolean));
        const missing = [...referencedFiles()].filter((f) => !precached.has(f));
        expect(missing).toEqual([]);
        for (const f of precached) expect(existsSync(path.join(root, f)), f).toBe(true);
    });

    it("cycle de vie simulé : pré-cache sans cache HTTP, suppression des seuls anciens caches de l'application", async () => {
        const listeners = {};
        const added = [];
        const deleted = [];
        let skipWaiting = false;
        let claimed = false;
        const ctx = {
            URL,
            Request: class {
                constructor(url, init) {
                    this.url = url;
                    this.cache = init && init.cache;
                }
            },
            self: {
                location: { origin: "https://tomh0999.github.io" },
                addEventListener: (type, fn) => (listeners[type] = fn),
                skipWaiting: () => (skipWaiting = true),
                clients: { claim: () => (claimed = true) }
            },
            caches: {
                open: async () => ({ addAll: async (reqs) => added.push(...reqs), put: async () => {} }),
                keys: async () => ["gdn-static-1.9.0", "but1-notes-s1-v3", "gdn-static-2.0.0", "autre-projet-github-pages", "workbox-precache-v2"],
                delete: async (name) => deleted.push(name),
                match: async () => null
            },
            fetch: async () => ({ ok: true })
        };
        vm.runInNewContext(swSource, ctx);
        let installPromise;
        listeners.install({ waitUntil: (p) => (installPromise = p) });
        await installPromise;
        expect(added.length).toBe(precacheList().length);
        expect(added.every((r) => r.cache === "reload")).toBe(true); // contourne le cache HTTP de GitHub Pages
        expect(skipWaiting).toBe(true);
        let activatePromise;
        listeners.activate({ waitUntil: (p) => (activatePromise = p) });
        await activatePromise;
        expect(deleted.sort()).toEqual(["but1-notes-s1-v3", "gdn-static-1.9.0"]); // jamais les caches des autres sites du même domaine
        expect(claimed).toBe(true);
    });

    it("requêtes : autres domaines (Supabase) non interceptées, config.js réseau d'abord, navigation servie depuis le cache", async () => {
        const listeners = {};
        const fetched = [];
        const matched = [];
        const ctx = {
            URL,
            Request: class {},
            self: { location: { origin: "https://tomh0999.github.io" }, addEventListener: (t, fn) => (listeners[t] = fn) },
            caches: { open: async () => ({ put: async () => {} }), match: async (key) => (matched.push(String(key.url || key)), { cached: key }) },
            fetch: async (req) => (fetched.push(req.url), { ok: true, clone() { return this; } })
        };
        vm.runInNewContext(swSource, ctx);
        const run = async (url, mode = "cors", method = "GET") => {
            let responded = null;
            listeners.fetch({ request: { url, mode, method }, respondWith: (p) => (responded = p) });
            return responded ? await responded : "non intercepté";
        };
        expect(await run("https://demo.supabase.co/rest/v1/items")).toBe("non intercepté");
        expect(await run("https://tomh0999.github.io/gestionnaire_de_notes/sw-data", "cors", "POST")).toBe("non intercepté");
        await run("https://tomh0999.github.io/gestionnaire_de_notes/config.js");
        expect(fetched).toEqual(["https://tomh0999.github.io/gestionnaire_de_notes/config.js"]);
        await run("https://tomh0999.github.io/gestionnaire_de_notes/#/notes", "navigate");
        expect(matched).toContain("./index.html");
    });
});

describe("Manifest, page et sécurité", () => {
    it("manifest complet et icônes présentes", () => {
        const m = JSON.parse(read("manifest.json"));
        expect(m).toMatchObject({ short_name: "Notes BUT1", start_url: "./", scope: "./", display: "standalone", lang: "fr" });
        expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
        for (const i of m.icons) expect(existsSync(path.join(root, i.src)), i.src).toBe(true);
        expect(indexHtml).toMatch(/<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
    });

    it("CSP stricte pour les scripts, aucun script ni gestionnaire d'événement en ligne", () => {
        const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(indexHtml)[1];
        expect(csp).toMatch(/script-src 'self';/);
        expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
        expect(csp).toMatch(/connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co/);
        expect(csp).toMatch(/object-src 'none'/);
        expect(indexHtml).not.toMatch(/<script>(?!\s*<\/script>)/);
        const sources = [indexHtml, ...listFiles("js").map((f) => readFileSync(f, "utf8"))];
        for (const src of sources) expect(src).not.toMatch(/\son(click|change|submit|load|error|input)=/i);
    });

    it("aucune ressource externe (CDN) : tout est servi par le site", () => {
        expect(indexHtml).not.toMatch(/(src|href)="https?:\/\//);
        expect(read("style.css")).not.toMatch(/url\(['"]?https?:/);
    });

    it("aucun secret dans le dépôt : pas de clé service_role, pas de jeton ADE, pas de .env", () => {
        const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
        expect(tracked.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example"))).toEqual([]);
        const offenders = [];
        for (const file of tracked) {
            if (/\.(png|woff2|ico)$/.test(file) || file.startsWith("assets/vendor/") || file === "package-lock.json") continue;
            const full = path.join(root, file);
            if (!existsSync(full)) continue;
            const text = readFileSync(full, "utf8");
            if (/data=[0-9a-f]{200,}/i.test(text)) offenders.push(`${file} : jeton ADE (data=…) en dur`);
            if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) offenders.push(`${file} : clé secrète Supabase`);
            for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]+/g)) {
                try {
                    const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
                    if (payload.role === "service_role") offenders.push(`${file} : clé service_role`);
                } catch {
                    /* pas un JWT */
                }
            }
        }
        expect(offenders).toEqual([]);
        const gitignore = read(".gitignore");
        expect(gitignore).toMatch(/^\.env$/m);
    });
});

function listFiles(dir) {
    const out = [];
    for (const f of readdirSync(path.join(root, dir))) {
        const p = path.join(root, dir, f);
        if (statSync(p).isDirectory()) out.push(...listFiles(path.join(dir, f)));
        else if (f.endsWith(".js")) out.push(p);
    }
    return out;
}

describe("Feuille Tailwind compilée", () => {
    it("assets/css/tailwind.css est à jour avec le HTML et le JS (sinon : npm run build:css)", () => {
        const tmp = mkdtempSync(path.join(os.tmpdir(), "gdn-css-"));
        try {
            const out = path.join(tmp, "tailwind.css");
            const cli = path.join(root, "node_modules", "tailwindcss", "lib", "cli.js");
            execFileSync(process.execPath, [cli, "-c", "tailwind.config.cjs", "-i", "assets/css/tailwind.input.css", "-o", out, "--minify"], { cwd: root, stdio: "pipe" });
            const norm = (s) => s.replace(/\r\n/g, "\n").trim();
            expect(norm(readFileSync(out, "utf8")) === norm(read("assets/css/tailwind.css")), "feuille Tailwind obsolète : lancer npm run build:css").toBe(true);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    }, 60000);
});
