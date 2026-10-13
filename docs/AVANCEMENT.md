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

- [x] Phase 0 — exploration, branche, tag, tests golden (71 tests verts sur le code d'origine, commit `68e8914`)
- [x] Phase 1 — `docs/RISQUES-ET-TESTS.md` (mis à jour avec les tests réels)
- [x] Outillage : Tailwind compilé, dépendances locales (polices, icônes, supabase-js), icônes PNG
- [x] Cœur métier pur : programme, calcul (extrait verbatim), nombres, échappement, UUID, dates, devoirs, EDT
- [x] Données : stockage local, dépôt, fusion, moteur de synchro, adaptateurs mémoire/Supabase, migration, sauvegardes
- [x] SQL Supabase + tests RLS (PGlite) ; fonction Edge `edt-proxy` + tests
- [x] Interface : coquille, navigation, Accueil, Notes (+ détail UE), EDT, Devoirs, Réglages
- [x] PWA : service worker versionné, manifest, icônes
- [x] Serveur de test + E2E Playwright (desktop + iPhone + production statique), captures relues
- [x] Documentation : `CONFIGURATION.md`, `SYNCHRONISATION.md`, `EXIGENCES.md`, README
- [x] Boucle de correction : toute la suite verte (lint, 372 Vitest, 92 Playwright)
- [x] Vérification finale (consigne de clôture) : voir le compte rendu

## Décisions

- Pas de framework ni de bundler : modules ES natifs servis tels quels par GitHub Pages.
- Tailwind compilé et ressources tierces copiées dans `assets/` (hors-ligne fiable, tests sans réseau, plus d'avertissement « CDN de développement »).
- Supabase (Postgres + Auth + Realtime + RLS) ; table générique `items` ; fonction Edge pour l'EDT (hébergement inchangé).
- Clé publique dans `config.js` (publique par nature) ; lien ADE dans les réglages synchronisés.
- Vue (jour/semaine, mois/liste) mémorisée par appareil ; zoom EDT synchronisé, une valeur mobile et une desktop.
- Les 3 notes d'exemple de l'ancienne version ne sont pas migrées (conservées dans la sauvegarde).
