// "Show original" with the changes marked: a word-level diff between what the model wrote and
// what Deslopper shows, as the original text with markers around removed and added bits.
//
// The markers are private-use characters, not HTML: ST runs display text through regex scripts,
// markdown, quote colouring, "encode tags" and a sanitizer, and plain characters pass all of them
// untouched, where tags could be escaped, stripped or split by the markdown. st/display.js turns
// them into spans after ST has rendered the message.
//
// Pure: imports nothing from SillyTavern, so it's tested directly.

export const DEL_START = "";
export const DEL_END = "";
export const INS_START = "";
export const INS_END = "";
export const MARKERS = /[-]/;

// Words (with apostrophes), whitespace runs, and single other characters. `*` and quote marks
// are their own tokens, so unchanged markdown and quotes stay outside the markers.
const TOKEN = /\s+|[\p{L}\p{N}_'’]+|[^]/gu;
const INVISIBLE = /[​⁠﻿]/g;

function tokenize(text) {
    return text.match(TOKEN) || [];
}

// Myers' diff (O((N+M)·D), D = number of edits): Deslopper changes a few spots in a long reply,
// so this stays quick where a full table would not. Returns [op, token] pairs in order
// ("=" same, "-" removed, "+" added), or null past `maxEdits` (a near-total rewrite isn't worth marking).
export function diffTokens(a, b, maxEdits = 1500) {
    // Common start and end cost nothing and shrink the search a lot.
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }
    const x0 = a.slice(start, endA);
    const y0 = b.slice(start, endB);
    const n = x0.length;
    const m = y0.length;
    const max = n + m;
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    let found = -1;
    for (let d = 0; d <= Math.min(max, maxEdits); d++) {
        trace.push(v.slice(off - d - 1, off + d + 2)); // k in [-d-1, d+1], index k + d + 1
        for (let k = -d; k <= d; k += 2) {
            let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && x0[x] === y0[y]) {
                x++;
                y++;
            }
            v[off + k] = x;
            if (x >= n && y >= m) {
                found = d;
                break;
            }
        }
        if (found >= 0) break;
    }
    if (found < 0) return null;

    const middle = [];
    let x = n;
    let y = m;
    for (let d = found; d > 0; d--) {
        const t = trace[d];
        const at = k => t[k + d + 1];
        const k = x - y;
        const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
        const prevX = at(prevK);
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) middle.push(["=", x0[--x], y--]);
        if (prevK === k + 1) middle.push(["+", y0[prevY]]);
        else middle.push(["-", x0[prevX]]);
        x = prevX;
        y = prevY;
    }
    while (x > 0) middle.push(["=", x0[--x], y--]);
    middle.reverse();

    const out = [];
    for (let i = 0; i < start; i++) out.push(["=", a[i]]);
    for (const [op, tok] of middle) out.push([op, tok]);
    for (let i = endA; i < a.length; i++) out.push(["=", a[i]]);
    return out;
}

// One run of changes: original layout kept, removed core struck, added core after it.
// Whitespace at the edges stays outside the markers so paragraph breaks and list/heading
// starts read the same as in the original.
function hunk(del, ins) {
    // Added line breaks would reflow the original; an added bit reads fine on one line.
    const insText = ins.replace(/\s*\n\s*/g, " ");
    const base = del || insText;
    const lead = base.match(/^\s*/)[0];
    const trail = base.slice(lead.length).match(/\s*$/)[0];
    // Invisible characters (zero-width space, word joiner, BOM) count as nothing: a removed one
    // would otherwise show as an empty red box beside the next word.
    const seen = s => (s.replace(INVISIBLE, "").trim() ? s.trim() : "");
    const d = seen(del);
    const i = seen(insText);
    return lead + (d ? DEL_START + d + DEL_END : "") + (i ? INS_START + i + INS_END : "") + trail;
}

// The original text with markers, or null when there's nothing to mark (or too much).
export function markChanges(original, cleaned) {
    const a = String(original ?? "");
    const b = String(cleaned ?? "");
    if (a === b || MARKERS.test(a) || MARKERS.test(b)) return null;
    const ops = diffTokens(tokenize(a), tokenize(b));
    if (!ops) return null;
    let out = "";
    let del = "";
    let ins = "";
    let open = false;
    for (let i = 0; i < ops.length; i++) {
        const [op, tok] = ops[i];
        if (op === "-") {
            del += tok;
            open = true;
        } else if (op === "+") {
            ins += tok;
            open = true;
        } else if (open && /^[^\S\n]+$/.test(tok) && ops[i + 1] && ops[i + 1][0] !== "=") {
            // A lone space between two changes joins them: "~~a b~~ x y" reads better than
            // "~~a~~ x ~~b~~ y".
            del += tok;
            ins += tok;
        } else {
            if (open) out += hunk(del, ins);
            del = ins = "";
            open = false;
            out += tok;
        }
    }
    if (open) out += hunk(del, ins);
    return out;
}
