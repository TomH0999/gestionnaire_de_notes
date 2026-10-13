import { describe, it, expect } from "vitest";
import {
    zonedTimeToUtc,
    zonedParts,
    tzOffset,
    parisDayKey,
    parisStartOfDay,
    parisInstant,
    parisTime,
    parisMinutesOfDay,
    addDays,
    diffDays,
    weekdayOf,
    startOfWeek,
    addMonths,
    monthGrid,
    parseDayKey,
    isValidDayKey,
    daysInMonth,
    parseTime,
    formatLongDate,
    formatShortDate,
    formatRelativeDay,
    formatDateTime,
    formatMonthYear,
    formatDayMonth
} from "../../js/core/dates.js";

const iso = (ms) => new Date(ms).toISOString();

describe("Fuseau Europe/Paris", () => {
    it("heure d'été (UTC+2) et heure d'hiver (UTC+1)", () => {
        expect(iso(zonedTimeToUtc(2026, 10, 13, 8, 30))).toBe("2026-10-13T06:30:00.000Z");
        expect(iso(zonedTimeToUtc(2026, 11, 2, 8, 0))).toBe("2026-11-02T07:00:00.000Z");
        expect(tzOffset(Date.UTC(2026, 6, 1))).toBe(2 * 3600000);
        expect(tzOffset(Date.UTC(2026, 11, 1))).toBe(3600000);
    });

    it("passage à l'heure d'hiver (25/10/2026) : 01:30 CEST, 02:30 ambiguë, 03:30 CET", () => {
        expect(iso(zonedTimeToUtc(2026, 10, 25, 1, 30))).toBe("2026-10-24T23:30:00.000Z");
        const ambiguous = zonedTimeToUtc(2026, 10, 25, 2, 30);
        expect(iso(ambiguous)).toBe("2026-10-25T01:30:00.000Z"); // seconde occurrence (heure d'hiver)
        expect(parisTime(ambiguous)).toBe("02:30");
        expect(iso(zonedTimeToUtc(2026, 10, 25, 3, 30))).toBe("2026-10-25T02:30:00.000Z");
        expect(iso(zonedTimeToUtc(2026, 10, 25, 0, 0))).toBe("2026-10-24T22:00:00.000Z");
    });

    it("passage à l'heure d'été (28/03/2027) : 02:30 inexistante → 03:30 CEST", () => {
        expect(iso(zonedTimeToUtc(2027, 3, 28, 1, 30))).toBe("2027-03-28T00:30:00.000Z");
        expect(iso(zonedTimeToUtc(2027, 3, 28, 2, 30))).toBe("2027-03-28T01:30:00.000Z");
        expect(parisTime(zonedTimeToUtc(2027, 3, 28, 2, 30))).toBe("03:30");
        expect(iso(zonedTimeToUtc(2027, 3, 28, 3, 30))).toBe("2027-03-28T01:30:00.000Z");
    });

    it("jour calendaire de Paris autour de minuit UTC", () => {
        expect(parisDayKey(Date.parse("2026-10-13T21:59:00Z"))).toBe("2026-10-13");
        expect(parisDayKey(Date.parse("2026-10-13T22:00:00Z"))).toBe("2026-10-14");
        expect(parisDayKey(Date.parse("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
        expect(iso(parisStartOfDay("2026-10-14"))).toBe("2026-10-13T22:00:00.000Z");
        expect(iso(parisStartOfDay("2026-10-26"))).toBe("2026-10-25T23:00:00.000Z");
    });

    it("composantes, heure et minutes du jour", () => {
        const ms = Date.parse("2026-10-13T06:30:00Z");
        expect(zonedParts(ms)).toMatchObject({ year: 2026, month: 10, day: 13, hour: 8, minute: 30, weekday: 1 });
        expect(parisTime(ms)).toBe("08:30");
        expect(parisMinutesOfDay(ms)).toBe(510);
        expect(parisTime(Date.parse("2026-10-13T22:00:00Z"))).toBe("00:00");
    });

    it("échéance à 23:59 la nuit du changement d'heure", () => {
        expect(iso(parisInstant("2026-10-25", "23:59"))).toBe("2026-10-25T22:59:00.000Z");
        expect(parisInstant("2026-02-30", "10:00")).toBeNaN();
        expect(parisInstant("2026-10-25", "25:00")).toBeNaN();
    });

    it("le résultat ne dépend pas du fuseau de l'appareil (TZ du processus)", () => {
        const before = [zonedTimeToUtc(2026, 10, 25, 1, 30), parisDayKey(Date.parse("2026-10-13T22:30:00Z")), formatLongDate("2026-10-13")];
        const saved = process.env.TZ;
        try {
            for (const tz of ["America/New_York", "Pacific/Kiritimati", "Asia/Tokyo", "UTC"]) {
                process.env.TZ = tz;
                if (tz === "America/New_York") expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(300); // le changement de fuseau est effectif
                expect([zonedTimeToUtc(2026, 10, 25, 1, 30), parisDayKey(Date.parse("2026-10-13T22:30:00Z")), formatLongDate("2026-10-13")]).toEqual(before);
            }
        } finally {
            if (saved === undefined) delete process.env.TZ;
            else process.env.TZ = saved;
        }
    });
});

describe("Dates calendaires", () => {
    it("fin de mois, fin d'année, années bissextiles", () => {
        expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
        expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
        expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
        expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
        expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
        expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
        expect(addDays("2026-10-25", 1)).toBe("2026-10-26"); // nuit du changement d'heure
        expect(diffDays("2027-01-05", "2026-12-29")).toBe(7);
        expect(diffDays("2026-10-26", "2026-10-25")).toBe(1);
        expect(daysInMonth(2028, 2)).toBe(29);
        expect(daysInMonth(2100, 2)).toBe(28);
        expect(daysInMonth(2000, 2)).toBe(29);
    });

    it("validation des dates", () => {
        expect(parseDayKey("2026-02-30")).toBeNull();
        expect(parseDayKey("2026-13-01")).toBeNull();
        expect(parseDayKey("2026-1-01")).toBeNull();
        expect(isValidDayKey("2028-02-29")).toBe(true);
        expect(isValidDayKey("2027-02-29")).toBe(false);
        expect(parseTime("8:05")).toEqual({ hour: 8, minute: 5 });
        expect(parseTime("24:00")).toBeNull();
        expect(parseTime("12:60")).toBeNull();
        expect(parseTime("midi")).toBeNull();
    });

    it("semaines (lundi = 0) et mois", () => {
        expect(weekdayOf("2026-10-13")).toBe(1);
        expect(weekdayOf("2026-10-18")).toBe(6);
        expect(startOfWeek("2026-10-13")).toBe("2026-10-12");
        expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
        expect(startOfWeek("2027-01-03")).toBe("2026-12-28");
        expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
        expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
        expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
        const grid = monthGrid(2026, 10);
        expect(grid[0][0]).toBe("2026-09-28");
        expect(grid.flat()).toContain("2026-10-31");
        expect(grid.every((w) => w.length === 7)).toBe(true);
        expect(monthGrid(2027, 2).length).toBe(4); // février 2027 : 28 jours commençant un lundi
        expect(monthGrid(2026, 2).length).toBe(5); // février 2026 commence un dimanche
    });

    it("formats français", () => {
        expect(formatLongDate("2026-10-13")).toBe("mardi 13 octobre");
        expect(formatLongDate("2026-10-13", { withYear: true })).toBe("mardi 13 octobre 2026");
        expect(formatShortDate("2026-10-20")).toBe("mar. 20 oct.");
        expect(formatRelativeDay("2026-10-13", "2026-10-13")).toBe("Aujourd'hui");
        expect(formatRelativeDay("2026-10-14", "2026-10-13")).toBe("Demain");
        expect(formatRelativeDay("2026-10-12", "2026-10-13")).toBe("Hier");
        expect(formatRelativeDay("2026-10-20", "2026-10-13")).toBe("mar. 20 oct.");
        expect(formatDateTime(Date.parse("2026-10-13T10:51:00Z"))).toBe("13/10/2026 à 12:51");
        expect(formatMonthYear(2026, 10)).toBe("octobre 2026");
        expect(formatDayMonth("2026-03-05")).toBe("05/03");
    });
});
