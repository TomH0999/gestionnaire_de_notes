# BUT1 Informatique — suivi de scolarité

Application personnelle (PWA) pour le BUT1 Informatique de l'IUT de Montpellier-Sète :

- **Notes et moyennes** : même calcul, mêmes arrondis que la version d'origine (vérifié par
  des tests « golden »), saisie avec virgule ou point, détail du calcul de chaque UE au survol,
  au toucher ou au clavier ;
- **Emploi du temps** (ADE) : vues Jour et Semaine, zoom, cours en cours / prochain, consultable hors-ligne ;
- **Devoirs, SAÉ, tests et contrôles** : calendrier mensuel avec période d'anticipation, liste triée par urgence ;
- **Accueil « Aujourd'hui »** : cours restants, ce qu'il faut commencer, saisies rapides, moyennes d'UE ;
- **Synchronisation** entre iPhone, PC fixe et PC portable (Supabase), en temps réel, avec
  fonctionnement complet hors-ligne.

Site : <https://tomh0999.github.io/gestionnaire_de_notes/>

---

## Installation & Utilisation PWA

Cette application s'utilise directement dans le navigateur ou s'installe sur votre appareil pour un accès hors-ligne.

### PC (Windows, Mac, Linux)

1. Ouvrez [la page déployée](https://tomh0999.github.io/gestionnaire_de_notes/) dans **Chrome**, **Edge** ou **Brave**.
2. Cliquez sur l'icône d'installation située à droite dans la barre d'adresse.
3. Si l'icône n'apparaît pas, ouvrez le menu du navigateur (trois points) puis sélectionnez **Installer l'application...**

### iOS (iPhone & iPad)

1. Ouvrez le site dans **Safari**.
2. Appuyez sur le bouton **Partager** (icône carré avec flèche vers le haut).
3. Défilez vers le bas et sélectionnez **Sur l'écran d'accueil**.
4. Validez en appuyant sur **Ajouter**.

Installée ainsi, l'application fonctionne hors-ligne et iOS conserve ses données.

### Android

1. Ouvrez le site dans **Chrome**.
2. Appuyez sur les trois points en haut à droite.
3. Choisissez **Installer l'application** (ou *Ajouter à l'écran d'accueil*).
4. Validez l'installation.

---

## Synchronisation entre appareils

Sans configuration, l'application fonctionne **en local** (comme la première version).
Pour synchroniser vos appareils et afficher l'emploi du temps, suivez le guide
**[Configuration en 5 minutes](docs/CONFIGURATION.md)** (projet Supabase gratuit, un fichier
`config.js` à remplir, une fonction à déployer). Le fonctionnement détaillé (modèle de
données, règles de conflit, migration) est décrit dans [docs/SYNCHRONISATION.md](docs/SYNCHRONISATION.md).

### Sauvegarde des données

- **Réglages → Sauvegarde → Exporter** génère un fichier `.json` (notes, devoirs, réglages ;
  jamais le lien ADE personnel). Sur mobile, vous pouvez le sauvegarder ou l'envoyer directement.
- **Importer** accepte ce format **et** les fichiers exportés par l'ancienne version ;
  l'import ajoute ou met à jour, sans jamais rien supprimer.
- Au premier lancement de cette version, une **sauvegarde automatique** des anciennes notes
  est créée (téléchargeable depuis l'accueil et les Réglages) ; les anciennes données
  restent intactes sur l'appareil.

---

## Développement

Site statique sans étape de build côté hébergement (GitHub Pages sert le dépôt tel quel).
Outils de développement et de test (Node.js 22.18+ ou 24) :

```bash
npm install
```

| Commande | Rôle |
|---|---|
| `npm run serve` | Sert le site comme GitHub Pages sur <http://127.0.0.1:4173/gestionnaire_de_notes/> |
| `npm test` | Tests unitaires, golden, intégration (synchro, SQL/RLS sur Postgres réel via PGlite) |
| `npm run test:e2e` | Tests de bout en bout Playwright (Chromium desktop, WebKit iPhone, version de production) |
| `npm run test:all` | Lint + feuille CSS à jour + toutes les suites |
| `npm run lint` | ESLint |
| `npm run build:css` | Recompile `assets/css/tailwind.css` (à lancer après avoir ajouté des classes Tailwind) |
| `npm run build` | Recopie les bibliothèques locales, recompile le CSS et les icônes |
| `npm run smoke:edt` | Test manuel contre la **vraie** source ADE (lien lu dans `EDT_URL`, jamais enregistré) |

Avant le premier `npm run test:e2e` : `npx playwright install chromium webkit`.

### Publier une nouvelle version

1. Incrémentez la version **à deux endroits identiques** : `js/version.js` et `VERSION` dans
   `sw.js` (et `package.json`) — un test vérifie qu'elles concordent. C'est ce qui fait
   arriver la mise à jour sur l'iPhone (bandeau « Nouvelle version — Recharger »).
2. `npm run test:all`, puis commit et push sur `main` : GitHub Pages publie.

### Structure

```
index.html, style.css, sw.js, manifest.json, config.js   site publié
js/core/        logique pure : calcul (code d'origine), dates Paris, devoirs, EDT, validation
js/data/        stockage local, file d'attente, fusion, moteur de synchro, migration, adaptateurs
js/ui/          coquille, navigation, pages (accueil, notes, EDT, devoirs, réglages)
assets/         Tailwind compilé, Font Awesome, police Inter, supabase-js (servis localement)
supabase/       schema.sql (tables, RLS, trigger) et fonction Edge edt-proxy
tests/          golden, unit, integration, e2e, serveur de test, fixtures EDT anonymisées
docs/           configuration, synchronisation, risques et tests, exigences, avancement
```
