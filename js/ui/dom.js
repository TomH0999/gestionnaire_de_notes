/** Petites aides DOM partagées par les pages. */
import { setHtml } from "../core/escape.js";

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Délégation d'événements : handler(event, élémentCorrespondant). */
export function on(root, type, selector, handler, options) {
    const listener = (event) => {
        const target = event.target instanceof Element ? event.target.closest(selector) : null;
        if (target && root.contains(target)) handler(event, target);
    };
    root.addEventListener(type, listener, options);
    return () => root.removeEventListener(type, listener, options);
}

/** Rendu d'un fragment html`` dans un élément (innerHTML contrôlé). */
export function render(element, fragment) {
    if (element) setHtml(element, fragment);
}

/** Exécute fn au prochain rafraîchissement d'écran (une seule fois par image). */
export function rafThrottle(fn) {
    let scheduled = false;
    return (...args) => {
        if (scheduled) return;
        scheduled = true;
        const run = () => {
            scheduled = false;
            fn(...args);
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
        else setTimeout(run, 16);
    };
}

export function isMobileViewport() {
    return typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 1023px)").matches : false;
}

/** Fait défiler le champ au-dessus du clavier virtuel (iPhone) quand il reçoit le focus. */
export function keepFieldVisible(root) {
    root.addEventListener("focusin", (event) => {
        const el = event.target;
        if (!(el instanceof HTMLElement) || !el.matches("input, select, textarea")) return;
        setTimeout(() => {
            try {
                el.scrollIntoView({ block: "center", behavior: "smooth" });
            } catch {
                /* ancien navigateur */
            }
        }, 300);
    });
}

export function formValues(form) {
    const out = {};
    for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type === "radio") {
            if (el.checked) out[el.name] = el.value;
        } else if (el.type === "checkbox") out[el.name] = el.checked;
        else out[el.name] = el.value;
    }
    return out;
}

/** Affiche les erreurs de validation à côté des champs (aria-invalid + message). */
export function showFieldErrors(form, errors) {
    for (const el of form.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
    for (const el of form.querySelectorAll("[data-error-for]")) {
        el.textContent = "";
        el.hidden = true;
    }
    let first = null;
    for (const [field, message] of Object.entries(errors || {})) {
        const input = form.elements[field];
        const slot = form.querySelector(`[data-error-for="${field}"]`);
        if (input && input.setAttribute) {
            input.setAttribute("aria-invalid", "true");
            if (!first) first = input;
        }
        if (slot) {
            slot.textContent = message;
            slot.hidden = false;
        }
    }
    if (first && typeof first.focus === "function") first.focus();
    return first;
}
