/**
 * Accueil « Aujourd'hui » — une seule page à faire défiler, affichée immédiatement depuis le
 * cache local puis mise à jour :
 *  1. date du jour + état de synchronisation ;
 *  2. cours restants aujourd'hui (le prochain en évidence) ;
 *  3. « À faire maintenant » (début conseillé atteint + échéances proches), case « fait » en un tap ;
 *  4. saisies rapides : une note (matière mémorisée) et un devoir, en 3 interactions max ;
 *  5. aperçu des moyennes d'UE avec détail ;
 *  6. raccourcis vers chaque fonctionnalité.
 */
import { html, raw } from "../../core/escape.js";
import { PROGRAM_S1, subjectName } from "../../core/program.js";
import { calculateAllAverages, formatAverage } from "../../core/grades-calc.js";
import { validateGradeInput, validateHomeworkInput } from "../../core/validation.js";
import { parisDayKey, formatLongDate, formatRelativeDay, parisTime, addDays, capitalize } from "../../core/dates.js";
import { selectDoNow, computeState, defaultsForType, HOMEWORK_TYPES, IMPORTANCE_LEVELS } from "../../core/homework.js";
import { findCurrentAndNext, subjectColor } from "../../core/timetable.js";
import { render, on, formValues, showFieldErrors } from "../dom.js";
import { attachPopover, closePopover } from "../popover.js";
import { syncPill } from "../sync-indicator.js";
import { ueCard, ueDetailContent, subjectOptions, importanceChip, stateChip, typeLabel, subjectLabel, emptyState, INPUT_CLASS, LABEL_CLASS, CARD_CLASS } from "../components.js";

const SECTION_TITLE = "text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2";

export function createHomePage(ctx) {
    let el = null;
    let lastData = null;

    function skeleton() {
        const last = ctx.repo().getSetting("lastSubject", "R1.01");
        const tomorrow = addDays(parisDayKey(ctx.now()), 1);
        return html`<div class="space-y-6">
            <section class="${raw(CARD_CLASS)} relative overflow-hidden" aria-labelledby="home-date">
                <div class="absolute -right-6 -top-6 w-32 h-32 bg-brand-600/10 rounded-full blur-2xl pointer-events-none"></div>
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Aujourd'hui</p>
                        <h2 id="home-date" class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight" data-home-date></h2>
                    </div>
                    <div data-home-sync></div>
                </div>
                <div data-home-banner></div>
            </section>

            <section class="${raw(CARD_CLASS)}" aria-labelledby="home-courses-title">
                <div class="flex items-center justify-between mb-4 gap-2">
                    <h2 id="home-courses-title" class="${raw(SECTION_TITLE)}"><i class="fa-solid fa-calendar-day text-brand-500" aria-hidden="true"></i> Cours restants aujourd'hui</h2>
                    <a href="#/edt" class="text-xs text-brand-400 hover:text-brand-100 min-h-[44px] inline-flex items-center shrink-0" aria-label="Voir l'emploi du temps"><span class="sm:hidden">Voir</span><span class="hidden sm:inline">Emploi du temps</span> <i class="fa-solid fa-chevron-right ml-1 text-[10px]" aria-hidden="true"></i></a>
                </div>
                <div data-home-courses></div>
            </section>

            <section class="${raw(CARD_CLASS)}" aria-labelledby="home-todo-title">
                <div class="flex items-center justify-between mb-4 gap-2">
                    <h2 id="home-todo-title" class="${raw(SECTION_TITLE)}"><i class="fa-solid fa-person-running text-brand-500" aria-hidden="true"></i> À faire maintenant</h2>
                    <a href="#/devoirs" class="text-xs text-brand-400 hover:text-brand-100 min-h-[44px] inline-flex items-center">Tous les devoirs <i class="fa-solid fa-chevron-right ml-1 text-[10px]" aria-hidden="true"></i></a>
                </div>
                <div data-home-todo></div>
            </section>

            <section class="grid grid-cols-1 lg:grid-cols-2 gap-6" aria-label="Saisies rapides">
                <form id="quick-grade-form" novalidate class="${raw(CARD_CLASS)} space-y-3">
                    <h2 class="${raw(SECTION_TITLE)}"><i class="fa-solid fa-plus-circle text-brand-500" aria-hidden="true"></i> Ajouter une note</h2>
                    <div>
                        <label for="quick-grade-subject" class="${raw(LABEL_CLASS)}">Matière / SAÉ <span class="text-slate-600">(mémorisée)</span></label>
                        <select id="quick-grade-subject" name="subjectCode" class="${raw(INPUT_CLASS)}">${subjectOptions(last)}</select>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                        <div>
                            <label for="quick-grade-score" class="${raw(LABEL_CLASS)}">Note</label>
                            <input id="quick-grade-score" name="score" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="12,5" class="${raw(INPUT_CLASS)}">
                        </div>
                        <div>
                            <label for="quick-grade-max" class="${raw(LABEL_CLASS)}">Sur</label>
                            <input id="quick-grade-max" name="max" type="text" inputmode="decimal" autocomplete="off" value="20" class="${raw(INPUT_CLASS)}">
                        </div>
                        <div>
                            <label for="quick-grade-coeff" class="${raw(LABEL_CLASS)}">Coeff.</label>
                            <input id="quick-grade-coeff" name="coeff" type="text" inputmode="decimal" autocomplete="off" value="1" class="${raw(INPUT_CLASS)}">
                        </div>
                    </div>
                    <p data-error-for="score" class="text-xs text-rose-400" hidden></p>
                    <p data-error-for="max" class="text-xs text-rose-400" hidden></p>
                    <p data-error-for="coeff" class="text-xs text-rose-400" hidden></p>
                    <div>
                        <label for="quick-grade-name" class="${raw(LABEL_CLASS)}">Nom <span class="text-slate-600">(facultatif)</span></label>
                        <input id="quick-grade-name" name="name" type="text" maxlength="120" autocomplete="off" placeholder="Note rapide" class="${raw(INPUT_CLASS)}">
                    </div>
                    <button type="submit" class="w-full bg-brand-600 hover:bg-brand-500 text-white font-medium py-2 min-h-[44px] rounded-lg text-sm transition shadow-lg shadow-brand-600/20 flex items-center justify-center gap-2">
                        <i class="fa-solid fa-plus" aria-hidden="true"></i> Ajouter la note
                    </button>
                </form>

                <form id="quick-homework-form" novalidate class="${raw(CARD_CLASS)} space-y-3">
                    <h2 class="${raw(SECTION_TITLE)}"><i class="fa-solid fa-list-check text-brand-500" aria-hidden="true"></i> Ajouter un devoir / une évaluation</h2>
                    <div>
                        <label for="quick-hw-title" class="${raw(LABEL_CLASS)}">Titre</label>
                        <input id="quick-hw-title" name="title" type="text" maxlength="200" autocomplete="off" enterkeyhint="done" placeholder="ex. Rendu TP2, DS de maths" class="${raw(INPUT_CLASS)}">
                        <p data-error-for="title" class="text-xs text-rose-400 mt-1" hidden></p>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label for="quick-hw-type" class="${raw(LABEL_CLASS)}">Type</label>
                            <select id="quick-hw-type" name="type" class="${raw(INPUT_CLASS)}">${HOMEWORK_TYPES.map((t) => html`<option value="${t.id}">${t.label}</option>`)}</select>
                        </div>
                        <div>
                            <label for="quick-hw-date" class="${raw(LABEL_CLASS)}">Échéance</label>
                            <input id="quick-hw-date" name="dueDate" type="date" value="${tomorrow}" class="${raw(INPUT_CLASS)}">
                            <p data-error-for="dueDate" class="text-xs text-rose-400 mt-1" hidden></p>
                        </div>
                    </div>
                    <div>
                        <label for="quick-hw-importance" class="${raw(LABEL_CLASS)}">Importance</label>
                        <select id="quick-hw-importance" name="importance" class="${raw(INPUT_CLASS)}">${Object.entries(IMPORTANCE_LEVELS).map(
                            ([v, l]) => html`<option value="${v}" ${raw(v === "2" ? "selected" : "")}>${l.label}</option>`
                        )}</select>
                    </div>
                    <p class="text-[11px] text-slate-500" data-quick-hw-hint></p>
                    <button type="submit" class="w-full bg-brand-600 hover:bg-brand-500 text-white font-medium py-2 min-h-[44px] rounded-lg text-sm transition shadow-lg shadow-brand-600/20 flex items-center justify-center gap-2">
                        <i class="fa-solid fa-plus" aria-hidden="true"></i> Ajouter
                    </button>
                </form>
            </section>

            <section class="${raw(CARD_CLASS)}" aria-labelledby="home-ue-title">
                <div class="flex items-center justify-between mb-4 gap-2">
                    <h2 id="home-ue-title" class="${raw(SECTION_TITLE)}"><i class="fa-solid fa-chart-pie text-brand-500" aria-hidden="true"></i> Moyennes d'UE</h2>
                    <a href="#/notes" class="text-xs text-brand-400 hover:text-brand-100 min-h-[44px] inline-flex items-center">Toutes les notes <i class="fa-solid fa-chevron-right ml-1 text-[10px]" aria-hidden="true"></i></a>
                </div>
                <div data-home-ue></div>
            </section>

            <nav class="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="Raccourcis">
                ${[
                    ["#/notes", "fa-graduation-cap", "Notes", "Moyennes et évaluations"],
                    ["#/edt", "fa-calendar-week", "Emploi du temps", "Jour et semaine"],
                    ["#/devoirs", "fa-list-check", "Devoirs", "Calendrier et liste"],
                    ["#/reglages", "fa-gear", "Réglages", "Compte, EDT, sauvegarde"]
                ].map(
                    ([href, icon, label, sub]) => html`<a href="${href}" class="bg-slate-900 border border-slate-800 rounded-2xl p-4 min-h-[88px] flex flex-col gap-2 hover:border-brand-500/50 hover:bg-slate-800/60 transition shadow-xl">
                        <i class="fa-solid ${raw(icon)} text-brand-500 text-lg" aria-hidden="true"></i>
                        <span class="text-sm font-semibold text-white">${label}</span>
                        <span class="text-[11px] text-slate-400">${sub}</span>
                    </a>`
                )}
            </nav>
        </div>`;
    }

    function renderCourses() {
        const box = el.querySelector("[data-home-courses]");
        const now = ctx.now();
        const today = parisDayKey(now);
        const tt = ctx.timetable;
        const url = ctx.repo().getSetting("edtUrl", "");
        const events = tt.eventsOfDay(today).filter((e) => !e.allDay);
        const remaining = events.filter((e) => e.end > now);
        const { next, current } = findCurrentAndNext(events, now);
        let status = "";
        if (tt.status === "loading") status = html`<p class="text-xs text-slate-400 mb-2"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Mise à jour de l'emploi du temps…</p>`;
        else if (tt.error && tt.hasData()) status = html`<p class="text-xs text-amber-300 mb-2"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> ${tt.error.message}</p>`;
        if (!tt.hasData()) {
            render(
                box,
                html`${status}${emptyState(
                    "fa-calendar-xmark",
                    url ? (tt.error ? tt.error.message : "Emploi du temps pas encore chargé.") : "Ajoutez le lien de votre emploi du temps ADE dans Réglages pour voir vos cours ici.",
                    html`<a href="${url ? "#/edt" : "#/reglages"}" class="inline-flex mt-2 text-xs text-brand-400 min-h-[44px] items-center">${url ? "Ouvrir l'emploi du temps" : "Configurer"}</a>`
                )}`
            );
            return;
        }
        if (remaining.length === 0) {
            render(box, html`${status}${emptyState("fa-mug-hot", events.length ? "Plus de cours aujourd'hui." : "Pas de cours aujourd'hui.")}`);
            return;
        }
        render(
            box,
            html`${status}<ul class="space-y-2">${remaining.map((e) => {
                const isNext = next && e.id === next.id;
                const isCurrent = current.some((c) => c.id === e.id);
                const color = subjectColor(e.subjectCode);
                return html`<li>
                    <button type="button" data-action="course-detail" data-id="${e.id}" class="w-full text-left flex items-start gap-3 p-3 rounded-xl border transition min-h-[44px] ${raw(
                        isNext ? "bg-brand-500/10 border-brand-500/40 ring-1 ring-brand-500/40" : isCurrent ? "bg-emerald-500/10 border-emerald-500/30" : "bg-slate-950/80 border-slate-800 hover:border-slate-700"
                    )} ${raw(e.cancelled ? "opacity-60" : "")}">
                        <span class="w-1.5 self-stretch rounded-full ${raw(color.dot)}" aria-hidden="true"></span>
                        <span class="min-w-0 flex-1">
                            <span class="flex flex-wrap items-center gap-2">
                                <span class="font-mono text-sm font-bold text-white">${parisTime(e.start)}–${parisTime(e.end)}</span>
                                ${isCurrent ? html`<span class="text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded">En cours</span>` : ""}
                                ${isNext ? html`<span class="text-[10px] font-bold uppercase tracking-wider text-brand-100 bg-brand-500/30 px-1.5 py-0.5 rounded">Prochain cours</span>` : ""}
                                ${e.cancelled ? html`<span class="text-[10px] font-bold uppercase text-rose-300">Annulé</span>` : ""}
                            </span>
                            <span class="block text-sm font-medium text-slate-100 break-words ${raw(e.cancelled ? "line-through" : "")}">${e.title}</span>
                            <span class="block text-xs text-slate-400"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${e.room || "Salle non précisée"}${e.subjectCode ? html` · ${e.subjectCode}` : ""}${e.type ? html` · ${e.type}` : ""}</span>
                        </span>
                    </button>
                </li>`;
            })}</ul>`
        );
    }

    function renderTodo() {
        const box = el.querySelector("[data-home-todo]");
        const now = ctx.now();
        const today = parisDayKey(now);
        const items = selectDoNow(ctx.repo().homework(), now);
        if (items.length === 0) {
            render(box, emptyState("fa-champagne-glasses", "Rien d'urgent : aucun élément à commencer ni d'échéance dans les 7 jours."));
            return;
        }
        render(
            box,
            html`<ul class="space-y-2">${items.slice(0, 12).map((hw) => {
                const state = computeState(hw, now);
                const dueKey = hw.dueDate;
                return html`<li class="flex items-start gap-3 p-3 rounded-xl bg-slate-950/80 border ${raw(state === "overdue" ? "border-rose-500/40" : "border-slate-800")}">
                    <label class="w-11 h-11 -m-2 flex items-center justify-center cursor-pointer shrink-0" title="Marquer comme fait">
                        <input type="checkbox" data-action="toggle-done" data-id="${hw.id}" class="w-5 h-5 accent-emerald-500 cursor-pointer" aria-label="Marquer « ${hw.title} » comme fait">
                    </label>
                    <a href="#/devoirs" data-focus-homework="${hw.id}" class="min-w-0 flex-1">
                        <span class="block text-sm font-medium text-slate-100 break-words">${hw.title}</span>
                        <span class="mt-1 flex flex-wrap items-center gap-1.5">
                            ${typeLabel(hw.type)} ${subjectLabel(hw.subjectCode)} ${importanceChip(hw.importance)} ${stateChip(state)}
                        </span>
                        <span class="block text-xs text-slate-400 mt-1"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${formatRelativeDay(dueKey, today)} à ${hw.dueTime || "23:59"}</span>
                    </a>
                </li>`;
            })}</ul>${items.length > 12 ? html`<p class="text-xs text-slate-400 mt-2">+ ${items.length - 12} autre(s) dans Devoirs.</p>` : ""}`
        );
    }

    function renderUe() {
        const box = el.querySelector("[data-home-ue]");
        const data = calculateAllAverages(ctx.repo().grades());
        lastData = data;
        render(
            box,
            html`<div class="flex flex-wrap items-center gap-4 mb-4">
                    <div>
                        <span class="text-xs text-slate-400 block">Moyenne générale</span>
                        <span class="text-3xl font-extrabold tracking-tight ${raw(data.globalAverage === null ? "text-white" : data.globalAverage >= 10 ? "text-emerald-400" : "text-rose-400")}" data-home-global>${formatAverage(data.globalAverage)}</span>
                        <span class="text-sm text-slate-400">/ 20</span>
                    </div>
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${raw(data.statusClass)}">${data.status}</span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">${PROGRAM_S1.ues.map((ue) => ueCard(ue, data.ueAverages[ue.code]))}</div>`
        );
        for (const btn of box.querySelectorAll("[data-ue]")) attachPopover(btn, () => ueDetailContent(lastData.subjectAverages, btn.dataset.ue));
    }

    function renderHeader() {
        el.querySelector("[data-home-date]").textContent = capitalize(formatLongDate(parisDayKey(ctx.now()), { withYear: false }));
        render(el.querySelector("[data-home-sync]"), syncPill(ctx.syncState()));
        render(el.querySelector("[data-home-banner]"), ctx.homeBanner ? ctx.homeBanner() : html``);
    }

    function renderAll() {
        if (!el) return;
        closePopover();
        renderHeader();
        renderCourses();
        renderTodo();
        renderUe();
    }

    function updateHomeworkHint(form) {
        const d = defaultsForType(form.elements.type.value);
        form.elements.importance.value = String(d.importance);
        const lvl = IMPORTANCE_LEVELS[d.importance];
        el.querySelector("[data-quick-hw-hint]").textContent = `Par défaut pour ce type : importance ${lvl.label.toLowerCase()}, ${d.anticipationDays ? `commencer ${d.anticipationDays} jour(s) avant` : "sans anticipation"}, échéance à ${d.dueTime}. Modifiable ensuite dans Devoirs.`;
    }

    return {
        id: "accueil",
        mount(container) {
            el = container;
            render(el, skeleton());
            const gradeForm = el.querySelector("#quick-grade-form");
            gradeForm.addEventListener("submit", (event) => {
                event.preventDefault();
                const values = formValues(gradeForm);
                const subjectLabelText = subjectName(values.subjectCode) || values.subjectCode;
                const v = validateGradeInput(values, { defaultName: `Note rapide du ${new Date(ctx.now()).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}` });
                if (!v.ok) return showFieldErrors(gradeForm, v.errors);
                showFieldErrors(gradeForm, {});
                ctx.repo().create("grades", { ...v.value, createdAt: Date.now() });
                ctx.repo().setSetting("lastSubject", v.value.subjectCode);
                gradeForm.elements.score.value = "";
                gradeForm.elements.name.value = "";
                ctx.toast(`Note ajoutée en ${v.value.subjectCode} (${subjectLabelText}).`);
            });
            const hwForm = el.querySelector("#quick-homework-form");
            hwForm.elements.type.addEventListener("change", () => updateHomeworkHint(hwForm));
            updateHomeworkHint(hwForm);
            hwForm.addEventListener("submit", (event) => {
                event.preventDefault();
                const values = formValues(hwForm);
                const d = defaultsForType(values.type);
                const v = validateHomeworkInput({ ...d, ...values, importance: Number(values.importance), subjectCode: null, notes: "", status: "todo" });
                if (!v.ok) return showFieldErrors(hwForm, v.errors);
                showFieldErrors(hwForm, {});
                ctx.repo().create("homework", { ...v.value, createdAt: Date.now() });
                hwForm.elements.title.value = "";
                ctx.toast(`« ${v.value.title} » ajouté — échéance ${formatRelativeDay(v.value.dueDate, parisDayKey(ctx.now())).toLowerCase()} à ${v.value.dueTime}.`);
            });
            on(el, "change", "[data-action=toggle-done]", (e, box) => {
                if (!box.checked) return;
                const hw = ctx.repo().homework().find((h) => h.id === box.dataset.id);
                if (!hw) return;
                ctx.repo().update(hw.id, { status: "done", doneAt: new Date(ctx.now()).toISOString() });
                ctx.toast(`« ${hw.title} » marqué comme fait.`, "success", {
                    action: { label: "Annuler", onClick: () => ctx.repo().update(hw.id, { status: hw.status === "done" ? "todo" : hw.status, doneAt: null }) }
                });
            });
            on(el, "click", "[data-action=course-detail]", (e, btn) => {
                const ev = ctx.timetable.cache.events.find((x) => x.id === btn.dataset.id);
                if (ev) ctx.openCourseDetail(ev);
            });
            on(el, "click", "[data-focus-homework]", (e, a) => ctx.focusHomework(a.dataset.focusHomework));
            renderAll();
        },
        render: renderAll,
        onShow() {
            const tomorrow = addDays(parisDayKey(ctx.now()), 1);
            const date = el && el.querySelector("#quick-hw-date");
            if (date && !date.matches(":focus") && date.value < parisDayKey(ctx.now())) date.value = tomorrow;
            const sel = el && el.querySelector("#quick-grade-subject");
            const last = ctx.repo().getSetting("lastSubject", null);
            if (sel && last && document.activeElement !== sel) sel.value = last;
            ctx.ensureTimetableFresh();
        },
        onHide() {
            closePopover();
        }
    };
}
