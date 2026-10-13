import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { parseDecimal, formatInputNumber, formatNumber } from "../../js/core/numbers.js";
import { escapeHtml, html, raw, setHtml, SafeHtml } from "../../js/core/escape.js";
import { uuidv4, uuidv5, sha1, isUuid, APP_NAMESPACE } from "../../js/core/uuid.js";

describe("parseDecimal — saisie française", () => {
    it.each([
        ["12,5", 12.5],
        ["12.5", 12.5],
        [" 12 ", 12],
        ["0", 0],
        ["20", 20],
        ["0,25", 0.25],
        [",5", 0.5],
        ["12,", 12],
        ["+3", 3],
        ["-3", -3],
        ["\u00a012,5\u202f", 12.5],
        [7.75, 7.75]
    ])("%j → %j", (input, expected) => {
        expect(parseDecimal(input)).toBe(expected);
    });

    it.each([[""], ["   "], ["abc"], ["1 000,5"], ["12\u00a05"], ["1 5"], ["12,5,3"], ["1.000,5"], ["1e3"], ["12a"], ["--1"], [","], [null], [undefined], [{}], [NaN], [Infinity]])(
        "%j est refusé (NaN)",
        (input) => {
            expect(parseDecimal(input)).toBeNaN();
        }
    );

    it("0,1 + 0,2 reste le calcul flottant standard (aucun arrondi caché)", () => {
        expect(parseDecimal("0,1") + parseDecimal("0,2")).toBe(0.1 + 0.2);
    });

    it("formatage des champs et des nombres", () => {
        expect(formatInputNumber(12.5)).toBe("12,5");
        expect(formatInputNumber(20)).toBe("20");
        expect(formatInputNumber(NaN)).toBe("");
        expect(formatNumber(14.255)).toBe((14.255).toFixed(2));
        expect(formatNumber(null)).toBe("--");
    });
});

describe("escapeHtml et gabarit html``", () => {
    it("échappe les 5 caractères sensibles", () => {
        expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe("&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt;&amp;");
    });
    it("accepte null, undefined, nombres et objets", () => {
        expect(escapeHtml(null)).toBe("");
        expect(escapeHtml(undefined)).toBe("");
        expect(escapeHtml(12.5)).toBe("12.5");
        expect(escapeHtml(0)).toBe("0");
        expect(escapeHtml({ toString: () => "<b>" })).toBe("&lt;b&gt;");
    });
    it("le gabarit échappe chaque valeur, y compris dans les tableaux", () => {
        const evil = "<script>alert(1)</script>";
        const out = html`<p title="${evil}">${evil}${[evil, html`<i>${evil}</i>`]}</p>`;
        expect(out).toBeInstanceOf(SafeHtml);
        expect(out.value).not.toContain("<script>");
        expect(out.value).toContain("<i>&lt;script&gt;");
        expect(out.value.match(/&lt;script&gt;/g)).toHaveLength(4);
    });
    it("raw() laisse passer le HTML de confiance ; false/null/undefined sont vides", () => {
        expect(html`${raw("<b>ok</b>")}${false}${null}${undefined}`.value).toBe("<b>ok</b>");
    });
    it("setHtml refuse une chaîne brute", () => {
        const el = { innerHTML: "" };
        expect(() => setHtml(el, "<b>brut</b>")).toThrow(TypeError);
        setHtml(el, html`<b>${"x"}</b>`);
        expect(el.innerHTML).toBe("<b>x</b>");
    });
});

describe("UUID", () => {
    it("v4 : format valide et unicité", () => {
        const set = new Set();
        for (let i = 0; i < 2000; i++) set.add(uuidv4());
        expect(set.size).toBe(2000);
        for (const id of set) expect(isUuid(id)).toBe(true);
    });

    it("SHA-1 : vecteurs de référence", () => {
        const hex = (s) => Buffer.from(sha1(new TextEncoder().encode(s))).toString("hex");
        expect(hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
        expect(hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
        const long = "é".repeat(200) + "x".repeat(77);
        expect(hex(long)).toBe(createHash("sha1").update(long, "utf8").digest("hex"));
    });

    it("v5 : identique à l'implémentation de référence (Node crypto) et déterministe", () => {
        const reference = (name, ns) => {
            const nsBytes = Buffer.from(ns.replace(/-/g, ""), "hex");
            const h = createHash("sha1").update(Buffer.concat([nsBytes, Buffer.from(name, "utf8")])).digest();
            h[6] = (h[6] & 0x0f) | 0x50;
            h[8] = (h[8] & 0x3f) | 0x80;
            const x = h.subarray(0, 16).toString("hex");
            return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
        };
        // Vecteur connu : uuid5(NAMESPACE_DNS, "python.org")
        expect(uuidv5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
        for (const name of ["grade|R1.01|ds1|15|20|1|#0", "setting:edtZoom", "é€😀"]) {
            expect(uuidv5(name)).toBe(reference(name, APP_NAMESPACE));
            expect(uuidv5(name)).toBe(uuidv5(name));
        }
        expect(uuidv5("a")).not.toBe(uuidv5("b"));
    });
});
