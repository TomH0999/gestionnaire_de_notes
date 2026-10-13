import { describe, it, expect } from "vitest";
import {
    HOMEWORK_TYPES,
    defaultsForType,
    dueInstant,
    suggestedStartKey,
    suggestedStartInstant,
    computeState,
    urgencyScore,
    sortByUrgency,
    compareByUrgency,
    selectDoNow,
    anticipationSpan,
    importanceLevel,
    anticipationLabel,
    homeworkType
} from "../../js/core/homework.js";

const at = (iso) => Date.parse(iso);
const hw = (over = {}) => ({
    title: "Devoir",
    type: "devoir",
    subjectCode: "R1.01",
    dueDate: "2026-10-20",
    dueTime: "23:59",
    importance: 2,
    anticipationDays: 2,
    status: "todo",
    ...over
});

describe("Valeurs par défaut par type", () => {
    it("chaque type a des valeurs par défaut cohérentes", () => {
        for (const t of HOMEWORK_TYPES) {
            const d = defaultsForType(t.id);
            expect(d.type).toBe(t.id);
            expect([1, 2, 3, 4]).toContain(d.importance);
            expect([0, 2, 7, 14, 30]).toContain(d.anticipationDays);
            expect(d.dueTime).toMatch(/^\d{2}:\d{2}$/);
        }
    });
    it("SAÉ = importance haute + anticipation longue ; gros contrôle = critique", () => {
        expect(defaultsForType("sae")).toMatchObject({ importance: 3, anticipationDays: 14 });
        expect(defaultsForType("controle")).toMatchObject({ importance: 4, anticipationDays: 7 });
        expect(defaultsForType("devoir")).toMatchObject({ importance: 2, anticipationDays: 2, dueTime: "23:59" });
    });
    it("type inconnu → « Autre » ; libellés", () => {
        expect(homeworkType("nimporte").id).toBe("autre");
        expect(importanceLevel(4).label).toBe("Critique");
        expect(importanceLevel(99).label).toBe("Normale");
        expect(anticipationLabel(7)).toBe("1 semaine");
        expect(anticipationLabel(3)).toBe("3 jours");
        expect(anticipationLabel(1)).toBe("1 jour");
    });
});

describe("Échéance et date de début conseillée", () => {
    it("échéance en heure de Paris (été / hiver)", () => {
        expect(new Date(dueInstant(hw())).toISOString()).toBe("2026-10-20T21:59:00.000Z");
        expect(new Date(dueInstant(hw({ dueDate: "2026-11-20" }))).toISOString()).toBe("2026-11-20T22:59:00.000Z");
    });
    it("début conseillé = échéance − anticipation, à minuit (Paris)", () => {
        expect(suggestedStartKey(hw({ anticipationDays: 7 }))).toBe("2026-10-13");
        expect(new Date(suggestedStartInstant(hw({ anticipationDays: 7 }))).toISOString()).toBe("2026-10-12T22:00:00.000Z");
        expect(suggestedStartKey(hw({ anticipationDays: 0 }))).toBe("2026-10-20");
    });
    it("fin de mois, année bissextile, changement d'année", () => {
        expect(suggestedStartKey(hw({ dueDate: "2026-11-01", anticipationDays: 2 }))).toBe("2026-10-30");
        expect(suggestedStartKey(hw({ dueDate: "2028-03-01", anticipationDays: 1 }))).toBe("2028-02-29");
        expect(suggestedStartKey(hw({ dueDate: "2028-03-01", anticipationDays: 2 }))).toBe("2028-02-28");
        expect(suggestedStartKey(hw({ dueDate: "2027-03-01", anticipationDays: 1 }))).toBe("2027-02-28");
        expect(suggestedStartKey(hw({ dueDate: "2027-01-05", anticipationDays: 7 }))).toBe("2026-12-29");
        expect(suggestedStartKey(hw({ dueDate: "2026-12-01", anticipationDays: 30 }))).toBe("2026-11-01");
    });
    it("période d'anticipation", () => {
        expect(anticipationSpan(hw({ anticipationDays: 7 }))).toEqual({ start: "2026-10-13", end: "2026-10-20", length: 7 });
    });
});

describe("États calculés", () => {
    it("à venir → à commencer maintenant → en retard → fait", () => {
        const item = hw({ anticipationDays: 2 }); // début 18/10 00:00, échéance 20/10 23:59
        expect(computeState(item, at("2026-10-17T21:59:59Z"))).toBe("upcoming");
        expect(computeState(item, at("2026-10-17T22:00:00Z"))).toBe("start-now");
        expect(computeState(item, at("2026-10-20T21:59:00Z"))).toBe("start-now");
        expect(computeState(item, at("2026-10-20T21:59:01Z"))).toBe("overdue");
        expect(computeState({ ...item, status: "done" }, at("2026-10-25T10:00:00Z"))).toBe("done");
    });
    it("anticipation qui place le début dans le passé : « à commencer maintenant », pas « en retard »", () => {
        // créé le 13/10 pour le 16/10 avec 1 semaine d'anticipation → début conseillé le 09/10 (passé)
        const item = hw({ dueDate: "2026-10-16", anticipationDays: 7 });
        expect(suggestedStartKey(item)).toBe("2026-10-09");
        expect(computeState(item, at("2026-10-13T10:00:00Z"))).toBe("start-now");
    });
    it("échéance aujourd'hui à minuit (00:00) : en retard dès 00:00:01", () => {
        const item = hw({ dueDate: "2026-10-14", dueTime: "00:00", anticipationDays: 0 });
        expect(new Date(dueInstant(item)).toISOString()).toBe("2026-10-13T22:00:00.000Z");
        expect(computeState(item, at("2026-10-13T21:59:00Z"))).toBe("upcoming");
        expect(computeState(item, at("2026-10-13T22:00:00Z"))).toBe("start-now");
        expect(computeState(item, at("2026-10-13T22:00:01Z"))).toBe("overdue");
    });
    it("sans anticipation : à commencer le jour même", () => {
        const item = hw({ anticipationDays: 0 });
        expect(computeState(item, at("2026-10-19T21:59:00Z"))).toBe("upcoming");
        expect(computeState(item, at("2026-10-19T22:00:00Z"))).toBe("start-now");
    });
    it("devoir sans matière : aucun impact", () => {
        expect(computeState(hw({ subjectCode: null }), at("2026-10-19T08:00:00Z"))).toBe("start-now");
    });
    it("statut « en cours » reste calculé normalement", () => {
        expect(computeState(hw({ status: "in_progress" }), at("2026-10-21T08:00:00Z"))).toBe("overdue");
    });
});

describe("Urgence", () => {
    const now = at("2026-10-13T08:00:00Z");
    it("formule documentée : importance × (1 + proximité) + 100 si en retard", () => {
        // début conseillé dans ≥ 14 jours → proximité 0 → urgence = importance
        const far = hw({ dueDate: "2026-12-01", anticipationDays: 0, importance: 4 });
        expect(urgencyScore(far, now)).toBe(4);
        // début conseillé passé depuis longtemps → proximité plafonnée à 28 ; en retard → +100
        const late = hw({ dueDate: "2026-09-01", anticipationDays: 0, importance: 1 });
        expect(urgencyScore(late, now)).toBe(1 * (1 + 28) + 100);
        // début conseillé exactement maintenant → proximité 14
        const startsNow = hw({ dueDate: "2026-10-20", anticipationDays: 7, importance: 3 });
        expect(urgencyScore(startsNow, at("2026-10-12T22:00:00Z"))).toBe(3 * (1 + 14));
        expect(urgencyScore({ ...late, status: "done" }, now)).toBe(-Infinity);
    });
    it("ordre : en retard d'abord, puis importance amplifiée par la proximité du début conseillé", () => {
        const items = [
            hw({ title: "SAE lointaine", type: "sae", dueDate: "2026-12-15", anticipationDays: 14, importance: 3 }),
            hw({ title: "Devoir en retard", dueDate: "2026-10-12", anticipationDays: 2, importance: 2 }),
            hw({ title: "Contrôle critique dans 7 j", type: "controle", dueDate: "2026-10-20", dueTime: "08:00", anticipationDays: 7, importance: 4 }),
            hw({ title: "Devoir faible demain", dueDate: "2026-10-14", anticipationDays: 2, importance: 1 }),
            hw({ title: "Fait", dueDate: "2026-10-12", status: "done", importance: 4 })
        ];
        expect(sortByUrgency(items, now).map((i) => i.title)).toEqual([
            "Devoir en retard",
            "Contrôle critique dans 7 j",
            "Devoir faible demain",
            "SAE lointaine",
            "Fait"
        ]);
    });
    it("le tri optimisé (scores précalculés) donne exactement l'ordre du comparateur de référence", () => {
        let seed = 12345;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
        const items = Array.from({ length: 400 }, (_, i) =>
            hw({
                title: `T${i % 37}`,
                dueDate: `2026-${String(9 + Math.floor(rnd() * 4)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
                dueTime: rnd() < 0.5 ? "08:00" : "23:59",
                importance: 1 + Math.floor(rnd() * 4),
                anticipationDays: [0, 2, 7, 14, 30][Math.floor(rnd() * 5)],
                status: rnd() < 0.15 ? "done" : "todo"
            })
        );
        const reference = [...items].sort((a, b) => compareByUrgency(a, b, now));
        expect(sortByUrgency(items, now)).toEqual(reference);
    });
    it("égalité de score : échéance la plus proche d'abord", () => {
        const a = hw({ title: "B", dueDate: "2026-12-10", anticipationDays: 0 });
        const b = hw({ title: "A", dueDate: "2026-12-05", anticipationDays: 0 });
        expect(urgencyScore(a, now)).toBe(urgencyScore(b, now));
        expect(sortByUrgency([a, b], now).map((i) => i.title)).toEqual(["A", "B"]);
    });
    it("« À faire maintenant » : début atteint OU échéance ≤ 7 jours, jamais les faits", () => {
        const items = [
            hw({ title: "dans 5 j sans anticipation", dueDate: "2026-10-18", anticipationDays: 0 }),
            hw({ title: "dans 20 j", dueDate: "2026-11-02", anticipationDays: 2 }),
            hw({ title: "début atteint", dueDate: "2026-11-02", anticipationDays: 30 }),
            hw({ title: "retard", dueDate: "2026-10-01" }),
            hw({ title: "fait", dueDate: "2026-10-14", status: "done" })
        ];
        const titles = selectDoNow(items, now).map((i) => i.title);
        expect(titles).toContain("dans 5 j sans anticipation");
        expect(titles).toContain("début atteint");
        expect(titles).toContain("retard");
        expect(titles).not.toContain("dans 20 j");
        expect(titles).not.toContain("fait");
        expect(titles[0]).toBe("retard");
    });
});
