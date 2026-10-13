/**
 * EXEMPLE de configuration (équivalent d'un .env.example pour ce site statique sans build).
 * Copiez les deux valeurs de votre projet dans config.js (même format), puis commitez config.js :
 * GitHub Pages sert les fichiers du dépôt tels quels.
 *
 *  supabaseUrl     : Supabase → Project Settings → API → Project URL
 *  supabaseAnonKey : Supabase → Project Settings → API Keys → clé « anon » (public) ou « publishable »
 *
 * Seule la clé PUBLIQUE va ici. La clé « service_role » / « secret » ne doit jamais être
 * copiée dans le dépôt ni dans le navigateur.
 */
window.GDN_CONFIG = {
    supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
    supabaseAnonKey: "colle-ici-la-cle-publique-anon-ou-publishable"
};
