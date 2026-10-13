/**
 * Erreurs typées de la synchronisation. Le moteur réagit selon `kind` :
 *  - "network"  : pas de réseau / requête interrompue → hors-ligne, nouvel essai plus tard ;
 *  - "auth"     : session absente ou expirée → reconnexion demandée, file conservée ;
 *  - "server"   : erreur côté serveur (5xx, contrainte) → nouvel essai avec délai croissant ;
 *  - "conflict" : conflits répétés sur une entrée → nouvel essai plus tard ;
 *  - "config"   : synchronisation non configurée.
 */
export class SyncError extends Error {
    constructor(kind, message, { status = null, code = null, cause = null } = {}) {
        super(message);
        this.name = "SyncError";
        this.kind = kind;
        this.status = status;
        this.code = code;
        if (cause) this.cause = cause;
    }
}

export function isNetworkFailure(error) {
    if (!error) return false;
    if (error instanceof SyncError) return error.kind === "network";
    const msg = String(error.message || error);
    return error.name === "TypeError" || error.name === "AbortError" || /Failed to fetch|NetworkError|Load failed|network|fetch failed|ECONNREFUSED|ETIMEDOUT/i.test(msg);
}
