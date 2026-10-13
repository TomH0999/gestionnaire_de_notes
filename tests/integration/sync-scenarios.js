/**
 * Scénarios de synchronisation à deux appareils, exécutés contre plusieurs serveurs :
 *  - MemoryServer (émulation en mémoire) ;
 *  - Postgres réel (PGlite) avec le schéma supabase/schema.sql et la RLS active.
 * `makeEnv()` fournit { server?, clock, backendFactory?, cleanup? }.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDevice, settle, syncAll } from "./helpers.js";
import { SAMPLE_GRADES } from "../../js/data/migration.js";

const grade = (name, over = {}) => ({ name, subjectCode: "R1.01", score: 12, max: 20, coeff: 1, createdAt: Date.now(), ...over });

export function defineSyncScenarios(label, makeEnv, { controllableServerClock = true } = {}) {
    // Scénarios qui dépendent de l'ordre réel des horloges (appareil vs serveur) : ils exigent
    // un serveur dont l'horloge suit l'horloge simulée des tests (serveur mémoire). Sur Postgres
    // (PGlite), clock_timestamp() suit l'horloge réelle : ces scénarios n'y sont pas définis
    // (non applicables, et non « ignorés ») ; le plafonnement SQL est testé dans sql-rls.test.js.
    const itClock = controllableServerClock ? it : () => {};
    describe(`Synchronisation deux appareils — ${label}`, () => {
        let env;
        let devices;
        const device = async (name, opts = {}) => {
            const d = createDevice(name, { server: env.server, clock: env.clock, backendFactory: env.backendFactory, ...opts });
            devices.push(d);
            await d.start();
            return d;
        };

        beforeEach(async () => {
            env = await makeEnv();
            devices = [];
            await env.createUser("tom@example.com", "motdepasse");
            await env.createUser("autre@example.com", "motdepasse2");
        });
        afterEach(async () => {
            for (const d of devices) d.controller.stopEngine();
            if (env.cleanup) await env.cleanup();
        });

        it("création sur A → visible sur B (temps réel)", async () => {
            const A = await (await device("A")).signIn();
            const B = await (await device("B")).signIn();
            A.repo.create("grades", grade("DS1"));
            await settle([A, B]);
            if (env.realtime) {
                expect(B.grades().map((g) => g.name)).toEqual(["DS1"]);
            }
            await syncAll([A, B]);
            expect(B.grades().map((g) => g.name)).toEqual(["DS1"]);
            expect(B.repo.pendingCount()).toBe(0);
        });

        it("temps réel coupé (iOS en arrière-plan) → rattrapé au retour au premier plan", async () => {
            const A = await (await device("A")).signIn();
            const B = await (await device("B")).signIn();
            B.backend.setRealtimeEnabled && B.backend.setRealtimeEnabled(false);
            A.repo.create("homework", { title: "Rendu SAE", type: "sae", subjectCode: null, dueDate: "2026-10-20", dueTime: "23:59", importance: 3, anticipationDays: 14, notes: "", status: "todo" });
            await settle([A, B]);
            expect(B.repo.homework()).toHaveLength(0);
            B.backend.setRealtimeEnabled && B.backend.setRealtimeEnabled(true);
            await B.controller.syncNow(); // visibilitychange → syncNow
            await settle([A, B]);
            expect(B.repo.homework().map((h) => h.title)).toEqual(["Rendu SAE"]);
        });

        it("suppression sur A → disparaît sur B (suppression logique propagée)", async () => {
            const A = await (await device("A")).signIn();
            const B = await (await device("B")).signIn();
            const g = A.repo.create("grades", grade("À supprimer"));
            await syncAll([A, B]);
            expect(B.grades()).toHaveLength(1);
            A.repo.remove(g.id);
            await syncAll([A, B]);
            expect(B.grades()).toHaveLength(0);
            expect(B.repo.getRecord(g.id).deleted).toBe(true);
            // La pierre tombale reste côté serveur
            const rows = await env.rowsOf("tom@example.com");
            expect(rows.find((r) => r.id === g.id).deleted_at).not.toBeNull();
        });

        it("modifications simultanées de champs différents → les deux sont conservées", async () => {
            const A = await (await device("A")).signIn();
            const B = await (await device("B")).signIn();
            const g = A.repo.create("grades", grade("DS2", { score: 10 }));
            await syncAll([A, B]);
            A.backend.setOnline(false);
            B.backend.setOnline(false);
            A.repo.update(g.id, { score: 15 });
            env.clock.advance(1000);
            B.repo.update(g.id, { name: "DS2 (rattrapage)" });
            A.backend.setOnline(true);
            B.backend.setOnline(true);
            A.controller.setNetworkAvailable(true);
            B.controller.setNetworkAvailable(true);
            await syncAll([A, B]);
            for (const d of [A, B]) {
                expect(d.grades()[0]).toMatchObject({ score: 15, name: "DS2 (rattrapage)" });
                expect(d.repo.pendingCount()).toBe(0);
            }
        });

        itClock("A hors-ligne modifie, B modifie le même champ plus tard, A revient → la plus récente gagne, la version perdue est archivée", async () => {
            const A = await (await device("A")).signIn();
            const B = await (await device("B")).signIn();
            const g = A.repo.create("grades", grade("TP noté", { score: 8 }));
            await syncAll([A, B]);
            A.backend.setOnline(false);
            A.repo.update(g.id, { score: 11 }); // 08:00
            env.clock.advance(5 * 60000);
            B.repo.update(g.id, { score: 14 }); // 08:05 (en ligne)
            await settle([A, B]);
            env.clock.advance(60000);
            A.backend.setOnline(true);
            A.controller.setNetworkAvailable(true);
            await syncAll([A, B]);
            expect(A.grades()[0].score).toBe(14);
            expect(B.grades()[0].score).toBe(14);
            const log = A.repo.conflictLog();
            expect(log).toHaveLength(1);
            expect(log[0].fields[0]).toMatchObject({ field: "score", valeurLocalePerdue: 11, valeurGardee: 14 });
        });

        it("A hors-ligne crée et modifie plusieurs entrées, B aussi → fusion sans aucune perte", async () => {
            const A = await (await device("A")).signIn();
            const B = await (await device("B")).signIn();
            A.backend.setOnline(false);
            B.backend.setOnline(false);
            for (let i = 0; i < 5; i++) A.repo.create("grades", grade(`A${i}`));
            for (let i = 0; i < 4; i++) B.repo.create("grades", grade(`B${i}`));
            B.repo.setSetting("edtZoom:desktop", 1.25);
            A.backend.setOnline(true);
            B.backend.setOnline(true);
            A.controller.setNetworkAvailable(true);
            B.controller.setNetworkAvailable(true);
            await syncAll([A, B]);
            for (const d of [A, B]) {
                expect(d.grades().map((g) => g.name).sort()).toEqual(["A0", "A1", "A2", "A3", "A4", "B0", "B1", "B2", "B3"]);
                expect(d.repo.getSetting("edtZoom:desktop")).toBe(1.25);
            }
            expect((await env.rowsOf("tom@example.com")).filter((r) => r.collection === "grades")).toHaveLength(9);
        });

        itClock("suppression hors-ligne sur A contre modification plus récente sur B → la modification gagne", async () => {
            const A = await (await device("A")).signIn();
            const B = await (await device("B")).signIn();
            const g = A.repo.create("grades", grade("Contesté"));
            await syncAll([A, B]);
            A.backend.setOnline(false);
            A.repo.remove(g.id);
            env.clock.advance(60000);
            B.repo.update(g.id, { score: 19 });
            await settle([B]);
            A.backend.setOnline(true);
            A.controller.setNetworkAvailable(true);
            await syncAll([A, B]);
            expect(A.grades().map((x) => x.score)).toEqual([19]);
            expect(B.grades().map((x) => x.score)).toEqual([19]);
        });

        it("migration depuis deux appareils ayant chacun des données locales → zéro doublon", async () => {
            const g1 = { id: "1696000000001", name: "DS1", subjectCode: "R1.01", score: 15, max: 20, coeff: 1 };
            const g1bis = { ...g1, id: "1696000099999", name: " ds1 " }; // même note saisie à la main sur l'autre appareil
            const g2 = { id: "1696000000002", name: "TP", subjectCode: "R1.02", score: 7, max: 10, coeff: 2 };
            const g3 = { id: "1696000000003", name: "Oral", subjectCode: "R1.10", score: 16, max: 20, coeff: 1 };
            const twin = { id: "1696000000004", name: "QCM", subjectCode: "R1.06", score: 10, max: 20, coeff: 1 };
            const twin2 = { ...twin, id: "1696000000005" }; // deux QCM identiques sur le même appareil = 2 notes
            const A = await device("A", { legacyGrades: [...SAMPLE_GRADES, g1, g2, twin, twin2] });
            const B = await device("B", { legacyGrades: [g1bis, g3, twin] });
            expect(A.migration).toMatchObject({ added: 4, skippedSamples: 3 });
            expect(B.migration).toMatchObject({ added: 3 });
            // Les deux se connectent « en même temps »
            await Promise.all([A.controller.signIn("tom@example.com", "motdepasse"), B.controller.signIn("tom@example.com", "motdepasse")]);
            await syncAll([A, B]);
            const rows = (await env.rowsOf("tom@example.com")).filter((r) => r.collection === "grades" && !r.deleted_at);
            expect(rows).toHaveLength(5); // DS1, TP, Oral, QCM ×2
            for (const d of [A, B]) {
                const names = d.grades().map((g) => g.name.trim().toLowerCase()).sort();
                expect(names).toEqual(["ds1", "oral", "qcm", "qcm", "tp"]);
                expect(d.repo.pendingCount()).toBe(0);
            }
            expect(rows.some((r) => r.data.name === "Contrôle TP1")).toBe(false);
            // Relancer la migration (redémarrage) n'ajoute rien
            const again = createDevice("A2", { server: env.server, clock: env.clock, storage: A.storage, backendFactory: env.backendFactory });
            devices.push(again);
            expect(again.migration.added).toBe(0);
        });

        it("une note supprimée dans la v2 n'est pas ressuscitée par la migration d'un autre appareil", async () => {
            const g = { id: "1696000000001", name: "Ancienne", subjectCode: "R1.01", score: 5, max: 20, coeff: 1 };
            const A = await (await device("A", { legacyGrades: [g] })).signIn();
            const id = A.grades()[0].id;
            env.clock.advance(60000);
            A.repo.remove(id);
            await syncAll([A]);
            const B = await (await device("B", { legacyGrades: [g] })).signIn();
            await syncAll([A, B]);
            expect(B.grades()).toHaveLength(0);
            expect(A.grades()).toHaveLength(0);
        });

        it("coupure réseau avant l'insertion puis réponse perdue après l'insertion → une seule ligne", async () => {
            const A = await (await device("A")).signIn();
            A.backend.failNext("insert", "before");
            A.repo.create("grades", grade("Coupure avant"));
            await settle([A]);
            expect(A.repo.pendingCount()).toBe(1);
            await A.controller.syncNow();
            // Sans temps réel, rien ne vient confirmer l'écriture dont la réponse s'est perdue
            if (A.backend.setRealtimeEnabled) A.backend.setRealtimeEnabled(false);
            A.backend.failNext("insert", "after");
            A.repo.create("grades", grade("Réponse perdue"));
            await settle([A]);
            expect(A.repo.pendingCount()).toBe(1);
            await A.controller.syncNow();
            await settle([A]);
            const rows = (await env.rowsOf("tom@example.com")).filter((r) => r.collection === "grades");
            expect(rows.map((r) => r.data.name).sort()).toEqual(["Coupure avant", "Réponse perdue"]);
            expect(A.repo.pendingCount()).toBe(0);
        });

        it("mise à jour dont la réponse se perd → pas de faux conflit, contenu final correct", async () => {
            const A = await (await device("A")).signIn();
            const g = A.repo.create("grades", grade("Màj", { score: 1 }));
            await settle([A]);
            A.backend.failNext("update", "after");
            A.repo.update(g.id, { score: 2 });
            await settle([A]);
            await A.controller.syncNow();
            await settle([A]);
            expect(A.repo.pendingCount()).toBe(0);
            expect(A.repo.conflictLog()).toHaveLength(0);
            expect((await env.rowsOf("tom@example.com"))[0].data.score).toBe(2);
        });

        it("file d'attente rejouée deux fois → idempotent (aucun doublon, aucun conflit)", async () => {
            const A = await (await device("A")).signIn();
            A.backend.setOnline(false);
            const g = A.repo.create("grades", grade("Rejouée"));
            A.repo.update(g.id, { score: 18 });
            const snapshot = JSON.parse(A.storage.getItem("gdn:v2:" + A.repo.scope + ":records"));
            A.backend.setOnline(true);
            await A.controller.syncNow();
            await settle([A]);
            // Rejeu : on restaure l'ancienne file (comme si l'accusé de réception avait été perdu)
            A.storage.setItem("gdn:v2:" + A.repo.scope + ":records", JSON.stringify(snapshot));
            A.repo.reloadFromStorage();
            expect(A.repo.pendingCount()).toBe(1);
            await A.controller.syncNow();
            await settle([A]);
            const rows = (await env.rowsOf("tom@example.com")).filter((r) => r.collection === "grades");
            expect(rows).toHaveLength(1);
            expect(rows[0].data.score).toBe(18);
            expect(A.repo.pendingCount()).toBe(0);
            expect(A.repo.conflictLog()).toHaveLength(0);
        });

        it("session expirée → file conservée, renvoyée après reconnexion", async () => {
            const A = await (await device("A")).signIn();
            await env.expireSession(A);
            A.repo.create("grades", grade("Pendant expiration"));
            await settle([A]);
            await new Promise((r) => setTimeout(r, 20));
            const state = A.controller.getState();
            expect(state.mode).toBe("signed-out");
            expect(state.sessionExpired).toBe(true);
            expect(A.repo.pendingCount()).toBe(1);
            expect(A.grades().map((g) => g.name)).toEqual(["Pendant expiration"]);
            await A.signIn();
            await syncAll([A]);
            expect(A.repo.pendingCount()).toBe(0);
            expect((await env.rowsOf("tom@example.com")).map((r) => r.data.name)).toContain("Pendant expiration");
        });

        itClock("appareil dont l'horloge avance de 2 h : il ne gagne pas les conflits à tort", async () => {
            const A = await (await device("A", { skewMs: 2 * 3600000 })).signIn();
            const B = await (await device("B")).signIn();
            const g = B.repo.create("grades", grade("Horloge", { score: 10 }));
            await syncAll([A, B]);
            A.backend.setOnline(false);
            A.repo.update(g.id, { score: 11 }); // vrai 08:00 (l'appareil croit 10:00)
            env.clock.advance(10 * 60000);
            B.repo.update(g.id, { score: 12 }); // vrai 08:10
            await settle([B]);
            A.backend.setOnline(true);
            A.controller.setNetworkAvailable(true);
            await syncAll([A, B]);
            expect(A.grades()[0].score).toBe(12);
            expect(B.grades()[0].score).toBe(12);
        });

        itClock("modifications faites hors-ligne AVANT toute synchronisation sur un appareil en avance de 3 h → recalées", async () => {
            const B = await (await device("B")).signIn();
            const g = B.repo.create("grades", grade("Recalage", { score: 10 }));
            await syncAll([B]);
            // A : appareil neuf, horloge +3 h, récupère la note puis passe hors-ligne avant toute mesure fiable
            const A = await device("A", { skewMs: 3 * 3600000 });
            A.backend.setOnline(false);
            await A.controller.signIn("tom@example.com", "motdepasse").catch(() => {});
            A.backend.setOnline(true);
            await A.signIn();
            await syncAll([A, B]);
            A.controller.engine.clockSamples = [];
            A.controller.engine.clockOffset = 0;
            A.controller.clockOffset = 0; // l'appareil a « oublié » l'écart : horodatage brut faux de +3 h
            A.backend.setOnline(false);
            A.repo.update(g.id, { score: 11 }); // vrai 08:00, horodaté 11:00
            env.clock.advance(20 * 60000);
            B.repo.update(g.id, { score: 12 }); // vrai 08:20
            await settle([B]);
            A.backend.setOnline(true);
            A.controller.engine.lastClockSync = 0;
            A.controller.setNetworkAvailable(true);
            await syncAll([A, B]);
            expect(A.grades()[0].score).toBe(12);
            expect(B.grades()[0].score).toBe(12);
        });

        it("données saisies avant toute connexion → adoptées et envoyées à la première connexion", async () => {
            const A = await device("A");
            expect(A.controller.getState().mode).toBe("signed-out");
            A.repo.create("grades", grade("Avant connexion"));
            A.repo.setSetting("lastSubject", "R1.05");
            await A.signIn();
            await syncAll([A]);
            const rows = await env.rowsOf("tom@example.com");
            expect(rows.map((r) => r.data.name || r.data.key).sort()).toEqual(["Avant connexion", "lastSubject"]);
            expect(A.repo.scope).not.toBe("local");
        });

        it("stockage local vidé (iOS) → tout est re-téléchargé depuis le cloud", async () => {
            const A = await (await device("A")).signIn();
            for (let i = 0; i < 30; i++) A.repo.create("grades", grade(`N${i}`));
            await syncAll([A]);
            const fresh = await (await device("A-vidé")).signIn();
            await syncAll([fresh]);
            expect(fresh.grades()).toHaveLength(30);
        });

        it("isolation des comptes : B ne voit pas les données de A", async () => {
            const A = await (await device("A")).signIn();
            const C = await (await device("C")).signIn("autre@example.com", "motdepasse2");
            A.repo.create("grades", grade("Privée"));
            await syncAll([A, C]);
            expect(C.grades()).toHaveLength(0);
            expect(await env.rowsOf("autre@example.com")).toHaveLength(0);
        });
    });
}
