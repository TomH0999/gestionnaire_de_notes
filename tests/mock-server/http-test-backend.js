/**
 * Adaptateur de synchronisation des tests E2E (chargé uniquement par le config.js de test) :
 * même interface que SupabaseBackend, parle au serveur de test (tests/mock-server/server.mjs)
 * en HTTP, temps réel par Server-Sent Events. La session est conservée dans le stockage local
 * comme le fait supabase-js (rechargement de page = toujours connecté).
 */
import { SyncError } from "../../js/data/sync-errors.js";

const SESSION_KEY = "gdn-test-session";

export class HttpTestBackend {
    constructor({ baseUrl }) {
        this.base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`, document.baseURI).href;
        this.edtUrl = new URL("__test/edt", document.baseURI).href;
        this.listeners = new Set();
        try {
            this.session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
        } catch {
            this.session = null;
        }
        this.source = null;
    }

    async request(path, body, { auth = true } = {}) {
        let res;
        try {
            res = await fetch(this.base + path, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(auth && this.session ? { Authorization: `Bearer ${this.session.token}` } : {}) },
                body: JSON.stringify(body || {})
            });
        } catch (e) {
            throw new SyncError("network", "Réseau indisponible.", { cause: e });
        }
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data;
        if (res.status === 401 || data.kind === "auth") throw new SyncError("auth", data.message || "Session expirée.", { status: res.status, code: data.code });
        throw new SyncError("server", data.message || `Erreur ${res.status}`, { status: res.status, code: data.code });
    }

    saveSession(s) {
        this.session = s;
        if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
        else localStorage.removeItem(SESSION_KEY);
    }

    async getSession() {
        return this.session ? { userId: this.session.userId, email: this.session.email } : null;
    }

    async signIn(email, password) {
        const s = await this.request("auth/signin", { email, password }, { auth: false });
        this.saveSession(s);
        return { userId: s.userId, email: s.email };
    }

    async signUp(email, password) {
        const s = await this.request("auth/signup", { email, password }, { auth: false });
        this.saveSession(s);
        return { userId: s.userId, email: s.email, needsConfirmation: false };
    }

    async signOut() {
        this.closeStream();
        try {
            await this.request("auth/signout", {});
        } catch {
            /* déconnexion locale quoi qu'il arrive */
        }
        this.saveSession(null);
        for (const l of this.listeners) l("signed-out", null);
    }

    async refreshSession() {
        if (!this.session) return null;
        try {
            await this.request("auth/check", {});
            return { userId: this.session.userId, email: this.session.email };
        } catch {
            return null;
        }
    }

    onAuthChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async serverTime() {
        return (await this.request("time", {})).time;
    }

    async pull({ since = null, limit = 500 } = {}) {
        return this.request("pull", { since, limit });
    }

    async insertMany(rows) {
        return this.request("insert", { rows });
    }

    async updateIf(row, base) {
        return this.request("update", { row, base });
    }

    async fetchOne(id) {
        return this.request("get", { id });
    }

    subscribe(onRow, onState) {
        this.closeStream();
        if (!this.session || typeof EventSource === "undefined") {
            onState("disconnected");
            return () => {};
        }
        onState("connecting");
        const source = new EventSource(`${this.base}stream?token=${encodeURIComponent(this.session.token)}`);
        source.onopen = () => onState("connected");
        source.onerror = () => onState("disconnected");
        source.onmessage = (event) => {
            try {
                onRow(JSON.parse(event.data));
            } catch {
                /* message illisible ignoré */
            }
        };
        this.source = source;
        return () => this.closeStream(source);
    }

    closeStream(source = this.source) {
        if (source) source.close();
        if (source === this.source) this.source = null;
    }

    async fetchTimetable({ url, from, to }) {
        if (!this.session) throw new SyncError("auth", "Connectez-vous pour actualiser l'emploi du temps.");
        let res;
        try {
            res = await fetch(this.edtUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.session.token}` }, body: JSON.stringify({ url, from, to }) });
        } catch (e) {
            throw new SyncError("network", "Réseau indisponible.", { cause: e });
        }
        const text = await res.text();
        if (res.ok) return text;
        let detail = {};
        try {
            detail = JSON.parse(text);
        } catch {
            detail = {};
        }
        if (res.status === 401) throw new SyncError("auth", detail.message || "Connexion requise.", { status: 401 });
        throw new SyncError("server", detail.message || `Erreur ${res.status}`, { status: res.status, code: detail.code });
    }
}
