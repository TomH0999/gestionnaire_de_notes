/**
 * Infobulle de détail (UE) : s'ouvre au SURVOL (souris), au TAP (écran tactile) et au FOCUS
 * clavier ; se ferme avec Échap, un tap/clic à l'extérieur ou en quittant la zone.
 * Positionnement calculé et borné au viewport (marge 8 px) : ne déborde jamais de l'écran ;
 * hauteur maximale = espace disponible (contenu défilant si nécessaire).
 *
 * Accessibilité : le déclencheur est un <button> avec aria-expanded et aria-controls ;
 * l'infobulle a role="tooltip" et est reliée par aria-describedby quand elle est ouverte.
 */
import { setHtml } from "../core/escape.js";

const MARGIN = 8;
const GAP = 8;
let current = null;
let globalListenersInstalled = false;

function canHover() {
    return typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function installGlobalListeners() {
    if (globalListenersInstalled) return;
    globalListenersInstalled = true;
    document.addEventListener(
        "pointerdown",
        (event) => {
            if (!current) return;
            const t = event.target;
            if (current.trigger.contains(t) || current.tip.contains(t)) return;
            closePopover();
        },
        true
    );
    document.addEventListener("keydown", (event) => {
        // Le focus reste où il est (sur le déclencheur pour un utilisateur clavier)
        if (event.key === "Escape" && current) closePopover();
    });
    window.addEventListener("resize", () => current && position(current));
    window.addEventListener("scroll", () => current && position(current), true);
}

export function closePopover() {
    if (!current) return;
    const { trigger, tip } = current;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-describedby");
    tip.remove();
    current = null;
}

/** Calcule la position (exportée pour les tests unitaires). */
export function computePosition(triggerRect, tipSize, viewport) {
    const spaceBelow = viewport.height - triggerRect.bottom - GAP - MARGIN;
    const spaceAbove = triggerRect.top - GAP - MARGIN;
    const placeBelow = spaceBelow >= Math.min(tipSize.height, 240) || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(120, placeBelow ? spaceBelow : spaceAbove);
    const height = Math.min(tipSize.height, maxHeight);
    const width = Math.min(tipSize.width, viewport.width - 2 * MARGIN);
    let left = triggerRect.left + triggerRect.width / 2 - width / 2;
    left = Math.max(MARGIN, Math.min(left, viewport.width - width - MARGIN));
    let top = placeBelow ? triggerRect.bottom + GAP : triggerRect.top - GAP - height;
    top = Math.max(MARGIN, Math.min(top, viewport.height - height - MARGIN));
    return { left, top, maxHeight, width, placement: placeBelow ? "bottom" : "top" };
}

function position(state) {
    const { trigger, tip } = state;
    const rect = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    tip.style.maxWidth = `${Math.min(400, vw - 2 * MARGIN)}px`;
    tip.style.maxHeight = "";
    tip.style.left = "0px";
    tip.style.top = "0px";
    const size = { width: tip.offsetWidth, height: tip.scrollHeight };
    const p = computePosition(rect, size, { width: vw, height: vh });
    tip.style.maxHeight = `${p.maxHeight}px`;
    tip.style.left = `${Math.round(p.left)}px`;
    tip.style.top = `${Math.round(p.top)}px`;
    tip.dataset.placement = p.placement;
}

function open(trigger, getContent, { pinned }) {
    if (current && current.trigger === trigger) {
        current.pinned = current.pinned || pinned;
        return;
    }
    closePopover();
    installGlobalListeners();
    const tip = document.createElement("div");
    const id = trigger.getAttribute("aria-controls") || `pop-${Math.random().toString(36).slice(2, 9)}`;
    tip.id = id;
    tip.setAttribute("role", "tooltip");
    tip.className = "gdn-popover";
    setHtml(tip, getContent());
    (document.getElementById("tooltip-layer") || document.body).appendChild(tip);
    trigger.setAttribute("aria-controls", id);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-describedby", id);
    current = { trigger, tip, pinned };
    position(current);
    tip.addEventListener("mouseenter", () => clearTimeout(trigger._gdnLeaveTimer));
    tip.addEventListener("mouseleave", () => {
        if (current && current.tip === tip && !current.pinned) scheduleClose(trigger);
    });
}

function scheduleClose(trigger) {
    clearTimeout(trigger._gdnLeaveTimer);
    trigger._gdnLeaveTimer = setTimeout(() => {
        if (current && current.trigger === trigger && !current.pinned) closePopover();
    }, 180);
}

/** Branche une infobulle sur un bouton. getContent() renvoie un fragment html``. */
export function attachPopover(trigger, getContent) {
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("mouseenter", () => {
        if (!canHover()) return;
        clearTimeout(trigger._gdnLeaveTimer);
        open(trigger, getContent, { pinned: false });
    });
    trigger.addEventListener("mouseleave", () => {
        if (!canHover()) return;
        scheduleClose(trigger);
    });
    trigger.addEventListener("click", (event) => {
        event.preventDefault();
        if (current && current.trigger === trigger && current.pinned) {
            closePopover();
            return;
        }
        open(trigger, getContent, { pinned: true });
    });
    trigger.addEventListener("focus", () => {
        if (trigger.matches(":focus-visible")) open(trigger, getContent, { pinned: false });
    });
    trigger.addEventListener("blur", () => {
        if (current && current.trigger === trigger && !current.pinned) closePopover();
    });
}

export function currentPopover() {
    return current ? current.tip : null;
}
