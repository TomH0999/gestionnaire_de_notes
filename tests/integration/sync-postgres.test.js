/**
 * Les mêmes scénarios de synchronisation, contre un vrai Postgres (PGlite) exécutant
 * supabase/schema.sql avec la RLS active. Les scénarios qui exigent de piloter l'horloge
 * du serveur sont couverts par le serveur mémoire et par les tests SQL du trigger.
 */
import { defineSyncScenarios } from "./sync-scenarios.js";
import { createPgliteEnv } from "./pglite-env.js";
import { createClock } from "./helpers.js";

defineSyncScenarios(
    "Postgres réel (PGlite) + schema.sql + RLS",
    async () => createPgliteEnv(createClock(new Date().toISOString())),
    { controllableServerClock: false }
);
