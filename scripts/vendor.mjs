/**
 * Copie les bibliothèques tierces depuis node_modules vers assets/vendor (servies par le site,
 * pré-cachées par le service worker : aucune dépendance CDN, fonctionnement hors-ligne).
 * À relancer après une mise à jour de version : `npm run vendor`.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nm = (...p) => path.join(root, "node_modules", ...p);
const out = (...p) => path.join(root, "assets", ...p);

function copy(from, to) {
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    console.log(`copié : ${path.relative(root, to)}`);
}

// supabase-js (bundle UMD minifié, expose window.supabase)
copy(nm("@supabase", "supabase-js", "dist", "umd", "supabase.js"), out("vendor", "supabase", "supabase.js"));

// Font Awesome 6.4.0 (même version que l'ancien CDN) : CSS + polices solid/regular en woff2
copy(nm("@fortawesome", "fontawesome-free", "css", "all.min.css"), out("vendor", "fontawesome", "css", "all.min.css"));
for (const f of ["fa-solid-900.woff2", "fa-regular-400.woff2"]) {
    copy(nm("@fortawesome", "fontawesome-free", "webfonts", f), out("vendor", "fontawesome", "webfonts", f));
}
// Les déclarations @font-face référencent aussi .ttf / brands : on ne garde que les woff2 utilisés
const faCss = out("vendor", "fontawesome", "css", "all.min.css");
let css = readFileSync(faCss, "utf8");
css = css.replace(/,url\(\.\.\/webfonts\/[^)]+\.ttf\) format\("truetype"\)/g, "");
css = css.replace(/@font-face\{font-family:"Font Awesome 6 Brands"[^}]*\}/g, "");
css = css.replace(/@font-face\{font-family:"FontAwesome";[^}]*\}/g, "");
// Polices « brands » et de compatibilité v4/v5 non fournies (jamais utilisées) : règles retirées
css = css.replace(/@font-face\{[^}]*fa-(brands-400|v4compatibility)[^}]*\}/g, "");
writeFileSync(faCss, css);

// Inter (police variable, sous-ensemble latin : couvre le français)
copy(nm("@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2"), out("fonts", "inter-latin-wght-normal.woff2"));

// Licences des ressources redistribuées
copy(nm("@fortawesome", "fontawesome-free", "LICENSE.txt"), out("vendor", "fontawesome", "LICENSE.txt"));
copy(nm("@supabase", "supabase-js", "LICENSE"), out("vendor", "supabase", "LICENSE"));
copy(nm("@fontsource-variable", "inter", "LICENSE"), out("fonts", "LICENSE-Inter.txt"));
