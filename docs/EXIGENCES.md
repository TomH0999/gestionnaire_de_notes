# Exigences → tests → résultat

Dernière exécution complète : 13/10/2026, depuis une réinstallation propre (`npm ci`, `npm run build`
sans aucune modification de fichier) : lint OK, feuille CSS à jour, **372 tests Vitest** (71 golden,
254 unitaires, 47 intégration) et **92 tests Playwright** (Chromium desktop, WebKit iPhone,
production statique Chromium + WebKit) : **464 passés, 0 ignoré, 0 échec**. ✅ = implémenté et vérifié par des tests automatisés qui passent ·
⚠️ = implémenté et testé avec des doublures (serveur simulé, WebKit de Playwright) ; une
vérification sur l'infrastructure réelle reste à faire (checklist manuelle) · ❌ = non fait.

Fichiers : `G` = tests/golden, `U` = tests/unit, `I` = tests/integration, `E2E` = tests/e2e.

## Phase 0 et 1

| Exigence | Test(s) | Résultat |
|---|---|---|
| Branche dédiée + sauvegarde | branche `feature/v2-suivi-scolarite`, tag `sauvegarde-avant-v2` | ✅ |
| Tests golden écrits AVANT toute modification, jamais modifiés | G `golden.test.js` (71 tests, 17 jeux : normal, notes manquantes, coeff 0, décimales, 0/20, 20/20, sans note, bornes…) ; `golden-expected.json` inchangé depuis le commit `68e8914` | ✅ |
| Analyse des risques | `docs/RISQUES-ET-TESTS.md` | ✅ |

## 1. Base de données en ligne et synchronisation

| Exigence | Test(s) | Résultat |
|---|---|---|
| Chaque donnée saisie stockée en ligne (notes, devoirs, réglages) | I scénarios (notes, devoirs, réglages) ; E2E `sync` | ✅ |
| Temps réel quand l'app est ouverte | I « création sur A → visible sur B (temps réel) » ; E2E `sync` (sans recharger) ; E2E `supabase-js` (abonnement filtré) | ⚠️ vrai Realtime Supabase à vérifier |
| Au démarrage, au retour au premier plan, à la reconnexion | I « temps réel coupé → rattrapé » ; E2E `sync` « retour au premier plan » ; E2E hors-ligne (`online`) | ✅ |
| Offline-first : lecture ET écriture sans réseau, file d'attente | I « hors-ligne… aucune perte » ; E2E `timetable` / `sync` hors-ligne ; E2E `production` (chargement hors-ligne) | ✅ |
| Indicateur synchronisé / en cours / hors-ligne / erreur | U `ui-logic` « Indicateur… » ; E2E (pastille dans tous les parcours) | ✅ |
| Aucune perte silencieuse | I « … archivée » (journal des conflits) ; notification | ✅ |
| UUID côté client, `updated_at`, `deleted_at`, fusion par entrée | SQL `sql-rls` ; U `data-layer` ; I | ✅ |
| Règle de conflit documentée, horloge serveur | `docs/SYNCHRONISATION.md` ; I « horloge avance de 2 h », « recalées » | ✅ |
| Authentification e-mail + mot de passe, session persistante | E2E `supabase-js` (vraie bibliothèque, API simulée) ; E2E `sync` (rechargement = toujours connecté) | ⚠️ vrai projet Supabase à vérifier |
| RLS stricte sur toutes les tables, clé publique seule | SQL `sql-rls` (Postgres réel) ; U `static-checks` (secrets) | ✅ (⚠️ à revoir dans le tableau de bord après exécution du script) |
| Migration : sauvegarde JSON auto téléchargeable, envoi sans doublon (deux appareils) | U `data-layer` ; I « migration depuis deux appareils » ; E2E `sync` (téléchargement + zéro doublon) ; E2E `production` (migration) | ✅ |
| Export / import JSON manuel dans Réglages | U `data-layer` « Export / import » ; (bouton présent, E2E `navigation`) | ✅ |
| Abstraction SyncBackend : adaptateurs Supabase et mémoire | U `supabase-backend` ; I (mémoire + Postgres) ; E2E `supabase-js` | ✅ |
| Script SQL complet et idempotent | SQL « rejoué deux fois sans erreur ni perte » | ✅ |
| Config d'exemple + guide « Configuration en 5 minutes » | `config.example.js`, `supabase/functions/.env.example`, `docs/CONFIGURATION.md` | ✅ |

## 2. Emploi du temps

| Exigence | Test(s) | Résultat |
|---|---|---|
| Analyse de la source réelle, fixture anonymisée | `tests/fixtures/edt/ade-semestre-anonymise.ics` (278 séances) ; U `timetable` | ✅ |
| Proxy serverless non ouvert, cache 10–15 min, compatible avec l'hébergement | U `edt-proxy` (21 tests) ; E2E via la vraie fonction | ✅ (⚠️ déploiement Supabase à faire) |
| Lien jamais en dur, modifiable dans Réglages | U `static-checks` ; E2E `timetable` « sans lien ADE… » ; E2E `supabase-js` | ✅ |
| Parsing : matière, type, salle, enseignants, groupe, horaires, journée entière, annulations, Europe/Paris, chevauchements | U `timetable` (42 tests) | ✅ |
| Vue Jour (mobile) / Semaine (desktop), préc./suiv./aujourd'hui, swipe | E2E `timetable` « vue par défaut… », « navigation… » ; E2E `timetable-swipe` | ✅ |
| Couleur par matière, cours en cours et prochain en évidence, détail au tap | E2E `timetable` ; captures relues | ✅ |
| Zoom −/+/réinitialiser, texte agrandi, mémorisé ; pinch-zoom sans casse | E2E « zoom… mémorisée » ; E2E `timetable-swipe` | ✅ |
| Cache hors-ligne « dernière mise à jour à… », chargement, erreurs claires, actualiser, rafraîchissement auto si ancien | E2E « hors-ligne… », « source indisponible… », « rafraîchissement automatique… » ; U `ui-logic` | ✅ |
| Smoke test séparé contre la vraie URL | `npm run smoke:edt` (exécuté le 13/10/2026 : 61 séances, 0 avertissement) | ✅ (manuel) |

## 3. Calendrier des devoirs

| Exigence | Test(s) | Résultat |
|---|---|---|
| Vue mois + vue liste ; ajouter, modifier, supprimer, fait | E2E `homework` (4 tests × 2 appareils) | ✅ |
| Types, champs, importance 4 niveaux (couleur + icône + libellé), anticipation en jours, notes, statut | U `homework`, `grades-validation` ; E2E `homework` | ✅ |
| Valeurs par défaut selon le type, modifiables | U `homework` ; E2E « valeurs par défaut selon le type… » | ✅ |
| Début conseillé, états calculés, tri par urgence documenté et testé | U `homework` (18 tests) ; E2E « vue Liste : tri par urgence » | ✅ |
| Période d'anticipation + échéance colorées dans le calendrier ; clic sur un jour | E2E « vue Mois : période d'anticipation… clic sur un jour » | ✅ |

## 4. Accueil et navigation

| Exigence | Test(s) | Résultat |
|---|---|---|
| Page unique affichée depuis le cache (~1 s) puis mise à jour | E2E `perf` (88–143 ms avec 600 notes + 600 devoirs) | ✅ |
| Ordre : date + synchro, cours, à faire, saisies rapides, UE, raccourcis | E2E `home` « ordre des sections » | ✅ |
| Cours restants, prochain en évidence (heure, salle, matière) | E2E `home` « cours restants… » | ✅ |
| « À faire maintenant » trié par urgence, « fait » en un tap | E2E `home` (2 tests) | ✅ |
| Saisie rapide note (matière mémorisée, virgule, clavier numérique) et devoir, ≤ 3 interactions | E2E `home` « 3 interactions », « titre + Ajouter » | ✅ (⚠️ clavier numérique iOS à voir sur iPhone) |
| Aperçu des UE avec détail, raccourcis | E2E `home` | ✅ |
| Pages dédiées ; onglets en bas (≥ 44 px, safe-area) / barre latérale ; URL par page ; retour | E2E `navigation` (3 tests × 2 appareils) | ✅ (⚠️ encoche réelle) |
| PWA : manifest, icônes, apple-touch-icon, SW versionné, nouvelles versions sur iPhone | E2E `production` (Chromium + WebKit) ; U `static-checks` | ✅ (⚠️ installation réelle sur iPhone) |

## 5. Notes

| Exigence | Test(s) | Résultat |
|---|---|---|
| Aucun changement de formule, d'arrondi, de décimales ni de stockage | G `golden` ; E2E `notes` (valeurs golden à l'écran) ; format des notes inchangé | ✅ |
| Virgule ou point acceptés | U `numbers-escape-uuid` ; E2E `notes`, `home` | ✅ |
| Détail UE au survol ET au tap/focus, aria | E2E `notes` (survol desktop, tap iPhone) ; E2E `keyboard` (focus) | ✅ |
| Contenu du détail : ressources/SAÉ, moyenne, coeff, produit, sommes, formule, résultat, matières sans note | U `grades-validation` ; E2E `notes` | ✅ |
| Ne déborde jamais, Échap ou tap extérieur | U `ui-logic` ; E2E `notes` (dont 320 px) | ✅ |
| Valeur du détail strictement identique à l'écran (test dédié) | U « au bit près » ; E2E `notes`, `keyboard`, `home` | ✅ |

## Tests demandés

| Exigence | Où | Résultat |
|---|---|---|
| Outils en devDependencies, scripts npm clairs, build de production non pollué | `package.json` | ✅ |
| Unitaires (calcul, EDT, anticipation/urgence, fusion, nombres FR, échappement) | `tests/unit` (254) | ✅ |
| Intégration synchro (deux clients, tous les scénarios, RLS) | `tests/integration` (47, dont Postgres réel) | ✅ (⚠️ « vrai Supabase local » impossible sans Docker : RLS testée sur Postgres réel PGlite) |
| E2E deux contextes, desktop + iPhone (WebKit), hors-ligne, zoom, tooltip, clavier, zéro erreur console / requête en échec | `tests/e2e` (92) | ✅ |
| EDT sur fixture/mock déterministe + smoke test manuel séparé | serveur de test + `npm run smoke:edt` | ✅ |
| PWA (manifest, mise à jour SW, hors-ligne après première visite) | E2E `production` | ✅ |
| Performance (accueil ~1 s, 500+ entrées) | E2E `perf` | ✅ |
| Tableau exigence → test → résultat | ce fichier | ✅ |
