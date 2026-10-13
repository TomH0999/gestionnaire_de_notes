# Configuration en 5 minutes (Supabase)

Sans cette configuration, l'application fonctionne déjà **en mode local** (comme avant :
données sur l'appareil, pastille « Local »). Ces étapes activent la synchronisation entre
l'iPhone, le PC fixe et le PC portable, ainsi que l'emploi du temps.

Ce qu'il vous faut : votre compte GitHub (le site est déjà publié sur GitHub Pages) et
10 minutes au maximum. Rien à installer.

---

## 1. Créer le projet Supabase (≈ 2 min)

1. Allez sur <https://supabase.com> → **Start your project** → connectez-vous (le plus simple :
   « Continue with GitHub »).
2. **New project** :
   - *Name* : `gestionnaire-de-notes` ;
   - *Database Password* : cliquez sur **Generate a password** et gardez-le dans votre
     gestionnaire de mots de passe (il ne sert pas à l'application) ;
   - *Region* : **Europe (Paris)** ou **Europe (Frankfurt)** ;
   - offre **Free**.
3. **Create new project**, puis attendez la fin de la création (≈ 1 min).

## 2. Créer la table et la sécurité (≈ 1 min)

1. Menu de gauche → **SQL Editor** → **New query**.
2. Copiez **tout** le fichier [`supabase/schema.sql`](../supabase/schema.sql)
   (sur GitHub : ouvrir le fichier → bouton **Copy raw file**), collez-le, cliquez sur **Run**.
   Résultat attendu : `Success. No rows returned`.
3. Vérification : **Table Editor** → la table `items` existe et n'affiche **pas** de badge
   rouge « RLS disabled » / « Unrestricted ».

Le script est rejouable sans risque (il ne supprime aucune donnée).

## 3. Créer votre compte puis fermer les inscriptions (≈ 1 min)

Méthode recommandée (aucun e-mail de confirmation à gérer) :

1. **Authentication** → **Users** → **Add user** → **Create new user** :
   votre adresse e-mail, un mot de passe solide (12 caractères ou plus), cochez
   **Auto Confirm User** → **Create user**.
2. **Désactivez les inscriptions publiques** : **Authentication** → **Sign In / Providers**
   (selon la version : *Authentication → Settings*, ou dans le fournisseur **Email**) →
   désactivez **Allow new users to sign up** → **Save**.
   Votre compte continue de fonctionner ; plus personne ne peut en créer un autre.

Autre méthode : bouton **Créer le compte** dans les Réglages de l'application. Il faut alors
confirmer l'adresse e-mail : réglez d'abord **Authentication → URL Configuration → Site URL**
sur `https://tomh0999.github.io/gestionnaire_de_notes/`, puis **désactivez les inscriptions**
comme au point 2 une fois votre compte créé.

## 4. Brancher l'application (≈ 1 min)

1. Récupérez les deux valeurs (le bouton **Connect** en haut du tableau de bord les affiche aussi) :
   - **Project URL** : *Project Settings → Data API* (ou *API*), de la forme `https://xxxxxxxx.supabase.co` ;
   - **clé publique** : *Project Settings → API Keys* → clé **Publishable** (`sb_publishable_…`).
     Sur un projet ancien, l'onglet *Legacy API keys* donne la clé `anon` `public`, qui convient aussi.
   - ⚠️ Ne copiez **jamais** la clé **secret** (`sb_secret_…`) ni **service_role**.
2. Dans le dépôt, ouvrez [`config.js`](../config.js) et remplissez :

   ```js
   window.GDN_CONFIG = {
       supabaseUrl: "https://xxxxxxxx.supabase.co",
       supabaseKey: "sb_publishable_..."
   };
   ```

   (Modèle commenté : [`config.example.js`](../config.example.js). Cette clé est publique par
   nature : la sécurité repose sur la connexion et la RLS.)
3. Publiez : sur GitHub, bouton ✏️ sur `config.js` → *Commit changes*, ou en local :

   ```bash
   git add config.js
   git commit -m "Configuration Supabase"
   git push
   ```

   GitHub Pages republie en une minute environ. `config.js` est toujours relu depuis le réseau
   par l'application installée : inutile de changer de version.

## 5. Emploi du temps : déployer la fonction `edt-proxy` (≈ 2 min)

Pourquoi : le serveur ADE de l'université n'autorise pas la lecture directe depuis un
navigateur (aucun en-tête CORS). Cette petite fonction récupère le calendrier côté serveur.
Elle n'est **pas** un proxy ouvert : seul un utilisateur connecté à votre projet peut
l'appeler, et uniquement vers `proseconsult.umontpellier.fr`.

Depuis le tableau de bord (rien à installer) :

1. **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nom de la fonction : `edt-proxy` (exactement).
3. Remplacez le code d'exemple par **tout** le contenu de
   [`supabase/functions/edt-proxy/index.ts`](../supabase/functions/edt-proxy/index.ts)
   → **Deploy function**.
4. Ouvrez la fonction → **Details** (ou *Settings*) → désactivez **Verify JWT**
   (« Enforce JWT verification ») → **Save**. La fonction vérifie elle-même, auprès de
   Supabase Auth, que l'appel vient d'un utilisateur connecté ; l'option de la plateforme ne
   comprend que les anciennes clés et bloquerait les clés « publishable ».

En ligne de commande (alternative) :

```bash
npx supabase login
```

```bash
npx supabase functions deploy edt-proxy --project-ref VOTRE_REF --no-verify-jwt
```

Secrets facultatifs (**Edge Functions → Secrets**) : voir
[`supabase/functions/.env.example`](../supabase/functions/.env.example)
(`ALLOWED_ORIGINS`, `EDT_SOURCE_URL`).

## 6. Sur chaque appareil

1. Ouvrez <https://tomh0999.github.io/gestionnaire_de_notes/>.
   Sur iPhone : **Safari → Partager → Sur l'écran d'accueil**, puis utilisez l'application
   installée (iOS conserve alors ses données hors-ligne).
2. **Réglages → Compte et synchronisation** : e-mail + mot de passe → **Se connecter**
   (une seule fois : la session reste ouverte).
   - Les notes déjà présentes sur l'appareil sont reprises automatiquement, sans doublon,
     même si plusieurs appareils en avaient ; une **sauvegarde JSON** est proposée au
     premier lancement (bandeau sur l'accueil, et *Réglages → Sauvegarde*).
3. Sur **un seul** appareil : **Réglages → Emploi du temps** → collez votre lien ADE
   (`https://proseconsult.umontpellier.fr/direct/?data=…`) → **Enregistrer et actualiser**.
   Le lien est synchronisé vers vos autres appareils. À chaque nouveau semestre, remplacez-le ici.

## Vérifier que tout marche

- La pastille en haut indique **Synchronisé** (verte).
- Ajoutez une note sur le PC : elle apparaît sur l'iPhone en quelques secondes.
- Supabase → **Table Editor → items** : une ligne par note, devoir ou réglage.
- La page **Emploi du temps** affiche « Dernière mise à jour : … ».

## Dépannage

| Message dans l'application | Cause probable | Que faire |
|---|---|---|
| « Adresse e-mail ou mot de passe incorrect. » | Faute de frappe, ou compte inexistant | Vérifier dans *Authentication → Users* |
| « Adresse e-mail non confirmée… » | Compte créé sans *Auto Confirm User* | *Users* → votre compte → confirmer, ou le recréer avec *Auto Confirm User* |
| « Les inscriptions sont désactivées… » | Normal après l'étape 3 | Utiliser « Se connecter » |
| « La fonction edt-proxy n'est pas déployée… » | Étape 5 non faite (ou autre nom) | Déployer la fonction sous le nom exact `edt-proxy` |
| EDT : « Connexion requise » ou erreur 401 | *Verify JWT* activé avec les nouvelles clés | Désactiver *Verify JWT* (étape 5.4) |
| EDT : « … page web au lieu d'un calendrier… le lien a peut-être expiré » | Nouveau semestre : lien ADE changé | Copier le nouveau lien depuis ADE → Réglages |
| Pastille « Erreur de synchro » pendant longtemps | Projet gratuit **mis en pause** après 7 jours sans activité | Tableau de bord → **Restore project**. Rien n'est perdu : l'application continue hors-ligne et renvoie tout ensuite |
| Pastille « Session expirée » | Session révoquée (mot de passe changé, déconnexion à distance) | Réglages → se reconnecter : les modifications en attente partent alors |

## Sécurité, en bref

- La table `items` est protégée par **RLS** : chaque compte ne voit et ne modifie que ses lignes ;
  sans connexion, rien n'est lisible (testé sur un vrai Postgres, voir `tests/integration/sql-rls.test.js`).
- Les suppressions sont logiques (`deleted_at`) : aucune suppression physique n'est possible depuis l'application.
- Le lien ADE (jeton personnel) n'est jamais dans le code : il est stocké dans vos réglages,
  protégés par la RLS, et n'est jamais inclus dans les exports JSON.
- Appareil perdu : changez votre mot de passe (*Authentication → Users*), les autres sessions devront se reconnecter.
