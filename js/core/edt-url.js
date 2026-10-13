/**
 * Lien de l'emploi du temps ADE (Université de Montpellier).
 *
 * L'utilisateur colle le lien « direct » d'ADE (…/direct/?data=<jeton>,1). Le jeton est
 * personnel : il n'est jamais écrit dans le code, seulement dans les réglages synchronisés
 * (protégés par RLS). La même validation est faite côté serveur par la fonction edt-proxy.
 */
export const ADE_HOST = "proseconsult.umontpellier.fr";
const ALLOWED_PATHS = ["/direct/", "/direct/index.jsp", "/jsp/custom/modules/plannings/direct_cal.jsp"];
const DATA_RE = /^[0-9a-f]{16,2048}(,\d{1,3})?$/i;

/**
 * Vérifie un lien saisi. Renvoie { ok, data, error } où `data` est le jeton opaque.
 */
export function parseEdtUrl(input) {
    if (typeof input !== "string" || !input.trim()) return { ok: false, error: "Collez le lien de votre emploi du temps ADE." };
    let url;
    try {
        url = new URL(input.trim());
    } catch {
        return { ok: false, error: "Ce n'est pas une adresse web valide." };
    }
    if (url.protocol !== "https:") return { ok: false, error: "Le lien doit commencer par https://." };
    if (url.hostname !== ADE_HOST) return { ok: false, error: `Seuls les liens ${ADE_HOST} sont acceptés.` };
    if (!ALLOWED_PATHS.includes(url.pathname)) return { ok: false, error: "Ce lien ADE n'est pas un lien d'emploi du temps « direct »." };
    const data = url.searchParams.get("data");
    if (!data || !DATA_RE.test(data)) return { ok: false, error: "Le paramètre « data » du lien est absent ou invalide." };
    return { ok: true, data };
}

/** Masque le jeton pour l'affichage (on n'affiche jamais le lien complet par défaut). */
export function maskEdtUrl(input) {
    const parsed = parseEdtUrl(input);
    if (!parsed.ok) return "";
    return `https://${ADE_HOST}/…?data=${parsed.data.slice(0, 6)}…${parsed.data.slice(-4)}`;
}
