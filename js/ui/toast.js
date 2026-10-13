/** Notifications (même présentation que la version d'origine). */
import { html, raw } from "../core/escape.js";
import { render } from "./dom.js";

export function showToast(message, type = "success", { action = null, duration = 3500 } = {}) {
    const container = document.getElementById("toast-container");
    if (!container) return null;
    const toast = document.createElement("div");
    const colors = { success: "bg-brand-600", error: "bg-rose-600", warning: "bg-amber-600", info: "bg-slate-700" };
    const icons = { success: "fa-circle-check", error: "fa-triangle-exclamation", warning: "fa-circle-exclamation", info: "fa-circle-info" };
    toast.className = `${colors[type] || colors.info} text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 transform transition-all duration-300 pointer-events-auto opacity-0 translate-y-2 max-w-sm`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    render(
        toast,
        html`<i class="fa-solid ${raw(icons[type] || icons.info)}" aria-hidden="true"></i><span class="flex-1">${message}</span>${
            action ? html`<button type="button" class="ml-2 px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 font-semibold min-h-[32px]" data-toast-action>${action.label}</button>` : ""
        }`
    );
    if (action) {
        toast.querySelector("[data-toast-action]").addEventListener("click", () => {
            action.onClick();
            dismiss();
        });
    }
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove("opacity-0", "translate-y-2"), 10);
    let timer = null;
    function dismiss() {
        clearTimeout(timer);
        toast.classList.add("opacity-0", "translate-y-2");
        setTimeout(() => toast.remove(), 300);
    }
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return dismiss;
}
