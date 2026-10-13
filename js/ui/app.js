/**
 * Coquille de l'application : navigation (barre d'onglets mobile / barre latérale desktop),
 * cycle de vie des pages, indicateur de synchronisation, déclencheurs de synchronisation
 * (premier plan, focus, reconnexion), bannières (migration, mise à jour), service worker.
 */
import { html, raw } from "../core/escape.js";
import { formatDateTime } from "../core/dates.js";
import { ROUTES, createRouter } from "./router.js";
import { render, rafThrottle } from "./dom.js";
import { showToast } from "./toast.js";
import { syncPill } from "./sync-indicator.js";
import { openCourseDetail } from "./course-detail.js";
import { closePopover } from "./popover.js";
import { downloadJson } from "./pages/settings.js";
import { createHomePage } from "./pages/home.js";
import { createNotesPage } from "./pages/notes.js";
import { createTimetablePage } from "./pages/timetable.js";
import { createHomeworkPage } from "./pages/homework.js";
import { createSettingsPage } from "./pages/settings.js";

export function createApp({ store, controller, timetable, version }) {
    const device = {
        get: (key, fallback = null) => store.getJSON(`device:${key}`, fallback),
        set: (key, value) => store.setJSON(`device:${key}`, value)
    };
    let activeRoute = null;
    let registration = null;
    let updateToastShown = false;
    let lastFocusSync = 0;

    const ctx = {
        version,
        store,
        controller,
        timetable,
        device,
        repo: () => controller.repo,
        now: () => Date.now(),
        toast: showToast,
        syncState: () => controller.getState(),
        openCourseDetail,
        focusHomework(id) {
            router.navigate("devoirs");
            setTimeout(() => pages.devoirs.openEdit(id), 60);
        },
        refreshTimetable(range = null, { manual = false } = {}) {
            const url = controller.repo.getSetting("edtUrl", "");
            const p = timetable.refresh(range ? { url, ...range } : { url });
            if (manual) {
                p.then((ok) => {
                    if (ok) showToast("Emploi du temps à jour.");
                    else if (timetable.error) showToast(timetable.error.message, "error", { duration: 6000 });
                });
            }
            return p;
        },
        ensureTimetableFresh() {
            const url = controller.repo.getSetting("edtUrl", "");
            if (!url || timetable.status === "loading" || navigator.onLine === false) return;
            if (controller.getState().mode !== "signed-in") return;
            if (timetable.isStale()) ctx.refreshTimetable(null);
        },
        checkForUpdate,
        homeBanner
    };

    const pages = {
        accueil: createHomePage(ctx),
        notes: createNotesPage(ctx),
        edt: createTimetablePage(ctx),
        devoirs: createHomeworkPage(ctx),
        reglages: createSettingsPage(ctx)
    };
    const mounted = new Set();

    function homeBanner() {
        const m = store.getJSON("migration", {});
        if (!m.bannerPending) return html``;
        const backups = store.getJSON("backups", []);
        const b = backups.find((x) => x.kind === "legacy");
        return html`<div class="mt-4 bg-brand-500/10 border border-brand-500/30 rounded-xl p-3 text-sm text-slate-200 flex flex-wrap items-center gap-3" data-migration-banner role="status">
            <i class="fa-solid fa-box-archive text-brand-400" aria-hidden="true"></i>
            <span class="flex-1 min-w-[12rem]">Vos ${m.lastAdded || ""} note(s) de l'ancienne version ont été reprises. Une sauvegarde JSON a été créée automatiquement${b ? ` (${formatDateTime(Date.parse(b.createdAt))})` : ""}.</span>
            ${b ? html`<button type="button" data-action="download-migration-backup" class="px-3 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold"><i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i> Télécharger la sauvegarde</button>` : ""}
            <button type="button" data-action="dismiss-migration-banner" class="px-3 min-h-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold">Compris</button>
        </div>`;
    }

    function renderNav() {
        const navItem = (r, variant) => {
            const active = activeRoute && activeRoute.id === r.id;
            if (variant === "tab") {
                return html`<a href="${r.hash}" data-nav="${r.id}" ${raw(active ? 'aria-current="page"' : "")} class="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[10px] font-medium transition ${raw(active ? "text-brand-400" : "text-slate-400 hover:text-slate-200")}">
                    <i class="fa-solid ${raw(r.icon)} text-lg" aria-hidden="true"></i><span>${r.short || r.label}</span>
                </a>`;
            }
            return html`<a href="${r.hash}" data-nav="${r.id}" ${raw(active ? 'aria-current="page"' : "")} class="flex items-center gap-3 px-3 min-h-[44px] rounded-xl text-sm font-medium transition ${raw(active ? "bg-brand-600/15 text-white border border-brand-500/30" : "text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent")}">
                <i class="fa-solid ${raw(r.icon)} w-5 text-center ${raw(active ? "text-brand-400" : "")}" aria-hidden="true"></i><span>${r.label}</span>
            </a>`;
        };
        render(document.getElementById("tabbar-items"), html`${ROUTES.map((r) => navItem(r, "tab"))}`);
        render(document.getElementById("sidebar-nav"), html`${ROUTES.map((r) => navItem(r, "side"))}`);
    }

    function renderSyncPills() {
        const s = controller.getState();
        render(document.getElementById("header-sync"), syncPill(s, { compact: true }));
        render(document.getElementById("sidebar-sync"), syncPill(s));
    }

    const renderActive = rafThrottle(() => {
        if (activeRoute && mounted.has(activeRoute.id)) pages[activeRoute.id].render();
    });

    function show(route) {
        if (activeRoute && activeRoute.id === route.id && mounted.has(route.id)) return;
        closePopover();
        const previous = activeRoute;
        activeRoute = route;
        if (previous && pages[previous.id].onHide) pages[previous.id].onHide();
        for (const section of document.querySelectorAll("[data-page]")) section.hidden = section.dataset.page !== route.id;
        const section = document.querySelector(`[data-page="${route.id}"]`);
        const page = pages[route.id];
        if (!mounted.has(route.id)) {
            page.mount(section);
            mounted.add(route.id);
        } else page.render();
        if (page.onShow) page.onShow();
        document.getElementById("page-title").textContent = route.title;
        document.title = route.id === "accueil" ? "BUT1 Informatique - Suivi de scolarité" : `${route.title} · BUT1 Informatique`;
        renderNav();
        if (previous) window.scrollTo({ top: 0 });
    }

    const router = createRouter(show);

    // ---------- Service worker et mises à jour ----------

    function promptReload() {
        if (updateToastShown) return;
        updateToastShown = true;
        showToast("Nouvelle version de l'application installée.", "info", { duration: 0, action: { label: "Recharger", onClick: () => window.location.reload() } });
    }

    async function registerServiceWorker() {
        if (!("serviceWorker" in navigator)) return;
        try {
            // Première installation : le service worker prend le contrôle sans changer de version
            // (pas de bannière). Tout changement de contrôleur ultérieur = nouvelle version publiée.
            let hadController = !!navigator.serviceWorker.controller;
            registration = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
            navigator.serviceWorker.addEventListener("controllerchange", () => {
                if (hadController) promptReload();
                hadController = true;
            });
        } catch (e) {
            console.warn("Service worker non enregistré :", e && e.message);
        }
    }

    let lastUpdateCheck = 0;
    async function checkForUpdate(manual = false) {
        if (!registration) {
            if (manual) showToast("Mise à jour indisponible (service worker inactif).", "info");
            return;
        }
        if (!manual && Date.now() - lastUpdateCheck < 30 * 60000) return;
        lastUpdateCheck = Date.now();
        try {
            await registration.update();
            if (manual && !registration.installing && !registration.waiting) showToast("Vous utilisez la dernière version.");
        } catch {
            if (manual) showToast("Impossible de vérifier les mises à jour (hors-ligne ?).", "warning");
        }
    }

    // ---------- Déclencheurs ----------

    function onForeground() {
        controller.syncNow();
        ctx.ensureTimetableFresh();
        checkForUpdate(false);
        renderActive();
    }

    function wireGlobalEvents() {
        controller.subscribe((state, extra) => {
            renderSyncPills();
            if (activeRoute && (activeRoute.id === "accueil" || activeRoute.id === "reglages")) renderActive();
            if (extra && extra.conflicts && extra.conflicts.length) {
                showToast(`Conflit de synchronisation résolu : « ${extra.conflicts[0].label} » (version la plus récente gardée, détail dans Réglages).`, "warning", { duration: 7000 });
            }
        });
        controller.repo.subscribe(() => renderActive());
        timetable.subscribe(() => {
            if (activeRoute && ["accueil", "edt", "reglages"].includes(activeRoute.id)) renderActive();
        });
        window.addEventListener("online", () => {
            controller.setNetworkAvailable(true);
            renderSyncPills();
            ctx.ensureTimetableFresh();
        });
        window.addEventListener("offline", () => {
            controller.setNetworkAvailable(false);
            renderSyncPills();
        });
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") onForeground();
        });
        window.addEventListener("focus", () => {
            if (Date.now() - lastFocusSync > 5000) {
                lastFocusSync = Date.now();
                onForeground();
            }
        });
        window.addEventListener("storage", (event) => {
            if (event.key && event.key === `gdn:v2:${controller.repo.scope}:records`) controller.repo.reloadFromStorage();
        });
        document.addEventListener("click", (event) => {
            const t = event.target instanceof Element ? event.target.closest("[data-action]") : null;
            if (!t) return;
            if (t.dataset.action === "dismiss-migration-banner") {
                store.setJSON("migration", { ...store.getJSON("migration", {}), bannerPending: false });
                renderActive();
            } else if (t.dataset.action === "download-migration-backup") {
                const b = store.getJSON("backups", []).find((x) => x.kind === "legacy");
                if (b) downloadJson(b.fileName, b.content, showToast);
            }
        });
        if (store.lastError && store.lastError.kind === "quota") showToast("Stockage de l'appareil plein : vos données restent en mémoire et dans le cloud.", "warning");
    }

    return {
        ctx,
        pages,
        start() {
            renderNav();
            renderSyncPills();
            wireGlobalEvents();
            router.start();
            document.documentElement.dataset.ready = "true";
            if (typeof performance !== "undefined" && performance.mark) performance.mark("gdn-first-render");
            registerServiceWorker();
            if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        },
        afterSync() {
            renderSyncPills();
            renderActive();
            ctx.ensureTimetableFresh();
        },
        navigate: (id) => router.navigate(id)
    };
}
