# Journal d'avancement — refonte v2 « suivi de scolarité »

Fichier de reprise : si la session est interrompue, reprendre à la première case non cochée.
Branche : `feature/v2-suivi-scolarite` · Tag de sauvegarde : `sauvegarde-avant-v2` (commit `3ec1d0c`).

## Constat initial (phase 0)

- Stack : site statique HTML + JS « vanilla » (fonctions globales, `onclick` inline), Tailwind via
  le CDN de développement, Font Awesome et Inter via CDN, PWA (manifest + `sw.js` cache-first).
- Hébergement : GitHub Pages (`https://tomh0999.github.io/gestionnaire_de_notes/`), dépôt public.
- Stockage : `localStorage`, une seule clé `BUT1_INFO_S1_GRADES` = tableau JSON
  `{ id, name, subjectCode, score, max, coeff }` (id = `Date.now()` ; 3 notes d'exemple
  `"1"`, `"2"`, `"3"` créées au premier lancement).
- EDT : l'URL fournie renvoie une page HTML GWT « ADE Web Direct Planning » ; l'export
  iCalendar est disponible via `…/jsp/custom/modules/plannings/direct_cal.jsp?data=<jeton>`
  (+ `firstDate`/`lastDate`). Aucun en-tête CORS → proxy serveur obligatoire.

## Étapes

- [x] Phase 0 — exploration, branche, tag, tests golden (71 tests verts sur le code d'origine)
- [x] Phase 1 — `docs/RISQUES-ET-TESTS.md`
- [ ] Outillage : Tailwind compilé, dépendances locales (polices, icônes, supabase-js), icônes PNG
- [ ] Cœur métier pur : programme, calcul (extrait verbatim), nombres, échappement, UUID, dates, devoirs, EDT
- [ ] Données : stockage local, dépôt, fusion, moteur de synchro, adaptateurs mémoire/Supabase, migration, sauvegardes
- [ ] SQL Supabase + tests RLS (PGlite) ; fonction Edge `edt-proxy` + tests
- [ ] Interface : coquille, navigation, Accueil, Notes (+ détail UE), EDT, Devoirs, Réglages
- [ ] PWA : service worker versionné, manifest, icônes
- [ ] Serveur de test + E2E Playwright (desktop + iPhone), captures relues
- [ ] Documentation : guide de configuration, tableau des exigences, README
- [ ] Boucle de correction : toute la suite verte

## Notes de reprise

(mis à jour au fil de l'eau)
