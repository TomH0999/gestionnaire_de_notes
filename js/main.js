/**
 * Point d'entrée : affichage immédiat depuis le cache local, puis démarrage de la
 * synchronisation (si configurée) et de l'emploi du temps.
 */
import { APP_VERSION } from "./version.js";
import { LocalStore, safeLocalStorage } from "./data/local-store.js";
import { SyncController } from "./data/sync-controller.js";
import { runLegacyMigration } from "./data/migration.js";
import { TimetableStore } from "./data/timetable-store.js";
import { SupabaseBackend, AUTH_STORAGE_KEY } from "./data/backends/supabase-backend.js";
import { createApp } from "./ui/app.js";
import { showToast } from "./ui/toast.js";

function readConfig() {
    const c = (typeof window !== "undefined" && window.GDN_CONFIG) || {};
    const text = (v) => (typeof v === "string" ? v.trim() : "");
    return {
        supabaseUrl: text(c.supabaseUrl),
        // Clé PUBLIQUE : « publishable » (sb_publishable_…) ou « anon » historique (ancien nom accepté)
        supabaseAnonKey: text(c.supabaseKey) || text(c.supabaseAnonKey),
        testBackend: c.testBackend && typeof c.testBackend.module === "string" ? c.testBackend : null
    };
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Chargement impossible : ${src}`));
        document.head.appendChild(s);
    });
}

async function createBackend(config, storage) {
    if (config.testBackend) {
        // Uniquement avec le config.js du serveur de test E2E (jamais en production)
        const mod = await import(new URL(config.testBackend.module, document.baseURI).href);
        return new mod.HttpTestBackend(config.testBackend);
    }
    if (config.supabaseUrl && config.supabaseAnonKey) {
        if (!window.supabase || typeof window.supabase.createClient !== "function") await loadScript("assets/vendor/supabase/supabase.js");
        const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY, storage },
            realtime: { params: { eventsPerSecond: 10 } }
        });
        return new SupabaseBackend(client, { url: config.supabaseUrl, anonKey: config.supabaseAnonKey, storage });
    }
    return null;
}

function boot() {
    const config = readConfig();
    const storage = safeLocalStorage();
    const store = new LocalStore(storage, {
        onError: (e) => {
            if (e.kind === "quota") showToast("Stockage de l'appareil plein : la dernière modification n'a pas pu être enregistrée localement.", "error", { duration: 7000 });
        }
    });
    const configured = !!(config.testBackend || (config.supabaseUrl && config.supabaseAnonKey));
    const controller = new SyncController({ store, backend: null, configured });

    // Migration des données de la version d'origine (idempotente, avant le premier affichage)
    try {
        const report = runLegacyMigration({ store, repo: controller.repo });
        if (report && report.error) showToast(report.error, "warning", { duration: 7000 });
    } catch (e) {
        console.error("Migration des anciennes données impossible", e);
    }

    const timetable = new TimetableStore({ store, fetcher: (req) => controller.fetchTimetable(req), scope: () => controller.repo.scope });
    controller.repo.subscribe((event) => {
        if (event.source === "scope") timetable.load();
    });
    const app = createApp({ store, controller, timetable, version: APP_VERSION });
    app.start();

    if (configured) {
        createBackend(config, storage)
            .then((backend) => controller.attachBackend(backend))
            .then(() => app.afterSync())
            .catch((e) => {
                console.error(e);
                showToast("Synchronisation indisponible pour le moment : vos données restent sur l'appareil.", "warning", { duration: 6000 });
            });
    }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
