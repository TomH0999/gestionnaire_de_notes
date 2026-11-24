/**
 * Page Notes : reprise de l'écran d'origine (moyenne générale, statut, moyennes d'UE,
 * formulaire d'ajout, ressources en accordéon, SAÉ en blocs), avec :
 *  - détail du calcul de chaque UE au survol, au tap et au focus clavier ;
 *  - saisie avec virgule ou point ; validation des valeurs absurdes ;
 *  - suppression logique (synchronisée) avec annulation.
 * Le calcul et l'affichage (toFixed(2)) sont strictement ceux d'origine.
 */
import { html, raw } from "../../core/escape.js";
import { isKnownSubject } from "../../core/program.js";
import { normalizedScore } from "../../core/grades-calc.js";
import { computeSemester } from "../../core/semester-calc.js";
import { semesterOfSubject, needsParcours } from "../../core/curriculum.js";
import { validateGradeInput } from "../../core/validation.js";
import { formatInputNumber } from "../../core/numbers.js";
import { render, on, formValues, showFieldErrors } from "../dom.js";
import { attachPopover, closePopover } from "../popover.js";
import { openModal, confirmDialog } from "../modal.js";
import { averageBadge, ueCard, ueDetailContent, subjectOptions, INPUT_CLASS, LABEL_CLASS, CARD_CLASS } from "../components.js";
import { academicState, semesterSwitcher, wireSemesterSwitcher, parcoursNotice, parcoursLabel } from "../semester.js";

export function gradeFormFields(prefix, values = {}, academic = { semester: 1, parcours: null }) {
    return html`<div class="md:col-span-2">
            <label for="${prefix}-name" class="${raw(LABEL_CLASS)}">Nom de l'évaluation</label>
            <input type="text" id="${prefix}-name" name="name" maxlength="120" autocomplete="off" placeholder="ex: DS1, Contrôle TP, Livrable 1" value="${values.name || ""}" class="${raw(INPUT_CLASS)}">
            <p data-error-for="name" class="text-xs text-rose-400 mt-1" hidden></p>
        </div>
        <div>
            <label for="${prefix}-subject" class="${raw(LABEL_CLASS)}">Matière / SAÉ</label>
            <select id="${prefix}-subject" name="subjectCode" class="${raw(INPUT_CLASS)}">${subjectOptions(values.subjectCode || null, academic)}</select>
            <p data-error-for="subjectCode" class="text-xs text-rose-400 mt-1" hidden></p>
        </div>
        <div class="grid grid-cols-3 gap-2">
            <div>
                <label for="${prefix}-score" class="${raw(LABEL_CLASS)}">Note</label>
                <input type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" id="${prefix}-score" name="score" placeholder="14,5" value="${values.score ?? ""}" class="${raw(INPUT_CLASS)}">
            </div>
            <div>
                <label for="${prefix}-max" class="${raw(LABEL_CLASS)}">Sur</label>
                <input type="text" inputmode="decimal" autocomplete="off" id="${prefix}-max" name="max" value="${values.max ?? "20"}" class="${raw(INPUT_CLASS)}">
            </div>
            <div>
                <label for="${prefix}-coeff" class="${raw(LABEL_CLASS)}">Coeff.</label>
                <input type="text" inputmode="decimal" autocomplete="off" id="${prefix}-coeff" name="coeff" value="${values.coeff ?? "1"}" class="${raw(INPUT_CLASS)}">
            </div>
            <p data-error-for="score" class="col-span-3 text-xs text-rose-400" hidden></p>
            <p data-error-for="max" class="col-span-3 text-xs text-rose-400" hidden></p>
            <p data-error-for="coeff" class="col-span-3 text-xs text-rose-400" hidden></p>
        </div>`;
}

export function createNotesPage(ctx) {
    const openSubjects = new Set();
    let el = null;
    let lastData = null;
    let shownKey = null; // semestre/parcours du squelette affiché

    function rangeLabel(list) {
        return list.length ? (list.length === 1 ? list[0].code : `${list[0].code} à ${list[list.length - 1].code}`) : "";
    }

    function lastSubjectFor(academic) {
        const last = ctx.repo().getSetting("lastSubject", null);
        return last && semesterOfSubject(last) === academic.semester ? last : null;
    }

    function skeleton(academic, data) {
        const ressources = data.subjects.filter((x) => x.kind === "ressource");
        return html`<div class="space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div data-notes-switcher>${semesterSwitcher(ctx.repo(), { id: "notes-semester" })}</div>
                <a href="#/bilan" class="text-xs text-brand-400 hover:text-brand-100 min-h-[44px] inline-flex items-center"><i class="fa-solid fa-chart-line mr-1" aria-hidden="true"></i> Tableau de bord</a>
            </div>
            ${!data.available ? parcoursNotice(academic.semester) : ""}
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="${raw(CARD_CLASS)} relative overflow-hidden flex flex-col justify-between">
                    <div class="absolute -right-6 -top-6 w-32 h-32 bg-brand-600/10 rounded-full blur-2xl pointer-events-none"></div>
                    <div>
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">Moyenne Générale</span>
                            <span id="sem-badge" class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-500/10 text-brand-400 border border-brand-500/20">Semestre ${academic.semester}${needsParcours(academic.semester) && academic.parcours ? ` · ${parcoursLabel(academic.parcours)}` : ""}</span>
                        </div>
                        <div class="flex items-baseline space-x-3 my-2">
                            <span id="overall-average" class="text-5xl sm:text-6xl font-extrabold text-white tracking-tight">--</span>
                            <span class="text-xl font-medium text-slate-400">/ 20</span>
                        </div>
                        <div class="mt-3">
                            <span class="text-xs text-slate-400 block mb-1">Obtention du semestre :</span>
                            <div id="status-badge" class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">Non calculé</div>
                        </div>
                    </div>
                    <div class="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                        <span id="total-evals-count">0 évaluation(s)</span>
                    </div>
                </div>
                <div class="lg:col-span-2 ${raw(CARD_CLASS)} flex flex-col">
                    <div class="flex items-center justify-between mb-4 gap-2">
                        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                            <i class="fa-solid fa-chart-pie text-brand-500" aria-hidden="true"></i> Moyennes des Unités d'Enseignement (UE)
                        </h2>
                    </div>
                    <div id="ue-averages-grid" class="grid grid-cols-2 sm:grid-cols-3 gap-3"></div>${!data.available ? html`<p class="text-xs text-slate-500">UE affichées dès que le parcours est choisi.</p>` : ""}
                    <p class="text-[11px] text-slate-500 mt-3"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i> Survolez ou touchez une UE pour voir le détail du calcul.</p>
                </div>
            </div>

            <div class="${raw(CARD_CLASS)} h-fit">
                <h3 class="text-base font-semibold text-white mb-4 flex items-center gap-2">
                    <i class="fa-solid fa-plus-circle text-brand-500" aria-hidden="true"></i> Ajouter une évaluation
                </h3>
                <form id="add-grade-form" novalidate class="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
                    ${gradeFormFields("grade", { subjectCode: lastSubjectFor(academic) }, academic)}
                    <div class="md:pt-5">
                        <button type="submit" class="w-full bg-brand-600 hover:bg-brand-500 text-white font-medium py-2 min-h-[44px] rounded-lg text-sm transition shadow-lg shadow-brand-600/20 flex items-center justify-center gap-2">
                            <i class="fa-solid fa-plus" aria-hidden="true"></i> Ajouter
                        </button>
                    </div>
                </form>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="${raw(CARD_CLASS)} space-y-4">
                    <h3 class="text-base font-semibold text-white flex items-center gap-2">
                        <i class="fa-solid fa-book-bookmark text-brand-500" aria-hidden="true"></i> Ressources (${rangeLabel(ressources)})
                    </h3>
                    <div id="ressources-accordion-container" class="space-y-3"></div>
                </div>
                <div class="${raw(CARD_CLASS)} space-y-4">
                    <h3 class="text-base font-semibold text-white flex items-center gap-2">
                        <i class="fa-solid fa-diagram-project text-brand-500" aria-hidden="true"></i> ${academic.semester === 1 ? "Situations d'Apprentissage et d'Évaluation (SAÉ 1.01 à 1.06)" : `SAÉ, stage et portfolio (S${academic.semester})`}
                    </h3>
                    <div id="saes-list-container" class="space-y-3"></div>
                </div>
            </div>
        </div>`;
    }

    function gradeRow(g, compact) {
        const scoreColor = normalizedScore(g) >= 10 ? "text-emerald-400" : "text-rose-400";
        const actions = html`<button type="button" data-action="edit-grade" data-id="${g.id}" class="w-11 h-11 -my-2 flex items-center justify-center hover:text-brand-400 text-slate-500 transition rounded-lg" title="Modifier" aria-label="Modifier ${g.name}">
                <i class="fa-solid fa-pen" aria-hidden="true"></i>
            </button>
            <button type="button" data-action="delete-grade" data-id="${g.id}" class="w-11 h-11 -my-2 flex items-center justify-center hover:text-red-400 text-slate-500 transition rounded-lg" title="Supprimer" aria-label="Supprimer ${g.name}">
                <i class="fa-solid fa-trash" aria-hidden="true"></i>
            </button>`;
        if (compact) {
            return html`<div class="flex items-center justify-between text-xs gap-2">
                <span class="text-slate-400 min-w-0 break-words">${g.name} (Coeff ${g.coeff})</span>
                <div class="flex items-center space-x-1 shrink-0">
                    <span class="font-bold font-mono ${raw(scoreColor)}">${g.score}/${g.max}</span>${actions}
                </div>
            </div>`;
        }
        return html`<div class="p-3 flex items-center justify-between text-xs hover:bg-slate-900/50 transition gap-2">
            <div class="min-w-0">
                <span class="font-medium text-slate-200 block break-words">${g.name}</span>
                <span class="text-[10px] text-slate-400">Coeff: ${g.coeff}</span>
            </div>
            <div class="flex items-center space-x-1 shrink-0">
                <span class="font-bold font-mono ${raw(scoreColor)}">${g.score} / ${g.max}</span>${actions}
            </div>
        </div>`;
    }

    function renderDynamic() {
        if (!el) return;
        const allGrades = ctx.repo().grades();
        const academic = academicState(ctx.repo());
        const data = computeSemester(allGrades, academic.semester, academic.parcours);
        const grades = allGrades.filter((g) => semesterOfSubject(g.subjectCode) === academic.semester);
        lastData = data;
        closePopover();
        const key = `${academic.semester}|${academic.parcours}`;
        if (key !== shownKey || !el.querySelector("#add-grade-form")) {
            // Changement de semestre : nouveau squelette (la saisie en cours est conservée)
            const form = el.querySelector("#add-grade-form");
            const draft = form ? { name: form.elements.name.value, score: form.elements.score.value, max: form.elements.max.value, coeff: form.elements.coeff.value } : null;
            const focused = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
            const focusSemester = focused && focused.dataset ? focused.dataset.semester : null;
            render(el, skeleton(academic, data));
            shownKey = key;
            if (draft) {
                const f = el.querySelector("#add-grade-form");
                for (const [k, v] of Object.entries(draft)) f.elements[k].value = v;
            }
            if (focusSemester) {
                const target = el.querySelector(`[data-action=set-semester][data-semester="${academic.semester}"]`);
                if (target) target.focus({ preventScroll: true });
            }
        } else {
            const slot = el.querySelector("[data-notes-switcher]");
            if (slot && !slot.contains(document.activeElement)) render(slot, semesterSwitcher(ctx.repo(), { id: "notes-semester" }));
        }

        const avgDisplay = el.querySelector("#overall-average");
        if (data.globalAverage !== null) {
            avgDisplay.textContent = data.globalAverage.toFixed(2);
            avgDisplay.className = data.globalAverage >= 10 ? "text-5xl sm:text-6xl font-extrabold text-emerald-400 tracking-tight" : "text-5xl sm:text-6xl font-extrabold text-rose-400 tracking-tight";
        } else {
            avgDisplay.textContent = "--";
            avgDisplay.className = "text-5xl sm:text-6xl font-extrabold text-white tracking-tight";
        }
        const statusBadge = el.querySelector("#status-badge");
        statusBadge.textContent = data.status;
        statusBadge.className = `inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${data.statusClass}`;
        el.querySelector("#total-evals-count").textContent = `${data.totalEvals} évaluation(s) saisie(s)`;

        const ueGrid = el.querySelector("#ue-averages-grid");
        render(ueGrid, html`${data.ues.map((ue) => ueCard(ue, data.ueAverages[ue.code]))}`);
        for (const btn of ueGrid.querySelectorAll("[data-ue]")) {
            attachPopover(btn, () => ueDetailContent(lastData, btn.dataset.ue));
        }

        const byCode = new Map();
        for (const g of grades) {
            if (!byCode.has(g.subjectCode)) byCode.set(g.subjectCode, []);
            byCode.get(g.subjectCode).push(g);
        }

        render(
            el.querySelector("#ressources-accordion-container"),
            html`${data.subjects.filter((x) => x.kind === "ressource").map((res) => {
                const list = byCode.get(res.code) || [];
                return html`<details data-subject="${res.code}" class="bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden group" ${raw(openSubjects.has(res.code) ? "open" : "")}>
                    <summary class="p-3.5 min-h-[44px] flex items-center justify-between cursor-pointer select-none bg-slate-900/80 hover:bg-slate-800/60 transition gap-2">
                        <div class="flex items-center space-x-2 min-w-0">
                            <i class="fa-solid fa-chevron-right text-xs text-slate-500 transition-transform duration-200 group-open:rotate-90" aria-hidden="true"></i>
                            <span class="text-xs font-bold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded shrink-0">${res.code}</span>
                            <span class="text-xs font-medium text-slate-200">${res.name}</span>
                        </div>
                        ${averageBadge(data.subjectAverages[res.code], { suffix: " / 20", empty: "Sans note" })}
                    </summary>
                    <div class="bg-slate-950 border-t border-slate-800">
                        ${list.length === 0 ? html`<p class="text-xs text-slate-500 italic p-3 text-center">Aucune évaluation enregistrée.</p>` : html`<div class="divide-y divide-slate-800/60">${list.map((g) => gradeRow(g, false))}</div>`}
                    </div>
                </details>`;
            })}`
        );

        render(
            el.querySelector("#saes-list-container"),
            html`${data.subjects.filter((x) => x.kind !== "ressource").map((sae) => {
                const list = byCode.get(sae.code) || [];
                return html`<div data-subject="${sae.code}" class="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex flex-col space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center space-x-2 min-w-0">
                            <span class="text-xs font-bold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded shrink-0">${sae.code}</span>
                            <span class="text-xs font-medium text-slate-200">${sae.name}</span>
                        </div>
                        ${averageBadge(data.subjectAverages[sae.code], { suffix: " / 20", empty: "N/A" })}
                    </div>
                    ${list.length > 0 ? html`<div class="mt-2 pt-2 border-t border-slate-800/80 space-y-1.5">${list.map((g) => gradeRow(g, true))}</div>` : ""}
                </div>`;
            })}`
        );

        // Notes rattachées à un code inconnu (import) : conservées et visibles, ignorées dans les moyennes (comme avant)
        const unknown = allGrades.filter((g) => !isKnownSubject(g.subjectCode));
        let unknownBox = el.querySelector("#unknown-subject-grades");
        if (unknown.length) {
            if (!unknownBox) {
                unknownBox = document.createElement("div");
                unknownBox.id = "unknown-subject-grades";
                unknownBox.className = `${CARD_CLASS} space-y-2`;
                el.firstElementChild.appendChild(unknownBox);
            }
            render(unknownBox, html`<h3 class="text-sm font-semibold text-amber-300"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> Notes rattachées à une matière inconnue (non comptées)</h3>${unknown.map((g) => gradeRow(g, true))}`);
        } else if (unknownBox) unknownBox.remove();
    }

    function openEdit(id) {
        const g = ctx.repo().grades().find((x) => x.id === id);
        if (!g) return;
        openModal({
            title: "Modifier l'évaluation",
            body: html`<form id="edit-grade-form" novalidate class="space-y-4">
                <div class="space-y-4">${gradeFormFields("edit-grade", { ...g, score: formatInputNumber(g.score), max: formatInputNumber(g.max), coeff: formatInputNumber(g.coeff) }, academicState(ctx.repo()))}</div>
                <div class="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                    <button type="button" data-modal-close class="px-4 py-2 min-h-[44px] rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition">Annuler</button>
                    <button type="submit" class="px-4 py-2 min-h-[44px] rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white transition shadow-md shadow-brand-600/20">Enregistrer</button>
                </div>
            </form>`,
            onMount(panel, close) {
                const form = panel.querySelector("form");
                form.addEventListener("submit", (event) => {
                    event.preventDefault();
                    const v = validateGradeInput(formValues(form));
                    if (!v.ok) return showFieldErrors(form, v.errors);
                    try {
                        ctx.repo().update(id, v.value);
                        close(true);
                        ctx.toast("Modification enregistrée.");
                    } catch (e) {
                        ctx.toast(e.message, "error");
                        close(false);
                    }
                });
            }
        });
    }

    async function remove(id) {
        const g = ctx.repo().grades().find((x) => x.id === id);
        if (!g) return;
        const ok = await confirmDialog({ title: "Supprimer l'évaluation", message: `Supprimer « ${g.name} » (${g.score}/${g.max}) ? La suppression sera synchronisée sur vos appareils.`, confirmLabel: "Supprimer", danger: true, icon: "fa-trash" });
        if (!ok) return;
        ctx.repo().remove(id);
        ctx.toast("Évaluation supprimée.", "success", {
            action: {
                label: "Annuler",
                onClick: () => {
                    const { id: _id, ...data } = g;
                    ctx.repo().create("grades", data, { id });
                    ctx.toast("Suppression annulée.");
                }
            }
        });
    }

    return {
        id: "notes",
        mount(container) {
            el = container;
            wireSemesterSwitcher(el, ctx.repo());
            on(el, "submit", "#add-grade-form", (event, form) => {
                event.preventDefault();
                const v = validateGradeInput(formValues(form));
                if (!v.ok) {
                    showFieldErrors(form, v.errors);
                    ctx.toast("Veuillez remplir correctement tous les champs.", "error");
                    return;
                }
                showFieldErrors(form, {});
                ctx.repo().create("grades", { ...v.value, createdAt: Date.now() });
                ctx.repo().setSetting("lastSubject", v.value.subjectCode);
                form.elements.name.value = "";
                form.elements.score.value = "";
                form.elements.max.value = "20";
                form.elements.coeff.value = "1";
                ctx.toast("Note ajoutée avec succès !");
            });
            on(el, "click", "[data-action=edit-grade]", (e, btn) => openEdit(btn.dataset.id));
            on(el, "click", "[data-action=delete-grade]", (e, btn) => remove(btn.dataset.id));
            on(el, "toggle", "details[data-subject]", (e, d) => (d.open ? openSubjects.add(d.dataset.subject) : openSubjects.delete(d.dataset.subject)), true);
            renderDynamic();
        },
        render: renderDynamic,
        onShow() {
            const sel = el && el.querySelector("#grade-subject");
            const last = lastSubjectFor(academicState(ctx.repo()));
            if (sel && last && document.activeElement !== sel) sel.value = last;
        },
        onHide() {
            closePopover();
        }
    };
}
