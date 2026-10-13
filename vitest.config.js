import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/golden/**/*.test.js", "tests/unit/**/*.test.js", "tests/integration/**/*.test.js"],
        environment: "node",
        testTimeout: 30000,
        hookTimeout: 30000
    }
});
