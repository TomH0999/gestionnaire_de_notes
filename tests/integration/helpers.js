/**
 * Clients simulés pour les tests d'intégration : chaque « appareil » a son propre
 * stockage local, son adaptateur et son contrôleur de synchronisation, et partage le
 * même serveur (MemoryServer ou serveur Postgres réel via PGlite).
 */
import { LocalStore, createMemoryStorage } from "../../js/data/local-store.js";
import { SyncController } from "../../js/data/sync-controller.js";
import { MemoryBackend } from "../../js/data/backends/memory-backend.js";
import { runLegacyMigration, LEGACY_KEY } from "../../js/data/migration.js";

export function createClock(startIso = "2026-10-13T08:00:00.000Z") {
    let t = Date.parse(startIso);
    return {
        now: () => t,
        advance(ms) {
            t += ms;
        },
        set(iso) {
            t = Date.parse(iso);
        }
    };
}

export const fastEngine = { pushDebounceMs: 1, pollMs: 3600000 };

export function createDevice(name, { server, clock, skewMs = 0, storage = createMemoryStorage(), legacyGrades = null, backendFactory = null } = {}) {
    if (legacyGrades) storage.setItem(LEGACY_KEY, JSON.stringify(legacyGrades));
    const store = new LocalStore(storage);
    const backend = backendFactory ? backendFactory(name) : new MemoryBackend(server, { name });
    const deviceNow = () => clock.now() + skewMs;
    const controller = new SyncController({ store, backend, deviceId: `device-${name}`, deviceNow, engineOptions: fastEngine });
    const migration = runLegacyMigration({ store, repo: controller.repo, now: deviceNow });
    return {
        name,
        storage,
        store,
        backend,
        controller,
        migration,
        get repo() {
            return controller.repo;
        },
        async start() {
            await controller.init();
            return this;
        },
        async signIn(email = "tom@example.com", password = "motdepasse") {
            await controller.signIn(email, password);
            await settle([this]);
            return this;
        },
        grades() {
            return controller.repo.grades();
        }
    };
}

/** Attend que tous les moteurs soient au repos (plus de cycle en cours ni d'envoi programmé). */
export async function settle(devices, { rounds = 30 } = {}) {
    for (let i = 0; i < rounds; i++) {
        await new Promise((r) => setTimeout(r, 3));
        let busy = false;
        for (const d of devices) {
            const engine = d.controller.engine;
            if (!engine) continue;
            if (engine.running) {
                busy = true;
                await engine.running.catch(() => {});
            }
        }
        if (!busy) {
            await new Promise((r) => setTimeout(r, 3));
            if (devices.every((d) => !d.controller.engine || !d.controller.engine.running)) return;
        }
    }
}

/** Synchronisation complète de chaque appareil, deux fois (aller-retour des fusions). */
export async function syncAll(devices) {
    for (let pass = 0; pass < 2; pass++) {
        for (const d of devices) {
            if (d.controller.engine) await d.controller.syncNow();
        }
        await settle(devices);
    }
}

export function byName(list) {
    return Object.fromEntries(list.map((g) => [g.name, g]));
}
