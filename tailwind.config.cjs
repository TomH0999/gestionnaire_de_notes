/**
 * Configuration Tailwind (v3.4) — identique à celle de l'ancienne page (CDN) :
 * mode sombre par classe, palette slate étendue (850/900/950) et couleurs « brand ».
 * La feuille compilée (assets/css/tailwind.css) est commitée : GitHub Pages sert des
 * fichiers statiques, sans étape de build. Après avoir ajouté des classes dans le HTML
 * ou le JS : `npm run build:css` (un test vérifie que la feuille est à jour).
 */
module.exports = {
    content: ["./index.html", "./js/**/*.js"],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                slate: {
                    850: "#1e293b",
                    900: "#0f172a",
                    950: "#020617"
                },
                brand: {
                    50: "#eff6ff",
                    100: "#dbeafe",
                    500: "#3b82f6",
                    600: "#2563eb",
                    700: "#1d4ed8"
                }
            }
        }
    },
    plugins: []
};
