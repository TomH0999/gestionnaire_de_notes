import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { calculateAllAverages, computeUeBreakdown, sortGradesForCalculation, formatAverage } from "../../js/core/grades-calc.js";
import { PROGRAM_S1, COEFFICIENTS_UE } from "../../js/core/program.js";
import { validateGradeInput, sanitizeLegacyGrade, validateHomeworkInput } from "../../js/core/validation.js";
import { parseEdtUrl, maskEdtUrl } from "../../js/core/edt-url.js";
import { DATASETS, generateRandomGrades } from "../golden/datasets.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(path.join(here, "..", "golden", "golden-expected.json"), "utf8"));

describe("Détail du calcul d'UE (infobulle)", () => {
    it("résultat strictement identique (au bit près) à la moyenne d'UE affichée — jeux golden", () => {
        for (const [name, grades] of Object.entries(DATASETS)) {
            const data = calculateAllAverages(grades);
            for (const ue of PROGRAM_S1.ues) {
                const b = computeUeBreakdown(data.subjectAverages, ue.code);
                expect(Object.is(b.result, data.ueAverages[ue.code]), `${name} ${ue.code}`).toBe(true);
                expect(formatAverage(b.result)).toBe(golden.datasets[name].display.ue[ue.code]);
            }
        }
    });
    it("identique aussi sur 500 jeux aléatoires", () => {
        for (let seed = 1; seed <= 500; seed++) {
            const grades = generateRandomGrades(seed, seed % 80, { allowZeroCoeff: seed % 4 === 0 });
            const data = calculateAllAverages(grades);
            for (const ue of PROGRAM_S1.ues) {
                expect(Object.is(computeUeBreakdown(data.subjectAverages, ue.code).result, data.ueAverages[ue.code])).toBe(true);
            }
        }
    });
    it("lignes dans l'ordre des coefficients, matières sans note signalées et exclues", () => {
        const data = calculateAllAverages(DATASETS["notes-manquantes"]);
        const b = computeUeBreakdown(data.subjectAverages, "UE 1.1");
        expect(b.rows.map((r) => r.code)).toEqual(Object.keys(COEFFICIENTS_UE["UE 1.1"]));
        const r102 = b.rows.find((r) => r.code === "R1.02");
        expect(r102).toMatchObject({ counted: false, average: null, product: null, coeff: 12 });
        const r101 = b.rows.find((r) => r.code === "R1.01");
        expect(r101.counted).toBe(true);
        expect(r101.product).toBe(r101.average * 42);
        expect(b.totalCoeffs).toBe(40 + 42); // SAE 1.01 + R1.01 seulement
        expect(b.totalProgramCoeffs).toBe(100);
        expect(b.ueName).toBe("Réaliser un développement d'application");
    });
    it("UE sans aucune note : résultat null", () => {
        const data = calculateAllAverages([]);
        const b = computeUeBreakdown(data.subjectAverages, "UE 1.4");
        expect(b.result).toBeNull();
        expect(b.rows.every((r) => !r.counted)).toBe(true);
        expect(computeUeBreakdown(data.subjectAverages, "UE 9.9")).toBeNull();
    });
});

describe("Ordre déterministe des notes avant calcul", () => {
    it("reproduit l'ordre d'insertion d'origine (createdAt = ancien id Date.now())", () => {
        const legacy = DATASETS["cas-normal"];
        const migrated = legacy.map((g) => ({ ...g, createdAt: Number(g.id), id: `uuid-${(Number(g.id) * 7919) % 1000}` }));
        const shuffled = [...migrated].sort(() => 0.5 - Math.random()).reverse();
        const sorted = sortGradesForCalculation(shuffled);
        expect(sorted.map((g) => g.createdAt)).toEqual(legacy.map((g) => Number(g.id)));
        expect(calculateAllAverages(sorted)).toStrictEqual(calculateAllAverages(legacy));
    });
    it("départage par identifiant à date de création égale, sans muter l'entrée", () => {
        const input = [{ id: "b", createdAt: 1 }, { id: "a", createdAt: 1 }, { id: "c" }];
        const out = sortGradesForCalculation(input);
        expect(out.map((g) => g.id)).toEqual(["c", "a", "b"]);
        expect(input.map((g) => g.id)).toEqual(["b", "a", "c"]);
    });
});

describe("Validation des notes saisies", () => {
    const base = { name: "DS1", subjectCode: "R1.01", score: "12,5", max: "20", coeff: "1" };
    it("accepte la virgule française et produit des nombres", () => {
        expect(validateGradeInput(base)).toEqual({ ok: true, errors: {}, value: { name: "DS1", subjectCode: "R1.01", score: 12.5, max: 20, coeff: 1 } });
        expect(validateGradeInput({ ...base, score: "0", coeff: "0,5" }).value).toMatchObject({ score: 0, coeff: 0.5 });
        expect(validateGradeInput({ ...base, score: "20" }).ok).toBe(true);
    });
    it.each([
        [{ score: "" }, "score"],
        [{ score: "abc" }, "score"],
        [{ score: "-1" }, "score"],
        [{ score: "21" }, "score"],
        [{ max: "0" }, "max"],
        [{ max: "x" }, "max"],
        [{ coeff: "0" }, "coeff"],
        [{ coeff: "-2" }, "coeff"],
        [{ coeff: "1000" }, "coeff"],
        [{ name: "   " }, "name"],
        [{ name: "x".repeat(121) }, "name"],
        [{ subjectCode: "R9.99" }, "subjectCode"]
    ])("refuse %j (champ %s)", (patch, field) => {
        const r = validateGradeInput({ ...base, ...patch });
        expect(r.ok).toBe(false);
        expect(r.errors[field]).toBeTruthy();
    });
    it("nom par défaut pour la saisie rapide", () => {
        expect(validateGradeInput({ ...base, name: "" }, { defaultName: "Note rapide" }).value.name).toBe("Note rapide");
    });
});

describe("Assainissement des anciennes notes / imports", () => {
    it("conserve les valeurs historiques (y compris hors barème)", () => {
        expect(sanitizeLegacyGrade({ id: 1696000000000, name: "TP", subjectCode: "R1.02", score: 22, max: 20, coeff: 1 })).toEqual({
            ok: true,
            grade: { id: "1696000000000", name: "TP", subjectCode: "R1.02", score: 22, max: 20, coeff: 1 }
        });
    });
    it("convertit les chaînes numériques, valeurs par défaut du barème et du coeff", () => {
        expect(sanitizeLegacyGrade({ id: "x", name: "A", subjectCode: "R1.01", score: "12,5" }).grade).toMatchObject({ score: 12.5, max: 20, coeff: 1 });
    });
    it.each([[null], ["texte"], [[1, 2]], [{ subjectCode: "R1.01", score: "abc" }], [{ subjectCode: "R1.01", score: 10, max: 0 }], [{ subjectCode: "R1.01", score: 10, coeff: -1 }], [{ score: 10 }]])(
        "rejette %j",
        (raw) => {
            expect(sanitizeLegacyGrade(raw).ok).toBe(false);
        }
    );
    it("un nom contenant du HTML reste une simple chaîne (échappée à l'affichage)", () => {
        expect(sanitizeLegacyGrade({ name: "<img src=x onerror=alert(1)>", subjectCode: "R1.01", score: 1 }).grade.name).toBe("<img src=x onerror=alert(1)>");
    });
});

describe("Validation des devoirs", () => {
    const base = { title: "Rendu TP", type: "devoir", subjectCode: "R1.01", dueDate: "2026-10-20", dueTime: "8:05", importance: 2, anticipationDays: 2, notes: "", status: "todo" };
    it("accepte une saisie valide et normalise l'heure", () => {
        expect(validateHomeworkInput(base)).toMatchObject({ ok: true, value: { dueTime: "08:05", subjectCode: "R1.01" } });
        expect(validateHomeworkInput({ ...base, subjectCode: "" }).value.subjectCode).toBeNull();
        expect(validateHomeworkInput({ ...base, dueTime: undefined }).value.dueTime).toBe("23:59");
    });
    it.each([
        [{ title: "" }, "title"],
        [{ type: "fete" }, "type"],
        [{ subjectCode: "R9" }, "subjectCode"],
        [{ dueDate: "2026-02-30" }, "dueDate"],
        [{ dueTime: "25:00" }, "dueTime"],
        [{ importance: 5 }, "importance"],
        [{ anticipationDays: -1 }, "anticipationDays"],
        [{ notes: "x".repeat(2001) }, "notes"],
        [{ status: "perdu" }, "status"]
    ])("refuse %j", (patch, field) => {
        const r = validateHomeworkInput({ ...base, ...patch });
        expect(r.ok).toBe(false);
        expect(r.errors[field]).toBeTruthy();
    });
});

describe("Lien ADE", () => {
    const token = "0123456789abcdef".repeat(4);
    it("accepte le lien « direct » et l'export direct_cal", () => {
        expect(parseEdtUrl(`https://proseconsult.umontpellier.fr/direct/?data=${token},1`)).toEqual({ ok: true, data: `${token},1` });
        expect(parseEdtUrl(`  https://proseconsult.umontpellier.fr/jsp/custom/modules/plannings/direct_cal.jsp?data=${token}  `).ok).toBe(true);
    });
    it.each([
        ["", /Collez/],
        ["pas une url", /valide/],
        [`http://proseconsult.umontpellier.fr/direct/?data=${token}`, /https/],
        [`https://evil.example.com/direct/?data=${token}`, /Seuls/],
        [`https://proseconsult.umontpellier.fr.evil.com/direct/?data=${token}`, /Seuls/],
        [`https://proseconsult.umontpellier.fr/admin/?data=${token}`, /direct/],
        ["https://proseconsult.umontpellier.fr/direct/", /data/],
        ["https://proseconsult.umontpellier.fr/direct/?data=<script>", /data/]
    ])("refuse %s", (url, message) => {
        const r = parseEdtUrl(url);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(message);
    });
    it("masque le jeton à l'affichage", () => {
        const masked = maskEdtUrl(`https://proseconsult.umontpellier.fr/direct/?data=${token},1`);
        expect(masked).not.toContain(token);
        expect(masked).toContain("012345");
    });
});
