/**
 * Semestre affiché et parcours : réglages synchronisés entre appareils (« semester »,
 * « parcours »), et sélecteur réutilisé par l'accueil, les notes et le tableau de bord.
 *
 * Changer de semestre se fait en un toucher (S1 à S6), ou au clavier avec les flèches
 * gauche/droite sur le sélecteur. Le parcours n'est demandé qu'à partir du semestre 4.
 */
import { html, raw } from "../core/escape.js";
import { SEMESTERS, PARCOURS, isSemester, isParcours, needsParcours, semesterOfSubject, parcoursInfo } from "../core/curriculum.js";
import { defaultSemester } from "../core/semester-calc.js";
import { on } from "./dom.js";

/** { semester, parcours } courants (semestre par défaut : le dernier où des notes existent). */
export function academicState(repo) {
    const saved = Number(repo.getSetting("semester", null));
    const grades = repo.grades();
    const semester = isSemester(saved) ? saved : defaultSemester(grades);
    const p = repo.getSetting("parcours", null);
    return { semester, parcours: isParcours(p) ? p : null };
}

function semestersWithGrades(repo) {
    const set = new Set();
    for (const g of repo.grades()) {
        const s = semesterOfSubject(g.subjectCode);
        if (s) set.add(s);
    }
    return set;
}

/** Sélecteur : six boutons de semestre (+ choix du parcours quand il est utile). */
export function semesterSwitcher(repo, { id = "semester-switcher", showParcours = "auto" } = {}) {
    const { semester, parcours } = academicState(repo);
    const withGrades = semestersWithGrades(repo);
    const wantParcours = showParcours === true || (showParcours === "auto" && (needsParcours(semester) || parcours !== null));
    const missing = needsParcours(semester) && !parcours;
    return html`<div class="flex flex-wrap items-center gap-2" data-semester-switcher id="${id}">
        <div class="flex bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1" role="radiogroup" aria-label="Semestre affiché" data-semester-group>
            ${SEMESTERS.map((s) => {
                const active = s === semester;
                return html`<button type="button" role="radio" aria-checked="${active ? "true" : "false"}" tabindex="${active ? "0" : "-1"}" data-action="set-semester" data-semester="${s}"
                    title="Semestre ${s}${withGrades.has(s) ? " (notes saisies)" : ""}"
                    class="relative min-w-[44px] min-h-[44px] px-2 rounded-lg text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${raw(active ? "bg-brand-600 text-white shadow-md shadow-brand-600/30" : "text-slate-400 hover:text-white hover:bg-slate-800")}">
                    S${s}${withGrades.has(s) && !active ? html`<span class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true"></span>` : ""}
                </button>`;
            })}
        </div>
        ${
            wantParcours
                ? html`<label class="flex items-center gap-2 text-xs text-slate-400">
                      <span class="sr-only sm:not-sr-only">Parcours</span>
                      <select data-action="set-parcours" aria-label="Parcours" class="bg-slate-950 border ${raw(missing ? "border-amber-500/60" : "border-slate-800")} rounded-lg px-2 min-h-[44px] text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500">
                          <option value="" ${raw(parcours ? "" : "selected")}>Choisir…</option>
                          ${PARCOURS.map((p) => html`<option value="${p.id}" title="${p.name}" ${raw(p.id === parcours ? "selected" : "")}>${p.label}</option>`)}
                      </select>
                  </label>`
                : ""
        }
    </div>`;
}

/** Message quand le semestre affiché dépend d'un parcours non choisi. */
export function parcoursNotice(semester) {
    return html`<div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-200 flex items-start gap-3" data-parcours-notice role="status">
        <i class="fa-solid fa-route mt-0.5" aria-hidden="true"></i>
        <span>À partir du semestre 4, les UE et les coefficients dépendent de votre parcours. Choisissez-le dans le sélecteur ci-dessus pour calculer les moyennes du semestre ${semester}.
        ${PARCOURS.map((p) => html`<br><span class="text-amber-100/80 text-xs"><strong>${p.label}</strong> : ${p.name}</span>`)}</span>
    </div>`;
}

export function parcoursLabel(id) {
    const p = parcoursInfo(id);
    return p ? p.label : "Parcours non choisi";
}

/**
 * Branche le sélecteur sur un conteneur (délégation : fonctionne après chaque rendu).
 * Les choix sont enregistrés comme réglages synchronisés ; la page se redessine via le dépôt.
 */
export function wireSemesterSwitcher(root, repo) {
    const setSemester = (s) => {
        if (!isSemester(s)) return;
        if (Number(repo.getSetting("semester", null)) !== s) repo.setSetting("semester", s);
    };
    on(root, "click", "[data-action=set-semester]", (e, btn) => {
        setSemester(Number(btn.dataset.semester));
        // le bouton est redessiné : redonner le focus au nouveau bouton actif
        requestAnimationFrame(() => {
            const next = root.querySelector(`[data-action=set-semester][data-semester="${btn.dataset.semester}"]`);
            if (next && document.activeElement === document.body) next.focus({ preventScroll: true });
        });
    });
    on(root, "keydown", "[data-action=set-semester]", (e, btn) => {
        const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        const next = Math.min(6, Math.max(1, Number(btn.dataset.semester) + delta));
        setSemester(next);
        requestAnimationFrame(() => {
            const target = root.querySelector(`[data-action=set-semester][data-semester="${next}"]`);
            if (target) target.focus({ preventScroll: true });
        });
    });
    on(root, "change", "[data-action=set-parcours]", (e, select) => {
        const value = isParcours(select.value) ? select.value : null;
        if (repo.getSetting("parcours", null) !== value) repo.setSetting("parcours", value);
    });
}
