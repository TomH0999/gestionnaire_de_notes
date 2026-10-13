# Analyse des risques (pré-mortem) et tests associés

Ce document a piloté la phase de tests : chaque risque indique **(a)** comment il est évité
dans le code et **(b)** quel(s) test(s) le détectent (fichiers de `tests/`). Les risques qui ne
peuvent pas être testés automatiquement ici sont signalés **M** (vérification manuelle, voir
la checklist du compte rendu) avec la justification.

Types : **G** golden · **U** unitaire (Vitest) · **I** intégration (Vitest : deux appareils sur
serveur mémoire ET sur Postgres réel PGlite avec `schema.sql`) · **SQL** Postgres réel (PGlite) ·
**E2E** Playwright (Chromium desktop, WebKit iPhone, version de production statique) · **M** manuel.

## 1. Synchronisation et données en ligne

| ID | Risque | (a) Prévention | (b) Test(s) |
|---|---|---|---|
| SYNC-01 | Conflit : même entrée modifiée sur deux appareils | Fusion 3 voies par champ ; même champ modifié des deux côtés → la plus récente gagne (horloge corrigée + plafonnée), départage par appareil ; valeur perdue archivée + notification | U `data-layer` « Fusion 3 voies » ; I « modifications simultanées de champs différents », « A hors-ligne modifie, B modifie le même champ plus tard » ; E2E `sync` « A hors-ligne modifie, B modifie… fusion sans perte » |
| SYNC-02 | Suppression non propagée | Suppression logique (`deleted_at`), pierres tombales conservées, aucun `DELETE` (ni politique ni droit) | I « suppression sur A → disparaît sur B » ; SQL « suppression physique impossible » ; E2E `sync` « création, modification et suppression… » ; E2E `supabase-js` (aucune requête DELETE) |
| SYNC-03 | Modification hors-ligne qui écrase une plus récente | Mise à jour conditionnelle sur `updated_at` ; sinon relecture + fusion | SQL « mise à jour conditionnelle » ; I « A hors-ligne… la plus récente gagne » ; E2E `supabase-js` (PATCH `id=eq…&updated_at=eq…`) |
| SYNC-04 | Doublons à la migration (deux appareils avec données locales) | UUID v5 du contenu + rang d'occurrence ; insertion `ON CONFLICT DO NOTHING` ; notes d'exemple non migrées | U `data-layer` « Migration… » ; I « migration depuis deux appareils… zéro doublon » (mémoire + Postgres) ; E2E `sync` « migration depuis deux appareils… » |
| SYNC-05 | Horloges d'appareils décalées | Curseurs et ordre = horloge serveur ; mesure de `server_time()` avant toute fusion ; recalage des éditions en attente ; plafond serveur `now()+1 min` | I « horloge avance de 2 h », « modifications faites hors-ligne AVANT toute synchronisation… recalées » ; SQL « horloge d'appareil en avance plafonnée » |
| SYNC-06 | Perte de données hors-ligne | Écriture locale d'abord ; file vidée seulement après accusé serveur | I « A hors-ligne crée et modifie plusieurs entrées… aucune perte » ; E2E `timetable` « hors-ligne : … note mise en attente puis envoyée » ; E2E `sync` hors-ligne |
| SYNC-07 | File rejouée deux fois | File « par état » ; écriture identique reconnue | I « file d'attente rejouée deux fois → idempotent » |
| SYNC-08 | Coupure réseau en pleine écriture | Rejouable avant ou après validation serveur | I « coupure réseau avant l'insertion puis réponse perdue après », « mise à jour dont la réponse se perd » |
| SYNC-09 | Session expirée | État « Session expirée », rafraîchissement tenté, file conservée et envoyée après reconnexion | I « session expirée → file conservée » ; U `supabase-backend` (401/JWT → auth) ; E2E `sync` « session expirée… » |
| SYNC-10 | iOS suspend le temps réel en arrière-plan | Resynchro au premier plan / focus / reconnexion / démarrage ; sondage de secours | I « temps réel coupé (iOS en arrière-plan) → rattrapé » ; E2E `sync` « temps réel coupé… rattrapage au retour au premier plan » |
| SYNC-11 | iOS vide le stockage des sites non installés | Données dans le cloud, `navigator.storage.persist()`, compteur « N en attente », guide : installer la PWA | I « stockage local vidé (iOS) → tout est re-téléchargé » ; **M** : l'éviction réelle d'iOS (7 jours sans visite) n'est pas simulable — installer la PWA (checklist) |
| SYNC-12 | Service worker qui sert une vieille version | Cache versionné, pré-cache `cache: "reload"`, `updateViaCache: "none"`, vérification au premier plan, bandeau « Recharger » ; `config.js` réseau d'abord | U `static-checks` (cycle de vie simulé, version = app) ; E2E `production` « mise à jour du service worker… » (Chromium + WebKit) — corrige un défaut trouvé (bandeau jamais proposé après une 1re installation) |
| SYNC-13 | RLS mal configurée | RLS + politiques `auth.uid()` en lecture/insertion/mise à jour, rien pour `anon`, `user_id` immuable | SQL « anonyme ne lit rien et n'écrit rien », « B ne voit pas les lignes de A », « B ne peut ni modifier… ni usurper », « RLS activée sur toutes les tables » ; I scénarios Postgres (isolation par la seule RLS) |
| SYNC-14 | Clé secrète commitée | Seule la clé publique est lue ; scan du dépôt (JWT `service_role`, `sb_secret_`, `.env`) | U `static-checks` « aucun secret dans le dépôt » |
| SYNC-15 | Curseur qui saute une ligne | Recouvrement 2 min + resynchro complète 12 h | U `data-layer` « une ligne validée dans le passé… est rattrapée » |
| SYNC-16 | Deux onglets ouverts | Événement `storage` → rechargement ; envoi idempotent | U `data-layer` « événement storage d'un autre onglet » |
| SYNC-17 | Changement d'utilisateur | Cache cloisonné par compte ; adoption des données « invité » au 1er compte | U `data-layer` « cloisonnement par compte et adoption » ; I « données saisies avant toute connexion → adoptées » ; I « isolation des comptes » |
| SYNC-18 | Quota `localStorage` dépassé | Écritures protégées, message, données gardées en mémoire et envoyées | U `data-layer` « préfixe, JSON corrompu, quota dépassé, stockage indisponible » |
| SYNC-19 | Cache local corrompu | Lectures protégées, entrées invalides ignorées, clé d'origine jamais supprimée | U `data-layer` « entrées invalides dans le cache ignorées », « JSON d'origine illisible conservé » |

## 2. Emploi du temps (EDT)

| ID | Risque | (a) Prévention | (b) Test(s) |
|---|---|---|---|
| EDT-01 | Blocage CORS (vérifié : ADE n'envoie aucun en-tête CORS) | Fonction Edge `edt-proxy` | U `edt-proxy` ; E2E via la vraie fonction (serveur de test) ; **M** `npm run smoke:edt` contre la vraie URL — exécuté le 13/10/2026 : HTTP 200, en-tête CORS absent, 61 séances analysées, 0 avertissement |
| EDT-02 | Proxy ouvert détourné | Utilisateur connecté vérifié auprès de Supabase Auth, hôte/chemins/paramètres en liste blanche, pas de redirection suivie, plage bornée, taille max | U `edt-proxy` « anonyme… 401 », « hôte non autorisé », « paramètres supplémentaires ignorés », « plage… refusée » |
| EDT-03 | Format qui change (page HTML, ICS invalide) | `BEGIN:VCALENDAR` exigé, erreur typée, cache conservé | U `timetable` « page HTML ADE », « texte quelconque » ; U `edt-proxy` (format) ; E2E `timetable` « source indisponible ou format changé » |
| EDT-04 | Source indisponible / lente | Délai 15 s, 502/504 clairs, version périmée servie si disponible, cache local | U `edt-proxy` « source indisponible / lente… », « STALE » ; E2E `timetable` |
| EDT-05 | Jeton expiré (nouveau semestre) | Lien modifiable dans Réglages, message explicite | E2E `timetable` (mode « html ») ; U `grades-validation` « Lien ADE » ; E2E « sans lien ADE… » |
| EDT-06 | Jeton personnel dans le dépôt public | Jamais en dur ; réglages synchronisés ; exclu des exports ; fixtures anonymisées | U `static-checks` (aucun `data=<hex>` long) ; U `data-layer` export « sans le lien ADE » |
| EDT-07 | Fuseau Europe/Paris et changement d'heure | `Intl` + `timeZone: "Europe/Paris"` | U `dates` (25/10/2026, 28/03/2027, TZ du processus changé) ; U `timetable` (semaine du 25/10) ; E2E « navigation… » (lundi 02/11 à 08:00) |
| EDT-08 | Cours qui se chevauchent | Colonnes par grappe | U `timetable` « chevauchements » ; E2E « cas limites : chevauchements côte à côte » |
| EDT-09 | Journée entière | `VALUE=DATE`, bandeau « Journée » | U `timetable` ; E2E « cas limites » |
| EDT-10 | Semaines vides / vacances | État vide explicite | U `timetable` « semaine de vacances » ; E2E « … semaine de vacances » |
| EDT-11 | Texte trop long | Coupure visuelle + détail complet au tap | E2E « cas limites » (intitulé complet dans le détail) |
| EDT-12 | Contenu malveillant / mal formé | Échappement systématique ; lignes invalides ignorées ; taille max | U `timetable` « contenu malveillant », « ligne illisible » ; E2E « cas limites » (aucune image injectée, aucune boîte de dialogue) |
| EDT-13 | Zoom / pinch-to-zoom qui cassent la mise en page | Zoom par variables CSS, conteneur défilant, viewport sans `user-scalable=no` | E2E « zoom − / + / réinitialiser… mémorisée » ; E2E `timetable-swipe` (pinch-zoom non bloqué) ; captures zoom 150 % relues |
| EDT-14 | Annulations | `STATUS:CANCELLED` / « annul » → barré + libellé | U `timetable` « annulations » ; E2E « cas limites » |
| EDT-15 | Cache EDT ancien jamais rafraîchi | Rafraîchissement auto à l'ouverture au-delà d'1 h | U `ui-logic` « devient ancien après 1 h » ; E2E « rafraîchissement automatique à l'ouverture… (et pas avant) » |

## 3. Agenda des devoirs

| ID | Risque | (a) Prévention | (b) Test(s) |
|---|---|---|---|
| AG-01 | Échéance aujourd'hui / à minuit | Heure murale de Paris (`AAAA-MM-JJ` + `HH:MM`), 23:59 par défaut | U `homework` « échéance aujourd'hui à minuit (00:00) » |
| AG-02 | Fin de mois / bissextile | Arithmétique calendaire en UTC pur | U `homework` « fin de mois, année bissextile, changement d'année » ; U `dates` |
| AG-03 | Anticipation qui place le début dans le passé | État « à commencer maintenant » (pas « en retard ») + message dans le formulaire | U `homework` « … début dans le passé » ; E2E `homework` « valeurs par défaut… » (message) |
| AG-04 | Devoir sans matière | `subjectCode` nullable | U `homework` ; E2E `homework` « … devoir sans matière accepté » |
| AG-05 | Devoir en retard | État calculé, mis en tête | U `homework` ; E2E `home` « À faire maintenant… trié par urgence » |
| AG-06 | Tri par urgence incohérent | Formule unique documentée ; tri optimisé prouvé équivalent | U `homework` « formule documentée », « ordre », « tri optimisé = comparateur de référence » ; E2E `homework` « vue Liste : tri par urgence… » |
| AG-07 | Saisie invalide | Validation + messages | U `grades-validation` « Validation des devoirs » ; E2E `homework` « validation… » |

## 4. Notes

| ID | Risque | (a) Prévention | (b) Test(s) |
|---|---|---|---|
| N-01 | Régression du calcul | Fonction copiée verbatim ; golden figés (17 jeux) + différentiel aléatoire | G `golden` (71 tests, valeurs inchangées depuis la phase 0) ; E2E `notes` « valeurs affichées identiques aux valeurs golden » (5 jeux, via la vraie migration) |
| N-02 | Ordre des notes différent selon l'appareil | Tri déterministe (création puis id) = ordre d'origine | U `grades-validation` « ordre déterministe » ; U `data-layer` « calcul via le dépôt = valeurs golden » |
| N-03 | Flottants (0.1 + 0.2) | Aucun arrondi ajouté ; `toFixed(2)` comme avant | G « notes-decimales » ; U `numbers-escape-uuid` |
| N-04 | Somme des coefficients = 0 | Comportement d'origine (`null`) | G « coefficient-zero », « aleatoire-coeff-zero » |
| N-05 | Virgule française | `parseDecimal` + `inputmode="decimal"` | U `numbers-escape-uuid` ; E2E `notes` « virgule française » ; E2E `home` « 3 interactions… virgule » |
| N-06 | Hors barème / négatif / barème nul | Validation de saisie (calcul inchangé) ; import : valeurs historiques gardées, barème ≤ 0 rejeté | U `grades-validation` ; E2E `notes` « validation hors barème » |
| N-07 | Champs vides | Validation | U `grades-validation` |
| N-08 | Matière supprimée avec des notes liées | Matières fixes ; code inconnu conservé, affiché, non compté (comme avant) | G « code-inconnu » |
| N-09 | Détail UE ≠ valeur affichée | Même boucle, même valeur ; test d'égalité stricte | U `grades-validation` « au bit près » (jeux golden + 500 aléatoires) ; E2E `notes` et `keyboard` (détail = carte) |
| N-10 | Injection via import (nom, note, id) | Import validé/typé ; échappement ; aucun `onclick` construit | U `numbers-escape-uuid`, `data-layer` « fichiers piégés », `static-checks` « aucun gestionnaire en ligne » |

## 5. Interface

| ID | Risque | (a) Prévention | (b) Test(s) |
|---|---|---|---|
| UI-01 | Pas de survol sur iPhone | Détail au tap et au focus, `aria-expanded` / `aria-describedby` | E2E `notes` (iPhone : tap) ; E2E `keyboard` (focus) |
| UI-02 | Tooltip qui déborde | Position bornée au viewport, sous l'en-tête et au-dessus de la barre d'onglets, hauteur max + défilement | U `ui-logic` « Positionnement… » ; E2E `notes` « dans l'écran », « 320 px » |
| UI-03 | Zones tactiles trop petites | Cibles ≥ 44 px | E2E `navigation` « zones tactiles d'au moins 44 px » (toutes les pages, desktop + iPhone) |
| UI-04 | Encoche / safe-area | `viewport-fit=cover`, `env(safe-area-inset-*)` | E2E `navigation` « encoche / safe-area » ; **M** rendu sur un vrai iPhone à encoche |
| UI-05 | Clavier mobile qui masque le champ | Champs ramenés au centre au focus dans les fenêtres, `scroll-padding` | **M** : le clavier virtuel n'existe pas dans les navigateurs de test (checklist iPhone) |
| UI-06 | Textes tronqués | Troncature seulement avec accès au détail | E2E « cas limites » ; captures relues (desktop + iPhone) |
| UI-07 | États vide / chargement / erreur réseau | États dédiés | E2E `timetable`, `home`, `homework` |
| UI-08 | Erreurs console / requêtes en échec | Tout servi localement ; surveillance dans chaque test E2E | Tous les E2E (`watchPage`) ; seules les erreurs provoquées volontairement sont tolérées, au cas par cas |
| UI-09 | Bouton retour | Routage par hash | E2E `navigation` « une URL par page… bouton retour » |
| UI-10 | Lenteur avec 500+ entrées | Rendu de la page active, scores précalculés, cache des conversions | E2E `perf` : accueil affiché en 88–143 ms avec 600 notes + 600 devoirs |
| UI-11 | Mise à jour jamais proposée | Suivi du contrôleur du service worker | E2E `production` « mise à jour du service worker » |
