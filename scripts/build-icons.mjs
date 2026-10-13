/**
 * Génère les icônes PNG de la PWA à partir de icon.svg (rendu par Chromium via Playwright,
 * aucune dépendance supplémentaire) :
 *  - icons/icon-192.png, icons/icon-512.png : icône d'origine (coins arrondis transparents) ;
 *  - icons/apple-touch-icon.png (180×180) et icons/icon-maskable-512.png : fond plein,
 *    motif réduit dans la zone de sécurité (iOS n'accepte pas le SVG ni la transparence).
 */
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(path.join(root, "icon.svg"), "utf8");
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <rect width="512" height="512" fill="#0f172a"/>
    <g transform="translate(${256 - 256 * scale} ${256 - 256 * scale}) scale(${scale})">${inner}</g>
</svg>`;

const outputs = [
    { file: "icon-192.png", size: 192, svg, transparent: true },
    { file: "icon-512.png", size: 512, svg, transparent: true },
    { file: "apple-touch-icon.png", size: 180, svg: fullBleed(0.86), transparent: false },
    { file: "icon-maskable-512.png", size: 512, svg: fullBleed(0.72), transparent: false }
];

mkdirSync(path.join(root, "icons"), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const o of outputs) {
    await page.setViewportSize({ width: o.size, height: o.size });
    const sized = o.svg.replace(/width="512" height="512"/, `width="${o.size}" height="${o.size}"`);
    await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
    await page.screenshot({ path: path.join(root, "icons", o.file), omitBackground: o.transparent, clip: { x: 0, y: 0, width: o.size, height: o.size } });
    console.log(`icône générée : icons/${o.file}`);
}
await browser.close();
