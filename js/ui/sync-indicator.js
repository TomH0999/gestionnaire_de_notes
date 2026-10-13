/**
 * Indicateur discret de l'état de synchronisation (en-tête + barre latérale + Accueil).
 * États : local / non connecté / session expirée / synchronisation… / synchronisé /
 * hors-ligne (avec nombre de modifications en attente) / erreur.
 */
import { html, raw } from "../core/escape.js";
import { formatDateTime } from "../core/dates.js";

export function describeSyncState(state, online = typeof navigator === "undefined" ? true : navigator.onLine !== false) {
    const pending = state.sync ? state.sync.pending || 0 : 0;
    const pendingText = pending > 0 ? ` · ${pending} en attente` : "";
    if (state.mode === "local") {
        return { key: "local", label: "Local", detail: "Synchronisation non configurée : les données restent sur cet appareil.", icon: "fa-hard-drive", tone: "slate" };
    }
    if (state.sessionExpired) {
        return { key: "expired", label: "Session expirée", detail: `Reconnectez-vous dans Réglages${pendingText ? " (modifications conservées)" : ""}.`, icon: "fa-user-clock", tone: "amber", pending };
    }
    if (state.mode === "signed-out" && state.sync && state.sync.phase === "starting") {
        return { key: "starting", label: "Démarrage…", detail: "Connexion au service de synchronisation.", icon: "fa-rotate", tone: "slate", spin: true, pending };
    }
    if (state.mode === "signed-out") {
        return { key: "signed-out", label: "Non connecté", detail: "Connectez-vous dans Réglages pour synchroniser vos appareils.", icon: "fa-user-slash", tone: "slate", pending };
    }
    const phase = state.sync ? state.sync.phase : "idle";
    if (!online || phase === "offline") {
        return { key: "offline", label: `Hors-ligne${pendingText}`, detail: "Vos modifications sont enregistrées sur l'appareil et partiront à la reconnexion.", icon: "fa-cloud", tone: "amber", pending };
    }
    if (phase === "error") {
        const msg = state.sync.error ? state.sync.error.message : "";
        return { key: "error", label: `Erreur de synchro${pendingText}`, detail: `Nouvel essai automatique. ${msg}`.trim(), icon: "fa-triangle-exclamation", tone: "rose", pending };
    }
    if (phase === "syncing") {
        return { key: "syncing", label: "Synchronisation…", detail: "Envoi et réception des modifications.", icon: "fa-rotate", tone: "brand", spin: true, pending };
    }
    if (pending > 0) {
        return { key: "pending", label: `${pending} en attente`, detail: "Envoi imminent.", icon: "fa-cloud-arrow-up", tone: "brand", pending };
    }
    const last = state.sync && state.sync.lastSyncAt ? `Dernière synchronisation : ${formatDateTime(state.sync.lastSyncAt)}.` : "";
    return { key: "synced", label: "Synchronisé", detail: last || "Toutes vos modifications sont dans le cloud.", icon: "fa-circle-check", tone: "emerald", pending: 0 };
}

const TONES = {
    slate: "bg-slate-800 text-slate-300 border-slate-700",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    rose: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    brand: "bg-brand-500/15 text-brand-100 border-brand-500/30",
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
};

export function syncPill(state, { compact = false } = {}) {
    const d = describeSyncState(state);
    return html`<a href="#/reglages" data-sync-state="${d.key}" title="${d.detail}" aria-label="État de la synchronisation : ${d.label}. ${d.detail}"
        class="inline-flex items-center min-h-[44px] min-w-[44px] justify-center group">
        <span class="inline-flex items-center gap-1.5 px-2.5 min-h-[32px] rounded-full text-xs font-medium border transition group-hover:brightness-110 ${raw(TONES[d.tone])}">
            <i class="fa-solid ${raw(d.icon)} ${raw(d.spin ? "fa-spin" : "")}" aria-hidden="true"></i>
            <span class="${raw(compact ? "hidden sm:inline" : "")}">${d.label}</span>
        </span>
    </a>`;
}
