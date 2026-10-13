/**
 * Service worker — cache versionné de l'application (fonctionnement hors-ligne).
 *
 * MISE À JOUR : incrémenter VERSION à chaque publication (même valeur que js/version.js,
 * vérifié par un test). Le navigateur détecte alors le changement de ce fichier, pré-cache
 * la nouvelle version en contournant le cache HTTP de GitHub Pages (cache: "reload"),
 * l'active immédiatement et l'application propose de recharger.
 *
 * Stratégies :
 *  - fichiers de l'application : cache d'abord (affichage instantané, hors-ligne) ;
 *  - config.js : réseau d'abord (une modification de configuration arrive sans changer VERSION) ;
 *  - Supabase et tout autre domaine : jamais interceptés (données gérées par l'application).
 */
const VERSION = "2.0.0";
const CACHE_PREFIX = "gdn-static-";
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
// Anciens caches de la version d'origine (même origine, à supprimer) — jamais ceux des autres sites
const LEGACY_CACHE_PREFIXES = ["but1-notes-s1-"];

const PRECACHE = [
    "./",
    "./index.html",
    "./config.js",
    "./style.css",
    "./manifest.json",
    "./icon.svg",
    "./icons/apple-touch-icon.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png",
    "./assets/css/tailwind.css",
    "./assets/fonts/inter-latin-wght-normal.woff2",
    "./assets/vendor/fontawesome/css/all.min.css",
    "./assets/vendor/fontawesome/webfonts/fa-solid-900.woff2",
    "./assets/vendor/fontawesome/webfonts/fa-regular-400.woff2",
    "./assets/vendor/supabase/supabase.js",
    "./js/main.js",
    "./js/version.js",
    "./js/core/dates.js",
    "./js/core/edt-url.js",
    "./js/core/escape.js",
    "./js/core/grades-calc.js",
    "./js/core/homework.js",
    "./js/core/numbers.js",
    "./js/core/program.js",
    "./js/core/timetable.js",
    "./js/core/uuid.js",
    "./js/core/validation.js",
    "./js/data/backup.js",
    "./js/data/local-store.js",
    "./js/data/merge.js",
    "./js/data/migration.js",
    "./js/data/repository.js",
    "./js/data/sync-controller.js",
    "./js/data/sync-engine.js",
    "./js/data/sync-errors.js",
    "./js/data/timetable-store.js",
    "./js/data/backends/supabase-backend.js",
    "./js/ui/app.js",
    "./js/ui/components.js",
    "./js/ui/course-detail.js",
    "./js/ui/dom.js",
    "./js/ui/modal.js",
    "./js/ui/popover.js",
    "./js/ui/router.js",
    "./js/ui/sync-indicator.js",
    "./js/ui/toast.js",
    "./js/ui/pages/home.js",
    "./js/ui/pages/homework.js",
    "./js/ui/pages/notes.js",
    "./js/ui/pages/settings.js",
    "./js/ui/pages/timetable.js"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((names) =>
                Promise.all(
                    names
                        .filter((name) => (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) || LEGACY_CACHE_PREFIXES.some((p) => name.startsWith(p)))
                        .map((name) => caches.delete(name))
                )
            )
            .then(() => self.clients.claim())
    );
});

function isConfig(url) {
    return url.pathname.endsWith("/config.js");
}

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // Supabase, etc. : non intercepté

    if (isConfig(url)) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put("./config.js", copy));
                    }
                    return response;
                })
                .catch(() => caches.match("./config.js", { ignoreSearch: true }))
        );
        return;
    }

    if (request.mode === "navigate") {
        // Page de l'application (avec ou sans #/route) : version en cache, sinon réseau
        event.respondWith(caches.match("./index.html").then((cached) => cached || fetch(request)));
        return;
    }

    event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)));
});
