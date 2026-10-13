/**
 * Calendrier des devoirs, SAÉ, tests et contrôles : vue Mois (période d'anticipation et
 * marqueur d'échéance aux couleurs de l'importance, clic sur un jour = voir/ajouter) et vue
 * Liste (tri par urgence ou par échéance). Ajout, modification, suppression, « fait ».
 */
import { html, raw } from "../../core/escape.js";
import { validateHomeworkInput } from "../../core/validation.js";
import {
    parisDayKey,
    monthGrid,
    parseDayKey,
    addMonths,
    diffDays,
    formatLongDate,
    formatMonthYear,
    formatRelativeDay,
    formatDayMonth,
    weekdayShortName,
    capitalize
} from "../../core/dates.js";
import {
    HOMEWORK_TYPES,
    ANTICIPATION_OPTIONS,
    STATUSES,
    defaultsForType,
    computeState,
    suggestedStartKey,
    sortByUrgency,
    compareByDue,
    importanceLevel,
    homeworkType,
    anticipationLabel
} from "../../core/homework.js";
import { render, on, formValues, showFieldErrors, isMobileViewport } from "../dom.js";
import { openModal, confirmDialog } from "../modal.js";
import { importanceChip, stateChip, typeLabel, subjectLabel, subjectOptions, importanceRadios, emptyState, INPUT_CLASS, LABEL_CLASS, CARD_CLASS, PRIMARY_BTN, SECONDARY_BTN } from "../components.js";

const SEGMENT = "px-3 min-h-[44px] text-xs font-semibold rounded-lg transition";

export function createHomeworkPage(ctx) {
    let el = null;
    const today = () => parisDayKey(ctx.now());
    const state = {
        view: ctx.device.get("homework-view", "month"),
        month: null,
        selectedDay: null,
        filter: "todo",
        sort: "urgency"
    };

    function items() {
        return ctx.repo().homework();
    }

    function skeleton() {
        return html`<div class="space-y-6">
            <div class="${raw(CARD_CLASS)} flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2" role="group" aria-label="Vue">
                    <button type="button" data-view="month" class="${raw(SEGMENT)}"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> Mois</button>
                    <button type="button" data-view="list" class="${raw(SEGMENT)}"><i class="fa-solid fa-list" aria-hidden="true"></i> Liste</button>
                </div>
                <button type="button" data-action="add" class="${raw(PRIMARY_BTN)}"><i class="fa-solid fa-plus" aria-hidden="true"></i> Ajouter</button>
            </div>
            <div data-hw-body></div>
        </div>`;
    }

    // ---------- Vue Mois ----------

    function monthView() {
        const t = today();
        const ref = parseDayKey(state.month || t);
        const weeks = monthGrid(ref.year, ref.month);
        const all = items();
        const now = ctx.now();
        const live = all.filter((h) => h.status !== "done");
        const cells = weeks.flat().map((day) => {
            const due = all.filter((h) => h.dueDate === day).sort((a, b) => b.importance - a.importance);
            const prep = live.filter((h) => h.dueDate !== day && diffDays(day, suggestedStartKey(h)) >= 0 && diffDays(h.dueDate, day) > 0).sort((a, b) => b.importance - a.importance);
            const inMonth = parseDayKey(day).month === ref.month;
            const isToday = day === t;
            const selected = day === state.selectedDay;
            const label = `${capitalize(formatLongDate(day))} : ${due.length} échéance(s), ${prep.length} en préparation`;
            return html`<button type="button" data-day="${day}" aria-label="${label}" aria-pressed="${selected ? "true" : "false"}"
                class="cal-cell relative text-left min-h-[64px] sm:min-h-[96px] p-1 sm:p-1.5 border-t border-l border-slate-800 [&:nth-child(7n+1)]:border-l-0 [&:nth-child(-n+7)]:border-t-0 flex flex-col gap-0.5 transition ${raw(inMonth ? "bg-slate-950/60" : "bg-slate-950/20 text-slate-600")} ${raw(
                    selected ? "ring-2 ring-inset ring-brand-500" : "hover:bg-slate-800/40"
                )}">
                <span class="text-[11px] sm:text-xs font-semibold ${raw(isToday ? "bg-brand-600 text-white rounded-full w-6 h-6 flex items-center justify-center" : inMonth ? "text-slate-300" : "")}">${parseDayKey(day).day}</span>
                <span class="flex flex-col gap-0.5" aria-hidden="true">${prep.slice(0, 3).map((h) => html`<span class="cal-bar block h-1 rounded-full opacity-70 ${raw(importanceLevel(h.importance).bar)}" title="${h.title} (période d'anticipation)"></span>`)}</span>
                <span class="hidden sm:flex flex-col gap-0.5">${due.slice(0, 2).map(
                    (h) => html`<span class="cal-due flex items-center gap-1 text-[10px] leading-tight px-1 py-0.5 rounded border ${raw(h.status === "done" ? "border-slate-700 text-slate-500 line-through" : importanceLevel(h.importance).chip)}">
                        <i class="fa-solid ${raw(h.status === "done" ? "fa-check" : importanceLevel(h.importance).icon)}" aria-hidden="true"></i><span class="truncate">${h.title}</span>
                    </span>`
                )}</span>
                <span class="flex sm:hidden flex-wrap gap-0.5" aria-hidden="true">${due.slice(0, 4).map((h) => html`<span class="cal-due-dot w-2 h-2 rounded-full ${raw(h.status === "done" ? "bg-slate-600" : importanceLevel(h.importance).dot)}"></span>`)}</span>
                ${due.length > 2 ? html`<span class="hidden sm:block text-[10px] text-slate-400">+${due.length - 2}</span>` : ""}
            </button>`;
        });
        return html`<div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div class="xl:col-span-2 ${raw(CARD_CLASS)} !p-3 sm:!p-4">
                <div class="flex items-center justify-between gap-2 mb-3">
                    <button type="button" data-action="prev-month" class="w-11 h-11 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" aria-label="Mois précédent"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
                    <div class="text-center">
                        <h2 class="text-base font-semibold text-white" aria-live="polite">${capitalize(formatMonthYear(ref.year, ref.month))}</h2>
                        <button type="button" data-action="this-month" class="text-xs text-brand-400 hover:text-brand-100 min-h-[44px] px-3">Aujourd'hui</button>
                    </div>
                    <button type="button" data-action="next-month" class="w-11 h-11 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" aria-label="Mois suivant"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
                </div>
                <div class="grid grid-cols-7 text-center text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500 pb-1">${[0, 1, 2, 3, 4, 5, 6].map((i) => html`<span>${weekdayShortName(i)}</span>`)}</div>
                <div class="grid grid-cols-7 rounded-xl overflow-hidden border border-slate-800">${cells}</div>
                <div class="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-slate-400">
                    <span class="inline-flex items-center gap-1"><span class="w-6 h-1 rounded-full bg-slate-500 inline-block"></span> période d'anticipation (début conseillé → échéance)</span>
                    <span class="inline-flex items-center gap-1"><i class="fa-solid fa-flag" aria-hidden="true"></i> échéance, couleur et icône = importance</span>
                </div>
            </div>
            <aside class="${raw(CARD_CLASS)}" data-day-panel aria-live="polite">${dayPanel(state.selectedDay || today(), now)}</aside>
        </div>`;
    }

    function dayPanel(day, now) {
        const all = items();
        const due = all.filter((h) => h.dueDate === day);
        const prep = all.filter((h) => h.status !== "done" && h.dueDate !== day && diffDays(day, suggestedStartKey(h)) >= 0 && diffDays(h.dueDate, day) > 0);
        return html`<div class="flex items-center justify-between gap-2 mb-3">
                <h3 class="text-sm font-semibold text-white">${capitalize(formatLongDate(day, { withYear: true }))}</h3>
                <button type="button" data-action="add-on-day" data-day="${day}" class="${raw(SECONDARY_BTN)} text-xs"><i class="fa-solid fa-plus" aria-hidden="true"></i> Ajouter ce jour</button>
            </div>
            <h4 class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Échéances</h4>
            ${due.length ? html`<ul class="space-y-2 mb-4">${sortByUrgency(due, now).map((h) => itemCard(h, now, { compact: true }))}</ul>` : html`<p class="text-xs text-slate-500 mb-4">Aucune échéance ce jour.</p>`}
            <h4 class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">À préparer (période d'anticipation)</h4>
            ${prep.length ? html`<ul class="space-y-2">${sortByUrgency(prep, now).map((h) => itemCard(h, now, { compact: true }))}</ul>` : html`<p class="text-xs text-slate-500">Rien à préparer ce jour.</p>`}`;
    }

    // ---------- Vue Liste ----------

    function listView() {
        const now = ctx.now();
        let list = items();
        if (state.filter === "todo") list = list.filter((h) => h.status !== "done");
        else if (state.filter === "done") list = list.filter((h) => h.status === "done");
        list = state.sort === "urgency" ? sortByUrgency(list, now) : [...list].sort(compareByDue);
        return html`<div class="${raw(CARD_CLASS)} space-y-4">
            <div class="flex flex-wrap items-end gap-3">
                <div>
                    <label for="hw-filter" class="${raw(LABEL_CLASS)}">Afficher</label>
                    <select id="hw-filter" data-control="filter" class="${raw(INPUT_CLASS)} !w-auto">
                        <option value="todo" ${raw(state.filter === "todo" ? "selected" : "")}>À faire</option>
                        <option value="done" ${raw(state.filter === "done" ? "selected" : "")}>Faits</option>
                        <option value="all" ${raw(state.filter === "all" ? "selected" : "")}>Tous</option>
                    </select>
                </div>
                <div>
                    <label for="hw-sort" class="${raw(LABEL_CLASS)}">Trier par</label>
                    <select id="hw-sort" data-control="sort" class="${raw(INPUT_CLASS)} !w-auto">
                        <option value="urgency" ${raw(state.sort === "urgency" ? "selected" : "")}>Urgence</option>
                        <option value="due" ${raw(state.sort === "due" ? "selected" : "")}>Échéance</option>
                    </select>
                </div>
                <p class="text-xs text-slate-400 pb-3">${list.length} élément(s)</p>
            </div>
            ${list.length ? html`<ul class="space-y-2" data-hw-list>${list.map((h) => itemCard(h, now))}</ul>` : emptyState("fa-clipboard-check", state.filter === "done" ? "Aucun élément fait pour l'instant." : "Aucun devoir ni évaluation à venir.", html`<button type="button" data-action="add" class="${raw(PRIMARY_BTN)} mx-auto mt-3"><i class="fa-solid fa-plus" aria-hidden="true"></i> Ajouter</button>`)}
        </div>`;
    }

    function itemCard(h, now, { compact = false } = {}) {
        const st = computeState(h, now);
        const start = suggestedStartKey(h);
        const t = today();
        const lvl = importanceLevel(h.importance);
        return html`<li data-hw-id="${h.id}" class="hw-item rounded-xl bg-slate-950/80 border ${raw(st === "overdue" ? "border-rose-500/40" : "border-slate-800")} p-3 border-l-4 ${raw(lvl.border)}">
            <div class="flex items-start gap-3">
                <label class="w-11 h-11 -m-2 flex items-center justify-center cursor-pointer shrink-0" title="Fait">
                    <input type="checkbox" data-action="toggle-done" data-id="${h.id}" class="w-5 h-5 accent-emerald-500 cursor-pointer" ${raw(h.status === "done" ? "checked" : "")} aria-label="Marquer « ${h.title} » comme ${h.status === "done" ? "à faire" : "fait"}">
                </label>
                <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-slate-100 break-words ${raw(h.status === "done" ? "line-through text-slate-500" : "")}">${h.title}</p>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5">${typeLabel(h.type)} ${subjectLabel(h.subjectCode)} ${importanceChip(h.importance)} ${stateChip(st)}
                        ${h.status === "in_progress" ? html`<span class="text-[11px] text-sky-300"><i class="fa-solid fa-spinner" aria-hidden="true"></i> En cours</span>` : ""}
                    </div>
                    <p class="text-xs text-slate-400 mt-1">
                        <i class="fa-regular fa-clock" aria-hidden="true"></i> Échéance : ${formatRelativeDay(h.dueDate, t)} à ${h.dueTime || "23:59"}
                        ${h.anticipationDays > 0 && h.status !== "done" ? html` · <i class="fa-solid fa-hourglass-start" aria-hidden="true"></i> ${diffDays(start, t) > 0 ? html`commencer le ${formatDayMonth(start)}` : html`début conseillé : ${diffDays(start, t) === 0 ? "aujourd'hui" : `dépassé (${formatDayMonth(start)})`}`}` : ""}
                    </p>
                    ${!compact && h.notes ? html`<p class="text-xs text-slate-400 mt-1 whitespace-pre-line break-words">${h.notes}</p>` : ""}
                </div>
                <div class="flex items-center shrink-0">
                    <button type="button" data-action="edit" data-id="${h.id}" class="w-11 h-11 flex items-center justify-center rounded-lg text-slate-500 hover:text-brand-400" aria-label="Modifier ${h.title}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                    ${compact ? "" : html`<button type="button" data-action="delete" data-id="${h.id}" class="w-11 h-11 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400" aria-label="Supprimer ${h.title}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>`}
                </div>
            </div>
        </li>`;
    }

    // ---------- Formulaire ----------

    function openForm(existing = null, { dueDate = null } = {}) {
        const d = existing ? existing : { ...defaultsForType("devoir"), title: "", subjectCode: null, dueDate: dueDate || parisDayKey(ctx.now() + 86400000), notes: "", status: "todo" };
        const touched = new Set(existing ? ["importance", "anticipationDays", "dueTime"] : []);
        openModal({
            title: existing ? "Modifier" : "Ajouter un devoir / une évaluation",
            icon: existing ? "fa-pen-to-square" : "fa-plus-circle",
            size: "max-w-lg",
            body: html`<form id="homework-form" novalidate class="space-y-4">
                <div>
                    <label for="hw-title" class="${raw(LABEL_CLASS)}">Titre</label>
                    <input id="hw-title" name="title" type="text" maxlength="200" autocomplete="off" value="${d.title}" class="${raw(INPUT_CLASS)}" ${raw(existing ? "" : "data-autofocus")}>
                    <p data-error-for="title" class="text-xs text-rose-400 mt-1" hidden></p>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="hw-type" class="${raw(LABEL_CLASS)}">Type</label>
                        <select id="hw-type" name="type" class="${raw(INPUT_CLASS)}">${HOMEWORK_TYPES.map((t) => html`<option value="${t.id}" ${raw(t.id === d.type ? "selected" : "")}>${t.label}</option>`)}</select>
                    </div>
                    <div>
                        <label for="hw-subject" class="${raw(LABEL_CLASS)}">Matière</label>
                        <select id="hw-subject" name="subjectCode" class="${raw(INPUT_CLASS)}">${subjectOptions(d.subjectCode, { allowNone: true })}</select>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="hw-date" class="${raw(LABEL_CLASS)}">Date d'échéance</label>
                        <input id="hw-date" name="dueDate" type="date" value="${d.dueDate}" class="${raw(INPUT_CLASS)}">
                        <p data-error-for="dueDate" class="text-xs text-rose-400 mt-1" hidden></p>
                    </div>
                    <div>
                        <label for="hw-time" class="${raw(LABEL_CLASS)}">Heure</label>
                        <input id="hw-time" name="dueTime" type="time" value="${d.dueTime || "23:59"}" class="${raw(INPUT_CLASS)}">
                        <p data-error-for="dueTime" class="text-xs text-rose-400 mt-1" hidden></p>
                    </div>
                </div>
                <fieldset>
                    <legend class="${raw(LABEL_CLASS)}">Importance</legend>
                    ${importanceRadios(d.importance)}
                </fieldset>
                <div>
                    <label for="hw-anticipation" class="${raw(LABEL_CLASS)}">Anticipation (commencer à s'en occuper…)</label>
                    <select id="hw-anticipation" name="anticipationDays" class="${raw(INPUT_CLASS)}">${ANTICIPATION_OPTIONS.map(
                        (o) => html`<option value="${o.days}" ${raw(o.days === Number(d.anticipationDays) ? "selected" : "")}>${o.label}${o.days ? " avant" : ""}</option>`
                    )}${ANTICIPATION_OPTIONS.some((o) => o.days === Number(d.anticipationDays)) ? "" : html`<option value="${d.anticipationDays}" selected>${anticipationLabel(Number(d.anticipationDays))} avant</option>`}</select>
                    <p class="text-[11px] text-slate-500 mt-1" data-start-hint></p>
                </div>
                <div>
                    <label for="hw-status" class="${raw(LABEL_CLASS)}">Statut</label>
                    <select id="hw-status" name="status" class="${raw(INPUT_CLASS)}">${STATUSES.map((s) => html`<option value="${s.id}" ${raw(s.id === d.status ? "selected" : "")}>${s.label}</option>`)}</select>
                </div>
                <div>
                    <label for="hw-notes" class="${raw(LABEL_CLASS)}">Notes <span class="text-slate-600">(facultatif)</span></label>
                    <textarea id="hw-notes" name="notes" rows="3" maxlength="2000" class="${raw(INPUT_CLASS)}">${d.notes || ""}</textarea>
                </div>
                <div class="flex items-center justify-between gap-3 pt-3 border-t border-slate-800">
                    ${existing ? html`<button type="button" data-action="delete-in-form" class="px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20"><i class="fa-solid fa-trash" aria-hidden="true"></i> Supprimer</button>` : html`<span></span>`}
                    <div class="flex gap-3">
                        <button type="button" data-modal-close class="px-4 py-2 min-h-[44px] rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition">Annuler</button>
                        <button type="submit" class="px-4 py-2 min-h-[44px] rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white transition shadow-md shadow-brand-600/20">Enregistrer</button>
                    </div>
                </div>
            </form>`,
            onMount(panel, close) {
                const form = panel.querySelector("form");
                const hint = panel.querySelector("[data-start-hint]");
                const updateHint = () => {
                    const v = formValues(form);
                    if (!parseDayKey(v.dueDate)) {
                        hint.textContent = "";
                        return;
                    }
                    const start = suggestedStartKey({ dueDate: v.dueDate, anticipationDays: Number(v.anticipationDays) });
                    const delta = diffDays(start, today());
                    hint.textContent = Number(v.anticipationDays) === 0 ? "À commencer le jour de l'échéance." : delta >= 0 ? `Date de début conseillée : ${capitalize(formatLongDate(start))}.` : `Date de début conseillée déjà passée (${formatDayMonth(start)}) : à commencer maintenant.`;
                };
                form.addEventListener("change", (event) => {
                    const name = event.target.name;
                    if (name === "importance" || name === "anticipationDays" || name === "dueTime") touched.add(name);
                    if (name === "type") {
                        const def = defaultsForType(form.elements.type.value);
                        if (!touched.has("importance")) form.querySelector(`input[name=importance][value="${def.importance}"]`).checked = true;
                        if (!touched.has("anticipationDays")) form.elements.anticipationDays.value = String(def.anticipationDays);
                        if (!touched.has("dueTime")) form.elements.dueTime.value = def.dueTime;
                    }
                    updateHint();
                });
                updateHint();
                form.addEventListener("submit", (event) => {
                    event.preventDefault();
                    const values = formValues(form);
                    const v = validateHomeworkInput({ ...values, importance: Number(values.importance), anticipationDays: Number(values.anticipationDays) });
                    if (!v.ok) return showFieldErrors(form, v.errors);
                    const doneAt = v.value.status === "done" ? (existing && existing.doneAt) || new Date(ctx.now()).toISOString() : null;
                    try {
                        if (existing) ctx.repo().update(existing.id, { ...v.value, doneAt });
                        else ctx.repo().create("homework", { ...v.value, doneAt, createdAt: Date.now() });
                        close(true);
                        ctx.toast(existing ? "Modification enregistrée." : "Élément ajouté.");
                        state.selectedDay = v.value.dueDate;
                    } catch (e) {
                        ctx.toast(e.message, "error");
                    }
                });
                const del = panel.querySelector("[data-action=delete-in-form]");
                if (del) del.addEventListener("click", async () => {
                    close(false);
                    await remove(existing.id);
                });
            }
        });
    }

    async function remove(id) {
        const h = items().find((x) => x.id === id);
        if (!h) return;
        const ok = await confirmDialog({ title: "Supprimer", message: `Supprimer « ${h.title} » (${homeworkType(h.type).label}, échéance ${formatDayMonth(h.dueDate)}) ?`, confirmLabel: "Supprimer", danger: true, icon: "fa-trash" });
        if (!ok) return;
        ctx.repo().remove(id);
        ctx.toast("Élément supprimé.", "success", {
            action: {
                label: "Annuler",
                onClick: () => {
                    const { id: _id, ...data } = h;
                    ctx.repo().create("homework", data, { id });
                }
            }
        });
    }

    function toggleDone(id, checked) {
        const h = items().find((x) => x.id === id);
        if (!h) return;
        ctx.repo().update(id, checked ? { status: "done", doneAt: new Date(ctx.now()).toISOString() } : { status: "todo", doneAt: null });
        ctx.toast(checked ? `« ${h.title} » : fait.` : `« ${h.title} » : à faire.`);
    }

    function renderBody() {
        if (!el) return;
        for (const b of el.querySelectorAll("[data-view]")) {
            const active = b.dataset.view === state.view;
            b.setAttribute("aria-pressed", active ? "true" : "false");
            b.className = `${SEGMENT} ${active ? "bg-brand-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`;
        }
        render(el.querySelector("[data-hw-body]"), state.view === "month" ? monthView() : listView());
    }

    return {
        id: "devoirs",
        mount(container) {
            el = container;
            render(el, skeleton());
            on(el, "click", "[data-view]", (e, b) => {
                state.view = b.dataset.view;
                ctx.device.set("homework-view", state.view);
                renderBody();
            });
            on(el, "click", "[data-action=add]", () => openForm(null, { dueDate: state.view === "month" && state.selectedDay ? state.selectedDay : null }));
            on(el, "click", "[data-action=add-on-day]", (e, b) => openForm(null, { dueDate: b.dataset.day }));
            on(el, "click", "[data-action=edit]", (e, b) => {
                const h = items().find((x) => x.id === b.dataset.id);
                if (h) openForm(h);
            });
            on(el, "click", "[data-action=delete]", (e, b) => remove(b.dataset.id));
            on(el, "change", "[data-action=toggle-done]", (e, box) => toggleDone(box.dataset.id, box.checked));
            on(el, "click", "[data-day]", (e, b) => {
                if (!b.classList.contains("cal-cell")) return;
                state.selectedDay = b.dataset.day;
                renderBody();
                if (isMobileViewport()) {
                    const panel = el.querySelector("[data-day-panel]");
                    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
                }
            });
            on(el, "click", "[data-action=prev-month]", () => {
                state.month = addMonths(state.month || today(), -1);
                renderBody();
            });
            on(el, "click", "[data-action=next-month]", () => {
                state.month = addMonths(state.month || today(), 1);
                renderBody();
            });
            on(el, "click", "[data-action=this-month]", () => {
                state.month = null;
                state.selectedDay = today();
                renderBody();
            });
            on(el, "change", "[data-control]", (e, s) => {
                state[s.dataset.control] = s.value;
                renderBody();
            });
            renderBody();
        },
        render: renderBody,
        openEdit(id) {
            const h = items().find((x) => x.id === id);
            if (h) openForm(h);
        },
        openNew(dueDate) {
            openForm(null, { dueDate });
        },
        state
    };
}

