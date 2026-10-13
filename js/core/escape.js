/**
 * Échappement HTML et gabarits sûrs.
 *
 * Toute donnée saisie par l'utilisateur ou venant de l'extérieur (EDT, import JSON,
 * synchronisation) DOIT passer par escapeHtml() ou par le gabarit html`` qui échappe
 * automatiquement chaque valeur interpolée.
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export class SafeHtml {
    constructor(value) {
        this.value = value;
    }
    toString() {
        return this.value;
    }
}

/** Marque une chaîne comme du HTML de confiance (à n'utiliser que pour du HTML écrit dans le code). */
export function raw(value) {
    return new SafeHtml(String(value));
}

function renderValue(value) {
    if (value instanceof SafeHtml) return value.value;
    if (Array.isArray(value)) return value.map(renderValue).join("");
    if (value === null || value === undefined || value === false) return "";
    return escapeHtml(value);
}

/** Gabarit : html`<p>${texteUtilisateur}</p>` échappe texteUtilisateur. */
export function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) {
        out += renderValue(values[i]) + strings[i + 1];
    }
    return new SafeHtml(out);
}

/** Remplace le contenu d'un élément par un fragment SafeHtml. */
export function setHtml(element, fragment) {
    if (!(fragment instanceof SafeHtml)) {
        throw new TypeError("setHtml attend un fragment produit par html``");
    }
    element.innerHTML = fragment.value;
}
