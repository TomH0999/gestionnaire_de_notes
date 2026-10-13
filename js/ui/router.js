/**
 * Navigation par hash (#/notes, #/edt…) : fonctionne sur GitHub Pages sans configuration
 * serveur, chaque page a son URL et le bouton retour du navigateur fonctionne.
 */
export const ROUTES = [
    { id: "accueil", hash: "#/", label: "Accueil", icon: "fa-house", title: "Aujourd'hui" },
    { id: "notes", hash: "#/notes", label: "Notes", icon: "fa-graduation-cap", title: "Notes & moyennes" },
    { id: "edt", hash: "#/edt", label: "Emploi du temps", short: "EDT", icon: "fa-calendar-week", title: "Emploi du temps" },
    { id: "devoirs", hash: "#/devoirs", label: "Devoirs", icon: "fa-list-check", title: "Devoirs & évaluations" },
    { id: "reglages", hash: "#/reglages", label: "Réglages", icon: "fa-gear", title: "Réglages" }
];

export function routeFromHash(hash) {
    const clean = (hash || "").replace(/^#\/?/, "").split(/[/?]/)[0];
    return ROUTES.find((r) => r.id === clean) || ROUTES[0];
}

export function createRouter(onChange) {
    const handler = () => onChange(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", handler);
    return {
        start: handler,
        navigate(id) {
            const route = ROUTES.find((r) => r.id === id) || ROUTES[0];
            if (window.location.hash === route.hash) handler();
            else window.location.hash = route.hash;
        }
    };
}
