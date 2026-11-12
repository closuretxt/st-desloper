// Splits a message into dialogue and narration, and protects the parts no rule may touch.
// PURE: no SillyTavern imports. join(split(text)) === text, always.
//
// Untouchable parts (code, HTML tags, <details> blocks, skipped tracker blocks, {{macros}}, links) are swapped for
// placeholders before any rule runs and swapped back at the end. Placeholders are private-use
// characters, so no rule's pattern can match inside them, and quote marks inside an HTML
// attribute can't be mistaken for dialogue.

const P_OPEN = "";
const P_CLOSE = "";
const P_BASE = 0xe100;
const P_MAX = 0xf7ff - P_BASE;
// Characters this module and core/marks.js use. Text that already has one is left alone.
const RESERVED = /[-]/;

// ---- skipped blocks: trackers and status lines no fix may touch -------------------------------
// Set from the settings (setSkip). A skipped block is protected whole, like <details>, and the
// stats leave it out, so a tracker's "Partly cloudy, 27°C" in every reply isn't a reused phrase.
//   tags:     tag names whose whole <tag>…</tag> block is skipped
//   allTags:  every tag block except the formatting tags below, which often wrap real prose
//   brackets: [Label: …] blocks ([Time: 12:24], [Status: …]), across lines too
// An unclosed tag or bracket isn't a block: its text stays normal prose (nothing is lost).

// Tags that wrap the story itself (colored dialogue, emphasis, paragraphs). "Every tag" must not
// skip these, or a reply styled with <font> or <p> would never be cleaned.
const FORMAT_TAGS = [
    "a", "abbr", "b", "big", "blockquote", "br", "center", "cite", "dd", "del", "dfn", "div", "dl",
    "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li",
    "mark", "ol", "p", "q", "s", "samp", "small", "span", "strike", "strong", "sub", "sup", "table",
    "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "var", "wbr",
    // already protected whole by PROTECT_RE's own block list
    "details", "style", "script", "pre", "code", "textarea", "svg",
];

const TAG_NAME = /^[A-Za-z][\w:.-]*$/;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "time, <status>, /stats" -> ["time", "status", "stats"]; anything that isn't a tag name dropped.
export function tagNamesOf(input) {
    const list = Array.isArray(input) ? input : String(input ?? "").split(/[\s,;]+/);
    const out = [];
    for (const raw of list) {
        const n = String(raw ?? "").replace(/[<>/]/g, "").trim().toLowerCase();
        if (n && TAG_NAME.test(n) && !out.includes(n)) out.push(n);
    }
    return out;
}

// The skip patterns for one config, as regex sources (empty array: nothing skipped).
function skipSources(cfg) {
    const out = [];
    // The name ends here ("time" must not match <timeline>); a self-closing <time/> opens nothing.
    const open = "(?=[\\s>/])[^>]*(?<!\\/)>";
    const body = "[\\s\\S]*?<\\/\\k<sk>\\s*>";
    if (cfg?.allTags) {
        const fmt = FORMAT_TAGS.map(escRe).join("|");
        out.push(`<(?!(?:${fmt})(?![\\w:.-]))(?<sk>[A-Za-z][\\w:.-]*)${open}${body}`);
    } else {
        const names = tagNamesOf(cfg?.tags);
        if (names.length) out.push(`<(?<sk>${names.map(escRe).join("|")})${open}${body}`);
    }
    // A short label, a colon, then anything but another bracket (capped, so a stray "[" can't
    // swallow a whole reply).
    if (cfg?.brackets) out.push("\\[[A-Za-z][\\w .'’-]{0,40}:[^\\[\\]]{0,2000}\\]");
    return out;
}

function buildProtect(skip) {
    return new RegExp(
        [
            "```[\\s\\S]*?(?:```|$)", // fenced code
            "<!--[\\s\\S]*?(?:-->|$)", // HTML comments
            "<(details|style|script|pre|code|textarea|svg)\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>", // whole blocks
            ...skip, // skipped blocks (trackers), before the single-tag pattern so the whole block goes
            "`[^`\\n]+`", // inline code
            "\\{\\{[\\s\\S]*?\\}\\}", // macros
            "<\\/?[A-Za-z][\\w:-]*(?:\\s[^<>]*)?\\/?>", // any other tag (its content stays normal text)
            "https?:\\/\\/[^\\s<>\"”]+", // links (their dots would split sentences)
        ].join("|"),
        "gi",
    );
}

let PROTECT_RE = buildProtect([]);
let SKIP_RE = null;
let skipKeyValue = "";

// Called when the settings load or change. Bad input just means nothing is skipped.
export function setSkip(cfg) {
    let skip = [];
    try {
        skip = skipSources(cfg);
        PROTECT_RE = buildProtect(skip);
        SKIP_RE = skip.length ? new RegExp(skip.join("|"), "gi") : null;
    } catch {
        skip = [];
        PROTECT_RE = buildProtect([]);
        SKIP_RE = null;
    }
    skipKeyValue = skip.join("\u0001");
}

// Changes whenever what's skipped changes: caches keyed on a reply's text add it to their key.
export function skipKey() {
    return skipKeyValue;
}

// The text with skipped blocks taken out (for the stats). Line breaks keep sentences apart.
export function stripSkipped(text) {
    const s = String(text ?? "");
    return SKIP_RE ? s.replace(SKIP_RE, "\n") : s;
}

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
