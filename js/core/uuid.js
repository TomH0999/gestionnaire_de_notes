/**
 * Identifiants UUID générés côté client.
 *  - uuidv4() : aléatoire (nouvelles entrées).
 *  - uuidv5(nom, espace) : déterministe (même nom → même UUID sur tous les appareils),
 *    utilisé pour la migration sans doublon et pour les réglages (un id par clé).
 */

/** Espace de noms propre à l'application (fixe, ne jamais changer). */
export const APP_NAMESPACE = "3f0c6a52-8d1e-4b7a-9c35-6e21d4b8a917";

export function uuidv4() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === "function") {
        c.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytesToUuid(bytes);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
    return typeof value === "string" && UUID_RE.test(value);
}

export function uuidv5(name, namespace = APP_NAMESPACE) {
    const nsBytes = uuidToBytes(namespace);
    const nameBytes = new TextEncoder().encode(String(name));
    const input = new Uint8Array(nsBytes.length + nameBytes.length);
    input.set(nsBytes, 0);
    input.set(nameBytes, nsBytes.length);
    const hash = sha1(input);
    const bytes = hash.slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytesToUuid(bytes);
}

function uuidToBytes(uuid) {
    const hex = uuid.replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("UUID d'espace de noms invalide");
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

function bytesToUuid(bytes) {
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** SHA-1 synchrone (RFC 3174), suffisant pour UUID v5 (pas d'usage cryptographique). */
export function sha1(bytes) {
    const ml = bytes.length * 8;
    const withPadding = ((bytes.length + 9 + 63) >> 6) << 6;
    const msg = new Uint8Array(withPadding);
    msg.set(bytes);
    msg[bytes.length] = 0x80;
    const view = new DataView(msg.buffer);
    view.setUint32(withPadding - 8, Math.floor(ml / 0x100000000));
    view.setUint32(withPadding - 4, ml >>> 0);

    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80);
    for (let offset = 0; offset < withPadding; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 80; i++) {
            const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
            w[i] = (x << 1) | (x >>> 31);
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4;
        for (let i = 0; i < 80; i++) {
            let f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
            else { f = b ^ c ^ d; k = 0xca62c1d6; }
            const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
            e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = new Uint8Array(20);
    const ov = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
    return out;
}
