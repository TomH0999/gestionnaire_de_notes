import js from "@eslint/js";
import globals from "globals";

/**
 * Lint : règles recommandées + interdiction des console.log oubliés (console.warn / error
 * autorisés pour les vrais incidents), code de l'application en contexte navigateur,
 * tests et scripts en contexte Node.
 */
export default [
    {
        ignores: [
            "node_modules/**",
            "assets/**",
            "test-results/**",
            "playwright-report/**",
            "coverage/**",
            "tests/golden/legacy/**",
            "supabase/functions/**/*.ts"
        ]
    },
    js.configs.recommended,
    {
        files: ["js/**/*.js", "config.js", "config.example.js", "tests/mock-server/http-test-backend.js"],
        languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.browser } },
        rules: {
            "no-console": ["error", { allow: ["warn", "error"] }],
            "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            eqeqeq: ["error", "always"],
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error"
        }
    },
    {
        files: ["config.js", "config.example.js"],
        languageOptions: { sourceType: "script" }
    },
    {
        files: ["sw.js"],
        languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: { ...globals.serviceworker } },
        rules: { "no-console": "error" }
    },
    {
        files: ["tests/**/*.js", "tests/**/*.mjs", "scripts/**/*.mjs", "*.config.js", "*.config.cjs", "eslint.config.js"],
        languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node, ...globals.browser } },
        rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] }
    },
    {
        files: ["tailwind.config.cjs"],
        languageOptions: { sourceType: "commonjs", globals: { ...globals.node } }
    }
];
