// Small text fixes (docs/PLAN.md section 7, item 22). PURE: no SillyTavern imports.
//
// Mechanical clean-ups that every model gets wrong now and then, each its own switch:
//   apostrophes   don’t -> don't
//   quotes        “Hi.” -> "Hi."   and doubled ""Hi."" -> "Hi."
//   spaces        double spaces, a space before , . ! ?, "end.Next" / "a,b", spaces at line
//                 ends, 3+ empty lines, zero-width characters, a no-break space between words
//   italics       an *italic left open runs to the end of its line: it gets closed; a stray
//                 closing * with no opener goes
//   slips         "from the his" -> "from his", "the the" -> "the", "…," -> "…"
//   mojibake      don‚Äôt / Ã© (text decoded twice): put back
//   ellipses      one style: leave / ... / …   (off by default: "leave")
//   punctuation   "What?!?!" -> "What?!", "No!!!" -> "No!"   (off by default: some like it loud)
// Scope "message": runs on the whole message before it's split into dialogue and narration, so
// quotes are already straight when the split happens. Code, tags and links are hidden from it
// (core/segments.js protect). These aren't slop, so the stats don't add them to the slop score.

const ZERO_WIDTH = /[​⁠﻿]/g; // never ZWJ (U+200D): emoji are built with it

// cp1252 bytes 0x80-0x9F -> the character Windows shows for them. Reversed, it turns
// "don‚Äôt"-style mojibake back into the bytes it came from.
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";
const TO_BYTE = new Map([...CP1252].map((c, i) => [c, 0x80 + i]));
const CONT = `\\u0080-\\u00BF${[...CP1252].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")}`;
// A lead byte (Â-ô) followed by 1-3 continuation bytes, as text.
const MOJIBAKE_RE = new RegExp(`[\\u00C2-\\u00F4][${CONT}]{1,3}`, "g");
const decoder = typeof TextDecoder === "function" ? new TextDecoder("utf-8", { fatal: true }) : null;

function unMojibake(s) {
    if (!decoder) return s;
    return s.replace(MOJIBAKE_RE, m => {
        const bytes = [...m].map(c => {
            const code = c.charCodeAt(0);
            return code <= 0xff ? code : TO_BYTE.get(c);
        });
        if (bytes.some(b => b === undefined)) return m;
        try {
            const out = decoder.decode(new Uint8Array(bytes));
            // Exactly one character back, and one a model writes (Latin letters, punctuation,
            // arrows, symbols, emoji): "Café——" decodes to a CJK character, which is a no.
            if ([...out].length !== 1) return m;
            const cp = out.codePointAt(0);
            const plausible = (cp >= 0xa0 && cp <= 0x24f) || (cp >= 0x2000 && cp <= 0x22ff) || (cp >= 0x2500 && cp <= 0x27bf) || cp >= 0x1f000;
            return plausible ? out : m;
        } catch {
            return m; // not valid UTF-8: real text (Portuguese "ão" never gets here anyway)
        }
    });
}

function apostrophes(s) {
    return s.replace(/[’‘‛ʼ]/g, "'").replace(/(?<=\p{L})[´`](?=\p{L})/gu, "'");
}

function quotes(s) {
    return s
        .replace(/[“”„‟〝〞＂]/g, '"')
        .replace(/(^|[\s(*])""(?=[\p{L}\p{N}*])/gmu, '$1"')
        .replace(/(?<=[\p{L}\p{N}.,!?…~*])""(?=[\s.,!?)*]|$)/gmu, '"');
}

function spaces(s) {
    return (
        s
            .replace(ZERO_WIDTH, "")
            .replace(/(?<=\S)[   ](?=\S)/g, " ")
            .replace(/[ \t]+$/gm, "")
            .replace(/\n(?:[ \t]*\n){2,}/g, "\n\n")
            .replace(/^\s*\n/, "")
            .replace(/\s+$/, "")
            // Two or more spaces between words (indentation at a line start stays).
            .replace(/(?<=\S) {2,}(?=\S)/g, " ")
            // No space before , ; : ! ? or a single period (a spaced "..." is a style: kept).
            .replace(/(?<=[\p{L}\p{N}"”’)*_~])[ \t]+(?=[,;:!?](?:[\s"”’)*_]|$))/gmu, "")
            .replace(/(?<=[\p{L}\p{N}"”’)*_~])[ \t]+(?=\.(?!\.)(?:[\s"”’)*_]|$))/gmu, "")
            // "end.Next" / "end?Next": a missing space after a sentence (two lowercase letters
            // before it, so "U.S." and "e.g." aren't touched).
            .replace(/(?<=\p{Ll}{2})([.!?])(?=\p{Lu}\p{Ll})/gu, "$1 ")
            // "word,word": a missing space after a comma between letters (numbers like 1,000 stay).
            .replace(/(?<=\p{L}{2}),(?=\p{L}{2})/gu, ", ")
    );
}

// Lone asterisks in a paragraph (not part of ** and not a "* " bullet at a line start).
function loneStars(p) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
        if (p[i] !== "*" || p[i - 1] === "*" || p[i + 1] === "*") continue;
        if (/(?:^|\n)[ \t]*$/.test(p.slice(0, i)) && /^[ \t]/.test(p.slice(i + 1))) continue; // bullet
        out.push(i);
    }
    return out;
}
const opensAt = (p, i) => /(?:^|[\s(“"])$/.test(p.slice(0, i)) && /^\S/.test(p.slice(i + 1));
const closesAt = (p, i) => /\S$/.test(p.slice(0, i)) && /^(?:$|[\s.,!?;:…~"”’)\]])/.test(p.slice(i + 1));

// Where an italic opened at `i` should close: before a quote that starts on the same line, or
// at the line's end.
function closeItalic(p, i) {
    const lineEnd = p.indexOf("\n", i) === -1 ? p.length : p.indexOf("\n", i);
    const line = p.slice(i + 1, lineEnd);
    const q = line.search(/[ \t]+["“]/);
    let at = q === -1 ? lineEnd : i + 1 + q;
    while (at > i + 1 && /[ \t]/.test(p[at - 1])) at--;
    if (at <= i + 1) return p;
    return `${p.slice(0, at)}*${p.slice(at)}`;
}

function italics(s) {
    return s
        .split(/(\n[ \t]*\n)/)
        .map((p, k) => {
            if (k % 2) return p; // the paragraph break itself
            const stars = loneStars(p);
            if (stars.length % 2 === 0) return p;
            const first = stars[0];
            const last = stars[stars.length - 1];
            // A stray closer with nothing open before it: it goes.
            if (closesAt(p, first) && !opensAt(p, first)) return p.slice(0, first) + p.slice(first + 1);
            // The last italic never closed: close it.
            if (opensAt(p, last) && !closesAt(p, last)) return closeItalic(p, last);
            return p; // can't tell which one is missing
        })
        .join("");
}

// "....", "…." and ". . ." count as one ellipsis too.
function ellipses(style) {
    const want = style === "…" ? "…" : "...";
    return s => s.replace(/\.{3,}|…\.?|\. \. \./g, want);
}

// A run keeps one of each mark, in the order it started with: "?!?!" -> "?!", "!!!" -> "!".
function punctuation(s) {
    return s.replace(/[?!]{2,}/g, m => (m.includes("?") && m.includes("!") ? (m.indexOf("?") < m.indexOf("!") ? "?!" : "!?") : m[0]));
}

// Typing slips: "a hand's width from the his" -> "from his" (an article left in front of a
// possessive), "the the" -> "the", "that's…, that's" -> "that's… that's". Pronoun doubles
// ("gave her her keys") are real English and stay.
function slips(s) {
    return s
        // Keep the capital when the article started a sentence: "The his" -> "His".
        .replace(/\b(?:the|a|an) ((?:his|her|my|your|their|our|its)\b)/gi, (all, pos) => (/^[A-Z]/.test(all) ? pos.charAt(0).toUpperCase() + pos.slice(1) : pos))
        // Not "is is" / "had had" / "that that": "What it is is…" is real English.
        .replace(/\b(the|a|an|to|of|and|on|at)\s+\1\b/gi, "$1")
        .replace(/(…|\.\.\.),(?=\s)/g, "$1");
}

// A few characters either side of the first change, for the tester and the stats.
function snippet(a, b) {
    let p = 0;
    while (p < a.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const from = Math.max(0, p - 24);
    const show = (t, end) => (from > 0 ? "…" : "") + t.slice(from, end + 24).replace(/\n/g, "⏎") + (end + 24 < t.length ? "…" : "");
    return { before: show(a, a.length - s), after: show(b, b.length - s) };
}

const PARTS = [
    { key: "mojibake", label: "mojibake", fn: () => unMojibake },
    { key: "apostrophes", label: "apostrophes", fn: () => apostrophes },
    { key: "quotes", label: "quotes", fn: () => quotes },
    { key: "spaces", label: "spaces", fn: () => spaces },
    { key: "italics", label: "italics", fn: () => italics },
    { key: "slips", label: "typing slips", fn: () => slips },
    { key: "ellipsis", label: "ellipses", fn: s => (s.ellipsis === "..." || s.ellipsis === "…" ? ellipses(s.ellipsis) : null) },
    { key: "punctuation", label: "punctuation", fn: () => punctuation },
];

export default {
    id: "text-fixes",
    name: "Small text fixes",
    description: "Curly quotes and apostrophes made straight, extra spaces gone, an *italic left open closed, mojibake (donâ€™t) put back: “Hi.”  She  smiles . → \"Hi.\" She smiles.",
    scope: "message",
    order: 5,
    defaults: { enabled: true, apostrophes: true, quotes: true, spaces: true, italics: true, slips: true, mojibake: true, ellipsis: "leave", punctuation: false },
    options: [
        { key: "apostrophes", type: "checkbox", label: "Curly apostrophes → ' (don’t → don't)" },
        { key: "quotes", type: "checkbox", label: "Curly double quotes → \" (and doubled \"\" → \")" },
        { key: "spaces", type: "checkbox", label: "Extra spaces, space before punctuation, missing space after it, extra empty lines" },
        { key: "italics", type: "checkbox", label: "Close an *italic left open; drop a stray *" },
        { key: "slips", type: "checkbox", label: "Typing slips: from the his → from his, the the → the, that's…, → that's…" },
        { key: "mojibake", type: "checkbox", label: "Fix mojibake (donâ€™t → don’t, Ã© → é)" },
        { key: "punctuation", type: "checkbox", label: "Shorten runs: !!! → !, ?!?! → ?!" },
        { key: "ellipsis", type: "select", label: "Ellipsis style", choices: ["leave", "...", "…"] },
    ],

    apply(text, ctx) {
        const s = ctx.settings || {};
        let out = text;
        const hits = [];
        for (const part of PARTS) {
            if (part.key !== "ellipsis" && s[part.key] === false) continue;
            const fn = part.fn(s);
            if (!fn) continue;
            const next = fn(out);
            if (next === out) continue;
            hits.push({ kind: part.key, label: part.label, ...snippet(out, next) });
            out = next;
        }
        return hits.length ? { text: out, hits } : text;
    },
};
