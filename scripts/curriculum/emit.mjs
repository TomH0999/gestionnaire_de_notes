import { readFileSync, writeFileSync } from "node:fs";
const [, , jsonPath, outPath, programPath] = process.argv;
const cur = JSON.parse(readFileSync(jsonPath, "utf8"));
const { PROGRAM_S1 } = await import(programPath);
const s1Names = new Map([...PROGRAM_S1.ressources, ...PROGRAM_S1.saes].map((s) => [s.code, s.name]));
const subjects = cur.subjects.map((s) => ({ code: s.code, name: s1Names.get(s.code) || s.name, semester: s.semester }));
const num = (n) => (Number.isInteger(n) ? n : n);
const ue = (u) => ({ code: u.code, competence: u.competence, ects: u.ects, modules: u.modules.map((m) => ({ coef: num(m.coef), items: m.items.map(([c, k]) => [c, num(k)]) })) });
const tables = {};
for (const [sem, t] of Object.entries(cur.semesters)) {
    if (t.common) tables[sem] = { common: Object.values(t.common).map(ue) };
    else tables[sem] = { parcours: Object.fromEntries(Object.entries(t.parcours).map(([p, ues]) => [p, Object.values(ues).map(ue)])) };
}
const body = `/**
 * Programme du BUT Informatique, semestres 1 à 6 — FICHIER GÉNÉRÉ, ne pas modifier à la main.
 *
 * Source : ${cur.source}.
 * Pour chaque UE : les modules (coefficient du module) et, dans chaque module, les ressources /
 * SAÉ / stage / portfolio avec leur coefficient, exactement comme dans les MCCC.
 * Semestres 1 à 3 : tronc commun. Semestres 4 à 6 : selon le parcours (RACDV, DACS, IAMSI).
 *
 * Valeurs absentes des MCCC (ligne coupée dans le PDF) et déduites des autres UE du même
 * semestre et parcours : S4 RACDV UE 4.3 module SAÉ/stage = 60 ; S4 DACS UE 4.4 = 60 / 40.
 * S3 : le document DACS indique R3.03 = 12 dans l'UE 3.2 (somme du module 67 pour 60) ;
 * la valeur RACDV (5, somme 60) est retenue pour le tronc commun.
 */
export const CURRICULUM_SOURCE = ${JSON.stringify(cur.source)};

export const SUBJECTS = ${JSON.stringify(subjects, null, 1).replace(/\n\s*/g, " ").replace(/\}, \{/g, "},\n    {").replace(/^\[ /, "[\n    ").replace(/ \]$/, "\n]")};

export const UE_TABLES = ${JSON.stringify(tables)};
`;
writeFileSync(outPath, body);
console.log("ok", subjects.length, "matières");
