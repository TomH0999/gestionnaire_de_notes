/**
 * Adaptateur Supabase (production) : Auth (e-mail + mot de passe, session persistante),
 * PostgREST (table `items`), Realtime (postgres_changes filtrés par la RLS) et appel de la
 * fonction Edge `edt-proxy`. Seule la clé publique (anon / publishable) est utilisée.
 *
 * Le client supabase-js est fourni par l'appelant (bibliothèque servie localement :
 * assets/vendor/supabase/supabase.js, aucune dépendance CDN).
 */
import { SyncError, isNetworkFailure } from "../sync-errors.js";

const COLUMNS = "id,collection,data,deleted_at,client_updated_at,device_id,updated_at";
export const AUTH_STORAGE_KEY = "gdn-supabase-auth";

const AUTH_MESSAGES = [
    [/invalid login credentials|invalid_credentials/i, "Adresse e-mail ou mot de passe incorrect."],
    [/email not confirmed/i, "Adresse e-mail non confirmée : ouvrez le lien reçu par e-mail (ou confirmez l'utilisateur dans Supabase)."],
    [/signups? not allowed|signup.*disabled/i, "Les inscriptions sont désactivées sur ce projet (c'est voulu une fois votre compte créé)."],
    [/user already registered|already exists/i, "Un compte existe déjà avec cette adresse : utilisez « Se connecter »."],
    [/password should be at least|weak.?password/i, "Mot de passe trop faible (6 caractères minimum, 12 recommandés)."],
    [/rate limit|too many/i, "Trop de tentatives : réessayez dans quelques minutes."],
    [/unable to validate email|invalid email/i, "Adresse e-mail invalide."]
];

export function mapSupabaseError(error, status = null) {
    if (!error) return null;
    if (error instanceof SyncError) return error;
    const message = String(error.message || error.error_description || error);
    const code = error.code || null;
    const httpStatus = status ?? error.status ?? null;
    if (isNetworkFailure(error) || httpStatus === 0 || /failed to fetch|networkerror|load failed|fetch failed/i.test(message) || error.name === "AuthRetryableFetchError") {
        return new SyncError("network", "Réseau indisponible.", { status: httpStatus, code, cause: error });
    }
    if (httpStatus === 401 || (httpStatus === 403 && /jwt/i.test(message)) || code === "PGRST301" || code === "PGRST302" || /jwt (expired|malformed)|invalid jwt|not authenticated/i.test(message)) {
        return new SyncError("auth", "Session expirée ou invalide.", { status: httpStatus, code, cause: error });
    }
    for (const [re, fr] of AUTH_MESSAGES) {
        if (re.test(message) || re.test(code || "")) return new SyncError("auth", fr, { status: httpStatus, code, cause: error });
    }
    return new SyncError("server", `Erreur du serveur : ${message}`, { status: httpStatus, code, cause: error });
}

function toSession(session) {
    return session && session.user ? { userId: session.user.id, email: session.user.email || null } : null;
}

export class SupabaseBackend {
    /**
     * @param client  client supabase-js (createClient)
     * @param options { url, anonKey, storage, fetchImpl, functionName }
     */
    constructor(client, { url, anonKey, storage = globalThis.localStorage, fetchImpl = (...a) => globalThis.fetch(...a), functionName = "edt-proxy" } = {}) {
        this.client = client;
        this.url = url ? url.replace(/\/+$/, "") : "";
        this.anonKey = anonKey;
        this.storage = storage;
        this.fetchImpl = fetchImpl;
        this.functionName = functionName;
        this.userId = null;
    }

    // ---------- Authentification ----------

    /** Session courante ; hors-ligne avec un jeton expiré, on garde l'utilisateur mémorisé. */
    async getSession() {
        try {
            const { data, error } = await this.client.auth.getSession();
            if (!error && data && data.session) {
                const s = toSession(data.session);
                this.userId = s.userId;
                return s;
            }
            if (error && mapSupabaseError(error).kind !== "network") return null;
        } catch (e) {
            if (mapSupabaseError(e).kind !== "network") return null;
        }
        const stored = this.readStoredSession();
        if (stored) this.userId = stored.userId;
        return stored;
    }

    readStoredSession() {
        try {
            const raw = this.storage && this.storage.getItem(AUTH_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const user = parsed && (parsed.user || (parsed.currentSession && parsed.currentSession.user));
            return user && user.id ? { userId: user.id, email: user.email || null, offline: true } : null;
        } catch {
            return null;
        }
    }

    async signIn(email, password) {
        let result;
        try {
            result = await this.client.auth.signInWithPassword({ email: String(email).trim(), password });
        } catch (e) {
            throw mapSupabaseError(e);
        }
        if (result.error) throw mapSupabaseError(result.error, result.error.status);
        const s = toSession(result.data.session);
        if (!s) throw new SyncError("auth", "Connexion impossible.");
        this.userId = s.userId;
        return s;
    }

    async signUp(email, password) {
        let result;
        try {
            result = await this.client.auth.signUp({ email: String(email).trim(), password });
        } catch (e) {
            throw mapSupabaseError(e);
        }
        if (result.error) throw mapSupabaseError(result.error, result.error.status);
        const s = toSession(result.data.session);
        if (s) {
            this.userId = s.userId;
            return { ...s, needsConfirmation: false };
        }
        return { userId: result.data.user ? result.data.user.id : null, email, needsConfirmation: true };
    }

    async signOut() {
        this.closeRealtime();
        try {
            await this.client.auth.signOut({ scope: "local" });
        } catch {
            /* déconnexion locale quoi qu'il arrive */
        }
        this.userId = null;
    }

    async refreshSession() {
        try {
            const { data, error } = await this.client.auth.refreshSession();
            if (error || !data || !data.session) return null;
            return toSession(data.session);
        } catch {
            return null;
        }
    }

    onAuthChange(listener) {
        const { data } = this.client.auth.onAuthStateChange((event, session) => {
            const s = toSession(session);
            if (s) this.userId = s.userId;
            if (event === "SIGNED_OUT") listener("signed-out", null);
            else if (event === "TOKEN_REFRESHED") listener("token-refreshed", s);
            else if (event === "SIGNED_IN" && s) listener("signed-in", s);
        });
        return () => data.subscription.unsubscribe();
    }

    requireUser() {
        if (!this.userId) throw new SyncError("auth", "Connexion requise.", { status: 401 });
        return this.userId;
    }

    async run(promiseLike) {
        let res;
        try {
            res = await promiseLike;
        } catch (e) {
            throw mapSupabaseError(e);
        }
        if (res.error) throw mapSupabaseError(res.error, res.status);
        return res.data;
    }

    // ---------- Données ----------

    async serverTime() {
        this.requireUser();
        return this.run(this.client.rpc("server_time"));
    }

    async pull({ since = null, limit = 500 } = {}) {
        this.requireUser();
        let q = this.client.from("items").select(COLUMNS).order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
        if (since) q = q.gte("updated_at", since);
        return { rows: (await this.run(q)) || [] };
    }

    async insertMany(rows) {
        const userId = this.requireUser();
        const payload = rows.map((r) => ({ ...r, user_id: userId }));
        const data = await this.run(this.client.from("items").upsert(payload, { onConflict: "user_id,id", ignoreDuplicates: true }).select(COLUMNS));
        return { rows: data || [] };
    }

    async updateIf(row, baseUpdatedAt) {
        this.requireUser();
        const patch = { collection: row.collection, data: row.data, deleted_at: row.deleted_at, client_updated_at: row.client_updated_at, device_id: row.device_id };
        const data = await this.run(this.client.from("items").update(patch).eq("id", row.id).eq("updated_at", baseUpdatedAt).select(COLUMNS));
        return { row: data && data.length ? data[0] : null };
    }

    async fetchOne(id) {
        this.requireUser();
        const data = await this.run(this.client.from("items").select(COLUMNS).eq("id", id).maybeSingle());
        return { row: data || null };
    }

    subscribe(onRow, onState) {
        const userId = this.requireUser();
        this.closeRealtime();
        const channel = this.client
            .channel(`items:${userId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `user_id=eq.${userId}` }, (payload) => {
                if (payload && payload.new && payload.new.id) onRow(payload.new);
            })
            .subscribe((status) => {
                if (status === "SUBSCRIBED") onState("connected");
                else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") onState("disconnected");
                else onState("connecting");
            });
        this.channel = channel;
        return () => this.closeRealtime(channel);
    }

    closeRealtime(channel = this.channel) {
        if (channel) {
            try {
                this.client.removeChannel(channel);
            } catch {
                /* déjà fermé */
            }
        }
        if (channel === this.channel) this.channel = null;
    }

    // ---------- Emploi du temps (fonction Edge) ----------

    async fetchTimetable({ url, from, to }) {
        this.requireUser();
        let token;
        try {
            const { data } = await this.client.auth.getSession();
            token = data && data.session ? data.session.access_token : null;
        } catch (e) {
            throw mapSupabaseError(e);
        }
        if (!token) throw new SyncError("auth", "Connectez-vous pour actualiser l'emploi du temps.", { status: 401 });
        let response;
        try {
            response = await this.fetchImpl(`${this.url}/functions/v1/${this.functionName}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, apikey: this.anonKey, "Content-Type": "application/json" },
                body: JSON.stringify({ url, from, to })
            });
        } catch (e) {
            throw new SyncError("network", "Réseau indisponible.", { cause: e });
        }
        const text = await response.text();
        if (response.ok) return text;
        let detail;
        try {
            detail = JSON.parse(text);
        } catch {
            detail = null;
        }
        const message = detail && detail.message ? detail.message : `Erreur ${response.status}`;
        if (response.status === 401) throw new SyncError("auth", message, { status: 401 });
        if (response.status === 404) throw new SyncError("server", "La fonction edt-proxy n'est pas déployée sur Supabase (voir docs/CONFIGURATION.md).", { status: 404, code: "function-missing" });
        throw new SyncError("server", message, { status: response.status, code: detail && detail.code ? detail.code : null });
    }
}
