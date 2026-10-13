/**
 * Moteur de synchronisation (indépendant du fournisseur : voir backends/).
 *
 * Cycle : pull (rattrapage incrémental avec recouvrement) puis push (envoi des entrées
 * modifiées localement). Déclenché au démarrage, après chaque modification locale
 * (avec un petit délai), à chaque événement temps réel, au retour au premier plan,
 * à la reconnexion réseau, et par sondage de secours si le temps réel est coupé.
 *
 * Interface attendue de l'adaptateur (backend) :
 *   pull({ since, limit })           → { rows }  lignes avec updated_at >= since, triées
 *   insertMany(rows)                 → { rows }  lignes réellement insérées (ON CONFLICT DO NOTHING)
 *   updateIf(row, baseUpdatedAt)     → { row }   null si la ligne a changé depuis la base
 *   fetchOne(id)                     → { row }   null si absente
 *   subscribe(onRow, onState)        → fonction de désabonnement
 */
import { SyncError } from "./sync-errors.js";
import { compareServerTs, parseServerTs } from "./merge.js";
import { recordToRow } from "./repository.js";

const RETRY_DELAYS = [2000, 5000, 15000, 30000, 60000, 120000];

export function shiftServerTs(ts, deltaMs) {
    const p = parseServerTs(ts);
    if (!p) return null;
    return new Date(p.ms + deltaMs).toISOString();
}

export class SyncEngine {
    constructor({
        repo,
        backend,
        timers = globalThis,
        now = () => Date.now(),
        onStatus = () => {},
        onConflict = () => {},
        onClockOffset = () => {},
        pageSize = 500,
        insertChunk = 200,
        overlapMs = 120000,
        fullSyncEveryMs = 12 * 3600000,
        pushDebounceMs = 400,
        pollMs = 60000,
        initialClockOffset = 0
    }) {
        Object.assign(this, { repo, backend, timers, now, onStatus, onConflict, onClockOffset, pageSize, insertChunk, overlapMs, fullSyncEveryMs, pushDebounceMs, pollMs });
        this.started = false;
        this.running = null;
        this.rerun = null;
        this.retryIndex = 0;
        this.clockSamples = [];
        this.clockOffset = initialClockOffset;
        this.lastClockSync = 0;
        this.status = { phase: "idle", pending: 0, lastSyncAt: repo.syncMeta().lastSyncAt || null, error: null, realtime: "off" };
    }

    // ---------- Cycle de vie ----------

    start() {
        if (this.started) return this.running || Promise.resolve();
        this.started = true;
        this.unsubRepo = this.repo.subscribe((event) => {
            if (event.conflicts && event.conflicts.length) this.onConflict(event.conflicts);
            if (event.source === "local" || (event.source !== "sync" && this.repo.pendingCount() > 0)) this.schedulePush();
            this.emit();
        });
        this.subscribeRealtime();
        this.pollTimer = this.timers.setInterval(() => {
            if (this.status.realtime !== "connected") this.syncNow({ reason: "poll" });
        }, this.pollMs);
        return this.syncNow({ reason: "start" });
    }

    stop() {
        this.started = false;
        if (this.unsubRepo) this.unsubRepo();
        if (this.unsubRealtime) {
            try {
                this.unsubRealtime();
            } catch {
                /* ignoré */
            }
        }
        this.unsubRepo = null;
        this.unsubRealtime = null;
        this.timers.clearTimeout(this.pushTimer);
        this.timers.clearTimeout(this.retryTimer);
        this.timers.clearInterval(this.pollTimer);
        this.status.realtime = "off";
    }

    subscribeRealtime() {
        try {
            this.unsubRealtime = this.backend.subscribe(
                (row) => this.repo.applyRemote(row),
                (state) => {
                    const previous = this.status.realtime;
                    this.status.realtime = state;
                    this.emit();
                    // Reconnexion du temps réel : rattraper ce qui a pu être manqué pendant la coupure
                    if (state === "connected" && previous !== "connected" && previous !== "off") this.syncNow({ reason: "realtime" });
                }
            );
        } catch {
            this.status.realtime = "disconnected";
        }
    }

    /** À appeler sur les événements online/offline du navigateur. */
    setNetworkAvailable(online) {
        if (!this.started) return;
        if (online) this.syncNow({ reason: "online" });
        else this.setPhase("offline");
    }

    // ---------- Statut ----------

    setPhase(phase) {
        this.status.phase = phase;
        this.emit();
    }

    emit() {
        this.status.pending = this.repo.pendingCount();
        try {
            this.onStatus({ ...this.status });
        } catch (e) {
            console.error(e);
        }
    }

    // ---------- Déclenchement ----------

    schedulePush() {
        if (!this.started) return;
        this.timers.clearTimeout(this.pushTimer);
        this.pushTimer = this.timers.setTimeout(() => this.syncNow({ pushOnly: true, reason: "local" }), this.pushDebounceMs);
    }

    scheduleRetry() {
        if (!this.started) return;
        const delay = RETRY_DELAYS[Math.min(this.retryIndex, RETRY_DELAYS.length - 1)];
        this.retryIndex++;
        this.timers.clearTimeout(this.retryTimer);
        this.retryTimer = this.timers.setTimeout(() => this.syncNow({ reason: "retry" }), delay);
    }

    async syncNow({ full = false, pushOnly = false } = {}) {
        if (!this.started) return;
        if (this.running) {
            this.rerun = { full: (this.rerun && this.rerun.full) || full, pull: (this.rerun && this.rerun.pull) || !pushOnly };
            return this.running;
        }
        this.running = this.runLoop({ full, pushOnly });
        try {
            await this.running;
        } finally {
            this.running = null;
        }
    }

    async runLoop({ full, pushOnly }) {
        this.setPhase("syncing");
        try {
            await this.syncClock();
            let pass = { full, pull: !pushOnly };
            for (let i = 0; i < 10 && pass; i++) {
                if (pass.pull) await this.pull({ full: pass.full });
                await this.push();
                pass = this.rerun;
                this.rerun = null;
            }
            this.retryIndex = 0;
            this.timers.clearTimeout(this.retryTimer);
            const at = this.now();
            this.repo.setSyncMeta({ lastSyncAt: at });
            this.status.lastSyncAt = at;
            this.status.error = null;
            this.setPhase("idle");
        } catch (error) {
            this.handleError(error);
        }
    }

    handleError(error) {
        const kind = error && error.kind ? error.kind : "server";
        this.status.error = { kind, message: error && error.message ? error.message : String(error) };
        if (kind === "auth") {
            this.setPhase("auth-expired");
            return; // pas de nouvel essai : il faut se reconnecter (la file est conservée)
        }
        this.setPhase(kind === "network" ? "offline" : "error");
        this.scheduleRetry();
    }

    // ---------- Pull ----------

    async pull({ full = false } = {}) {
        const meta = this.repo.syncMeta();
        const doFull = full || !meta.cursor || this.now() - (meta.lastFullSyncAt || 0) > this.fullSyncEveryMs;
        let since = doFull ? null : shiftServerTs(meta.cursor, -this.overlapMs);
        let maxSeen = doFull ? null : meta.cursor;
        for (let page = 0; page < 100000; page++) {
            const { rows } = await this.backend.pull({ since, limit: this.pageSize });
            if (rows.length) {
                this.repo.batch(() => {
                    for (const row of rows) this.repo.applyRemote(row);
                });
            }
            for (const row of rows) if (compareServerTs(row.updated_at, maxSeen) > 0) maxSeen = row.updated_at;
            if (rows.length < this.pageSize) break;
            const last = rows[rows.length - 1].updated_at;
            if (since !== null && compareServerTs(last, since) <= 0) break; // aucune progression possible
            since = last;
        }
        this.repo.setSyncMeta({ cursor: maxSeen || meta.cursor || null, lastFullSyncAt: doFull ? this.now() : meta.lastFullSyncAt || 0 });
    }

    // ---------- Push ----------

    async push() {
        const dirty = this.repo.dirtyRecords();
        if (dirty.length === 0) return;
        const fresh = dirty.filter((r) => !r.serverUpdatedAt);
        const known = dirty.filter((r) => r.serverUpdatedAt);

        for (let i = 0; i < fresh.length; i += this.insertChunk) {
            const chunk = fresh.slice(i, i + this.insertChunk).map((r) => ({ id: r.id, rev: r.localRev, row: recordToRow(r) }));
            const t0 = this.now();
            const { rows } = await this.backend.insertMany(chunk.map((c) => c.row));
            const t1 = this.now();
            const inserted = new Map(rows.map((r) => [r.id, r]));
            this.repo.batch(() => {
                for (const c of chunk) {
                    const srv = inserted.get(c.id);
                    if (srv) {
                        this.repo.confirmPush(c.id, c.rev, c.row, srv);
                        this.observeClock(t0, t1, srv.updated_at);
                    }
                }
            });
            // Déjà présentes côté serveur (autre appareil, migration, ou envoi précédent dont la réponse s'est perdue)
            for (const c of chunk) if (!inserted.has(c.id)) await this.resolveExisting(c.id, 0);
        }
        for (const r of known) await this.pushOne(r.id, 0);
    }

    async pushOne(id, attempt) {
        const rec = this.repo.getRecord(id);
        if (!rec || !rec.dirty) return;
        if (attempt > 6) throw new SyncError("conflict", "Conflits répétés sur une même entrée : nouvel essai plus tard.");
        if (!rec.serverUpdatedAt) return this.insertOne(id, attempt);
        const row = recordToRow(rec);
        const rev = rec.localRev;
        const t0 = this.now();
        const { row: srv } = await this.backend.updateIf(row, rec.serverUpdatedAt);
        const t1 = this.now();
        if (srv) {
            this.repo.confirmPush(id, rev, row, srv);
            this.observeClock(t0, t1, srv.updated_at);
            return;
        }
        await this.resolveExisting(id, attempt + 1);
    }

    async insertOne(id, attempt) {
        const rec = this.repo.getRecord(id);
        if (!rec || !rec.dirty) return;
        const row = recordToRow(rec);
        const rev = rec.localRev;
        const t0 = this.now();
        const { rows } = await this.backend.insertMany([row]);
        const t1 = this.now();
        if (rows.length) {
            this.repo.confirmPush(id, rev, row, rows[0]);
            this.observeClock(t0, t1, rows[0].updated_at);
            return;
        }
        await this.resolveExisting(id, attempt + 1);
    }

    /** La ligne existe et diffère de notre base : on la récupère, on fusionne, on renvoie si besoin. */
    async resolveExisting(id, attempt) {
        if (attempt > 6) throw new SyncError("conflict", "Conflits répétés sur une même entrée : nouvel essai plus tard.");
        const { row } = await this.backend.fetchOne(id);
        if (!row) {
            this.repo.markNeverSynced(id);
            return this.insertOne(id, attempt + 1);
        }
        this.repo.applyRemote(row, { force: true });
        const rec = this.repo.getRecord(id);
        if (rec && rec.dirty) await this.pushOne(id, attempt + 1);
    }

    // ---------- Horloge ----------

    /**
     * Mesure l'heure du serveur (au plus toutes les 10 min) AVANT de fusionner quoi que ce
     * soit : un appareil dont l'horloge est décalée ne doit pas gagner un conflit à tort.
     */
    async syncClock() {
        if (typeof this.backend.serverTime !== "function") return;
        if (this.lastClockSync && this.now() - this.lastClockSync < 600000 && this.clockSamples.length > 0) return;
        const t0 = this.now();
        const ts = await this.backend.serverTime();
        const t1 = this.now();
        this.lastClockSync = t1;
        this.observeClock(t0, t1, ts);
    }

    /** Estime l'écart horloge appareil → serveur (médiane des dernières mesures). */
    observeClock(t0, t1, serverTs) {
        const p = parseServerTs(serverTs);
        if (!p || t1 - t0 > 5000) return;
        this.clockSamples.push(p.ms - (t0 + t1) / 2);
        if (this.clockSamples.length > 7) this.clockSamples.shift();
        const sorted = [...this.clockSamples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (Math.abs(median - this.clockOffset) > 1000) {
            const previous = this.clockOffset;
            this.clockOffset = Math.round(median);
            this.onClockOffset(this.clockOffset, this.clockOffset - previous);
        }
    }
}
