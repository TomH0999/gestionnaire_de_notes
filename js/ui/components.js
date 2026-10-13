/** Fragments d'interface partagés (mêmes classes que la version d'origine). */
import { html, raw } from "../core/escape.js";
import { PROGRAM_S1, subjectName } from "../core/program.js";
import { computeUeBreakdown, formatAverage } from "../core/grades-calc.js";
import { formatNumber } from "../core/numbers.js";
import { importanceLevel, homeworkType, STATES, IMPORTANCE_LEVELS } from "../core/homework.js";

export const INPUT_CLASS =
    "w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 min-h-[44px] text-base sm:text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent aria-[invalid=true]:border-rose-500";
export const LABEL_CLASS = "block text-xs font-medium text-slate-400 mb-1";
export const CARD_CLASS = "bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl";
export const PRIMARY_BTN = "bg-brand-600 hover:bg-brand-500 text-white font-medium px-4 py-2 min-h-[44px] rounded-lg text-sm transition shadow-lg shadow-brand-600/20 flex items-center justify-center gap-2";
export const SECONDARY_BTN = "px-3 py-2 min-h-[44px] text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition border border-slate-700 flex items-center justify-center gap-2";

export function averageBadge(avg, { suffix = "", empty = "--" } = {}) {
    if (avg === null || avg === undefined) return html`<span class="text-xs text-slate-500 font-mono">${empty}</span>`;
    const colorClass = avg >= 10 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-rose-400 bg-rose-500/10 border-rose-500/20";
    return html`<span class="text-xs font-bold font-mono px-2 py-0.5 rounded border ${raw(colorClass)}">${formatAverage(avg)}${suffix}</span>`;
}

/** Options « Matière / SAÉ » groupées (mêmes libellés que l'origine). */
export function subjectOptions(selected = null, { allowNone = false, noneLabel = "Aucune matière" } = {}) {
    return html`${allowNone ? html`<option value="" ${raw(!selected ? "selected" : "")}>${noneLabel}</option>` : ""}
        <optgroup label="Ressources (Matières)">${PROGRAM_S1.ressources.map(
            (r) => html`<option value="${r.code}" ${raw(r.code === selected ? "selected" : "")}>${r.code} - ${r.name}</option>`
        )}</optgroup>
        <optgroup label="SAÉ">${PROGRAM_S1.saes.map((s) => html`<option value="${s.code}" ${raw(s.code === selected ? "selected" : "")}>${s.code} - ${s.name}</option>`)}</optgroup>`;
}

/** Carte d'UE cliquable (bouton) avec infobulle de détail. */
export function ueCard(ue, avg, { compact = false } = {}) {
    return html`<button type="button" data-ue="${ue.code}" aria-controls="ue-detail-${ue.code.replace(/\W/g, "")}"
        class="ue-card text-left bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between min-h-[64px] hover:border-brand-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition">
        <span class="flex items-center justify-between mb-1 w-full gap-2">
            <span class="text-xs font-semibold text-brand-400 flex items-center gap-1">${ue.code}<i class="fa-solid fa-circle-info text-[10px] text-slate-500" aria-hidden="true"></i></span>
            <span data-ue-value>${averageBadge(avg)}</span>
        </span>
        ${compact ? "" : html`<span class="text-[11px] text-slate-400 line-clamp-2">${ue.name}</span>`}
        <span class="sr-only">Afficher le détail du calcul</span>
    </button>`;
}

/**
 * Contenu de l'infobulle : ressources et SAÉ de l'UE avec moyenne, coefficient et produit,
 * puis sommes, formule et résultat (même valeur, même arrondi que la carte).
 */
export function ueDetailContent(subjectAverages, ueCode) {
    const b = computeUeBreakdown(subjectAverages, ueCode);
    if (!b) return html``;
    const missing = b.rows.filter((r) => !r.counted);
    const result = formatAverage(b.result);
    return html`<div class="text-xs text-slate-300">
        <p class="font-semibold text-white text-sm">${b.ueCode} — ${b.ueName}</p>
        <table class="w-full mt-2 border-collapse">
            <thead><tr class="text-[10px] uppercase tracking-wider text-slate-500">
                <th scope="col" class="text-left font-semibold py-1 pr-2">Ressource / SAÉ</th>
                <th scope="col" class="text-right font-semibold py-1 px-1">Moy.</th>
                <th scope="col" class="text-right font-semibold py-1 px-1">Coeff.</th>
                <th scope="col" class="text-right font-semibold py-1 pl-1">Produit</th>
            </tr></thead>
            <tbody>${b.rows.map(
                (r) => html`<tr class="border-t border-slate-800 ${raw(r.counted ? "" : "text-slate-500")}">
                    <td class="py-1 pr-2"><span class="font-semibold ${raw(r.counted ? "text-brand-400" : "")}">${r.code}</span> <span class="hidden sm:inline">${r.name}</span></td>
                    <td class="py-1 px-1 text-right font-mono">${r.counted ? formatAverage(r.average) : "sans note"}</td>
                    <td class="py-1 px-1 text-right font-mono">${r.coeff}</td>
                    <td class="py-1 pl-1 text-right font-mono">${r.counted ? formatNumber(r.product) : "—"}</td>
                </tr>`
            )}</tbody>
        </table>
        ${
            b.result === null
                ? html`<p class="mt-2 text-slate-400">Aucune note dans cette UE pour l'instant : moyenne non calculée.</p>`
                : html`<div class="mt-2 pt-2 border-t border-slate-700 space-y-0.5 font-mono">
                      <p>Σ produits = <span class="text-slate-100">${formatNumber(b.weightedSum)}</span></p>
                      <p>Σ coefficients = <span class="text-slate-100">${b.totalCoeffs}</span>${b.totalCoeffs !== b.totalProgramCoeffs ? html` <span class="text-slate-500">(sur ${b.totalProgramCoeffs})</span>` : ""}</p>
                      <p class="pt-1">Moyenne = Σ produits ÷ Σ coeff. = ${formatNumber(b.weightedSum)} ÷ ${b.totalCoeffs} = <strong class="text-white text-sm" data-ue-detail-result>${result}</strong></p>
                  </div>`
        }
        ${
            missing.length && b.result !== null
                ? html`<p class="mt-2 text-[11px] text-slate-400"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Matières sans note (${missing.map((m) => m.code).join(", ")}) : ignorées, exclues du numérateur et du dénominateur (règle actuelle).</p>`
                : ""
        }
    </div>`;
}

export function importanceChip(value, { short = false } = {}) {
    const lvl = importanceLevel(value);
    return html`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${raw(lvl.chip)}" title="Importance : ${lvl.label}">
        <i class="fa-solid ${raw(lvl.icon)}" aria-hidden="true"></i><span class="${raw(short ? "sr-only" : "")}">${lvl.label}</span>
    </span>`;
}

export function stateChip(state) {
    const s = STATES[state] || STATES.upcoming;
    return html`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${raw(s.chip)}"><i class="fa-solid ${raw(s.icon)}" aria-hidden="true"></i>${s.label}</span>`;
}

export function typeLabel(typeId) {
    const t = homeworkType(typeId);
    return html`<span class="inline-flex items-center gap-1 text-[11px] text-slate-400"><i class="fa-solid ${raw(t.icon)}" aria-hidden="true"></i>${t.label}</span>`;
}

export function subjectLabel(code) {
    if (!code) return html`<span class="text-[11px] text-slate-500">Sans matière</span>`;
    return html`<span class="text-[11px] font-bold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded" title="${subjectName(code) || code}">${code}</span>`;
}

export function importanceRadios(selected, name = "importance") {
    return html`<div class="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Importance">${Object.entries(IMPORTANCE_LEVELS).map(
        ([value, lvl]) => html`<label class="importance-option flex items-center justify-center gap-1.5 min-h-[44px] px-2 rounded-lg border border-slate-800 bg-slate-950 cursor-pointer text-xs font-semibold ${raw(lvl.text)} has-[:checked]:ring-2 has-[:checked]:ring-brand-500 has-[:checked]:border-transparent">
            <input type="radio" name="${name}" value="${value}" class="sr-only" ${raw(String(selected) === value ? "checked" : "")}>
            <i class="fa-solid ${raw(lvl.icon)}" aria-hidden="true"></i>${lvl.label}
        </label>`
    )}</div>`;
}

export function emptyState(icon, text, action = "") {
    return html`<div class="text-center py-6 px-3 text-slate-500">
        <i class="fa-solid ${raw(icon)} text-2xl mb-2 text-slate-600" aria-hidden="true"></i>
        <p class="text-sm">${text}</p>${action}
    </div>`;
}
