/**
 * Accès protégé au stockage local (localStorage).
 *  - Toutes les clés de l'application sont préfixées « gdn:v2: » : l'origine
 *    tomh0999.github.io est partagée avec les autres projets GitHub Pages du compte.
 *  - Lectures JSON protégées (contenu corrompu → valeur par défaut + erreur signalée).
 *  - Écritures protégées (quota dépassé, navigation privée) → false + erreur signalée,
 *    les données restent en mémoire et partent au cloud.
 */
export const PREFIX = "gdn:v2:";

export function createMemoryStorage() {
    const map = new Map();
    return {
        get length() {
            return map.size;
        },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => {
            map.set(k, String(v));
        },
        removeItem: (k) => {
            map.delete(k);
        },
        clear: () => map.clear()
    };
}

export function safeLocalStorage() {
    try {
        const s = globalThis.localStorage;
        const probe = "__gdn_probe__";
        s.setItem(probe, "1");
        s.removeItem(probe);
        return s;
    } catch {
        return createMemoryStorage();
    }
}

export class LocalStore {
    constructor(storage = safeLocalStorage(), { prefix = PREFIX, onError = null } = {}) {
        this.storage = storage;
        this.prefix = prefix;
        this.onError = onError;
        this.lastError = null;
    }

    reportError(kind, key, error) {
        this.lastError = { kind, key, message: error && error.message ? error.message : String(error) };
        if (this.onError) {
            try {
                this.onError(this.lastError);
            } catch {
                /* ne jamais casser l'appelant */
            }
        }
    }

    getJSON(key, fallback = null) {
        let raw;
        try {
            raw = this.storage.getItem(this.prefix + key);
        } catch (e) {
            this.reportError("read", key, e);
            return fallback;
        }
        if (raw === null || raw === undefined) return fallback;
        try {
            return JSON.parse(raw);
        } catch (e) {
            this.reportError("corrupt", key, e);
            return fallback;
        }
    }

    setJSON(key, value) {
        try {
            this.storage.setItem(this.prefix + key, JSON.stringify(value));
            return true;
        } catch (e) {
            this.reportError(isQuotaError(e) ? "quota" : "write", key, e);
            return false;
        }
    }

    remove(key) {
        try {
            this.storage.removeItem(this.prefix + key);
        } catch (e) {
            this.reportError("write", key, e);
        }
    }

    /** Lecture brute d'une clé hors préfixe (ancienne clé historique). */
    getRaw(fullKey) {
        try {
            return this.storage.getItem(fullKey);
        } catch (e) {
            this.reportError("read", fullKey, e);
            return null;
        }
    }

    /** Clés (sans préfixe) commençant par `start`. */
    keysStartingWith(start) {
        const out = [];
        try {
            for (let i = 0; i < this.storage.length; i++) {
                const k = this.storage.key(i);
                if (k && k.startsWith(this.prefix + start)) out.push(k.slice(this.prefix.length));
            }
        } catch (e) {
            this.reportError("read", start, e);
        }
        return out;
    }
}

function isQuotaError(e) {
    return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
}
