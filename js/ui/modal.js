/**
 * Fenêtres modales accessibles (role="dialog", focus piégé, Échap, retour du focus),
 * présentées comme la modale d'édition d'origine ; en feuille du bas sur mobile.
 */
import { html, raw } from "../core/escape.js";
import { render, keepFieldVisible } from "./dom.js";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let openCount = 0;

/**
 * Ouvre une modale. `body` est un fragment html``. `onMount(panel, close)` permet de
 * brancher les événements. Renvoie { panel, close }.
 */
export function openModal({ title, icon = "fa-pen-to-square", body, onMount = null, onClose = null, size = "max-w-md", labelId = null }) {
    const root = document.getElementById("modal-root") || document.body;
    const previouslyFocused = document.activeElement;
    const id = labelId || `modal-title-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4";
    overlay.setAttribute("data-modal-overlay", "");
    render(
        overlay,
        html`<div role="dialog" aria-modal="true" aria-labelledby="${id}" class="modal-panel bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 w-full ${raw(size)} shadow-2xl relative max-h-[92vh] overflow-y-auto overscroll-contain">
            <div class="flex items-start justify-between gap-3 mb-4">
                <h3 id="${id}" class="text-base font-semibold text-white flex items-center gap-2">
                    <i class="fa-solid ${raw(icon)} text-brand-500" aria-hidden="true"></i> <span>${title}</span>
                </h3>
                <button type="button" data-modal-close class="-mr-2 -mt-1 w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition" aria-label="Fermer">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
            <div data-modal-body>${body}</div>
        </div>`
    );
    const panel = overlay.querySelector('[role="dialog"]');
    root.appendChild(overlay);
    openCount++;
    document.body.classList.add("overflow-hidden");
    keepFieldVisible(panel);

    let closed = false;
    function close(result) {
        if (closed) return;
        closed = true;
        overlay.remove();
        openCount = Math.max(0, openCount - 1);
        if (openCount === 0) document.body.classList.remove("overflow-hidden");
        document.removeEventListener("keydown", onKey, true);
        if (previouslyFocused && typeof previouslyFocused.focus === "function" && document.contains(previouslyFocused)) previouslyFocused.focus();
        if (onClose) onClose(result);
    }
    function onKey(event) {
        if (!document.contains(overlay)) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close(null);
        } else if (event.key === "Tab") {
            const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", (event) => {
        if (event.target === overlay) close(null);
    });
    panel.querySelectorAll("[data-modal-close]").forEach((b) => b.addEventListener("click", () => close(null)));
    if (onMount) onMount(panel, close);
    const autofocus = panel.querySelector("[autofocus]") || panel.querySelector('input:not([type="hidden"]), select, textarea, button:not([data-modal-close])');
    if (autofocus) setTimeout(() => autofocus.focus({ preventScroll: true }), 30);
    return { panel, close };
}

/** Confirmation (remplace window.confirm, bloquant et peu lisible sur iPhone). */
export function confirmDialog({ title = "Confirmer", message, confirmLabel = "Confirmer", danger = false, icon = "fa-circle-question" }) {
    return new Promise((resolve) => {
        openModal({
            title,
            icon,
            body: html`<p class="text-sm text-slate-300 leading-relaxed">${message}</p>
                <div class="flex items-center justify-end gap-3 pt-5 mt-5 border-t border-slate-800">
                    <button type="button" data-cancel class="px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition">Annuler</button>
                    <button type="button" data-confirm class="px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-white transition shadow-md ${raw(
                        danger ? "bg-rose-600 hover:bg-rose-500 shadow-rose-600/20" : "bg-brand-600 hover:bg-brand-500 shadow-brand-600/20"
                    )}">${confirmLabel}</button>
                </div>`,
            onMount(panel, close) {
                panel.querySelector("[data-cancel]").addEventListener("click", () => close(false));
                panel.querySelector("[data-confirm]").addEventListener("click", () => close(true));
                setTimeout(() => panel.querySelector(danger ? "[data-cancel]" : "[data-confirm]").focus(), 40);
            },
            onClose: (result) => resolve(result === true)
        });
    });
}
