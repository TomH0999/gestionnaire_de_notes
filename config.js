/**
 * Configuration publique de l'application (lue par le navigateur, servie par GitHub Pages).
 *
 * Renseignez l'URL de votre projet Supabase et sa clé PUBLIQUE :
 *   - clé « publishable » (commence par sb_publishable_) : Supabase → Project Settings → API Keys ;
 *   - ou, sur un ancien projet, la clé « anon » (même rôle).
 * Voir docs/CONFIGURATION.md.
 *
 * - La clé publique PEUT être publiée : la sécurité repose sur la connexion et la RLS.
 * - Ne mettez JAMAIS ici la clé « secret » (sb_secret_…) ni « service_role » (un test le vérifie).
 * - Laisser vide = mode local (aucune synchronisation, comme la version d'origine).
 */
window.GDN_CONFIG = {
    supabaseUrl: "https://wcdjcpcmavbslwmicosx.supabase.co/rest/v1/",
    supabaseKey: "sb_publishable_BAHiz2mhBcvt9Sja0u7MqQ_ZcMZz0l2"
};
