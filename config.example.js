/**
 * EXEMPLE de configuration (équivalent d'un .env.example pour ce site statique sans build).
 * Copiez les deux valeurs de votre projet dans config.js (même format), puis commitez config.js :
 * GitHub Pages sert les fichiers du dépôt tels quels.
 *
 *  supabaseUrl : Supabase → Project Settings → API → Project URL (https://<ref>.supabase.co)
 *  supabaseKey : Supabase → Project Settings → API Keys → clé « Publishable » (sb_publishable_…)
 *                (sur un ancien projet : la clé « anon public », même rôle)
 *
 * Seule la clé PUBLIQUE va ici. La clé « secret » (sb_secret_…) ou « service_role » ne doit
 * jamais être copiée dans le dépôt ni dans le navigateur.
 */
window.GDN_CONFIG = {
    supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
    supabaseKey: "sb_publishable_colle-ici-ta-cle-publique"
};
