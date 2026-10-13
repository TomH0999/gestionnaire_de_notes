/**
 * Orchestration compte + données + synchronisation (utilisé tel quel par l'application
 * et par les tests d'intégration).
 *
 * Modes :
 *  - "local"      : synchronisation non configurée (config.js vide) → tout reste sur l'appareil ;
 *  - "signed-out" : synchronisation configurée mais aucun compte connecté (données locales) ;
 *  - "signed-in"  : compte connecté, moteur de synchronisation actif.
 *
 * Portées de données : « local » (avant toute connexion) puis l'identifiant du compte.
 * Au premier compte connecté sur l'appareil, les données locales sont adoptées par ce compte.
 * Après une déconnexion, les données du compte restent en cache (et les modifications en
 * file d'attente) jusqu'à la reconnexion de ce même compte.
 */
import { Repository, adoptLocalRecords } from "./repository.js";
import { SyncEngine } from "./sync-engine.js";
import { SyncError } from "./sync-errors.js";
import { uuidv4 } from "../core/uuid.js";

export function getDeviceId(store) {
    let id = store.getJSON("device-id", null);
    if (typeof id !== "string" || id.length < 8) {
        id = uuidv4();
        store.setJSON("device-id", id);
    }
    return id;
}

export class SyncController {
    constructor({ store, backend = null, configured = !!backend, deviceId = getDeviceId(store), deviceNow = () => Date.now(), timers = globalThis, engineOptions = {} }) {
        this.store = store;
        this.backend = backend;
        this.deviceId = deviceId;
        this.deviceNow = deviceNow;
        this.timers = timers;
        this.engineOptions = engineOptions;
        this.clockOffset = Number(store.getJSON("clock-offset", 0)) || 0;
        this.engine = null;
        this.listeners = new Set();
        const meta = store.getJSON("meta", {});
        this.repo = new Repository({ store, scope: meta.activeScope || "local", deviceId, clock: () => this.deviceNow() + this.clockOffset });
        this.state = {
            mode: configured ? "signed-out" : "local",
            user: meta.lastUser || null,
            sessionExpired: false,
            sync: { phase: configured ? (backend ? "signed-out" : "starting") : "disabled", pending: this.repo.pendingCount(), lastSyncAt: null, error: null, realtime: "off" }
        };
        this.repo.subscribe(() => this.refreshPending());
    }

    /**
     * Branche l'adaptateur une fois la bibliothèque chargée : l'application s'affiche
     * d'abord depuis le cache local (instantané), la synchronisation démarre ensuite.
     */
    async attachBackend(backend) {
        this.backend = backend;
        if (this.state.mode === "local") this.state.mode = "signed-out";
        this.state.sync = { ...this.state.sync, phase: "signed-out" };
        return this.init();
    }

    // ---------- Abonnement à l'état ----------

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit() {
        const snapshot = this.getState();
        for (const l of [...this.listeners]) {
            try {
                l(snapshot);
            } catch (e) {
                console.error(e);
            }
        }
    }

    getState() {
        return { ...this.state, sync: { ...this.state.sync, pending: this.repo.pendingCount() } };
    }

    refreshPending() {
        const pending = this.repo.pendingCount();
        if (pending !== this.state.sync.pending) {
            this.state.sync.pending = pending;
            this.emit();
        }
    }

    // ---------- Démarrage et session ----------

    async init() {
        if (!this.backend) return this.getState();
        this.unsubAuth = this.backend.onAuthChange((event, session) => this.handleAuthEvent(event, session));
        let session;
        try {
            session = await this.backend.getSession();
        } catch {
            session = null;
        }
        if (session) await this.activate(session);
        else this.setSignedOut(false);
        return this.getState();
    }

    async signIn(email, password) {
        this.requireBackend();
        const session = await this.backend.signIn(email, password);
        await this.activate(session);
        return session;
    }

    async signUp(email, password) {
        this.requireBackend();
        const result = await this.backend.signUp(email, password);
        if (result && result.userId && !result.needsConfirmation) await this.activate(result);
        return result;
    }

    async signOut() {
        this.stopEngine();
        if (this.backend) {
            try {
                await this.backend.signOut();
            } catch {
                /* déconnexion locale quoi qu'il arrive */
            }
        }
        this.setSignedOut(false);
    }

    requireBackend() {
        if (!this.backend) throw new SyncError("config", "La synchronisation n'est pas configurée (voir docs/CONFIGURATION.md).");
    }

    async activate(session) {
        if (this.engine && this.state.user && this.state.user.id === session.userId && this.state.mode === "signed-in") {
            this.state.sessionExpired = false;
            this.engine.syncNow();
            this.emit();
            return;
        }
        this.stopEngine();
        const meta = this.store.getJSON("meta", {});
        if (this.repo.scope !== session.userId) {
            if (this.repo.scope === "local") adoptLocalRecords(this.store, "local", session.userId);
            this.repo.setScope(session.userId);
        }
        this.store.setJSON("meta", { ...meta, activeScope: session.userId, lastUser: { id: session.userId, email: session.email || null } });
        this.state.mode = "signed-in";
        this.state.user = { id: session.userId, email: session.email || null };
        this.state.sessionExpired = false;
        this.engine = new SyncEngine({
            repo: this.repo,
            backend: this.backend,
            timers: this.timers,
            now: this.deviceNow,
            onStatus: (status) => this.onEngineStatus(status),
            onConflict: (conflicts) => this.emitConflicts(conflicts),
            initialClockOffset: this.clockOffset,
            onClockOffset: (offset, delta) => {
                this.clockOffset = offset;
                this.store.setJSON("clock-offset", offset);
                // Les modifications encore en attente ont été horodatées avec l'ancien écart :
                // on les recale (l'avance ou le retard d'une horloge est en pratique stable).
                if (delta) this.repo.shiftDirtyEditTimes(delta);
            },
            ...this.engineOptions
        });
        this.emit();
        await this.engine.start();
    }

    stopEngine() {
        if (this.engine) this.engine.stop();
        this.engine = null;
    }

    setSignedOut(expired) {
        this.stopEngine();
        this.state.mode = this.backend ? "signed-out" : "local";
        this.state.sessionExpired = expired;
        this.state.sync = { ...this.state.sync, phase: expired ? "auth-expired" : this.backend ? "signed-out" : "disabled", realtime: "off" };
        this.emit();
    }

    handleAuthEvent(event, session) {
        if (event === "signed-out" && this.state.mode === "signed-in") {
            // Jeton révoqué / rafraîchissement impossible : on garde les données et la file.
            this.setSignedOut(true);
        } else if (event === "token-refreshed" && this.engine && this.state.sync.phase === "auth-expired") {
            this.engine.syncNow();
        } else if (event === "signed-in" && session && this.state.mode !== "signed-in") {
            this.activate(session).catch((e) => console.error(e));
        }
    }

    async onEngineStatus(status) {
        this.state.sync = { ...status };
        this.emit();
        if (status.phase === "auth-expired" && !this.recovering) {
            // Une requête a été refusée (jeton expiré pendant une mise en veille) : un
            // rafraîchissement de session suffit souvent ; sinon reconnexion demandée.
            this.recovering = true;
            try {
                const session = this.backend.refreshSession ? await this.backend.refreshSession() : null;
                if (session && this.engine) this.engine.syncNow();
                else this.setSignedOut(true);
            } finally {
                this.recovering = false;
            }
        }
    }

    emitConflicts(conflicts) {
        this.lastConflicts = conflicts;
        for (const l of [...this.listeners]) {
            try {
                l(this.getState(), { conflicts });
            } catch (e) {
                console.error(e);
            }
        }
    }

    // ---------- Déclencheurs externes ----------

    syncNow(options) {
        if (this.engine) return this.engine.syncNow(options);
        return Promise.resolve();
    }

    setNetworkAvailable(online) {
        if (this.engine) this.engine.setNetworkAvailable(online);
    }

    /** Récupération de l'emploi du temps via la fonction serveur (compte connecté requis). */
    async fetchTimetable(request) {
        if (!this.backend) throw new SyncError("config", "Synchronisation non configurée : l'emploi du temps passe par le serveur Supabase.");
        if (this.state.mode !== "signed-in") throw new SyncError("auth", "Connectez-vous (Réglages) pour actualiser l'emploi du temps.");
        return this.backend.fetchTimetable(request);
    }
}
