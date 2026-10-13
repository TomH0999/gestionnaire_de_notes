/**
 * Logique des devoirs, SAÉ, tests et contrôles : valeurs par défaut, états calculés,
 * date de début conseillée et tri par urgence.
 *
 * Une entrée (collection "homework") :
 *   { title, type, subjectCode|null, dueDate "AAAA-MM-JJ", dueTime "HH:MM" (heure de Paris),
 *     importance 1..4, anticipationDays (0, 2, 7, 14, 30), notes, status, doneAt, createdAt }
 */
import { addDays, diffDays, parisInstant, parisStartOfDay, DAY_MS } from "./dates.js";

export const HOMEWORK_TYPES = [
    { id: "devoir", label: "Devoir", icon: "fa-pen-to-square", defaults: { importance: 2, anticipationDays: 2, dueTime: "23:59" } },
    { id: "sae", label: "SAÉ", icon: "fa-diagram-project", defaults: { importance: 3, anticipationDays: 14, dueTime: "23:59" } },
    { id: "test", label: "Test", icon: "fa-clipboard-question", defaults: { importance: 3, anticipationDays: 2, dueTime: "08:00" } },
    { id: "controle", label: "Gros contrôle", icon: "fa-file-signature", defaults: { importance: 4, anticipationDays: 7, dueTime: "08:00" } },
    { id: "autre", label: "Autre", icon: "fa-thumbtack", defaults: { importance: 2, anticipationDays: 0, dueTime: "23:59" } }
];

const TYPE_BY_ID = new Map(HOMEWORK_TYPES.map((t) => [t.id, t]));

export function homeworkType(id) {
    return TYPE_BY_ID.get(id) || TYPE_BY_ID.get("autre");
}

/**
 * Importance : couleur ET icône ET libellé (jamais la couleur seule).
 * Les classes Tailwind sont écrites en entier pour être conservées à la compilation.
 */
export const IMPORTANCE_LEVELS = {
    1: { label: "Faible", icon: "fa-angle-down", text: "text-slate-300", chip: "bg-slate-500/15 text-slate-300 border-slate-500/30", bar: "bg-slate-400", dot: "bg-slate-400", border: "border-l-slate-400" },
    2: { label: "Normale", icon: "fa-equals", text: "text-sky-300", chip: "bg-sky-500/15 text-sky-300 border-sky-500/30", bar: "bg-sky-400", dot: "bg-sky-400", border: "border-l-sky-400" },
    3: { label: "Haute", icon: "fa-angle-up", text: "text-amber-300", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30", bar: "bg-amber-400", dot: "bg-amber-400", border: "border-l-amber-400" },
    4: { label: "Critique", icon: "fa-angles-up", text: "text-rose-300", chip: "bg-rose-500/15 text-rose-300 border-rose-500/30", bar: "bg-rose-400", dot: "bg-rose-400", border: "border-l-rose-400" }
};

export function importanceLevel(value) {
    return IMPORTANCE_LEVELS[value] || IMPORTANCE_LEVELS[2];
}

export const ANTICIPATION_OPTIONS = [
    { days: 0, label: "Aucune" },
    { days: 2, label: "1-2 jours" },
    { days: 7, label: "1 semaine" },
    { days: 14, label: "2 semaines" },
    { days: 30, label: "1 mois" }
];

export function anticipationLabel(days) {
    const opt = ANTICIPATION_OPTIONS.find((o) => o.days === days);
    if (opt) return opt.label;
    return days === 1 ? "1 jour" : `${days} jours`;
}

export const STATUSES = [
    { id: "todo", label: "À faire" },
    { id: "in_progress", label: "En cours" },
    { id: "done", label: "Fait" }
];

export function statusLabel(id) {
    const s = STATUSES.find((x) => x.id === id);
    return s ? s.label : "À faire";
}

/** États calculés (en plus du statut saisi). */
export const STATES = {
    upcoming: { label: "À venir", icon: "fa-hourglass-start", chip: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
    "start-now": { label: "À commencer maintenant", icon: "fa-person-running", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    overdue: { label: "En retard", icon: "fa-circle-exclamation", chip: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
    done: { label: "Fait", icon: "fa-circle-check", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" }
};

/** Valeurs par défaut pour une saisie rapide d'un type donné. */
export function defaultsForType(typeId) {
    const t = homeworkType(typeId);
    return { type: t.id, ...t.defaults };
}

export function dueInstant(hw) {
    return parisInstant(hw.dueDate, hw.dueTime || "23:59");
}

/** Date de début conseillée = échéance − anticipation (date calendaire). */
export function suggestedStartKey(hw) {
    return addDays(hw.dueDate, -(Number(hw.anticipationDays) || 0));
}

/** Début conseillé : minuit (Paris) du jour de début conseillé. */
export function suggestedStartInstant(hw) {
    return parisStartOfDay(suggestedStartKey(hw));
}

/**
 * État calculé :
 *  - "done"      : statut « fait » ;
 *  - "overdue"   : échéance dépassée et pas fait ;
 *  - "start-now" : date de début conseillée atteinte (même si elle tombe dans le passé dès la création) ;
 *  - "upcoming"  : début conseillé pas encore atteint.
 */
export function computeState(hw, now) {
    if (hw.status === "done") return "done";
    if (now > dueInstant(hw)) return "overdue";
    if (now >= suggestedStartInstant(hw)) return "start-now";
    return "upcoming";
}

/**
 * Score d'urgence (plus grand = plus urgent) :
 *
 *   urgence   = importance × (1 + proximité) + (100 si en retard)
 *   proximité = 14 − joursAvantDébut, bornée à [0, 28]
 *               (joursAvantDébut < 0 quand la date de début conseillée est passée)
 *
 * Lecture : un élément dont le début conseillé est dans 14 jours ou plus a une proximité
 * nulle (seule l'importance compte) ; plus le début conseillé approche puis se dépasse,
 * plus l'importance est amplifiée. Les éléments en retard passent toujours devant.
 * Les éléments faits ont un score de −∞. Égalité : échéance la plus proche, puis titre.
 */
export function urgencyScore(hw, now) {
    const state = computeState(hw, now);
    if (state === "done") return -Infinity;
    const importance = Math.min(4, Math.max(1, Number(hw.importance) || 2));
    const daysUntilStart = (suggestedStartInstant(hw) - now) / DAY_MS;
    const proximity = Math.min(28, Math.max(0, 14 - daysUntilStart));
    return importance * (1 + proximity) + (state === "overdue" ? 100 : 0);
}

export function compareByUrgency(a, b, now) {
    const sa = urgencyScore(a, now);
    const sb = urgencyScore(b, now);
    if (sa !== sb) return sb - sa;
    const da = dueInstant(a);
    const db = dueInstant(b);
    if (da !== db) return da - db;
    return String(a.title).localeCompare(String(b.title), "fr");
}

export function sortByUrgency(items, now) {
    return [...items].sort((a, b) => compareByUrgency(a, b, now));
}

export function compareByDue(a, b) {
    const da = dueInstant(a);
    const db = dueInstant(b);
    if (da !== db) return da - db;
    return String(a.title).localeCompare(String(b.title), "fr");
}

/**
 * « À faire maintenant » (page d'accueil) : pas fait ET (début conseillé atteint
 * OU échéance dans les 7 prochains jours), trié par urgence.
 */
export function selectDoNow(items, now, horizonDays = 7) {
    const horizon = now + horizonDays * DAY_MS;
    return sortByUrgency(
        items.filter((hw) => {
            const state = computeState(hw, now);
            if (state === "done") return false;
            if (state === "overdue" || state === "start-now") return true;
            return dueInstant(hw) <= horizon;
        }),
        now
    );
}

/** Jours couverts par la période d'anticipation (début conseillé → échéance), bornés. */
export function anticipationSpan(hw) {
    const start = suggestedStartKey(hw);
    const length = diffDays(hw.dueDate, start);
    return { start, end: hw.dueDate, length };
}
