/**
 * Emploi du temps : vue Jour (par défaut sur mobile) et vue Semaine (par défaut sur desktop),
 * précédent / suivant / aujourd'hui, swipe sur mobile, couleur par matière, cours en cours et
 * prochain cours mis en évidence, détail au clic/tap, zoom explicite (−/+/réinitialiser)
 * mémorisé dans les réglages synchronisés (une valeur pour mobile, une pour desktop),
 * cache hors-ligne avec date de dernière mise à jour.
 */
import { html, raw } from "../../core/escape.js";
import { parisDayKey, addDays, startOfWeek, weekdayOf, formatLongDate, formatDayMonth, weekdayShortName, parisMinutesOfDay, parisTime, formatDateTime, capitalize, diffDays } from "../../core/dates.js";
import { layoutOverlaps, findCurrentAndNext, subjectColor } from "../../core/timetable.js";
import { render, on, isMobileViewport } from "../dom.js";
import { CARD_CLASS, SECONDARY_BTN } from "../components.js";

export const ZOOM_LEVELS = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const BASE_HOUR_PX = 56;
const SEGMENT = "px-3 min-h-[44px] text-xs font-semibold rounded-lg transition";

export function zoomKey() {
    return `edtZoom:${isMobileViewport() ? "mobile" : "desktop"}`;
}

export function createTimetablePage(ctx) {
    let el = null;
    let clockTimer = null;
    const state = {
        view: ctx.device.get("edt-view", null),
        day: null
    };
    const view = () => state.view || (isMobileViewport() ? "day" : "week");
    const currentDay = () => state.day || parisDayKey(ctx.now());

    function zoom() {
        const z = Number(ctx.repo().getSetting(zoomKey(), 1));
        return ZOOM_LEVELS.includes(z) ? z : 1;
    }

    function skeleton() {
        return html`<div class="space-y-4">
            <div class="${raw(CARD_CLASS)} !p-3 sm:!p-4 space-y-3">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5">
                        <button type="button" data-action="prev" class="w-11 h-11 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" aria-label="Précédent"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
                        <button type="button" data-action="today" class="px-3 min-h-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold">Aujourd'hui</button>
                        <button type="button" data-action="next" class="w-11 h-11 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" aria-label="Suivant"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
                    </div>
                    <h2 class="text-sm sm:text-base font-semibold text-white text-right" data-edt-label aria-live="polite"></h2>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5" role="group" aria-label="Vue">
                        <button type="button" data-view="day" class="${raw(SEGMENT)}">Jour</button>
                        <button type="button" data-view="week" class="${raw(SEGMENT)}">Semaine</button>
                    </div>
                    <div class="flex items-center gap-1.5" role="group" aria-label="Zoom de la grille">
                        <button type="button" data-action="zoom-out" class="w-11 h-11 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" aria-label="Réduire le zoom"><i class="fa-solid fa-magnifying-glass-minus" aria-hidden="true"></i></button>
                        <span class="text-xs font-mono text-slate-300 w-12 text-center" data-zoom-value aria-live="polite"></span>
                        <button type="button" data-action="zoom-in" class="w-11 h-11 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" aria-label="Agrandir"><i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i></button>
                        <button type="button" data-action="zoom-reset" class="w-11 h-11 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" aria-label="Réinitialiser le zoom"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button>
                    </div>
                    <button type="button" data-action="refresh" class="${raw(SECONDARY_BTN)} !min-h-[44px] text-xs"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Actualiser</button>
                </div>
            </div>
            <div data-edt-status></div>
            <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
                <div data-edt-scroll class="edt-scroll overflow-auto overscroll-contain" tabindex="0" aria-label="Grille de l'emploi du temps (faire défiler)">
                    <div data-edt-grid></div>
                </div>
            </div>
        </div>`;
    }

    function displayedDays() {
        if (view() === "day") return [currentDay()];
        const monday = startOfWeek(currentDay());
        const days = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
        for (const i of [5, 6]) {
            const d = addDays(monday, i);
            if (ctx.timetable.eventsOfDay(d).length) days.push(d);
        }
        return days;
    }

    function applyZoom() {
        const scroll = el.querySelector("[data-edt-scroll]");
        const z = zoom();
        scroll.style.setProperty("--edt-hour", `${Math.round(BASE_HOUR_PX * z)}px`);
        scroll.style.setProperty("--edt-font", String(z));
        scroll.style.setProperty("--edt-col-min", `${Math.round((view() === "day" ? 160 : 120) * z)}px`);
        el.querySelector("[data-zoom-value]").textContent = `${Math.round(z * 100)} %`;
        el.querySelector("[data-action=zoom-out]").disabled = z <= ZOOM_LEVELS[0];
        el.querySelector("[data-action=zoom-in]").disabled = z >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    }

    function setZoom(z) {
        ctx.repo().setSetting(zoomKey(), z);
        applyZoom();
    }

    function statusBar() {
        const tt = ctx.timetable;
        const url = ctx.repo().getSetting("edtUrl", "");
        const days = displayedDays();
        const parts = [];
        if (!url) {
            parts.push(html`<div class="bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm text-slate-300 flex flex-wrap items-center gap-2"><i class="fa-solid fa-link text-brand-500" aria-hidden="true"></i> <span>Ajoutez le lien de votre emploi du temps ADE dans <a href="#/reglages" class="text-brand-400 underline py-3">Réglages</a>.</span></div>`);
        }
        if (tt.status === "loading") {
            parts.push(html`<p class="text-xs text-slate-400" role="status"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Récupération de l'emploi du temps…</p>`);
        } else if (tt.error && url) {
            parts.push(html`<div class="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-xl p-3 text-sm flex flex-wrap items-center gap-2" role="alert">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span class="flex-1 min-w-0">${tt.error.message}${tt.hasData() ? " Affichage de la dernière version enregistrée." : ""}</span>
                <button type="button" data-action="refresh" class="px-3 min-h-[40px] rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-xs font-semibold">Réessayer</button>
            </div>`);
        }
        const fetchedAt = tt.fetchedAtFor(days[0]) || tt.lastFetchedAt();
        const offline = (typeof navigator !== "undefined" && navigator.onLine === false) || (tt.error && tt.error.code === "offline") || ctx.syncState().sync.phase === "offline";
        if (fetchedAt) {
            parts.push(html`<p class="text-xs text-slate-500" data-edt-updated><i class="fa-regular fa-clock" aria-hidden="true"></i> Dernière mise à jour : ${formatDateTime(fetchedAt)}${offline ? " (hors-ligne)" : ""}</p>`);
        }
        if (url && tt.hasData() && !tt.covers(days[0], days[days.length - 1]) && tt.status !== "loading") {
            parts.push(html`<p class="text-xs text-amber-300"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Cette période n'est pas encore chargée${offline ? " (hors-ligne)" : " : chargement…"}</p>`);
        }
        return html`<div class="space-y-2">${parts}</div>`;
    }

    function grid() {
        const days = displayedDays();
        const now = ctx.now();
        const today = parisDayKey(now);
        const perDay = days.map((d) => ctx.timetable.eventsOfDay(d));
        const timed = perDay.flat().filter((e) => !e.allDay);
        const allDay = perDay.map((list) => list.filter((e) => e.allDay));
        let startHour = 8;
        let endHour = 19;
        for (const e of timed) {
            startHour = Math.min(startHour, Math.floor(parisMinutesOfDay(e.start) / 60));
            const endMin = parisDayKey(e.end) !== parisDayKey(e.start) ? 24 * 60 : parisMinutesOfDay(e.end);
            endHour = Math.max(endHour, Math.ceil(endMin / 60));
        }
        const hours = [];
        for (let h = startHour; h < endHour; h++) hours.push(h);
        const { current, next } = findCurrentAndNext(timed, now);
        const totalHours = endHour - startHour;
        const hasAllDay = allDay.some((l) => l.length);
        const empty = perDay.every((l) => l.length === 0);
        const cols = `grid-template-columns: 3.25rem repeat(${days.length}, minmax(var(--edt-col-min), 1fr));`;

        const column = (day, list) => {
            const placed = layoutOverlaps(list.filter((e) => !e.allDay));
            const nowLine =
                day === today && parisMinutesOfDay(now) >= startHour * 60 && parisMinutesOfDay(now) <= endHour * 60
                    ? html`<div class="edt-now absolute left-0 right-0 z-20 pointer-events-none" style="top: calc(${(parisMinutesOfDay(now) - startHour * 60) / 60} * var(--edt-hour))" aria-hidden="true"><span class="block h-0.5 bg-rose-500"></span></div>`
                    : "";
            return html`<div class="edt-day relative border-l border-slate-800 ${raw(day === today ? "bg-brand-500/5" : "")}" style="height: calc(${totalHours} * var(--edt-hour))" data-day="${day}">
                ${hours.map((h) => html`<div class="absolute left-0 right-0 border-t border-slate-800/70" style="top: calc(${h - startHour} * var(--edt-hour))" aria-hidden="true"></div>`)}
                ${placed.map(({ event: e, col, cols: n }) => {
                    const startMin = parisMinutesOfDay(e.start);
                    const endMin = parisDayKey(e.end) !== day ? 24 * 60 : parisMinutesOfDay(e.end);
                    const top = (startMin - startHour * 60) / 60;
                    const height = Math.max(0.33, (endMin - startMin) / 60);
                    const color = subjectColor(e.subjectCode);
                    const isCurrent = current.some((c) => c.id === e.id);
                    const isNext = next && next.id === e.id;
                    return html`<button type="button" data-event-id="${e.id}"
                        class="edt-event absolute rounded-lg border-l-4 px-1.5 py-1 text-left overflow-hidden ${raw(color.block)} ${raw(isCurrent ? "ring-2 ring-emerald-400 z-10" : isNext ? "ring-2 ring-brand-400 z-10" : "")} ${raw(e.cancelled ? "opacity-60" : "")} hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition"
                        style="top: calc(${top} * var(--edt-hour) + 1px); height: calc(${height} * var(--edt-hour) - 2px); left: calc(${(col / n) * 100}% + 2px); width: calc(${100 / n}% - 4px)"
                        aria-label="${e.title}, ${parisTime(e.start)} à ${parisTime(e.end)}${e.room ? `, salle ${e.room}` : ""}${e.cancelled ? ", annulé" : ""}${isCurrent ? ", en cours" : isNext ? ", prochain cours" : ""}">
                        <span class="edt-event-time block font-mono text-slate-300">${parisTime(e.start)}–${parisTime(e.end)}${isCurrent ? html` <span class="text-emerald-300 font-sans font-bold">· en cours</span>` : isNext ? html` <span class="text-brand-100 font-sans font-bold">· prochain</span>` : ""}</span>
                        <span class="edt-event-title block font-semibold text-slate-50 ${raw(e.cancelled ? "line-through" : "")}">${e.title}</span>
                        <span class="edt-event-room block text-slate-300 truncate">${e.room}${e.type ? ` · ${e.type}` : ""}</span>
                    </button>`;
                })}
                ${nowLine}
            </div>`;
        };

        return html`<div class="edt-grid grid min-w-full" style="${cols}">
            <div class="sticky top-0 left-0 z-30 bg-slate-900 border-b border-slate-800"></div>
            ${days.map(
                (d) => html`<div class="sticky top-0 z-20 bg-slate-900 border-b border-l border-slate-800 px-2 py-2 text-center">
                    <span class="block text-[11px] uppercase tracking-wider ${raw(d === today ? "text-brand-400 font-bold" : "text-slate-500")}">${weekdayShortName(weekdayOf(d))}</span>
                    <span class="block text-sm font-semibold ${raw(d === today ? "text-white" : "text-slate-300")}">${formatDayMonth(d)}</span>
                </div>`
            )}
            ${
                hasAllDay
                    ? html`<div class="sticky left-0 z-10 bg-slate-900 text-[10px] text-slate-500 px-1 py-1 border-b border-slate-800">Journée</div>${allDay.map(
                          (list) => html`<div class="border-b border-l border-slate-800 p-1 space-y-1">${list.map(
                              (e) => html`<button type="button" data-event-id="${e.id}" class="edt-allday w-full text-left text-[11px] rounded px-1.5 py-1 border-l-4 ${raw(subjectColor(e.subjectCode).block)} truncate ${raw(e.cancelled ? "line-through opacity-60" : "")}">${e.title}</button>`
                          )}</div>`
                      )}`
                    : ""
            }
            <div class="edt-hours sticky left-0 z-10 bg-slate-900" style="height: calc(${totalHours} * var(--edt-hour))">
                ${hours.map((h) => html`<span class="absolute right-1.5 -translate-y-1/2 text-[10px] font-mono text-slate-500" style="top: calc(${h - startHour} * var(--edt-hour))">${h === startHour ? "" : `${String(h).padStart(2, "0")}:00`}</span>`)}
            </div>
            ${days.map((d, i) => column(d, perDay[i]))}
        </div>
        ${empty && ctx.timetable.hasData() ? html`<p class="text-center text-sm text-slate-500 py-3 border-t border-slate-800" data-edt-empty>${view() === "day" ? "Aucun cours ce jour-là." : "Aucun cours cette semaine (vacances ?)."}</p>` : ""}`;
    }

    function label() {
        const days = displayedDays();
        if (view() === "day") return capitalize(formatLongDate(days[0], { withYear: true }));
        return `Semaine du ${formatDayMonth(days[0])} au ${formatDayMonth(addDays(startOfWeek(days[0]), 6))}`;
    }

    function renderAll() {
        if (!el) return;
        for (const b of el.querySelectorAll("[data-view]")) {
            const active = b.dataset.view === view();
            b.setAttribute("aria-pressed", active ? "true" : "false");
            b.className = `${SEGMENT} ${active ? "bg-brand-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`;
        }
        el.querySelector("[data-edt-label]").textContent = label();
        render(el.querySelector("[data-edt-status]"), statusBar());
        render(el.querySelector("[data-edt-grid]"), grid());
        applyZoom();
    }

    function ensureRange() {
        const days = displayedDays();
        const tt = ctx.timetable;
        if (tt.hasData() && !tt.covers(days[0], days[days.length - 1])) {
            const r = tt.rangeAround(days[0]);
            ctx.refreshTimetable(r);
        }
    }

    function move(delta) {
        const step = view() === "day" ? 1 : 7;
        state.day = addDays(currentDay(), delta * step);
        renderAll();
        ensureRange();
    }

    function scrollToNow() {
        const scroll = el.querySelector("[data-edt-scroll]");
        const target = el.querySelector(".edt-now") || el.querySelector(".edt-event");
        if (scroll && target) scroll.scrollTop = Math.max(0, target.offsetTop - 48);
    }

    function installSwipe() {
        const scroll = el.querySelector("[data-edt-scroll]");
        let start = null;
        scroll.addEventListener(
            "touchstart",
            (e) => {
                start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), left: scroll.scrollLeft } : null;
            },
            { passive: true }
        );
        scroll.addEventListener(
            "touchend",
            (e) => {
                if (!start || e.changedTouches.length !== 1) return;
                const dx = e.changedTouches[0].clientX - start.x;
                const dy = e.changedTouches[0].clientY - start.y;
                const fast = Date.now() - start.t < 700;
                const scrolledHorizontally = Math.abs(scroll.scrollLeft - start.left) > 2;
                const canScrollX = scroll.scrollWidth > scroll.clientWidth + 2;
                start = null;
                if (!fast || scrolledHorizontally || Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
                if (canScrollX) {
                    const atStart = scroll.scrollLeft <= 1;
                    const atEnd = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 1;
                    if ((dx > 0 && !atStart) || (dx < 0 && !atEnd)) return;
                }
                move(dx < 0 ? 1 : -1);
            },
            { passive: true }
        );
    }

    return {
        id: "edt",
        mount(container) {
            el = container;
            render(el, skeleton());
            on(el, "click", "[data-action=prev]", () => move(-1));
            on(el, "click", "[data-action=next]", () => move(1));
            on(el, "click", "[data-action=today]", () => {
                state.day = null;
                renderAll();
                scrollToNow();
                ensureRange();
            });
            on(el, "click", "[data-view]", (e, b) => {
                state.view = b.dataset.view;
                ctx.device.set("edt-view", state.view);
                renderAll();
                ensureRange();
            });
            on(el, "click", "[data-action=zoom-in]", () => setZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(zoom()) + 1)]));
            on(el, "click", "[data-action=zoom-out]", () => setZoom(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(zoom()) - 1)]));
            on(el, "click", "[data-action=zoom-reset]", () => setZoom(1));
            on(el, "click", "[data-action=refresh]", () => {
                const days = displayedDays();
                const tt = ctx.timetable;
                const inDefault = diffDays(days[0], tt.defaultRange().from) >= 0 && diffDays(tt.defaultRange().to, days[0]) >= 0;
                ctx.refreshTimetable(inDefault ? tt.defaultRange() : tt.rangeAround(days[0]), { manual: true });
            });
            on(el, "click", "[data-event-id]", (e, b) => {
                const ev = ctx.timetable.cache.events.find((x) => x.id === b.dataset.eventId);
                if (ev) ctx.openCourseDetail(ev);
            });
            installSwipe();
            renderAll();
        },
        render: renderAll,
        onShow() {
            renderAll();
            scrollToNow();
            ctx.ensureTimetableFresh();
            ensureRange();
            clearInterval(clockTimer);
            clockTimer = setInterval(() => renderAll(), 60000);
        },
        onHide() {
            clearInterval(clockTimer);
        },
        state
    };
}
