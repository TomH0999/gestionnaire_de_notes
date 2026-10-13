import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
    parseICS,
    parseTimetable,
    parseIcsDateTime,
    parseDuration,
    unfoldLines,
    parseContentLine,
    unescapeText,
    matchSubject,
    inferType,
    formatTeacher,
    layoutOverlaps,
    findCurrentAndNext,
    subjectColor,
    TimetableFormatError
} from "../../js/core/timetable.js";
import { parisTime, parisDayKey } from "../../js/core/dates.js";
import { escapeHtml } from "../../js/core/escape.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "edt");
const realIcs = readFileSync(path.join(fixtures, "ade-semestre-anonymise.ics"), "utf8");
const edgeIcs = readFileSync(path.join(fixtures, "cas-limites.ics"), "utf8");
const adeHtml = readFileSync(path.join(fixtures, "ade-page-direct.html"), "utf8");

describe("Bas niveau iCalendar", () => {
    it("dépliage des lignes (CRLF, LF, espace et tabulation)", () => {
        expect(unfoldLines("A:1\r\n 23\r\nB:x\n\ty")).toEqual(["A:123", "B:xy"]);
    });
    it("lecture des propriétés et paramètres (valeurs entre guillemets)", () => {
        expect(parseContentLine('DTSTART;TZID="Europe/Paris":20261013T083000')).toEqual({
            name: "DTSTART",
            params: { TZID: "Europe/Paris" },
            value: "20261013T083000"
        });
        expect(parseContentLine("LOCATION:Salle: 006")).toMatchObject({ name: "LOCATION", value: "Salle: 006" });
        expect(parseContentLine("sans deux points")).toBeNull();
        expect(parseContentLine(":valeur")).toBeNull();
    });
    it("déséchappement du texte", () => {
        expect(unescapeText("a\\nb\\, c\\; d\\\\e\\N")).toBe("a\nb, c; d\\e\n");
    });
    it("dates : UTC, flottante (Paris), TZID, journée entière, invalides", () => {
        expect(new Date(parseIcsDateTime("20261013T063000Z").ms).toISOString()).toBe("2026-10-13T06:30:00.000Z");
        expect(new Date(parseIcsDateTime("20261013T083000").ms).toISOString()).toBe("2026-10-13T06:30:00.000Z");
        expect(new Date(parseIcsDateTime("20261013T083000", { TZID: "America/New_York" }).ms).toISOString()).toBe("2026-10-13T12:30:00.000Z");
        expect(new Date(parseIcsDateTime("20261013T083000", { TZID: "Fuseau/Inconnu" }).ms).toISOString()).toBe("2026-10-13T06:30:00.000Z");
        expect(parseIcsDateTime("20261016", { VALUE: "DATE" })).toMatchObject({ allDay: true });
        expect(parseIcsDateTime("20261332T000000Z")).toBeNull();
        expect(parseIcsDateTime("20260230T100000Z")).toBeNull();
        expect(parseIcsDateTime("demain")).toBeNull();
    });
    it("durées", () => {
        expect(parseDuration("PT1H30M")).toBe(5400000);
        expect(parseDuration("P1D")).toBe(86400000);
        expect(parseDuration("P1W")).toBe(7 * 86400000);
        expect(parseDuration("-PT15M")).toBe(-900000);
        expect(parseDuration("P")).toBeNull();
        expect(parseDuration("PT")).toBeNull();
        expect(parseDuration("1H")).toBeNull();
    });
});

describe("Fixture réelle ADE (anonymisée) — 278 séances du semestre", () => {
    const { events, warnings } = parseTimetable(realIcs);

    it("toutes les séances sont lues, sans avertissement", () => {
        expect(events).toHaveLength(278);
        expect(warnings).toEqual([]);
        for (const e of events) {
            expect(e.end).toBeGreaterThan(e.start);
            expect(e.title.length).toBeGreaterThan(0);
            expect(e.allDay).toBe(false);
            expect(e.cancelled).toBe(false);
        }
    });
    it("triées chronologiquement, identifiants uniques", () => {
        for (let i = 1; i < events.length; i++) expect(events[i].start).toBeGreaterThanOrEqual(events[i - 1].start);
        expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    });
    it("enseignants, groupes et salle extraits de la description (ligne « Exported » et « A valider » retirées)", () => {
        const first = events.find((e) => e.title === "Soutien Initiation au dev");
        expect(first.teachers).toContain("Claire MARTIN");
        for (const e of events) {
            expect(e.groups.join(" ")).not.toMatch(/Exported|A valider/);
            for (const t of e.teachers) expect(t).toMatch(/^[A-ZÀ-Þ][a-zà-ÿ]+(?:[- ][A-ZÀ-Þ][a-zà-ÿ]+)* [A-ZÀ-Þ' -]+$/);
        }
        expect(events.some((e) => e.groups.includes("Sète"))).toBe(true);
        expect(events.some((e) => e.groups.includes("SèteB"))).toBe(true);
        expect(events.filter((e) => e.room === "Salle 006").length).toBeGreaterThan(200);
    });
    it("heures converties en heure de Paris, y compris après le changement d'heure du 25/10", () => {
        const before = events.find((e) => parisDayKey(e.start) === "2026-10-23" && e.title === "PPP");
        expect(parisTime(before.start)).toBe("09:30");
        expect(parisTime(before.end)).toBe("11:00");
        const after = events.find((e) => parisDayKey(e.start) === "2026-11-02");
        expect(parisTime(after.start)).toBe("08:00");
        // Toutes les séances entre 8 h et 23 h (aucun décalage d'une heure)
        for (const e of events) {
            const h = Number(parisTime(e.start).slice(0, 2));
            expect(h).toBeGreaterThanOrEqual(8);
            expect(h).toBeLessThanOrEqual(22);
        }
    });
    it("semaine de vacances (26–30/10) : aucune séance", () => {
        expect(events.filter((e) => ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].includes(parisDayKey(e.start)))).toHaveLength(0);
    });
    it("association aux matières de l'application", () => {
        const matched = events.filter((e) => e.subjectCode).length;
        expect(matched / events.length).toBeGreaterThan(0.95);
        const byTitle = Object.fromEntries(events.map((e) => [e.title, e.subjectCode]));
        expect(byTitle["Initiation au dev."]).toBe("R1.01");
        expect(byTitle["Dev. interfaces web"]).toBe("R1.02");
        expect(byTitle["Intro. archi."]).toBe("R1.03");
        expect(byTitle["Intro. systèmes"]).toBe("R1.04");
        expect(byTitle["Intro B.D."]).toBe("R1.05");
        expect(byTitle["Maths discrètes"]).toBe("R1.06");
        expect(byTitle["Outils maths. fondamentaux"]).toBe("R1.07");
        expect(byTitle["Gestion proj. orga."]).toBe("R1.08");
        expect(byTitle["Intro. Economie"]).toBe("R1.09");
        expect(byTitle["Anglais TP"]).toBe("R1.10");
        expect(byTitle["Bases de la comm."]).toBe("R1.11");
        expect(byTitle["PPP"]).toBe("R1.12");
        expect(byTitle["SAE - S1.05 - travail en autonomie"]).toBe("SAE 1.05");
        expect(byTitle["Présentation SAE 1.01 Phase 2"]).toBe("SAE 1.01");
        expect(byTitle["Rattrapage - Gestion"]).toBe("R1.08");
        expect(byTitle["Soutien BD"]).toBe("R1.05");
    });
    it("le résultat ne dépend pas du fuseau de l'appareil", () => {
        const saved = process.env.TZ;
        try {
            process.env.TZ = "America/Los_Angeles";
            expect(parseTimetable(realIcs).events.map((e) => [e.start, e.end])).toEqual(events.map((e) => [e.start, e.end]));
        } finally {
            if (saved === undefined) delete process.env.TZ;
            else process.env.TZ = saved;
        }
    });
    it("fins de ligne LF uniquement : même résultat", () => {
        expect(parseTimetable(realIcs.replace(/\r\n/g, "\n")).events).toEqual(events);
    });
});

describe("Cas limites (fixture synthétique)", () => {
    const { events, warnings } = parseTimetable(edgeIcs);
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));

    it("événement sans début ignoré, ligne illisible signalée", () => {
        expect(byId["cas-sans-debut"]).toBeUndefined();
        expect(warnings.some((w) => /sans date de début/.test(w))).toBe(true);
        expect(warnings.some((w) => /illisible/.test(w))).toBe(true);
        expect(events).toHaveLength(13);
    });
    it("journée entière (VALUE=DATE)", () => {
        const e = byId["cas-journee-entiere"];
        expect(e.allDay).toBe(true);
        expect(parisDayKey(e.start)).toBe("2026-10-16");
        expect(e.end - e.start).toBe(86400000);
    });
    it("annulations : STATUS:CANCELLED et « ANNULÉ » dans l'intitulé", () => {
        expect(byId["cas-annule-status"].cancelled).toBe(true);
        expect(byId["cas-annule-titre"].cancelled).toBe(true);
        expect(byId["cas-chevauchement-A"].cancelled).toBe(false);
    });
    it("TZID Europe/Paris de part et d'autre du changement d'heure ; heure flottante + DURATION", () => {
        expect(new Date(byId["cas-tzid-ete"].start).toISOString()).toBe("2026-10-23T07:00:00.000Z");
        expect(new Date(byId["cas-tzid-hiver"].start).toISOString()).toBe("2026-10-26T08:00:00.000Z");
        const f = byId["cas-flottant"];
        expect(parisTime(f.start)).toBe("14:00");
        expect(f.end - f.start).toBe(90 * 60000);
    });
    it("fin avant début corrigée (durée minimale), VALARM imbriqué sans effet", () => {
        const e = byId["cas-fin-avant-debut"];
        expect(e.end - e.start).toBe(15 * 60000);
        const alarm = byId["cas-alarme"];
        expect(alarm.title).toBe("Intro. Economie");
        expect(alarm.room).toBe("K014");
    });
    it("texte long et caractères échappés conservés en entier", () => {
        const e = byId["cas-texte-long"];
        expect(e.title.length).toBeGreaterThan(100);
        expect(e.groups.join("\n")).toContain("chargé, son chargeur; et le sujet imprimé \\ version 2");
        expect(e.subjectCode).toBe("SAE 1.05");
    });
    it("contenu malveillant : conservé comme texte, neutralisé par l'échappement", () => {
        const e = byId["cas-injection"];
        expect(e.title).toContain("<img");
        expect(escapeHtml(e.title)).not.toContain("<img");
        expect(escapeHtml(e.room)).not.toContain("<script>");
        expect(e.groups).toContain("<b>Groupe</b>");
    });
    it("plusieurs enseignants, type déduit de l'intitulé", () => {
        expect(byId["cas-chevauchement-C"].teachers).toEqual(["Hugo THOMAS", "Zoé GARCIA DA SILVA"]);
        expect(byId["cas-chevauchement-C"].type).toBe("TD");
        expect(byId["cas-chevauchement-A"].type).toBe("TP");
    });
});

describe("Entrées invalides", () => {
    it("réponse vide", () => {
        expect(() => parseICS("")).toThrow(TimetableFormatError);
        expect(() => parseICS(null)).toThrow(/vide/);
    });
    it("page HTML ADE (format changé / lien expiré)", () => {
        try {
            parseICS(adeHtml);
            throw new Error("aurait dû échouer");
        } catch (e) {
            expect(e).toBeInstanceOf(TimetableFormatError);
            expect(e.code).toBe("html");
        }
    });
    it("texte quelconque / JSON", () => {
        expect(() => parseICS('{"events": []}')).toThrow(expect.objectContaining({ code: "not-ics" }));
    });
    it("calendrier vide (vacances) : zéro séance, pas d'erreur", () => {
        expect(parseTimetable("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n")).toEqual({ events: [], warnings: [] });
    });
    it("calendrier tronqué : séances complètes conservées, avertissement", () => {
        const truncated = realIcs.slice(0, Math.floor(realIcs.length / 2));
        const { events, warnings } = parseTimetable(truncated);
        expect(events.length).toBeGreaterThan(100);
        expect(warnings.join(" ")).toMatch(/tronqué|incomplet/);
    });
    it("BOM UTF-8 accepté", () => {
        expect(parseTimetable("\uFEFF" + realIcs).events).toHaveLength(278);
    });
});

describe("Association matières, types et noms", () => {
    it.each([
        ["Initiation au Dev. - Test", "R1.01", "Évaluation"],
        ["SAE - S1.01 (test)", "SAE 1.01", "Évaluation"],
        ["SAE - 1.05 (examen)", "SAE 1.05", "Évaluation"],
        ["Lancement SAE S1.05 - Recueil de besoins", "SAE 1.05", "SAÉ"],
        ["Soutien Initiation au dev", "R1.01", "Soutien"],
        ["SAE - S1.04 - travail en autonomie", "SAE 1.04", "Autonomie"],
        ["Rattrapage - Economie", "R1.09", "Évaluation"],
        ["Réunion de rentrée BUT 1 - Sète", null, null],
        ["Intervention SUAPS-Présentation", null, null],
        ["CM Maths discrètes", "R1.06", "CM"]
    ])("%s → %s / %s", (title, code, type) => {
        expect(matchSubject(title)).toBe(code);
        expect(inferType(title)).toBe(type);
    });
    it("format des enseignants", () => {
        expect(formatTeacher("BAZIN   ALEXANDRE")).toBe("Alexandre BAZIN");
        expect(formatTeacher("SAMBAT COUMAR   SANJANA")).toBe("Sanjana SAMBAT COUMAR");
        expect(formatTeacher("DUPONT   JEAN-PIERRE")).toBe("Jean-Pierre DUPONT");
    });
});

describe("Mise en page et repères", () => {
    const ev = (id, start, end, extra = {}) => ({ id, start: Date.parse(start), end: Date.parse(end), cancelled: false, allDay: false, ...extra });

    it("chevauchements : colonnes par grappe", () => {
        const layout = layoutOverlaps([
            ev("A", "2026-10-14T12:00Z", "2026-10-14T14:00Z"),
            ev("B", "2026-10-14T12:30Z", "2026-10-14T14:30Z"),
            ev("C", "2026-10-14T14:00Z", "2026-10-14T15:00Z"),
            ev("D", "2026-10-14T16:00Z", "2026-10-14T17:00Z")
        ]);
        const get = (id) => layout.find((l) => l.event.id === id);
        expect(get("A")).toMatchObject({ col: 0, cols: 2 });
        expect(get("B")).toMatchObject({ col: 1, cols: 2 });
        expect(get("C")).toMatchObject({ col: 0, cols: 2 });
        expect(get("D")).toMatchObject({ col: 0, cols: 1 });
    });
    it("trois cours simultanés", () => {
        const layout = layoutOverlaps([
            ev("A", "2026-10-14T08:00Z", "2026-10-14T10:00Z"),
            ev("B", "2026-10-14T08:00Z", "2026-10-14T10:00Z"),
            ev("C", "2026-10-14T08:00Z", "2026-10-14T09:00Z")
        ]);
        expect(new Set(layout.map((l) => l.col))).toEqual(new Set([0, 1, 2]));
        expect(layout.every((l) => l.cols === 3)).toBe(true);
    });
    it("cours en cours et prochain cours (annulés et journées entières ignorés)", () => {
        const list = [
            ev("1", "2026-10-13T06:30Z", "2026-10-13T08:00Z"),
            ev("2", "2026-10-13T08:15Z", "2026-10-13T10:15Z", { cancelled: true }),
            ev("3", "2026-10-13T11:15Z", "2026-10-13T12:15Z"),
            ev("4", "2026-10-13T00:00Z", "2026-10-14T00:00Z", { allDay: true })
        ];
        expect(findCurrentAndNext(list, Date.parse("2026-10-13T07:00Z"))).toMatchObject({ current: [{ id: "1" }], next: { id: "3" } });
        expect(findCurrentAndNext(list, Date.parse("2026-10-13T08:00Z"))).toMatchObject({ current: [], next: { id: "3" } });
        expect(findCurrentAndNext(list, Date.parse("2026-10-13T13:00Z"))).toEqual({ current: [], next: null });
    });
    it("couleurs : une par matière, SAÉ groupées, inconnue neutre", () => {
        expect(subjectColor("R1.01").block).toContain("blue");
        expect(subjectColor("SAE 1.03").block).toContain("indigo");
        expect(subjectColor(null).block).toContain("slate");
        expect(subjectColor("X").block).toContain("slate");
    });
});
