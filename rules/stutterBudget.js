// Stutter budget (docs/PLAN.md section 7, item 12). PURE: no SillyTavern imports.
//
// The user likes a stammer now and then, but once the history is full of them the model doubles
// down. So the first N stammers in a window of replies stay (default 3 per 10 replies; the window
// is one setting for every budget, core/speech.js windowLeft) and the rest become the plain word:
//   "I-I don't know. W-what do you mean?"  -> "I-I don't know. What do you mean?"  (1 left)
//   "Wh-why", "I-I-I", "B-but", "I— I"     -> "Why", "I", "But", "I"
// A stammer only counts when the letters before the hyphen start the next word, so "T-shirt",
// "X-ray", "uh-huh" and "A-list" are never touched, nor doubled words ("no-no", "ha-ha") or
// lowercase prefixes ("re-read", "co-op"). Speech only. Off by default.

import { MARK } from "../core/marks.js";
import { earlier, budgetOf, windowLeft, countIn } from "../core/speech.js";

// Hyphen form ("W-what", "I-I-I") and dash form ("I—I", "I— I"; a single letter, or the whole
// word again: "No—no").
const HYPHEN = /(?<![\p{L}\p{N}'’-])(\p{L}{1,3})(?:-\1)*-(?=\1)/giu;
const DASH = /(?<![\p{L}\p{N}'’-])(\p{L}{1,3})(?:[—–]\s?\1)*[—–]\s?(?=\1)/giu;
const PREFIXES = new Set(["re", "de", "co", "pre", "pro", "un", "non", "sub", "ex", "bi", "tri", "mid", "mis", "dis", "in", "im", "out", "up", "over", "anti", "semi", "self"]);

// Every stammer in a text: [{ start, end, prefix }] in order.
export function stammers(text) {
    const out = [];
    for (const re of [HYPHEN, DASH]) {
        re.lastIndex = 0;
        for (const m of String(text).matchAll(re)) {
            const prefix = m[1];
            const next = (String(text).slice(m.index + m[0].length).match(/^\p{L}+/u) || [""])[0];
            if (!next) continue;
            const whole = next.toLowerCase() === prefix.toLowerCase();
            // "no-no", "ha-ha", "so-so": a doubled word, not a stammer (a single letter is: "I-I").
            if (re === HYPHEN && whole && prefix.length >= 2) continue;
            // "re-read": a word prefix. A stammer at a sentence start is capitalized ("Re-really?").
            if (prefix.length >= 2 && /^\p{Ll}/u.test(prefix) && PREFIXES.has(prefix.toLowerCase())) continue;
            // The dash form only for a single letter or the whole word again ("I—I", "No—no").
            if (re === DASH && prefix.length > 1 && !whole) continue;
            out.push({ start: m.index, end: m.index + m[0].length, prefix, next });
        }
    }
    return out.sort((a, b) => a.start - b.start).filter((s, i, all) => !i || s.start >= all[i - 1].end);
}

export default {
    id: "stutter-budget",
    name: "Stutter budget",
    description: 'Past the budget, stammers become the plain word: "I-I don\'t know. W-what do you mean?" → "I-I don\'t know. What do you mean?"',
    scope: "dialogue",
    order: 250,
    defaults: { enabled: false, budget: 3 },
    options: [{ key: "budget", type: "number", label: "Stammers kept per budget window (0 = none)", min: 0, max: 50 }],

    apply(text, ctx) {
        const found = stammers(text);
        if (!found.length) return text;
        let seen = earlier(ctx, t => stammers(t), s => s.type === "dialogue", "stammers").length;
        const max = windowLeft(ctx, "stutter-budget", budgetOf(ctx.settings?.budget, 3), raw => countIn(raw, "dialogue", stammers));
        const cut = [];
        for (const s of found) if (seen++ >= max) cut.push(s);
        if (!cut.length) return text;
        let out = text;
        const hits = [];
        for (const s of cut.reverse()) {
            // "W-what" -> "What": the word takes the stammer's capital.
            const rest = out.slice(s.end);
            const fixed = /^\p{Lu}/u.test(s.prefix) ? rest.replace(/^\p{Ll}/u, c => c.toUpperCase()) : rest;
            out = out.slice(0, s.start) + MARK + fixed;
            const word = fixed.match(/^\p{L}+/u)?.[0] ?? "";
            hits.unshift({ kind: "stutter", label: "stammer", before: text.slice(s.start, s.end) + s.next, after: word });
        }
        return { text: out, hits };
    },
};
