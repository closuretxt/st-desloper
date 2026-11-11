// Splits a message into dialogue and narration, and protects the parts no rule may touch.
// PURE: no SillyTavern imports. join(split(text)) === text, always.
//
// Untouchable parts (code, HTML tags, <details> blocks, {{macros}}, links) are swapped for
// placeholders before any rule runs and swapped back at the end. Placeholders are private-use
// characters, so no rule's pattern can match inside them, and quote marks inside an HTML
// attribute can't be mistaken for dialogue.

const P_OPEN = "";
const P_CLOSE = "";
const P_BASE = 0xe100;
const P_MAX = 0xf7ff - P_BASE;
// Characters this module and core/marks.js use. Text that already has one is left alone.
const RESERVED = /[-]/;

const PROTECT_RE = new RegExp(
    [
        "```[\\s\\S]*?(?:```|$)", // fenced code
        "<!--[\\s\\S]*?(?:-->|$)", // HTML comments
        "<(details|style|script|pre|code|textarea|svg)\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>", // whole blocks
        "`[^`\\n]+`", // inline code
        "\\{\\{[\\s\\S]*?\\}\\}", // macros
        "<\\/?[A-Za-z][\\w:-]*(?:\\s[^<>]*)?\\/?>", // any other tag (its content stays normal text)
        "https?:\\/\\/[^\\s<>\"”]+", // links (their dots would split sentences)
    ].join("|"),
    "gi",
);

const PLACEHOLDER_RE = /([-])/g;

// Returns { text, parts } or null when the text can't be handled safely (reserved characters,
// absurd number of protected parts). null means: leave the message as it is.
export function protect(text) {
    const s = String(text ?? "");
    if (RESERVED.test(s)) return null;
    const parts = [];
    let tooMany = false;
    const masked = s.replace(PROTECT_RE, m => {
        if (parts.length >= P_MAX) {
            tooMany = true;
            return m;
        }
        parts.push(m);
        return P_OPEN + String.fromCharCode(P_BASE + parts.length - 1) + P_CLOSE;
    });
    return tooMany ? null : { text: masked, parts };
}

export function unprotect(text, parts) {
    return String(text).replace(PLACEHOLDER_RE, (m, c) => parts[c.charCodeAt(0) - P_BASE] ?? m);
}

export function placeholdersOf(text) {
    return (String(text).match(PLACEHOLDER_RE) || []).sort();
}

// A rule must keep every placeholder exactly once, or the protected part would be lost or doubled.
export function placeholdersIntact(oldText, newText) {
    const a = placeholdersOf(oldText);
    const b = placeholdersOf(newText);
    return a.length === b.length && a.every((p, i) => p === b[i]);
}

// Opening quote -> the characters that can close it. Models mix “ with ", so “ accepts both.
const QUOTES = {
    '"': ['"'],
    "“": ["”", '"'],
    "「": ["」"],
    "『": ["』"],
};

// Segments: { type: 'dialogue' | 'narration', open, text, close }. For dialogue, `text` is the
// inside of the quotes; for narration open and close are ''.
// A quote never runs past the end of its line: an unclosed quote is dialogue up to the line end
// (safer than calling it narration, since narration rules rewrite more).
export function splitSegments(text) {
    const s = String(text ?? "");
    const segs = [];
    let i = 0;
    let narrStart = 0;
    while (i < s.length) {
        const closers = QUOTES[s[i]];
        if (!closers) {
            i++;
            continue;
        }
        let j = i + 1;
        while (j < s.length && s[j] !== "\n" && !closers.includes(s[j])) j++;
        if (narrStart < i) segs.push({ type: "narration", open: "", text: s.slice(narrStart, i), close: "" });
        const closed = j < s.length && closers.includes(s[j]);
        segs.push({ type: "dialogue", open: s[i], text: s.slice(i + 1, j), close: closed ? s[j] : "" });
        i = closed ? j + 1 : j;
        narrStart = i;
    }
    if (narrStart < s.length) segs.push({ type: "narration", open: "", text: s.slice(narrStart), close: "" });
    return segs;
}

export function joinSegments(segs) {
    return segs.map(s => s.open + s.text + s.close).join("");
}
