/**
 * Moyennes par semestre et tableau de bord sur toute la scolarité.
 *
 *  - Semestre 1 : calcul d'origine, inchangé (calculateAllAverages, tests « golden »).
 *  - Semestres 2 à 6 : calcul des MCCC, par modules.
 *      matière = Σ (note / barème × 20 × coeff) / Σ coeff (même formule qu'au S1) ;
 *      module  = Σ (moyenne matière × coeff) / Σ coeff, sur les matières notées du module ;
 *      UE      = Σ (moyenne module × coeff module) / Σ coeff, sur les modules ayant une moyenne ;
 *      semestre = moyenne simple des UE calculées (toutes ont le même nombre d'ECTS).
 *    Les sommes sont faites dans un ordre fixe : le classement (SQL) obtient les mêmes valeurs
 *    au bit près (vérifié par ses tests).
 */
import { calculateAllAverages, sortGradesForCalculation } from "./grades-calc.js";
import { SEMESTERS, COMPETENCES, semesterUes, semesterSubjects, semesterOfSubject, needsParcours, subjectInfo } from "./curriculum.js";

const NEUTRAL = "bg-slate-800 text-slate-400 border-slate-700";
const PROGRESS = "bg-brand-500/20 text-brand-400 border-brand-500/30";
const GOOD = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
const WARN = "bg-amber-500/20 text-amber-400 border-amber-500/30";

/** Notes d'un semestre, dans l'ordre déterministe du calcul. */
export function gradesOfSemester(grades, semester) {
    return sortGradesForCalculation(grades.filter((g) => semesterOfSubject(g.subjectCode) === semester));
}

function subjectAveragesFor(grades, subjects) {
    const out = {};
    for (const s of subjects) {
        let scoreSum = 0;
        let coeffSum = 0;
        let any = false;
        for (const g of grades) {
            if (g.subjectCode !== s.code) continue;
            any = true;
            scoreSum += (g.score / g.max) * 20 * g.coeff;
            coeffSum += g.coeff;
        }
        out[s.code] = any && coeffSum > 0 ? scoreSum / coeffSum : null;
    }
    return out;
}

/** Détail du calcul d'une UE (semestres 2 à 6) : modules, matières, sommes, résultat. */
export function moduleUeBreakdown(ue, subjectAverages) {
    let weighted = 0;
    let total = 0;
    const modules = ue.modules.map((m) => {
        let sum = 0;
        let coeffs = 0;
        const rows = m.items.map(([code, coeff]) => {
            const avg = subjectAverages[code];
            const counted = avg !== null && avg !== undefined;
            if (counted) {
                sum += avg * coeff;
                coeffs += coeff;
            }
            const info = subjectInfo(code);
            return { code, name: info ? info.name : code, coeff, average: counted ? avg : null, counted };
        });
        const average = coeffs > 0 ? sum / coeffs : null;
        if (average !== null) {
            weighted += average * m.coef;
            total += m.coef;
        }
        return { coef: m.coef, rows, sum, coeffs, average };
    });
    return { ueCode: ue.code, ueName: ue.name, modules, weightedSum: weighted, totalCoeffs: total, result: total > 0 ? weighted / total : null };
}

function statusFor(semester, ueValues, ueCount) {
    if (ueValues.length === 0) return { status: "Non calculé", statusClass: NEUTRAL };
    if (ueValues.length < ueCount) return { status: "En cours d'évaluation", statusClass: PROGRESS };
    const under = ueValues.filter((v) => v < 10).length;
    if (under === 0) return { status: "Toutes les UE à 10 ou plus", statusClass: GOOD };
    return { status: `${under} UE sous 10`, statusClass: WARN };
}

/**
 * Moyennes d'un semestre. Renvoie { semester, available, ues, subjects, subjectAverages,
 * ueAverages, globalAverage, status, statusClass, totalEvals }. available = false quand le
 * semestre dépend du parcours et qu'aucun parcours n'est choisi.
 */
export function computeSemester(allGrades, semester, parcours = null) {
    const grades = gradesOfSemester(allGrades, semester);
    const ues = semesterUes(semester, parcours);
    const subjects = semesterSubjects(semester, parcours);
    if (!ues) {
        return { semester, available: false, ues: [], subjects, subjectAverages: {}, ueAverages: {}, globalAverage: null, status: "Choisissez votre parcours", statusClass: NEUTRAL, totalEvals: grades.length };
    }
    if (semester === 1) {
        const r = calculateAllAverages(grades);
        return { semester, available: true, ues, subjects, ...r };
    }
    const subjectAverages = subjectAveragesFor(grades, subjects);
    const ueAverages = {};
    const values = [];
    for (const ue of ues) {
        const avg = moduleUeBreakdown(ue, subjectAverages).result;
        ueAverages[ue.code] = avg;
        if (avg !== null) values.push(avg);
    }
    const globalAverage = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return { semester, available: true, ues, subjects, subjectAverages, ueAverages, globalAverage, ...statusFor(semester, values, ues.length), totalEvals: grades.length };
}

export function computeAllSemesters(grades, parcours = null) {
    return SEMESTERS.map((s) => computeSemester(grades, s, parcours));
}

/** Semestre à ouvrir par défaut : le dernier semestre où des notes existent, sinon le S1. */
export function defaultSemester(grades) {
    let best = 1;
    for (const g of grades) {
        const s = semesterOfSubject(g.subjectCode);
        if (s && s > best) best = s;
    }
    return best;
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function extremes(entries) {
    // entries : [{ ..., value }] ; meilleure et pire valeur (premier rencontré en cas d'égalité)
    let best = null;
    let worst = null;
    for (const e of entries) {
        if (best === null || e.value > best.value) best = e;
        if (worst === null || e.value < worst.value) worst = e;
    }
    return { best, worst };
}

/**
 * Tableau de bord : statistiques par semestre et sur toute la scolarité.
 * La moyenne globale est la moyenne simple des moyennes de semestre calculées ; la moyenne
 * d'une compétence est la moyenne simple de ses UE calculées (UE n.c, tous semestres).
 */
export function buildDashboard(grades, parcours = null) {
    const semesters = computeAllSemesters(grades, parcours).map((r) => {
        const semGrades = gradesOfSemester(grades, r.semester);
        const normalized = semGrades.map((g) => ({ grade: g, value: (g.score / g.max) * 20 })).filter((x) => Number.isFinite(x.value));
        const subjectEntries = r.subjects.filter((s) => r.subjectAverages[s.code] !== null && r.subjectAverages[s.code] !== undefined).map((s) => ({ code: s.code, name: s.name, value: r.subjectAverages[s.code] }));
        const ueEntries = r.ues.filter((u) => r.ueAverages[u.code] !== null && r.ueAverages[u.code] !== undefined).map((u) => ({ code: u.code, name: u.name, competence: u.competence, value: r.ueAverages[u.code] }));
        const gradeExt = extremes(normalized.map((x) => ({ name: x.grade.name, code: x.grade.subjectCode, score: x.grade.score, max: x.grade.max, value: x.value })));
        return {
            ...r,
            hasData: semGrades.length > 0,
            gradeCount: semGrades.length,
            gradeMean: mean(normalized.map((x) => x.value)),
            gradesAbove10: normalized.filter((x) => x.value >= 10).length,
            subjectsRated: subjectEntries.length,
            subjectsTotal: r.subjects.length,
            uesRated: ueEntries.length,
            uesAbove10: ueEntries.filter((u) => u.value >= 10).length,
            bestSubject: extremes(subjectEntries).best,
            worstSubject: extremes(subjectEntries).worst,
            bestUe: extremes(ueEntries).best,
            worstUe: extremes(ueEntries).worst,
            bestGrade: gradeExt.best,
            worstGrade: gradeExt.worst,
            subjectEntries,
            ueEntries
        };
    });

    const rated = semesters.filter((s) => s.globalAverage !== null);
    const allSubjects = semesters.flatMap((s) => s.subjectEntries.map((e) => ({ ...e, semester: s.semester })));
    const allUes = semesters.flatMap((s) => s.ueEntries.map((e) => ({ ...e, semester: s.semester })));
    const competences = COMPETENCES.map((c) => {
        const ues = allUes.filter((u) => u.competence === c.id);
        return { ...c, value: mean(ues.map((u) => u.value)), count: ues.length, ues };
    });
    const semExt = extremes(rated.map((s) => ({ semester: s.semester, value: s.globalAverage })));
    const progression = [];
    for (let i = 1; i < rated.length; i++) {
        progression.push({ from: rated[i - 1].semester, to: rated[i].semester, delta: rated[i].globalAverage - rated[i - 1].globalAverage });
    }
    const sortedSubjects = [...allSubjects].sort((a, b) => b.value - a.value || a.code.localeCompare(b.code));
    return {
        semesters,
        globalAverage: mean(rated.map((s) => s.globalAverage)),
        semestersRated: rated.length,
        competences,
        bestSemester: semExt.best,
        worstSemester: semExt.worst,
        bestSubject: sortedSubjects[0] || null,
        worstSubject: sortedSubjects[sortedSubjects.length - 1] || null,
        topSubjects: sortedSubjects.slice(0, 5),
        // Les plus faibles, sans répéter celles déjà listées parmi les meilleures
        bottomSubjects: sortedSubjects.slice(Math.max(5, sortedSubjects.length - 5)).reverse(),
        uesRated: allUes.length,
        uesAbove10: allUes.filter((u) => u.value >= 10).length,
        gradeCount: semesters.reduce((n, s) => n + s.gradeCount, 0),
        progression,
        missingParcours: semesters.some((s) => !s.available && s.hasData) || (parcours === null && semesters.some((s) => needsParcours(s.semester) && s.hasData))
    };
}
