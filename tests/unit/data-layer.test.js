import { describe, it, expect, vi } from "vitest";
import { merge3, compareServerTs, parseServerTs, deepEqual, newerSide, sameContent } from "../../js/data/merge.js";
import { LocalStore, createMemoryStorage, PREFIX } from "../../js/data/local-store.js";
import { Repository, adoptLocalRecords, settingId, recordToRow } from "../../js/data/repository.js";
import { planLegacyGrades, runLegacyMigration, legacyGradeId, isSampleGrade, SAMPLE_GRADES, LEGACY_KEY } from "../../js/data/migration.js";
import { buildExport, planImport, applyImport } from "../../js/data/backup.js";
import { SyncEngine, shiftServerTs } from "../../js/data/sync-engine.js";
import { MemoryServer } from "../../js/data/backends/memory-server.js";
import { MemoryBackend } from "../../js/data/backends/memory-backend.js";
import { calculateAllAverages } from "../../js/core/grades-calc.js";
import { DATASETS } from "../golden/datasets.js";

const newRepo = (opts = {}) => {
    const store = new LocalStore(opts.storage || createMemoryStorage());
    let t = opts.start || Date.parse("2026-10-13T08:00:00Z");
    const repo = new Repository({ store, scope: opts.scope || "local", deviceId: opts.deviceId || "dev-A", clock: () => t++ });
    return { store, repo };
};

describe("Horodatages serveur", () => {
    it("lecture et comparaison quel que soit le format (Z, +00:00, précision variable)", () => {
        expect(parseServerTs("2026-10-13T08:00:00.123456+00:00")).toEqual({ ms: Date.parse("2026-10-13T08:00:00.123Z"), micro: 456 });
        expect(compareServerTs("2026-10-13T08:00:00.12+00:00", "2026-10-13T08:00:00.123Z")).toBe(-1);
        expect(compareServerTs("2026-10-13T10:00:00+02:00", "2026-10-13T08:00:00Z")).toBe(0);
        expect(compareServerTs("2026-10-13T08:00:00.000001+00:00", "2026-10-13T08:00:00+00:00")).toBe(1);
        expect(compareServerTs(null, "2026-10-13T08:00:00Z")).toBe(-1);
        expect(compareServerTs(null, null)).toBe(0);
        expect(parseServerTs("n'importe quoi")).toBeNull();
        expect(shiftServerTs("2026-10-13T08:02:00.5+00:00", -120000)).toBe("2026-10-13T08:00:00.500Z");
    });
});

describe("Fusion 3 voies", () => {
    const L = (data, t, extra = {}) => ({ data, deleted: false, clientUpdatedAt: t, deviceId: "A", ...extra });
    const R = (data, t, extra = {}) => ({ data, deleted: false, clientUpdatedAt: t, deviceId: "B", ...extra });
    const base = { data: { name: "DS", score: 10, coeff: 1 }, deleted: false };

    it("champs différents modifiés de chaque côté → les deux gardés, aucun conflit", () => {
        const m = merge3(base, L({ name: "DS", score: 15, coeff: 1 }, 1), R({ name: "DS rattrapage", score: 10, coeff: 1 }, 2));
        expect(m).toEqual({ data: { name: "DS rattrapage", score: 15, coeff: 1 }, deleted: false, conflicts: [] });
    });
    it("même champ modifié des deux côtés → le plus récent gagne, conflit signalé", () => {
        const m = merge3(base, L({ ...base.data, score: 11 }, 100), R({ ...base.data, score: 14 }, 200));
        expect(m.data.score).toBe(14);
        expect(m.conflicts).toEqual([{ field: "score", local: 11, remote: 14, winner: "remote" }]);
        expect(merge3(base, L({ ...base.data, score: 11 }, 300), R({ ...base.data, score: 14 }, 200)).data.score).toBe(11);
    });
    it("égalité parfaite des horodatages → départage déterministe par appareil", () => {
        expect(newerSide({ clientUpdatedAt: 5, deviceId: "b" }, { clientUpdatedAt: 5, deviceId: "a" })).toBe("local");
        expect(newerSide({ clientUpdatedAt: 5, deviceId: "a" }, { clientUpdatedAt: 5, deviceId: "b" })).toBe("remote");
        const x = merge3(base, L({ ...base.data, score: 1 }, 5), R({ ...base.data, score: 2 }, 5));
        const y = merge3(base, { ...R({ ...base.data, score: 2 }, 5) }, { ...L({ ...base.data, score: 1 }, 5) });
        expect(x.data.score).toBe(y.data.score); // même résultat vu des deux appareils
    });
    it("suppression contre modification : la plus récente gagne", () => {
        expect(merge3(base, L(base.data, 100, { deleted: true }), R({ ...base.data, score: 19 }, 200))).toMatchObject({ deleted: false, data: { score: 19 } });
        expect(merge3(base, L(base.data, 300, { deleted: true }), R({ ...base.data, score: 19 }, 200)).deleted).toBe(true);
        // L'autre côté n'a rien modifié : la suppression s'applique sans conflit
        expect(merge3(base, L(base.data, 1, { deleted: true }), R(base.data, 999))).toMatchObject({ deleted: true, conflicts: [] });
    });
    it("sans base (entrée jamais synchronisée) : champs identiques fusionnés, différences départagées", () => {
        const m = merge3(null, L({ a: 1, b: 2, createdAt: 1 }, 10), R({ a: 1, b: 3, createdAt: 2 }, 20));
        expect(m.data).toEqual({ a: 1, b: 3, createdAt: 2 });
        expect(m.conflicts.map((c) => c.field)).toEqual(["b"]); // createdAt : champ technique, pas de conflit signalé
    });
    it("champ supprimé d'un côté seulement", () => {
        const m = merge3({ data: { a: 1, notes: "x" } }, L({ a: 1 }, 1), R({ a: 1, notes: "x" }, 2));
        expect(m.data).toEqual({ a: 1 });
    });
    it("égalité profonde", () => {
        expect(deepEqual({ a: [1, { b: 2 }], c: undefined }, { a: [1, { b: 2 }] })).toBe(true);
        expect(deepEqual({ a: 1 }, { a: "1" })).toBe(false);
        expect(deepEqual([1, 2], [2, 1])).toBe(false);
        expect(deepEqual(NaN, NaN)).toBe(true);
        expect(sameContent({ data: { a: 1 }, deleted: false }, { data: { a: 1 }, deleted: true })).toBe(false);
    });
});

describe("Stockage local protégé", () => {
    it("préfixe, JSON corrompu, quota dépassé, stockage indisponible", () => {
        const storage = createMemoryStorage();
        const errors = [];
        const store = new LocalStore(storage, { onError: (e) => errors.push(e.kind) });
        store.setJSON("x", { a: 1 });
        expect(storage.getItem(`${PREFIX}x`)).toBe('{"a":1}');
        storage.setItem(`${PREFIX}bad`, "{pas du json");
        expect(store.getJSON("bad", "défaut")).toBe("défaut");
        const full = { ...storage, getItem: storage.getItem, setItem: () => { const e = new Error("plein"); e.name = "QuotaExceededError"; throw e; } };
        const store2 = new LocalStore(full, { onError: (e) => errors.push(e.kind) });
        expect(store2.setJSON("y", 1)).toBe(false);
        const broken = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => {}, removeItem: () => {}, length: 0, key: () => null };
        expect(new LocalStore(broken, { onError: (e) => errors.push(e.kind) }).getJSON("z", 42)).toBe(42);
        expect(errors).toEqual(["corrupt", "quota", "read"]);
    });
});

describe("Dépôt local", () => {
    it("création, modification, suppression logique, persistance et rechargement", () => {
        const { store, repo } = newRepo();
        const g = repo.create("grades", { name: "DS1", subjectCode: "R1.01", score: 12, max: 20, coeff: 1, createdAt: 1 });
        repo.update(g.id, { score: 13 });
        const h = repo.create("homework", { title: "TP" });
        repo.remove(h.id);
        expect(repo.grades()).toEqual([{ id: g.id, name: "DS1", subjectCode: "R1.01", score: 13, max: 20, coeff: 1, createdAt: 1 }]);
        expect(repo.homework()).toEqual([]);
        expect(repo.getRecord(h.id)).toMatchObject({ deleted: true, dirty: true });
        expect(repo.pendingCount()).toBe(2);
        const reloaded = new Repository({ store, scope: "local", deviceId: "dev-A" });
        expect(reloaded.grades()[0].score).toBe(13);
        expect(reloaded.getRecord(h.id).deleted).toBe(true);
    });
    it("une modification identique ne crée pas d'envoi inutile", () => {
        const { repo } = newRepo();
        const g = repo.create("grades", { name: "A", score: 1 });
        const rev = repo.getRecord(g.id).localRev;
        repo.update(g.id, { score: 1 });
        expect(repo.getRecord(g.id).localRev).toBe(rev);
    });
    it("réglages : un identifiant déterministe par clé", () => {
        const { repo } = newRepo();
        repo.setSetting("edtZoom:mobile", 1.5);
        repo.setSetting("edtZoom:mobile", 1.75);
        expect(repo.getSetting("edtZoom:mobile")).toBe(1.75);
        expect(repo.getRecord(settingId("edtZoom:mobile"))).toBeTruthy();
        expect(repo.list("settings")).toHaveLength(1);
        expect(repo.getSetting("inconnu", "défaut")).toBe("défaut");
    });
    it("notifications regroupées en lot, événement « storage » d'un autre onglet", () => {
        const storage = createMemoryStorage();
        const { repo } = newRepo({ storage });
        const events = [];
        repo.subscribe((e) => events.push(e.source));
        repo.batch(() => {
            repo.create("grades", { name: "1" });
            repo.create("grades", { name: "2" });
        });
        expect(events).toEqual(["local"]);
        const other = newRepo({ storage }).repo; // deuxième onglet, même stockage
        other.create("grades", { name: "3 (autre onglet)" });
        repo.reloadFromStorage();
        expect(repo.list("grades")).toHaveLength(3);
        expect(events.at(-1)).toBe("storage");
    });
    it("cloisonnement par compte et adoption des données locales", () => {
        const storage = createMemoryStorage();
        const { store, repo } = newRepo({ storage });
        repo.create("grades", { name: "invité" });
        expect(adoptLocalRecords(store, "local", "user-1")).toEqual({ adopted: 1, ok: true });
        repo.setScope("user-1");
        expect(repo.list("grades").map((g) => g.name)).toEqual(["invité"]);
        repo.setScope("user-2");
        expect(repo.list("grades")).toEqual([]);
        repo.setScope("local");
        expect(repo.list("grades")).toEqual([]);
    });
    it("ligne envoyée au serveur : suppression logique et horodatage ISO", () => {
        const { repo } = newRepo();
        const g = repo.create("grades", { name: "x" });
        repo.remove(g.id);
        const row = recordToRow(repo.getRecord(g.id));
        expect(row.deleted_at).toMatch(/Z$/);
        expect(row.client_updated_at).toMatch(/Z$/);
        expect(row).not.toHaveProperty("user_id");
    });
    it("entrées invalides dans le cache ignorées", () => {
        const storage = createMemoryStorage();
        storage.setItem(`${PREFIX}local:records`, JSON.stringify({ a: { id: "a", collection: "virus" }, b: null, c: { id: "autre", collection: "grades" } }));
        expect(newRepo({ storage }).repo.records.size).toBe(0);
    });
    it("calcul via le dépôt = valeurs golden (pipeline réel de l'application)", () => {
        const { repo } = newRepo();
        // Notes saisies dans un ordre mélangé : le tri par date de création restaure l'ordre d'origine
        const dataset = DATASETS["cas-normal"].map((g) => ({ ...g, createdAt: Number(g.id) }));
        for (const g of [...dataset].reverse()) repo.create("grades", { name: g.name, subjectCode: g.subjectCode, score: g.score, max: g.max, coeff: g.coeff, createdAt: g.createdAt });
        expect(calculateAllAverages(repo.grades())).toStrictEqual(calculateAllAverages(DATASETS["cas-normal"]));
    });
});

describe("Migration des données d'origine", () => {
    it("identifiants déterministes, notes d'exemple ignorées, rejets comptés", () => {
        const list = [...SAMPLE_GRADES, { id: "1696000000001", name: "DS", subjectCode: "R1.01", score: 12, max: 20, coeff: 1 }, { id: "x", subjectCode: "R1.01", score: "abc" }];
        const plan = planLegacyGrades(list);
        expect(plan.skippedSamples).toBe(3);
        expect(plan.rejected).toEqual([{ index: 4, reason: "note invalide" }]);
        expect(plan.grades).toHaveLength(1);
        expect(plan.grades[0].id).toBe(legacyGradeId({ name: " ds ", subjectCode: "R1.01", score: 12, max: 20, coeff: 1 }, 0));
        expect(plan.grades[0].data).toMatchObject({ createdAt: 1696000000001, legacyId: "1696000000001" });
        expect(plan.grades[0].clientUpdatedAt).toBe(1696000000001);
        expect(planLegacyGrades({}).error).toBeTruthy();
    });
    it("une note d'exemple modifiée par l'utilisateur est migrée", () => {
        expect(isSampleGrade({ ...SAMPLE_GRADES[0], score: 16 })).toBe(false);
        expect(isSampleGrade(SAMPLE_GRADES[1])).toBe(true);
    });
    it("sauvegarde automatique avant migration, clé d'origine intacte, idempotence", () => {
        const storage = createMemoryStorage();
        const legacy = JSON.stringify([{ id: "1696000000001", name: "DS", subjectCode: "R1.01", score: 12, max: 20, coeff: 1 }]);
        storage.setItem(LEGACY_KEY, legacy);
        const { store, repo } = newRepo({ storage });
        const first = runLegacyMigration({ store, repo });
        expect(first).toMatchObject({ added: 1, firstTime: true });
        expect(first.backup.content).toBe(legacy);
        expect(store.getJSON("backups")).toHaveLength(1);
        expect(storage.getItem(LEGACY_KEY)).toBe(legacy);
        const second = runLegacyMigration({ store, repo });
        expect(second).toMatchObject({ added: 0, alreadyPresent: 1 });
        expect(store.getJSON("backups")).toHaveLength(1);
        // Note ajoutée par un ancien onglet resté ouvert → migrée au démarrage suivant
        storage.setItem(LEGACY_KEY, JSON.stringify([...JSON.parse(legacy), { id: "1696000000009", name: "Ajout tardif", subjectCode: "R1.02", score: 5, max: 10, coeff: 1 }]));
        expect(runLegacyMigration({ store, repo }).added).toBe(1);
        expect(repo.grades()).toHaveLength(2);
    });
    it("note supprimée dans la v2 jamais ressuscitée ; JSON d'origine illisible conservé", () => {
        const storage = createMemoryStorage();
        storage.setItem(LEGACY_KEY, JSON.stringify([{ id: "1696000000001", name: "DS", subjectCode: "R1.01", score: 12, max: 20, coeff: 1 }]));
        const { store, repo } = newRepo({ storage });
        runLegacyMigration({ store, repo });
        repo.remove(repo.grades()[0].id);
        expect(runLegacyMigration({ store, repo }).added).toBe(0);
        expect(repo.grades()).toHaveLength(0);
        const s2 = createMemoryStorage();
        s2.setItem(LEGACY_KEY, "{corrompu");
        const r2 = newRepo({ storage: s2 });
        expect(runLegacyMigration({ store: r2.store, repo: r2.repo }).error).toMatch(/illisibles/);
        expect(s2.getItem(LEGACY_KEY)).toBe("{corrompu");
    });
    it("aucune donnée d'origine → rien à faire", () => {
        const { store, repo } = newRepo();
        expect(runLegacyMigration({ store, repo })).toBeNull();
    });
});

describe("Export / import JSON", () => {
    it("aller-retour complet sans le lien ADE personnel", () => {
        const { repo } = newRepo();
        repo.create("grades", { name: "DS", subjectCode: "R1.01", score: 12, max: 20, coeff: 1, createdAt: 5 });
        repo.create("homework", { title: "Rendu", type: "devoir", subjectCode: null, dueDate: "2026-10-20", dueTime: "23:59", importance: 2, anticipationDays: 2, notes: "", status: "todo", createdAt: 1 });
        repo.setSetting("edtUrl", "https://proseconsult.umontpellier.fr/direct/?data=secret");
        repo.setSetting("lastSubject", "R1.05");
        const exported = buildExport(repo, { appVersion: "2.0.0" });
        expect(JSON.stringify(exported)).not.toContain("secret");
        const target = newRepo({ deviceId: "dev-B" }).repo;
        const plan = planImport(JSON.stringify(exported));
        expect(plan).toMatchObject({ kind: "v2", rejected: 0 });
        expect(applyImport(target, plan)).toEqual({ added: 4 - 1, updated: 0, unchanged: 0, rejected: 0 });
        expect(target.grades()[0]).toMatchObject({ name: "DS", score: 12 });
        expect(target.homework()[0].title).toBe("Rendu");
        expect(target.getSetting("lastSubject")).toBe("R1.05");
        // Réimport : rien ne change, rien n'est supprimé
        expect(applyImport(target, planImport(JSON.stringify(exported)))).toMatchObject({ added: 0, updated: 0, unchanged: 3 });
    });
    it("import de l'ancien format (tableau) : identifiants déterministes, sans doublon", () => {
        const { repo } = newRepo();
        const old = JSON.stringify([{ id: "1696000000001", name: "DS", subjectCode: "R1.01", score: 12, max: 20, coeff: 1 }]);
        expect(applyImport(repo, planImport(old))).toMatchObject({ added: 1 });
        expect(applyImport(repo, planImport(old))).toMatchObject({ added: 0, unchanged: 1 });
    });
    it("fichiers invalides ou piégés refusés proprement", () => {
        expect(planImport("pas du json").error).toMatch(/JSON/);
        expect(planImport('{"format":"autre"}').error).toMatch(/Format/);
        const evil = { format: "gestionnaire-de-notes", version: 2, collections: { grades: [{ id: "pas-un-uuid", name: "<img onerror=alert(1)>", subjectCode: "R1.01", score: 1 }], homework: [{ id: "x" }], settings: [{ key: "edtUrl", value: "vol" }, { key: 3 }] } };
        expect(planImport(JSON.stringify(evil))).toMatchObject({ kind: "v2", grades: [], homework: [], settings: [], rejected: 4 });
    });
});

describe("Moteur : rattrapage avec recouvrement et pagination", () => {
    it("une ligne validée « dans le passé » (dans la fenêtre de recouvrement) est rattrapée", async () => {
        let t = Date.parse("2026-10-13T08:00:00Z");
        const server = new MemoryServer({ now: () => t });
        server.signUp("u@example.com", "secret1");
        const backend = new MemoryBackend(server);
        await backend.signIn("u@example.com", "secret1");
        backend.setRealtimeEnabled(false);
        const { repo } = newRepo();
        const engine = new SyncEngine({ repo, backend, now: () => t, pushDebounceMs: 1, pollMs: 1e9, pageSize: 3 });
        await engine.start();
        // 7 lignes → plusieurs pages de 3
        const writer = new MemoryBackend(server);
        await writer.signIn("u@example.com", "secret1");
        const rows = Array.from({ length: 7 }, (_, i) => ({ id: crypto.randomUUID(), collection: "grades", data: { name: `n${i}` }, client_updated_at: new Date(t).toISOString(), device_id: "w" }));
        await writer.insertMany(rows);
        await engine.syncNow();
        expect(repo.list("grades")).toHaveLength(7);
        // Ligne « tardive » : horodatée 1 min avant le curseur (transaction validée en retard)
        t += 10 * 60000;
        await engine.syncNow();
        const late = { id: crypto.randomUUID(), user_id: backend.session.userId, collection: "grades", data: { name: "tardive" }, deleted_at: null, client_updated_at: new Date(t).toISOString(), device_id: "w" };
        const cursor = repo.syncMeta().cursor;
        server.rows.set(`${late.user_id}|${late.id}`, { ...late, created_at: cursor, updated_at: shiftServerTs(cursor, -60000).replace("Z", "000+00:00") });
        await engine.syncNow();
        expect(repo.list("grades").map((g) => g.name)).toContain("tardive");
        engine.stop();
    });
    it("erreurs : hors-ligne → nouvel essai programmé ; auth → plus d'essai", async () => {
        const server = new MemoryServer();
        server.signUp("u@example.com", "secret1");
        const backend = new MemoryBackend(server);
        await backend.signIn("u@example.com", "secret1");
        const timers = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), setInterval: vi.fn(() => 2), clearInterval: vi.fn() };
        const { repo } = newRepo();
        const statuses = [];
        const engine = new SyncEngine({ repo, backend, timers, onStatus: (s) => statuses.push(s.phase) });
        backend.setOnline(false);
        await engine.start();
        expect(statuses.at(-1)).toBe("offline");
        expect(timers.setTimeout).toHaveBeenCalled();
        backend.setOnline(true);
        server.expireToken(backend.token);
        timers.setTimeout.mockClear();
        await engine.syncNow();
        expect(statuses.at(-1)).toBe("auth-expired");
        expect(timers.setTimeout).not.toHaveBeenCalled();
        engine.stop();
    });
});
