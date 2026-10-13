/** Logique d'interface testable sans navigateur : infobulle, indicateur de synchro, cache EDT, routes. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { computePosition } from "../../js/ui/popover.js";
import { describeSyncState } from "../../js/ui/sync-indicator.js";
import { routeFromHash, ROUTES } from "../../js/ui/router.js";
import { TimetableStore, describeTimetableError, STALE_AFTER_MS } from "../../js/data/timetable-store.js";
import { LocalStore, createMemoryStorage } from "../../js/data/local-store.js";
import { SyncError } from "../../js/data/sync-errors.js";
import { TimetableFormatError } from "../../js/core/timetable.js";

const ICS = readFileSync(new URL("../fixtures/edt/ade-semestre-anonymise.ics", import.meta.url), "utf8");

describe("Positionnement de l'infobulle (jamais hors de l'écran)", () => {
    const vp = { width: 390, height: 664 };
    const insets = { top: 64, bottom: 69 };
    const rect = (x, y, w = 160, h = 64) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });
    const inside = (p, size) => {
        const h = Math.min(size.height, p.maxHeight);
        expect(p.left).toBeGreaterThanOrEqual(8);
        expect(p.left + p.width).toBeLessThanOrEqual(vp.width - 8);
        expect(p.top).toBeGreaterThanOrEqual(insets.top + 8);
        expect(p.top + h).toBeLessThanOrEqual(vp.height - insets.bottom - 8);
    };
    it("sous le déclencheur s'il y a la place, sinon au-dessus, sinon côté le plus spacieux avec défilement", () => {
        const small = { width: 300, height: 150 };
        const p1 = computePosition(rect(20, 100), small, vp, insets);
        expect(p1.placement).toBe("bottom");
        inside(p1, small);
        const p2 = computePosition(rect(20, 480), small, vp, insets);
        expect(p2.placement).toBe("top");
        inside(p2, small);
        const huge = { width: 380, height: 900 };
        const p3 = computePosition(rect(200, 300), huge, vp, insets);
        inside(p3, huge);
        expect(p3.maxHeight).toBeLessThan(900);
    });
    it("déclencheur collé aux bords gauche/droit : l'infobulle est recadrée dans l'écran", () => {
        const size = { width: 360, height: 200 };
        inside(computePosition(rect(0, 120, 40), size, vp, insets), size);
        inside(computePosition(rect(350, 120, 40), size, vp, insets), size);
        const wide = { width: 1000, height: 100 };
        expect(computePosition(rect(10, 100), wide, vp, insets).width).toBe(vp.width - 16);
    });
});

describe("Indicateur de synchronisation", () => {
    const base = { mode: "signed-in", sessionExpired: false, user: { id: "u" }, sync: { phase: "idle", pending: 0, lastSyncAt: null, error: null } };
    it.each([
        [{ mode: "local" }, "local", "Local"],
        [{ mode: "signed-out" }, "signed-out", "Non connecté"],
        [{ mode: "signed-out", sync: { phase: "starting", pending: 0 } }, "starting", "Démarrage…"],
        [{ sessionExpired: true, mode: "signed-out" }, "expired", "Session expirée"],
        [{ sync: { phase: "syncing", pending: 2 } }, "syncing", "Synchronisation…"],
        [{ sync: { phase: "offline", pending: 3 } }, "offline", "Hors-ligne · 3 en attente"],
        [{ sync: { phase: "error", pending: 1, error: { message: "boum" } } }, "error", "Erreur de synchro · 1 en attente"],
        [{ sync: { phase: "idle", pending: 4 } }, "pending", "4 en attente"],
        [{}, "synced", "Synchronisé"]
    ])("%j → %s", (patch, key, label) => {
        const state = { ...base, ...patch, sync: { ...base.sync, ...(patch.sync || {}) } };
        const d = describeSyncState(state, true);
        expect(d.key).toBe(key);
        expect(d.label).toBe(label);
    });
    it("navigateur hors-ligne → « Hors-ligne » même si le moteur n'a encore rien tenté", () => {
        expect(describeSyncState(base, false).key).toBe("offline");
    });
});

describe("Routes", () => {
    it("une URL par page, route inconnue → accueil", () => {
        expect(routeFromHash("#/notes").id).toBe("notes");
        expect(routeFromHash("#/edt?x=1").id).toBe("edt");
        expect(routeFromHash("").id).toBe("accueil");
        expect(routeFromHash("#/inconnue").id).toBe("accueil");
        expect(ROUTES.map((r) => r.id)).toEqual(["accueil", "notes", "edt", "devoirs", "reglages"]);
    });
});

describe("Cache de l'emploi du temps", () => {
    const make = (fetcher, now = () => Date.parse("2026-10-13T07:00:00Z")) => {
        const store = new LocalStore(createMemoryStorage());
        return { store, tt: new TimetableStore({ store, fetcher, now }) };
    };
    it("récupère, met en cache, couvre la plage, devient « ancien » après 1 h", async () => {
        let t = Date.parse("2026-10-13T07:00:00Z");
        const { store, tt } = make(async () => ICS, () => t);
        expect(await tt.refresh({ url: "https://proseconsult.umontpellier.fr/direct/?data=aa" })).toBe(true);
        expect(tt.status).toBe("ok");
        expect(tt.eventsOfDay("2026-10-13").map((e) => e.title)).toEqual(["Intro. systèmes", "Maths discrètes", "Soutien Initiation au dev", "Dev. interfaces web"]);
        expect(tt.covers("2026-10-12", "2026-10-18")).toBe(true);
        expect(tt.isStale()).toBe(false);
        t += STALE_AFTER_MS + 1;
        expect(tt.isStale()).toBe(true);
        // Persistance : un nouvel objet relit le cache (consultation hors-ligne)
        const again = new TimetableStore({ store, fetcher: async () => "", now: () => t });
        expect(again.eventsOfDay("2026-10-13")).toHaveLength(4);
    });
    it("échec : message clair, cache précédent conservé", async () => {
        let fail = null;
        const { tt } = make(async () => {
            if (fail) throw fail;
            return ICS;
        });
        await tt.refresh({ url: "u" });
        fail = new SyncError("network", "x");
        expect(await tt.refresh({ url: "u" })).toBe(false);
        expect(tt.error.message).toMatch(/Hors-ligne/);
        expect(tt.eventsOfDay("2026-10-13")).toHaveLength(4);
        fail = new TimetableFormatError("format", "html");
        await tt.refresh({ url: "u" });
        expect(tt.error.code).toBe("html");
    });
    it("changement de lien : l'ancien cache est vidé ; sans lien : invitation à le configurer", async () => {
        const { tt } = make(async () => ICS);
        await tt.refresh({ url: "lien-1" });
        tt.setSource("lien-2");
        expect(tt.hasData()).toBe(false);
        expect(await tt.refresh({ url: "" })).toBe(false);
        expect(tt.error.code).toBe("no-url");
    });
    it("fusion de plages : la plage rechargée remplace ses anciennes séances (cours déplacé/supprimé)", async () => {
        let text = ICS;
        const { tt } = make(async () => text);
        await tt.refresh({ url: "u", from: "2026-10-12", to: "2026-10-18" });
        text = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
        await tt.refresh({ url: "u", from: "2026-10-12", to: "2026-10-18" });
        expect(tt.eventsOfDay("2026-10-13")).toHaveLength(0);
    });
    it.each([
        [new SyncError("auth", "Connectez-vous"), "auth"],
        [new SyncError("config", "non configurée"), "config"],
        [new SyncError("server", "Erreur", { code: "timeout" }), "timeout"],
        [new Error("?"), "unknown"]
    ])("traduction des erreurs %#", (error, code) => {
        expect(describeTimetableError(error).code).toBe(code);
    });
});
