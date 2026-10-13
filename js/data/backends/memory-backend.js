/**
 * Adaptateur « en mémoire » (tests) : même interface que SupabaseBackend, branché sur un
 * MemoryServer partagé entre plusieurs clients simulés. Permet de simuler une coupure
 * réseau (avant ou après validation serveur), une session expirée, et la suspension du
 * temps réel (iOS en arrière-plan : les événements sont perdus, pas mis en file).
 */
import { SyncError } from "../sync-errors.js";

const clone = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

export class MemoryBackend {
    constructor(server, { name = "client" } = {}) {
        this.server = server;
        this.name = name;
        this.session = null;
        this.online = true;
        this.realtimeEnabled = true;
        this.failures = [];
        this.authListeners = new Set();
        this.realtime = null;
        this.calls = [];
    }

    // ---------- Simulation réseau ----------

    setOnline(online) {
        this.online = online;
        if (this.realtime) this.realtime.onState(online && this.realtimeEnabled ? "connected" : "disconnected");
    }

    /** Coupe/rétablit uniquement le temps réel (ex. iOS suspend la connexion WebSocket). */
    setRealtimeEnabled(enabled) {
        this.realtimeEnabled = enabled;
        if (this.realtime) this.realtime.onState(enabled && this.online ? "connected" : "disconnected");
    }

    /** La prochaine opération `op` échoue : "before" = jamais arrivée, "after" = exécutée mais réponse perdue. */
    failNext(op, when = "before") {
        this.failures.push({ op, when });
    }

    async call(op, fn) {
        this.calls.push(op);
        await Promise.resolve();
        if (!this.online) throw new SyncError("network", "Hors-ligne (simulation).");
        const idx = this.failures.findIndex((f) => f.op === op || f.op === "any");
        const failure = idx >= 0 ? this.failures.splice(idx, 1)[0] : null;
        if (failure && failure.when === "before") throw new SyncError("network", `Coupure réseau avant ${op} (simulation).`);
        const result = fn();
        if (failure && failure.when === "after") throw new SyncError("network", `Réponse perdue après ${op} (simulation).`);
        return clone(result);
    }

    // ---------- Authentification ----------

    get token() {
        return this.session ? this.session.token : null;
    }

    async getSession() {
        return this.session ? { userId: this.session.userId, email: this.session.email } : null;
    }

    async signIn(email, password) {
        const s = await this.call("auth", () => this.server.signIn(email, password));
        this.session = s;
        this.emitAuth("signed-in");
        return { userId: s.userId, email: s.email };
    }

    async signUp(email, password) {
        const s = await this.call("auth", () => this.server.signUp(email, password));
        this.session = s;
        this.emitAuth("signed-in");
        return { userId: s.userId, email: s.email, needsConfirmation: false };
    }

    async signOut() {
        if (this.session) this.server.signOut(this.session.token);
        this.session = null;
        this.closeRealtime();
        this.emitAuth("signed-out");
    }

    async refreshSession() {
        if (!this.session) return null;
        try {
            this.server.authenticate(this.session.token);
            return { userId: this.session.userId, email: this.session.email };
        } catch {
            return null;
        }
    }

    onAuthChange(listener) {
        this.authListeners.add(listener);
        return () => this.authListeners.delete(listener);
    }

    emitAuth(event) {
        const session = this.session ? { userId: this.session.userId, email: this.session.email } : null;
        for (const l of [...this.authListeners]) l(event, session);
    }

    // ---------- Données ----------

    async serverTime() {
        return this.call("time", () => this.server.serverTime(this.token));
    }

    async pull({ since = null, limit = 500 } = {}) {
        const rows = await this.call("pull", () => this.server.select(this.token, { since, limit }));
        return { rows };
    }

    async insertMany(rows) {
        const userId = this.session ? this.session.userId : undefined;
        const inserted = await this.call("insert", () => this.server.insertMany(this.token, rows.map((r) => ({ ...clone(r), user_id: userId }))));
        return { rows: inserted };
    }

    async updateIf(row, baseUpdatedAt) {
        const userId = this.session ? this.session.userId : undefined;
        const updated = await this.call("update", () => this.server.updateIf(this.token, { ...clone(row), user_id: userId }, baseUpdatedAt));
        return { row: updated };
    }

    async fetchOne(id) {
        const row = await this.call("fetch", () => this.server.get(this.token, id));
        return { row };
    }

    subscribe(onRow, onState) {
        this.closeRealtime();
        const handle = { onRow, onState, unsub: null };
        try {
            handle.unsub = this.server.subscribe(this.token, (row) => {
                // Événements perdus (pas mis en file) quand le temps réel est coupé
                if (this.online && this.realtimeEnabled) onRow(row);
            });
        } catch {
            onState("disconnected");
            return () => {};
        }
        this.realtime = handle;
        queueMicrotask(() => onState(this.online && this.realtimeEnabled ? "connected" : "disconnected"));
        return () => {
            if (handle.unsub) handle.unsub();
            if (this.realtime === handle) this.realtime = null;
        };
    }

    closeRealtime() {
        if (this.realtime && this.realtime.unsub) this.realtime.unsub();
        this.realtime = null;
    }

    // ---------- Emploi du temps (tests) ----------

    async fetchTimetable() {
        if (!this.online) throw new SyncError("network", "Hors-ligne (simulation).");
        if (this.timetableResponder) return this.timetableResponder();
        throw new SyncError("server", "Aucun emploi du temps simulé.", { status: 502 });
    }
}
