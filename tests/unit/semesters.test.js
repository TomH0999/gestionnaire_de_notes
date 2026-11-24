/**
 * Programme S1 à S6, calcul par semestre et tableau de bord.
 */
import { describe, it, expect } from "vitest";
import { PROGRAM_S1, COEFFICIENTS_UE } from "../../js/core/program.js";
import { SUBJECTS, UE_TABLES } from "../../js/core/curriculum-data.js";
import { SEMESTERS, PARCOURS, semesterUes, semesterSubjects, semesterOfSubject, needsParcours, isKnownSubjectCode, subjectKind } from "../../js/core/curriculum.js";
import { calculateAllAverages, sortGradesForCalculation } from "../../js/core/grades-calc.js";
import { computeSemester, buildDashboard, defaultSemester, moduleUeBreakdown } from "../../js/core/semester-calc.js";
import { validateGradeInput } from "../../js/core/validation.js";

let n = 0;
const grade = (subjectCode, score, max = 20, coeff = 1) => ({ id: `g${String(++n).padStart(4, "0")}`, name: `Éval ${n}`, subjectCode, score, max, coeff, createdAt: n });

describe("programme (MCCC)", () => {
    it("S1 : mêmes UE et coefficients que le calcul d'origine", () => {
        const ues = semesterUes(1);
        expect(ues.map((u) => u.code)).toEqual(PROGRAM_S1.ues.map((u) => u.code));
        for (const ue of ues) {
            const flat = {};
            for (const m of ue.modules) {
                const sum = m.items.reduce((a, [, c]) => a + c, 0);
                expect(sum, `${ue.code} : somme du module = coefficient du module`).toBe(m.coef);
                for (const [code, c] of m.items) flat[code] = c;
            }
            expect(flat).toEqual(COEFFICIENTS_UE[ue.code]);
        }
        expect(semesterSubjects(1).map((s) => s.code).sort()).toEqual([...PROGRAM_S1.ressources, ...PROGRAM_S1.saes].map((s) => s.code).sort());
    });

    it("chaque matière citée existe, appartient au bon semestre, codes uniques", () => {
        const codes = SUBJECTS.map((s) => s.code);
        expect(new Set(codes).size).toBe(codes.length);
        for (const sem of SEMESTERS) {
            const tables = UE_TABLES[sem].common ? [UE_TABLES[sem].common] : Object.values(UE_TABLES[sem].parcours);
            for (const ues of tables) {
                for (const ue of ues) {
                    expect(ue.code.startsWith(`UE ${sem}.`)).toBe(true);
                    expect(ue.modules.length).toBeGreaterThan(0);
                    for (const m of ue.modules) {
                        expect(m.coef).toBeGreaterThan(0);
                        for (const [code, c] of m.items) {
                            expect(isKnownSubjectCode(code), code).toBe(true);
                            expect(semesterOfSubject(code), code).toBe(sem);
                            expect(c).toBeGreaterThan(0);
                        }
                    }
                }
            }
        }
        for (const s of SUBJECTS) {
            const m = /^R(\d)/.exec(s.code) || /^SAE (\d)/.exec(s.code) || /S(\d)$/.exec(s.code);
            expect(Number(m[1]), s.code).toBe(s.semester);
        }
    });

    it("tronc commun S1-S3, parcours à partir du S4 ; 6 UE puis 3 UE en BUT 3", () => {
        expect([1, 2, 3].map(needsParcours)).toEqual([false, false, false]);
        expect([4, 5, 6].map(needsParcours)).toEqual([true, true, true]);
        expect(semesterUes(4)).toBeNull();
        expect(semesterUes(4, "inconnu")).toBeNull();
        for (const p of PARCOURS) {
            expect(semesterUes(4, p.id)).toHaveLength(6);
            expect(semesterUes(5, p.id)).toHaveLength(3);
            expect(semesterUes(6, p.id)).toHaveLength(3);
        }
        expect(semesterUes(5, "RACDV").map((u) => u.code)).toEqual(["UE 5.1", "UE 5.2", "UE 5.6"]);
        expect(semesterUes(5, "DACS").map((u) => u.code)).toEqual(["UE 5.1", "UE 5.3", "UE 5.6"]);
        expect(semesterUes(5, "IAMSI").map((u) => u.code)).toEqual(["UE 5.1", "UE 5.5", "UE 5.6"]);
    });

    it("quelques coefficients relus dans les MCCC 2025-2026", () => {
        const ue = (s, p, code) => semesterUes(s, p).find((u) => u.code === code);
        expect(ue(2, null, "UE 2.1").modules).toEqual([
            { coef: 40, items: [["SAE 2.01", 38]] },
            { coef: 60, items: [["R2.02", 21], ["R2.03", 12], ["R2.01", 21], ["R2.13", 6]] }
        ]);
        expect(ue(4, "RACDV", "UE 4.1").modules[0]).toEqual({ coef: 60, items: [["Stage S4", 30], ["Portfolio S4", 5], ["SAE 4.A", 15]] });
        expect(ue(4, "IAMSI", "UE 4.1").modules.map((m) => m.coef)).toEqual([50, 50]);
        expect(ue(6, "DACS", "UE 6.3").modules[0].items).toEqual([["Portfolio S6", 5], ["SAE 6.B", 10], ["Stage S6", 45]]);
        expect(subjectKind("R4.A.11")).toBe("ressource");
        expect(subjectKind("Stage S6")).toBe("stage");
        expect(subjectKind("SAE 5.D")).toBe("sae");
    });

    it("la saisie accepte les matières de tous les semestres", () => {
        expect(validateGradeInput({ name: "TP", subjectCode: "R4.B.10", score: "12", max: "20", coeff: "1" }).ok).toBe(true);
        expect(validateGradeInput({ name: "Stage", subjectCode: "Stage S6", score: "15", max: "20", coeff: "1" }).ok).toBe(true);
        expect(validateGradeInput({ name: "?", subjectCode: "R9.99", score: "15", max: "20", coeff: "1" }).ok).toBe(false);
    });
});

describe("calcul par semestre", () => {
    it("S1 : identique au bit près au calcul d'origine, les notes des autres semestres sont ignorées", () => {
        const s1 = [grade("R1.01", 15.5), grade("R1.01", 7, 10, 2), grade("SAE 1.01", 13.37), grade("R1.06", 9, 20, 0.5), grade("R1.12", 16)];
        const others = [grade("R2.01", 4), grade("SAE 4.A", 18)];
        const expected = calculateAllAverages(sortGradesForCalculation(s1));
        const r = computeSemester([...others, ...s1], 1);
        expect(r.available).toBe(true);
        expect(r.subjectAverages).toEqual(expected.subjectAverages);
        for (const k of Object.keys(expected.ueAverages)) expect(Object.is(r.ueAverages[k], expected.ueAverages[k])).toBe(true);
        expect(Object.is(r.globalAverage, expected.globalAverage)).toBe(true);
        expect(r.status).toBe(expected.status);
        expect(r.totalEvals).toBe(5);
    });

    it("S2 : moyenne par modules (SAÉ 40 / ressources 60)", () => {
        const r = computeSemester([grade("SAE 2.01", 10), grade("R2.01", 16), grade("R2.02", 12), grade("R2.13", 20)], 2);
        // UE 2.1 : module SAÉ = 10 ; module ressources = (16×21 + 12×21 + 20×6) / 48 = 14.75
        expect(r.ueAverages["UE 2.1"]).toBeCloseTo((10 * 40 + 14.75 * 60) / 100, 12);
        // UE 2.2 : seule R2.01 notée → module ressources = 16, module SAÉ absent
        expect(r.ueAverages["UE 2.2"]).toBe(16);
        // UE 2.4 : aucune matière notée
        expect(r.ueAverages["UE 2.4"]).toBeNull();
        const values = Object.values(r.ueAverages).filter((v) => v !== null);
        expect(r.globalAverage).toBeCloseTo(values.reduce((a, b) => a + b, 0) / values.length, 12);
        expect(r.status).toBe("En cours d'évaluation");
    });

    it("S4 sans parcours : moyennes non calculées ; avec parcours : modules 60/40 (RACDV) ou 50/50 (IAMSI)", () => {
        const grades = [grade("Stage S4", 16), grade("SAE 4.A", 10), grade("R4.01", 8)];
        const none = computeSemester(grades, 4);
        expect(none.available).toBe(false);
        expect(none.globalAverage).toBeNull();
        expect(none.subjects.length).toBeGreaterThan(20); // toutes les matières du S4 restent saisissables
        const racdv = computeSemester(grades, 4, "RACDV");
        // UE 4.1 : module A = (16×30 + 10×15) / 45 = 14 ; module B = 8 ; UE = (14×60 + 8×40) / 100
        expect(racdv.ueAverages["UE 4.1"]).toBeCloseTo((14 * 60 + 8 * 40) / 100, 12);
        const iamsi = computeSemester([grade("Stage S4", 16), grade("SAE 4.D", 10), grade("R4.01", 8)], 4, "IAMSI");
        expect(iamsi.ueAverages["UE 4.1"]).toBeCloseTo((14 * 50 + 8 * 50) / 100, 12);
    });

    it("statut neutre au-delà du S1 (pas de verdict officiel inventé)", () => {
        const all = semesterUes(3).flatMap((u) => u.modules.flatMap((m) => m.items.map(([c]) => c)));
        const good = computeSemester([...new Set(all)].map((c) => grade(c, 14)), 3);
        expect(good.status).toBe("Toutes les UE à 10 ou plus");
        const mixed = computeSemester([...new Set(all)].map((c) => grade(c, c === "SAE 3" ? 2 : 11)), 3);
        expect(mixed.status).toMatch(/UE sous 10$/);
    });

    it("détail d'une UE : même résultat que la moyenne affichée", () => {
        const grades = [grade("SAE 5.A", 12), grade("R5.A.10", 15), grade("R5.01", 9)];
        const r = computeSemester(grades, 5, "RACDV");
        for (const ue of r.ues) expect(Object.is(moduleUeBreakdown(ue, r.subjectAverages).result, r.ueAverages[ue.code])).toBe(true);
    });

    it("semestre par défaut : le dernier où des notes existent", () => {
        expect(defaultSemester([])).toBe(1);
        expect(defaultSemester([grade("R1.01", 10), grade("R3.05", 12)])).toBe(3);
        expect(defaultSemester([grade("CODE INCONNU", 10)])).toBe(1);
    });
});

describe("tableau de bord", () => {
    it("moyenne globale, compétences, meilleure et pire matière, progression", () => {
        const grades = [grade("R1.01", 16), grade("SAE 1.01", 12), grade("R2.01", 8), grade("SAE 2.01", 10), grade("R2.07", 18)];
        const d = buildDashboard(grades);
        const s1 = d.semesters[0];
        const s2 = d.semesters[1];
        expect(d.semestersRated).toBe(2);
        expect(d.globalAverage).toBeCloseTo((s1.globalAverage + s2.globalAverage) / 2, 12);
        expect(d.bestSubject).toMatchObject({ code: "R2.07", value: 18, semester: 2 });
        expect(d.worstSubject).toMatchObject({ code: "R2.01", value: 8 });
        expect(d.topSubjects.map((s) => s.code)).toEqual(["R2.07", "R1.01", "SAE 1.01", "SAE 2.01", "R2.01"]);
        expect(d.bottomSubjects).toEqual([]); // 5 matières : toutes déjà parmi les meilleures
        const more = buildDashboard([...grades, grade("R2.03", 4), grade("R2.04", 6)]);
        expect(more.bottomSubjects.map((s) => s.code)).toEqual(["R2.03", "R2.04"]);
        expect(d.progression).toEqual([{ from: 1, to: 2, delta: s2.globalAverage - s1.globalAverage }]);
        const c1 = d.competences.find((c) => c.id === 1);
        expect(c1.value).toBeCloseTo((s1.ueAverages["UE 1.1"] + s2.ueAverages["UE 2.1"]) / 2, 12);
        expect(s1.bestGrade).toMatchObject({ code: "R1.01", value: 16 });
        expect(s2.worstGrade).toMatchObject({ code: "R2.01" });
        expect(s2.gradeCount).toBe(3);
        expect(s2.gradesAbove10).toBe(2);
        expect(d.semesters[2]).toMatchObject({ hasData: false, globalAverage: null, gradeCount: 0 });
        expect(d.missingParcours).toBe(false);
    });

    it("signale un parcours manquant quand des notes de S4+ existent", () => {
        expect(buildDashboard([grade("R4.01", 12)]).missingParcours).toBe(true);
        expect(buildDashboard([grade("R4.01", 12)], "DACS").missingParcours).toBe(false);
    });

    it("aucune note : rien n'est calculé", () => {
        const d = buildDashboard([]);
        expect(d).toMatchObject({ globalAverage: null, semestersRated: 0, bestSubject: null, gradeCount: 0, uesRated: 0 });
    });
});
