/**
 * Serveur en mémoire qui reproduit la sémantique de la table Supabase `items`
 * (voir supabase/schema.sql) — utilisé par les tests et le serveur de test E2E :
 *  - clé primaire (user_id, id) ;
 *  - trigger : updated_at = horloge serveur (strictement croissante, microsecondes),
 *    created_at et user_id immuables, client_updated_at plafonné à now() + 1 min ;
 *  - RLS : aucune lecture/écriture sans session valide ; un utilisateur ne voit et ne
 *    modifie que ses lignes ; pas de suppression physique ;
 *  - insertMany = INSERT … ON CONFLICT DO NOTHING RETURNING * ;
 *  - updateIf  = UPDATE … WHERE id = $1 AND updated_at = $2 RETURNING * ;
 *  - abonnements temps réel par utilisateur.
 * Les tests SQL (PGlite) vérifient que le vrai schéma se comporte de la même façon.
 */
import { SyncError } from "../sync-errors.js";
import { uuidv4 } from "../../core/uuid.js";
import { compareServerTs } from "../merge.js";

export const ALLOWED_COLLECTIONS = ["grades", "homework", "settings"];
const CLIENT_CLOCK_TOLERANCE_MS = 60000;
const MAX_DATA_BYTES = 100000;

const clone = (v) => JSON.parse(JSON.stringify(v));

export function microsToIso(micros) {
    const ms = Number(micros / 1000n);
    const micro = Number(micros % 1000n);
    return `${new Date(ms).toISOString().slice(0, 23)}${String(micro).padStart(3, "0")}+00:00`;
}

export class MemoryServer {
    constructor({ now = () => Date.now(), tokenTtlMs = 3600000 } = {}) {
        this.now = now;
        this.tokenTtlMs = tokenTtlMs;
        this.users = new Map(); // email → { id, password }
        this.sessions = new Map(); // token → { userId, expiresAt }
        this.rows = new Map(); // `${userId}|${id}` → row
        this.subscribers = new Set();
        this.lastMicros = 0n;
        this.allowSignup = true;
        this.requestLog = [];
    }

    serverNowIso() {
        let micros = BigInt(Math.floor(this.now())) * 1000n;
        if (micros <= this.lastMicros) micros = this.lastMicros + 1n;
        this.lastMicros = micros;
        return microsToIso(micros);
    }

    // ---------- Authentification ----------

    signUp(email, password) {
        if (!this.allowSignup) throw new SyncError("auth", "Les inscriptions sont désactivées.", { code: "signup_disabled", status: 422 });
        const key = String(email).trim().toLowerCase();
        if (this.users.has(key)) throw new SyncError("auth", "Un compte existe déjà avec cette adresse.", { code: "user_already_exists", status: 422 });
        if (String(password).length < 6) throw new SyncError("auth", "Mot de passe trop court (6 caractères minimum).", { code: "weak_password", status: 422 });
        this.users.set(key, { id: uuidv4(), password: String(password) });
        return this.signIn(email, password);
    }

    signIn(email, password) {
        const user = this.users.get(String(email).trim().toLowerCase());
        if (!user || user.password !== String(password)) {
            throw new SyncError("auth", "Adresse e-mail ou mot de passe incorrect.", { code: "invalid_credentials", status: 400 });
        }
        const token = uuidv4();
        this.sessions.set(token, { userId: user.id, expiresAt: this.now() + this.tokenTtlMs });
        return { token, userId: user.id, email: String(email).trim().toLowerCase() };
    }

    signOut(token) {
        this.sessions.delete(token);
    }

    /** Fait expirer une session (test « session expirée »). */
    expireToken(token) {
        const s = this.sessions.get(token);
        if (s) s.expiresAt = 0;
    }

    authenticate(token) {
        const s = token ? this.sessions.get(token) : null;
        if (!s) throw new SyncError("auth", "Authentification requise.", { status: 401, code: "no_session" });
        if (s.expiresAt <= this.now()) throw new SyncError("auth", "Session expirée.", { status: 401, code: "jwt_expired" });
        return s.userId;
    }

    /** Équivalent de la fonction SQL public.server_time() (réservée aux comptes connectés). */
    serverTime(token) {
        this.authenticate(token);
        return this.serverNowIso();
    }

    // ---------- Données (équivalent RLS : tout passe par authenticate) ----------

    key(userId, id) {
        return `${userId}|${id}`;
    }

    select(token, { since = null, limit = 1000 } = {}) {
        const userId = this.authenticate(token);
        this.requestLog.push({ op: "select", userId });
        const rows = [...this.rows.values()]
            .filter((r) => r.user_id === userId && (since === null || compareIso(r.updated_at, since) >= 0))
            .sort((a, b) => compareIso(a.updated_at, b.updated_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .slice(0, limit);
        return rows.map(clone);
    }

    get(token, id) {
        const userId = this.authenticate(token);
        const row = this.rows.get(this.key(userId, id));
        return row ? clone(row) : null;
    }

    validate(row) {
        if (!row || typeof row.id !== "string" || !/^[0-9a-f-]{36}$/i.test(row.id)) throw new SyncError("server", "Identifiant invalide.", { status: 400, code: "22P02" });
        if (!ALLOWED_COLLECTIONS.includes(row.collection)) throw new SyncError("server", "Collection refusée par la contrainte CHECK.", { status: 400, code: "23514" });
        if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) throw new SyncError("server", "Données invalides.", { status: 400, code: "23514" });
        if (JSON.stringify(row.data).length > MAX_DATA_BYTES) throw new SyncError("server", "Entrée trop volumineuse.", { status: 400, code: "23514" });
    }

    clampClientTs(value) {
        const parsed = Date.parse(value);
        const limit = this.now() + CLIENT_CLOCK_TOLERANCE_MS;
        if (!Number.isFinite(parsed)) return new Date(this.now()).toISOString();
        return new Date(Math.min(parsed, limit)).toISOString();
    }

    insertMany(token, rows) {
        const userId = this.authenticate(token);
        this.requestLog.push({ op: "insert", userId, count: rows.length });
        for (const row of rows) {
            this.validate(row);
            if (row.user_id !== undefined && row.user_id !== userId) {
                throw new SyncError("server", "new row violates row-level security policy", { status: 403, code: "42501" });
            }
        }
        const inserted = [];
        for (const row of rows) {
            const k = this.key(userId, row.id);
            if (this.rows.has(k)) continue; // ON CONFLICT DO NOTHING
            const ts = this.serverNowIso();
            const stored = {
                id: row.id,
                user_id: userId,
                collection: row.collection,
                data: clone(row.data),
                deleted_at: row.deleted_at || null,
                client_updated_at: this.clampClientTs(row.client_updated_at),
                device_id: row.device_id || null,
                created_at: ts,
                updated_at: ts
            };
            this.rows.set(k, stored);
            inserted.push(clone(stored));
            this.broadcast(stored);
        }
        return inserted;
    }

    updateIf(token, row, baseUpdatedAt) {
        const userId = this.authenticate(token);
        this.requestLog.push({ op: "update", userId });
        this.validate(row);
        if (row.user_id !== undefined && row.user_id !== userId) {
            throw new SyncError("server", "new row violates row-level security policy", { status: 403, code: "42501" });
        }
        const k = this.key(userId, row.id);
        const existing = this.rows.get(k);
        if (!existing || compareIso(existing.updated_at, baseUpdatedAt) !== 0) return null;
        const updated = {
            ...existing,
            collection: row.collection,
            data: clone(row.data),
            deleted_at: row.deleted_at || null,
            client_updated_at: this.clampClientTs(row.client_updated_at),
            device_id: row.device_id || null,
            updated_at: this.serverNowIso()
        };
        this.rows.set(k, updated);
        this.broadcast(updated);
        return clone(updated);
    }

    // ---------- Temps réel ----------

    subscribe(token, callback) {
        const userId = this.authenticate(token);
        const sub = { userId, callback };
        this.subscribers.add(sub);
        return () => this.subscribers.delete(sub);
    }

    broadcast(row) {
        for (const sub of [...this.subscribers]) {
            if (sub.userId === row.user_id) {
                try {
                    sub.callback(clone(row));
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }

    // ---------- Aides de test ----------

    rowsOf(userId) {
        return [...this.rows.values()].filter((r) => r.user_id === userId).map(clone);
    }
}

function compareIso(a, b) {
    // Compare des horodatages quel que soit leur format (« Z » ou « +00:00 », précision variable).
    return compareServerTs(a, b);
}
