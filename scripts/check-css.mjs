/**
 * Vérifie que assets/css/tailwind.css correspond au HTML et au JS actuels
 * (sinon : npm run build:css). Utilisé par npm run test:all.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "gdn-css-"));
try {
    const out = path.join(tmp, "tailwind.css");
    const cli = path.join(root, "node_modules", "tailwindcss", "lib", "cli.js");
    execFileSync(process.execPath, [cli, "-c", "tailwind.config.cjs", "-i", "assets/css/tailwind.input.css", "-o", out, "--minify"], { cwd: root, stdio: "pipe" });
    const norm = (s) => s.replace(/\r\n/g, "\n").trim();
    if (norm(readFileSync(out, "utf8")) !== norm(readFileSync(path.join(root, "assets", "css", "tailwind.css"), "utf8"))) {
        console.error("assets/css/tailwind.css est obsolète : lancez « npm run build:css » puis commitez le fichier.");
        process.exit(1);
    }
    console.log("Feuille Tailwind à jour.");
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
