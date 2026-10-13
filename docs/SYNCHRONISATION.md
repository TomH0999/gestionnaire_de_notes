# Synchronisation : modèle de données et règles de conflit

## Modèle

Une seule table Supabase, `items` (voir `supabase/schema.sql`) : une ligne par entrée.

| Colonne | Rôle |
|---|---|
| `user_id`, `id` | Clé primaire. `id` = UUID généré par l'appareil (v4 aléatoire ; v5 déterministe pour la migration et pour les réglages : un id par clé de réglage). |
| `collection` | `grades` (notes), `homework` (devoirs/évaluations), `settings` (réglages). |
| `data` | Contenu JSON de l'entrée. Les notes gardent **exactement** le format d'origine : `name, subjectCode, score, max, coeff` (+ `createdAt`, `legacyId`). |
| `deleted_at` | Suppression **logique** (jamais de `DELETE`). |
| `updated_at` | **Horloge du serveur**, posée par trigger à chaque écriture, strictement croissante par ligne. |
| `client_updated_at` | Moment de l'édition sur l'appareil, corrigé de l'écart mesuré avec le serveur, plafonné à `now() + 1 min` par le trigger. |
| `device_id` | Appareil auteur de la dernière modification. |

Sur l'appareil, le dépôt local (`js/data/repository.js`) garde la même entrée avec : la
dernière version serveur connue (`serverUpdatedAt`), un drapeau `dirty` (modification à
envoyer = **file d'attente**), et la **base** (version serveur au moment de la première
modification locale non envoyée) pour la fusion.

## Quand synchronise-t-on ?

Au démarrage ; après chaque modification locale (≈ 0,4 s plus tard) ; à chaque événement
**temps réel** (Supabase Realtime, filtré par la RLS) ; au **retour au premier plan**
(`visibilitychange`, `focus`) ; à la **reconnexion** (`online`) ; en secours toutes les 60 s
si le temps réel est coupé ; avec un délai croissant (2 s → 2 min) après une erreur.

Un cycle = mesure de l'heure du serveur → *pull* (lignes avec `updated_at ≥ curseur − 2 min`,
recouvrement qui rattrape une transaction validée en retard ; resynchronisation complète
toutes les 12 h) → *push* des entrées `dirty`.

## Règles de conflit

1. **Ordre** : seul l'horloge du **serveur** (`updated_at`) ordonne les versions et sert de
   curseur. Une écriture est **conditionnelle** : `UPDATE … WHERE id = … AND updated_at = <base>` ;
   une insertion est `ON CONFLICT DO NOTHING`. Si la ligne a changé entre-temps, rien n'est
   écrasé : l'appareil relit la version serveur et fusionne.
2. **Fusion 3 voies, champ par champ** (base / local / serveur) :
   - champ modifié d'un seul côté → cette modification est gardée (ex. note modifiée sur
     l'iPhone + nom modifié sur le PC → les deux sont conservés) ;
   - même champ modifié des deux côtés → la **modification la plus récente** gagne, d'après
     `client_updated_at` (horloge de l'appareil **corrigée** de l'écart mesuré avec le serveur,
     **plafonnée** par le serveur) ; égalité parfaite → départage déterministe par appareil.
3. **Suppression contre modification** : la plus récente gagne.
4. **Aucune perte silencieuse** : toute valeur locale écartée est inscrite dans le
   **journal des conflits** (Réglages) et signalée par une notification ; elle figure aussi
   dans l'export JSON.
5. **Idempotence** : rejouer la file d'attente (réponse perdue, coupure en pleine écriture)
   ne crée ni doublon ni faux conflit : une écriture identique déjà présente est reconnue.

## Migration des données d'origine

Clé `localStorage` historique `BUT1_INFO_S1_GRADES` : jamais modifiée ni supprimée. Au
premier lancement, une sauvegarde JSON est créée (téléchargeable depuis le bandeau d'accueil
et Réglages), puis chaque note reçoit un **UUID v5 calculé depuis son contenu** (matière, nom
normalisé, note, barème, coefficient) et son rang parmi les notes identiques : la même note
migrée depuis deux appareils a donc le même identifiant (zéro doublon), deux notes identiques
d'un même appareil restent deux notes. Les 3 notes d'exemple créées automatiquement par
l'ancienne version (contenu intact) ne sont pas reprises (elles restent dans la sauvegarde).
La migration est relancée à chaque démarrage et n'ajoute que les notes absentes ; une note
supprimée dans la nouvelle version n'est jamais ressuscitée.

## Ordre des notes et précision des moyennes

`calculateAllAverages` est le code d'origine, inchangé. Les notes lui sont passées dans un
ordre déterministe (date de création = ancien identifiant `Date.now()`, puis identifiant),
identique à l'ordre d'origine : les sommes flottantes, donc les moyennes affichées, sont les
mêmes au bit près sur tous les appareils (tests golden).

## Limites connues

- Les suppressions faites dans l'**ancienne** version sur un appareil ne sont pas connues des
  autres appareils : une note supprimée sur l'un mais encore présente sur l'autre réapparaît
  à la migration (elle se supprime ensuite normalement).
- Une note modifiée sur un appareil **après** un import manuel entre appareils (même contenu
  d'origine, valeurs différentes) peut apparaître en double après migration : à supprimer à la main.
- Si l'horloge d'un appareil change brutalement pendant une longue période hors-ligne,
  l'horodatage de ses modifications en attente peut être faussé (le plafonnement serveur
  limite l'effet d'une horloge en avance).
