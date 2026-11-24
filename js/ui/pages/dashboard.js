/**
 * Tableau de bord : notes et statistiques par semestre, puis sur toute la scolarité.
 *  1. chiffres clés (moyenne globale, semestres notés, UE à 10 ou plus, évaluations) ;
 *  2. évolution de la moyenne générale de S1 à S6 (barres, seuil de 10) ;
 *  3. moyenne par UE sur tous les semestres (UE 1 = UE 1.1, 2.1, 3.1…) ;
 *  4. meilleures et moins bonnes matières de toute la scolarité ;
 *  5. détail du semestre choisi (même sélecteur que les autres pages).
 */
import { html, raw } from "../../core/escape.js";
import { formatAverage } from "../../core/grades-calc.js";
import { formatNumber } from "../../core/numbers.js";
import { buildDashboard } from "../../core/semester-calc.js";
import { needsParcours, CURRICULUM_SOURCE } from "../../core/curriculum.js";
import { render } from "../dom.js";
import { closePopover } from "../popover.js";
import { averageBadge, emptyState, CARD_CLASS } from "../components.js";
import { academicState, semesterSwitcher, wireSemesterSwitcher, parcoursNotice, parcoursLabel } from "../semester.js";

const SECTION_TITLE = "text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2";

const tone = (v) => (v === null || v === undefined ? "text-white" : v >= 10 ? "text-emerald-400" : "text-rose-400");
const plural = (n, word, many = `${word}s`) => `${n} ${n > 1 ? many : word}`;

function statTile(label, value, sub = "", { valueClass = "text-white", testid = null } = {}) {
    return html`<div class="bg-slate-950/80 border border-slate-800 rounded-xl p-4 min-w-0">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">${label}</p>
        <p class="text-2xl font-extrabold tracking-tight mt-1 ${raw(valueClass)}" ${raw(testid ? `data-testid="${testid}"` : "")}>${value}</p>
        ${sub ? html`<p class="text-[11px] text-slate-400 mt-1">${sub}</p>` : ""}
    </div>`;
}

/** Barres verticales S1→S6 sur 0–20 avec repère à 10 ; valeur au survol / au toucher. */
function progressionChart(d) {
    const last = [...d.semesters].reverse().find((s) => s.globalAverage !== null);
    return html`<figure class="mt-2" aria-labelledby="dash-progress-title">
        <div class="relative h-48 border-b border-slate-700" role="img" aria-label="Moyenne générale de chaque semestre, sur 20">
            <div class="absolute inset-x-0 border-t border-dashed border-slate-600" style="bottom:50%" aria-hidden="true"></div>
            <span class="absolute right-0 text-[10px] text-slate-500 -translate-y-full pr-1" style="bottom:50%" aria-hidden="true">10</span>
            <div class="absolute inset-0 grid grid-cols-6 gap-2 sm:gap-4 items-end px-1">
                ${d.semesters.map((s) => {
                    const v = s.globalAverage;
                    const h = v === null ? 0 : Math.max(2, Math.min(100, (v / 20) * 100));
                    return html`<div class="dash-bar relative h-full flex items-end justify-center group" tabindex="0" data-semester-bar="${s.semester}"
                        aria-label="Semestre ${s.semester} : ${v === null ? "pas de moyenne" : `${formatAverage(v)} sur 20`}">
                        ${
                            v === null
                                ? html`<span class="text-[10px] text-slate-600 mb-1">—</span>`
                                : html`<span class="w-full max-w-[44px] rounded-t bg-brand-500 group-hover:bg-brand-400 group-focus:bg-brand-400 transition-colors" style="height:${h.toFixed(1)}%"></span>`
                        }
                        ${
                            v !== null
                                ? html`<span class="dash-tip absolute left-1/2 -translate-x-1/2 px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs font-mono text-white whitespace-nowrap shadow-lg ${raw(last && last.semester === s.semester ? "" : "opacity-0 group-hover:opacity-100 group-focus:opacity-100")}" style="bottom:calc(${h.toFixed(1)}% + 6px)">${formatAverage(v)}</span>`
                                : ""
                        }
                    </div>`;
                })}
            </div>
        </div>
        <div class="grid grid-cols-6 gap-2 sm:gap-4 px-1 mt-1 text-center text-xs font-semibold text-slate-400">${d.semesters.map((s) => html`<span>S${s.semester}</span>`)}</div>
        <figcaption class="text-[11px] text-slate-500 mt-2">Moyenne générale de chaque semestre (sur 20). Ligne pointillée : 10.</figcaption>
    </figure>`;
}

function competenceList(d) {
    return html`<ul class="space-y-3">${d.competences.map(
        (c) => html`<li>
            <div class="flex items-center justify-between gap-2 text-xs">
                <span class="text-slate-200 min-w-0"><span class="font-semibold text-brand-400">UE ${c.id}</span> ${c.name}</span>
                <span class="font-mono font-bold shrink-0 ${raw(tone(c.value))}" data-competence="${c.id}">${formatAverage(c.value)}</span>
            </div>
            <div class="mt-1 h-2 rounded-full bg-slate-800 overflow-hidden" aria-hidden="true">
                ${c.value === null ? "" : html`<div class="h-full rounded-full bg-brand-500" style="width:${Math.max(0, Math.min(100, (c.value / 20) * 100)).toFixed(1)}%"></div>`}
            </div>
            <p class="text-[10px] text-slate-500 mt-0.5">${c.count ? `${plural(c.count, "UE")} : ${c.ues.map((u) => `${u.code} ${formatAverage(u.value)}`).join(" · ")}` : "Aucune UE calculée"}</p>
        </li>`
    )}</ul>`;
}

function subjectRanking(list, empty) {
    if (!list.length) return html`<p class="text-xs text-slate-500">${empty}</p>`;
    return html`<ol class="space-y-1.5">${list.map(
        (s, i) => html`<li class="flex items-center justify-between gap-2 text-xs bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2">
            <span class="min-w-0"><span class="text-slate-500 font-mono mr-1">${i + 1}.</span><span class="font-semibold text-brand-400">${s.code}</span> <span class="text-slate-300">${s.name}</span> <span class="text-slate-500">· S${s.semester}</span></span>
            ${averageBadge(s.value)}
        </li>`
    )}</ol>`;
}

function semesterCard(s) {
    const row = (label, value) => html`<div class="flex items-center justify-between gap-2 py-1.5 border-t border-slate-800 text-xs"><span class="text-slate-400">${label}</span><span class="text-slate-100 text-right min-w-0">${value}</span></div>`;
    const ext = (e) => (e ? html`<span class="font-semibold text-brand-400">${e.code}</span> <span class="font-mono">${formatAverage(e.value)}</span>` : html`<span class="text-slate-500">—</span>`);
    return html`<div class="space-y-4">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            ${statTile("Moyenne générale", formatAverage(s.globalAverage), s.status, { valueClass: tone(s.globalAverage), testid: "semester-average" })}
            ${statTile("UE à 10 ou plus", `${s.uesAbove10} / ${s.ues.length || "—"}`, `${plural(s.uesRated, "UE calculée", "UE calculées")}`)}
            ${statTile("Évaluations", String(s.gradeCount), s.gradeCount ? `${s.gradesAbove10} à 10/20 ou plus` : "aucune saisie")}
            ${statTile("Moyenne des notes", formatAverage(s.gradeMean), "toutes évaluations confondues", { valueClass: tone(s.gradeMean) })}
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
                <p class="text-xs font-semibold text-slate-300 mb-1">Repères</p>
                ${row("Meilleure UE", ext(s.bestUe))}
                ${row("UE la plus faible", ext(s.worstUe))}
                ${row("Meilleure matière", ext(s.bestSubject))}
                ${row("Matière la plus faible", ext(s.worstSubject))}
                ${row("Meilleure note", s.bestGrade ? html`${s.bestGrade.name} <span class="text-slate-500">(${s.bestGrade.code})</span> <span class="font-mono">${formatNumber(s.bestGrade.score)}/${formatNumber(s.bestGrade.max)}</span>` : "—")}
                ${row("Note la plus basse", s.worstGrade ? html`${s.worstGrade.name} <span class="text-slate-500">(${s.worstGrade.code})</span> <span class="font-mono">${formatNumber(s.worstGrade.score)}/${formatNumber(s.worstGrade.max)}</span>` : "—")}
                ${row("Matières notées", `${s.subjectsRated} / ${s.subjectsTotal}`)}
            </div>
            <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
                <p class="text-xs font-semibold text-slate-300 mb-2">UE du semestre</p>
                ${
                    s.ues.length
                        ? html`<ul class="space-y-1">${s.ues.map(
                              (u) => html`<li class="flex items-center justify-between gap-2 text-xs"><span class="min-w-0"><span class="font-semibold text-brand-400">${u.code}</span> <span class="text-slate-400">${u.name}</span></span>${averageBadge(s.ueAverages[u.code])}</li>`
                          )}</ul>`
                        : html`<p class="text-xs text-slate-500">UE affichées dès que le parcours est choisi.</p>`
                }
            </div>
        </div>
        <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
            <p class="text-xs font-semibold text-slate-300 mb-2">Toutes les matières du semestre</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">${s.subjects.map(
                (x) => html`<div class="flex items-center justify-between gap-2 text-xs py-0.5"><span class="min-w-0 truncate"><span class="font-semibold text-brand-400">${x.code}</span> <span class="text-slate-400">${x.name}</span></span>${averageBadge(s.subjectAverages[x.code], { empty: "—" })}</div>`
            )}</div>
        </div>
    </div>`;
}

export function createDashboardPage(ctx) {
    let el = null;

    function renderAll() {
        if (!el) return;
        closePopover();
        const academic = academicState(ctx.repo());
        const grades = ctx.repo().grades();
        const d = buildDashboard(grades, academic.parcours);
        const current = d.semesters.find((s) => s.semester === academic.semester);
        const focused = document.activeElement && el.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.semester : null;
        render(
            el,
            html`<div class="space-y-6" data-dashboard>
                <section class="${raw(CARD_CLASS)}" aria-labelledby="dash-global-title">
                    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <h2 id="dash-global-title" class="${raw(SECTION_TITLE)}"><i class="fa-solid fa-chart-line text-brand-500" aria-hidden="true"></i> Toute la scolarité</h2>
                        <span class="text-xs text-slate-400">Parcours : <strong class="text-slate-200">${parcoursLabel(academic.parcours)}</strong></span>
                    </div>
                    ${
                        d.gradeCount === 0
                            ? emptyState("fa-chart-simple", "Aucune note saisie pour l'instant : le tableau de bord se remplit au fil de vos évaluations.", html`<a href="#/notes" class="inline-flex mt-2 text-xs text-brand-400 min-h-[44px] items-center">Ajouter une note</a>`)
                            : html`<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                  ${statTile("Moyenne globale", formatAverage(d.globalAverage), d.semestersRated ? `moyenne des ${plural(d.semestersRated, "semestre noté", "semestres notés")}` : "aucun semestre calculé", { valueClass: tone(d.globalAverage), testid: "global-average" })}
                                  ${statTile("Meilleur semestre", d.bestSemester ? `S${d.bestSemester.semester}` : "—", d.bestSemester ? `${formatAverage(d.bestSemester.value)} / 20` : "")}
                                  ${statTile("Semestre le plus faible", d.worstSemester ? `S${d.worstSemester.semester}` : "—", d.worstSemester ? `${formatAverage(d.worstSemester.value)} / 20` : "")}
                                  ${statTile("UE à 10 ou plus", `${d.uesAbove10} / ${d.uesRated}`, `${plural(d.gradeCount, "évaluation")} au total`)}
                              </div>
                              ${
                                  d.progression.length
                                      ? html`<p class="text-xs text-slate-400 mt-3">${d.progression.map(
                                            (p, i) => html`${i ? " · " : ""}S${p.from} → S${p.to} : <span class="font-mono ${raw(p.delta >= 0 ? "text-emerald-400" : "text-rose-400")}">${p.delta >= 0 ? "+" : "−"}${formatAverage(Math.abs(p.delta))}</span>`
                                        )}</p>`
                                      : ""
                              }`
                    }
                    ${d.missingParcours ? html`<div class="mt-4">${parcoursNotice(4)}</div>` : ""}
                </section>

                ${
                    d.gradeCount
                        ? html`<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                              <section class="${raw(CARD_CLASS)}" aria-labelledby="dash-progress-title">
                                  <h2 id="dash-progress-title" class="${raw(SECTION_TITLE)}"><i class="fa-solid fa-chart-column text-brand-500" aria-hidden="true"></i> Évolution par semestre</h2>
                                  ${progressionChart(d)}
                              </section>
                              <section class="${raw(CARD_CLASS)}" aria-labelledby="dash-comp-title">
                                  <h2 id="dash-comp-title" class="${raw(SECTION_TITLE)} mb-4"><i class="fa-solid fa-layer-group text-brand-500" aria-hidden="true"></i> Moyenne par UE (tous les semestres)</h2>
                                  ${competenceList(d)}
                              </section>
                          </div>
                          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                              <section class="${raw(CARD_CLASS)}" aria-labelledby="dash-top-title">
                                  <h2 id="dash-top-title" class="${raw(SECTION_TITLE)} mb-4"><i class="fa-solid fa-arrow-trend-up text-brand-500" aria-hidden="true"></i> Meilleures matières (tous semestres)</h2>
                                  ${subjectRanking(d.topSubjects, "Aucune matière notée.")}
                              </section>
                              <section class="${raw(CARD_CLASS)}" aria-labelledby="dash-bottom-title">
                                  <h2 id="dash-bottom-title" class="${raw(SECTION_TITLE)} mb-4"><i class="fa-solid fa-arrow-trend-down text-brand-500" aria-hidden="true"></i> Matières les plus faibles</h2>
                                  ${subjectRanking(d.bottomSubjects, d.topSubjects.length ? "Elles apparaîtront ici à partir de 6 matières notées (les 5 meilleures sont listées à côté)." : "Aucune matière notée.")}
                              </section>
                          </div>`
                        : ""
                }

                <section class="${raw(CARD_CLASS)}" aria-labelledby="dash-sem-title">
                    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <h2 id="dash-sem-title" class="${raw(SECTION_TITLE)}"><i class="fa-solid fa-calendar-check text-brand-500" aria-hidden="true"></i> Semestre ${academic.semester}</h2>
                        ${semesterSwitcher(ctx.repo(), { id: "dash-semester", showParcours: true })}
                    </div>
                    ${!current.available && needsParcours(current.semester) ? parcoursNotice(current.semester) : semesterCard(current)}
                </section>
                <p class="text-[11px] text-slate-500">Coefficients : ${CURRICULUM_SOURCE}. Moyenne globale = moyenne simple des moyennes de semestre ; moyenne d'une UE (tous semestres) = moyenne simple des UE de même numéro calculées (UE 1.1, 2.1, 3.1…).</p>
            </div>`
        );
        if (focused) {
            const t = el.querySelector(`[data-action=set-semester][data-semester="${academic.semester}"]`);
            if (t) t.focus({ preventScroll: true });
        }
    }

    return {
        id: "bilan",
        mount(container) {
            el = container;
            wireSemesterSwitcher(el, ctx.repo());
            renderAll();
        },
        render: renderAll,
        onHide() {
            closePopover();
        }
    };
}
