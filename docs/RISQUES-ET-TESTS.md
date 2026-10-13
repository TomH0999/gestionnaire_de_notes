# Analyse des risques (pré-mortem) et tests associés

Ce document pilote la phase de tests : chaque risque indique **(a)** comment il est évité
dans le code et **(b)** quel(s) test(s) le détectent. Les identifiants de tests renvoient aux
fichiers de `tests/` (`unit/`, `integration/`, `e2e/`, `golden/`).

Légende des types de tests : **G** golden · **U** unitaire (Vitest) · **I** intégration (Vitest) ·
**SQL** Postgres réel en WASM (PGlite) · **E2E** Playwright (Chromium desktop + WebKit iPhone) ·
**M** test manuel documenté.

---

## 1. Synchronisation et données en ligne

| ID | Risque | (a) Prévention | (b) Test(s) |
|---|---|---|---|
| SYNC-01 | Conflit : la même entrée modifiée sur deux appareils | Fusion 3 voies par champ (base connue / local / distant) ; si le même champ diffère des deux côtés, la modification la plus récente gagne (horodatage d'édition corrigé du décalage d'horloge, départage déterministe par `device_id`). La version perdante est archivée dans le journal des conflits + notification. | U `merge.test.js` ; I `sync-two-clients.test.js` « modifications simultanées » |
| SYNC-02 | Suppression non propagée (l'entrée réapparaît) | Suppression logique (`deleted_at`) synchronisée comme une modification ; pierres tombales conservées ; jamais de `DELETE` SQL (aucune politique RLS de suppression). | I « suppression A → disparaît en B » ; SQL « DELETE refusé » |
| SYNC-03 | Une modification hors-ligne écrase une modification plus récente faite ailleurs | Mise à jour conditionnelle (`updated_at` de base) : si la ligne a changé côté serveur, on récupère la version distante et on fusionne au lieu d'écraser. | I « A hors-ligne modifie, B modifie, A revient » |
| SYNC-04 | Doublons à la migration initiale (deux appareils avec des données locales) | Identifiants **déterministes** (UUID v5 du contenu de la note + rang d'occurrence) : la même note migrée depuis deux appareils produit le même identifiant ; insertion `ON CONFLICT DO NOTHING` puis fusion. Les 3 notes d'exemple d'origine ne sont pas migrées (elles restent dans la sauvegarde). | U `migration.test.js` ; I « migration depuis deux appareils » |
| SYNC-05 | Horloges d'appareils décalées | L'ordre et les curseurs de synchro utilisent **l'horloge serveur** (`updated_at` posé par trigger). L'horodatage d'édition sert seulement à départager un vrai conflit ; il est corrigé par l'écart mesuré avec le serveur et **plafonné côté serveur** (`≤ now() + 1 min`). | U `merge.test.js` « horloge en avance » ; SQL « plafonnement client_updated_at » ; I « appareil avec horloge décalée » |
| SYNC-06 | Perte de données hors-ligne | Écriture locale d'abord (cache `localStorage`), entrée marquée « à envoyer » ; la file n'est vidée qu'après accusé de réception serveur. | I « hors-ligne puis reconnexion » ; E2E `offline.spec.js` |
| SYNC-07 | File d'attente rejouée deux fois | File « par état » (entrées sales) et non par opérations ; une réécriture identique est reconnue (même `device_id` + même horodatage d'édition + même contenu) et confirmée sans doublon. | I « file rejouée deux fois (idempotence) » |
| SYNC-08 | Coupure réseau en pleine écriture (requête perdue avant ou après validation serveur) | Les deux cas sont rejouables : avant → la ligne n'existe pas, on réinsère ; après → conflit apparent résolu comme « notre propre écriture ». | I « coupure avant commit » / « réponse perdue après commit » |
| SYNC-09 | Session expirée / jeton invalide | Erreur d'authentification détectée → état « Session expirée, reconnectez-vous », la file locale est conservée et renvoyée après reconnexion. Rafraîchissement automatique du jeton par supabase-js. | I « session expirée » ; U `supabase-backend.test.js` (mappage 401) |
| SYNC-10 | iOS suspend la connexion temps réel en arrière-plan | Resynchronisation complète au retour au premier plan (`visibilitychange`, `focus`), à la reconnexion (`online`) et au démarrage ; rattrapage incrémental avec fenêtre de recouvrement ; sondage de secours toutes les 60 s si le temps réel est coupé. | I « événement temps réel manqué → rattrapé au pull » ; E2E `sync.spec.js` « retour au premier plan » |
| SYNC-11 | iOS vide le stockage local des sites non installés (ITP 7 jours) | Les données sont dans le cloud dès la connexion ; `navigator.storage.persist()` demandé ; indicateur « N modifications en attente » visible ; guide : installer la PWA sur l'écran d'accueil. | M (documenté) ; I « cache local vidé → tout est re-téléchargé » |
| SYNC-12 | Le service worker sert une vieille version sur iPhone | Cache versionné (`gdn-static-<version>`), pré-cache avec `cache: 'reload'` (contourne le cache HTTP de GitHub Pages), enregistrement `updateViaCache: 'none'`, vérification de mise à jour au retour au premier plan, bannière « Nouvelle version — Recharger ». `config.js` en réseau d'abord. | U `sw.test.js` ; E2E `pwa.spec.js` « mise à jour du service worker » |
| SYNC-13 | RLS mal configurée (données lisibles par n'importe qui) | RLS activée + politiques `user_id = auth.uid()` en lecture/insertion/mise à jour, aucun droit pour `anon`, pas de politique de suppression. | SQL `sync-sql-rls.test.js` : anonyme ne lit/écrit rien, B ne voit pas A, B ne peut pas modifier une ligne de A ni usurper `user_id` |
| SYNC-14 | Clé `service_role` ou secret commité | Seule la clé publique (anon/publishable) est lue depuis `config.js` ; test qui scanne le dépôt. | U `security.test.js` |
| SYNC-15 | Curseur de synchro qui saute une ligne (transactions validées dans le désordre) | Rattrapage avec recouvrement de 2 min + resynchronisation complète périodique (12 h) ; application des lignes idempotente. | U `sync-engine` « recouvrement » ; I « ligne tardive rattrapée » |
| SYNC-16 | Deux onglets ouverts sur le même appareil | Événement `storage` → rechargement de l'état local ; envoi idempotent. | U `repository.test.js` « événement storage » |
| SYNC-17 | Changement d'utilisateur sur l'appareil | Cache local cloisonné par utilisateur (`gdn:v2:<uid>:…`) ; les données « invité » sont adoptées au premier compte connecté uniquement. | U `repository.test.js` « cloisonnement » ; I « adoption des données locales » |
| SYNC-18 | Quota `localStorage` dépassé | Écriture protégée (try/catch) → message d'erreur clair, la donnée reste en mémoire et part au cloud. | U `local-store.test.js` « quota » |
| SYNC-19 | Données corrompues dans le cache local | Lecture JSON protégée ; entrées invalides ignorées et signalées ; ancienne clé historique jamais supprimée. | U `local-store.test.js`, `migration.test.js` « JSON invalide » |

## 2. Emploi du temps (EDT)

| ID | Risque | (a) Prévention | (b) Test(s) |
|---|---|---|---|
| EDT-01 | Blocage CORS (ADE n'envoie aucun en-tête CORS — vérifié) | Fonction Supabase Edge `edt-proxy` : récupère l'ICS côté serveur. | U `edt-proxy.test.js` ; M smoke test réel `npm run smoke:edt` |
| EDT-02 | Proxy ouvert détourné | Utilisateur authentifié obligatoire (vérification du JWT auprès de Supabase Auth), hôte autorisé unique `proseconsult.umontpellier.fr`, chemins et paramètres en liste blanche, plage de dates bornée. | U `edt-proxy.test.js` « hôte refusé », « anonyme refusé », « paramètre injecté » |
| EDT-03 | Format de la source qui change (page HTML, erreur, ICS invalide) | Le parseur exige `BEGIN:VCALENDAR` ; erreur typée « format inattendu » affichée ; le cache précédent est conservé. | U `timetable-parse.test.js` « HTML au lieu d'ICS » ; E2E « source au format inattendu » |
| EDT-04 | Source indisponible / lente | Délai max 15 s côté proxy, message clair, cache local consultable hors-ligne avec « dernière mise à jour à… ». | U `edt-proxy.test.js` « 502 » ; E2E `timetable.spec.js` « source indisponible » |
| EDT-05 | Jeton ADE expiré (nouveau semestre) | URL modifiable dans Réglages (synchronisée, protégée par RLS) ; erreur explicite si ADE renvoie autre chose qu'un calendrier. | E2E « modifier l'URL dans Réglages » |
| EDT-06 | Jeton personnel dans le dépôt public | Jamais en dur : stocké dans les réglages synchronisés ; fixtures anonymisées ; test de scan. | U `security.test.js` « aucun jeton ADE » |
| EDT-07 | Fuseau Europe/Paris et changement d'heure | Conversion via `Intl` avec `timeZone: 'Europe/Paris'` (indépendante du fuseau de l'appareil). | U `dates.test.js`, `timetable-parse.test.js` « semaine du 25/10 » (tests lancés aussi avec `TZ=America/New_York`) |
| EDT-08 | Cours qui se chevauchent (groupes A/B) | Disposition en colonnes par grappes de chevauchement. | U `timetable-layout.test.js` ; E2E capture |
| EDT-09 | Événements sur la journée / sur plusieurs jours | `VALUE=DATE` géré, bandeau « Toute la journée ». | U « événement journée entière » |
| EDT-10 | Semaines vides / vacances | État vide « Aucun cours cette semaine ». | U + E2E « semaine de vacances » |
| EDT-11 | Texte trop long | Coupure visuelle mais détail complet au clic/tap (rien de tronqué sans accès). | E2E « détail complet au tap » |
| EDT-12 | Contenu malveillant ou mal formé (HTML dans SUMMARY, lignes cassées) | Tout texte échappé à l'affichage ; lignes invalides ignorées ; taille max. | U « SUMMARY avec <script> » ; E2E aucune exécution |
| EDT-13 | Zoom qui casse la mise en page / pinch-to-zoom | Zoom par variable CSS (hauteur d'heure + taille de texte), conteneur défilant ; viewport sans `user-scalable=no`. | E2E « zoom −/+/réinitialiser mémorisé » |
| EDT-14 | Annulations | `STATUS:CANCELLED` ou « annul » dans le titre/description → barré + libellé « Annulé ». | U « cours annulé » |

## 3. Agenda des devoirs

| ID | Risque | (a) Prévention | (b) Test(s) |
|---|---|---|---|
| AG-01 | Échéance aujourd'hui / à minuit | Dates stockées en heure murale de Paris (`AAAA-MM-JJ` + `HH:MM`), converties de façon explicite ; 23:59 par défaut pour un devoir. | U `homework.test.js` « échéance à minuit », « aujourd'hui » |
| AG-02 | Fin de mois / année bissextile | Arithmétique sur des dates calendaires (UTC pur), pas de `setDate` locale. | U « 29 février 2028 », « 31 → 1er » |
| AG-03 | Anticipation qui place le début dans le passé | État « à commencer maintenant » (et non « en retard ») tant que l'échéance n'est pas passée. | U « début dans le passé » |
| AG-04 | Devoir sans matière | `subjectCode` nullable, affichage « Sans matière ». | U + E2E |
| AG-05 | Devoir en retard | État calculé « en retard », mis en avant (bonus d'urgence). | U « en retard » |
| AG-06 | Tri par urgence incohérent | Formule unique documentée et testée (voir `js/core/homework.js`). | U « ordre d'urgence » |
| AG-07 | Saisie invalide (titre vide, date invalide) | Validation avant enregistrement, messages en français. | U `validation.test.js` ; E2E |

## 4. Notes

| ID | Risque | (a) Prévention | (b) Test(s) |
|---|---|---|---|
| N-01 | Régression du calcul | Fonction de calcul copiée **verbatim**, tests golden figés + différentiel aléatoire contre la version d'origine. | G `golden.test.js` |
| N-02 | Ordre des notes différent selon l'appareil (sommes flottantes) | Tri déterministe avant calcul (date de création puis id) qui reproduit l'ordre d'origine. | U `grades-calc.test.js` « ordre déterministe » |
| N-03 | Flottants (0.1 + 0.2) | Aucun arrondi intermédiaire ajouté ; affichage `toFixed(2)` comme avant. | G « notes-decimales » |
| N-04 | Somme des coefficients = 0 | Comportement d'origine conservé (moyenne `null` = « sans note »). | G « coefficient-zero » |
| N-05 | Virgule française (« 12,5 ») | `parseDecimal` accepte virgule et point, refuse le reste ; champs `inputmode="decimal"`. | U `numbers.test.js` ; E2E saisie « 12,5 » |
| N-06 | Notes hors barème / négatives / barème nul | Validation de saisie (0 ≤ note ≤ barème, barème > 0, coeff > 0). Le calcul lui-même n'est pas modifié. | U `validation.test.js` |
| N-07 | Champs vides | Validation + message. | U + E2E |
| N-08 | Matière supprimée alors que des notes y sont liées | Les matières sont fixes (programme BUT1) ; un code inconnu (import) est conservé mais ignoré dans les moyennes, comme avant. | G « code-inconnu » |
| N-09 | Détail UE différent de la valeur affichée | Le détail réutilise la même boucle et la même valeur ; test d'égalité stricte. | U `grades-calc.test.js` ; E2E « tooltip = carte » |
| N-10 | Injection HTML via un import JSON (nom, note, id) | Données importées validées/typées ; tout est échappé ; plus aucun `onclick` construit avec des données. | U `escape.test.js`, `backup.test.js` ; U `security.test.js` |

## 5. Interface

| ID | Risque | (a) Prévention | (b) Test(s) |
|---|---|---|---|
| UI-01 | Pas de survol sur iPhone (détail UE) | Détail ouvert au tap et au focus clavier, attributs `aria-expanded`/`aria-describedby`. | E2E `notes.spec.js` « tap (iPhone) » / « clavier » |
| UI-02 | Tooltip qui déborde de l'écran | Positionnement calculé et borné au viewport (8 px), hauteur max + défilement. | E2E « tooltip dans le viewport » (360 px et desktop) |
| UI-03 | Zones tactiles trop petites | Cibles ≥ 44 px (barre d'onglets, cases « fait », boutons). | E2E « tailles tactiles » |
| UI-04 | Encoche / safe-area | `viewport-fit=cover` + `env(safe-area-inset-*)` sur l'en-tête et la barre d'onglets. | E2E capture iPhone ; U vérification CSS |
| UI-05 | Clavier mobile qui masque le champ | `scrollIntoView` au focus des champs dans les feuilles/modales, modales défilantes. | M (iPhone réel) |
| UI-06 | Textes tronqués | Troncature uniquement avec accès au détail complet. | E2E captures relues |
| UI-07 | États vide / chargement / erreur réseau | États dédiés pour chaque liste et pour l'EDT. | E2E |
| UI-08 | Erreurs console / requêtes en échec | Aucune dépendance CDN (tout est servi localement), garde des erreurs. | E2E : écoute `console` + `requestfailed` sur chaque parcours |
| UI-09 | Navigation : bouton retour | Routage par hash (`#/notes`…), historique natif. | E2E `navigation.spec.js` |
| UI-10 | Lenteur avec 500+ notes et devoirs | Rendu par page active seulement, calculs en O(n). | E2E `perf.spec.js` (600 notes + 600 devoirs) |
