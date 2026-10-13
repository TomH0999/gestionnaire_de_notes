/**
 * Nombres saisis en français : « 12,5 » et « 12.5 » sont acceptés.
 * Refuse tout le reste (lettres, notation scientifique, séparateurs multiples...).
 */
const DECIMAL_RE = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

export function parseDecimal(input) {
    if (typeof input === "number") return Number.isFinite(input) ? input : NaN;
    if (typeof input !== "string") return NaN;
    // Espaces (y compris insécables : trim() les retire) tolérés autour du nombre,
    // jamais au milieu (« 1 5 » ne doit pas devenir 15)
    const s = input.trim();
    if (!DECIMAL_RE.test(s)) return NaN;
    return Number(s.replace(",", "."));
}

/** Valeur numérique pour pré-remplir un champ de saisie (virgule française). */
export function formatInputNumber(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    return String(value).replace(".", ",");
}

/** Affichage compact d'un nombre (produits et sommes du détail UE). */
export function formatNumber(value, decimals = 2) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "--";
    return value.toFixed(decimals);
}
