// Lone-line budget (docs/PLAN.md section 7, item 17). PURE: no SillyTavern imports.
//
// Some models love a one-line paragraph for drama:
//   The room goes still.\n\nNobody moves.\n\nThe fire pops.
// The first N in a window of replies stay (default 3 per 10 replies, core/speech.js windowLeft);
// each one after that joins the paragraph before it:
//   The room goes still. Nobody moves.\n\nThe fire pops.     (with the budget at 0)
// A lone adverb ("Slowly.") is the adverb-fragments rule's: it folds into the sentence before.
// Only narration, and only when both paragraphs are narration as a whole: a line of dialogue on
// its own paragraph is normal (one speaker per paragraph). Never touched: scene breaks (***),
// headings, lists, a whole-line italic (a thought), protected parts, a paragraph ending in ":".
// Off by default.

import { MARK } from "../core/marks.js";
import { sentencesAt, budgetOf, hasPlaceholder, windowLeft, countIn } from "../core/speech.js";

const SEP = /\n[ \t]*\n[ \t\n]*/g;
const MAX_WORDS = 15;

const words = s => (s.match(/[\p{L}\p{N}'’]+/gu) || []).length;
// A paragraph a merge may not touch.
function special(p) {
    const t = p.trim();
    if (!/\p{L}/u.test(t)) return true; // *** or ---
    if (/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(t)) return true; // heading, list, quote block
    if (/^([*_]{1,3})[^*_]+\1$/.test(t)) return true; // a whole-line italic: a thought
    if (/:\s*$/.test(t)) return true;
    return hasPlaceholder(t);
}

// The lone paragraphs of one narration segment: [{ sepStart, sepEnd, line }].
// first: this segment starts the reply (its first paragraph is whole narration).
// last: this segment ends the reply (its last paragraph ends there).
export function loneLines(text, { first = false, last = false } = {}) {
    const chunks = [];
    let pos = 0;
    SEP.lastIndex = 0;
    for (const m of String(text).matchAll(SEP)) {
        chunks.push({ start: pos, end: m.index, sepStart: m.index, sepEnd: m.index + m[0].length });
        pos = m.index + m[0].length;
    }
    chunks.push({ start: pos, end: text.length, sepStart: null, sepEnd: null });
    const out = [];
    for (let k = 1; k < chunks.length; k++) {
        const c = chunks[k];
        const prev = chunks[k - 1];
        const line = text.slice(c.start, c.end);
        const before = text.slice(prev.start, prev.end);
        if (!line.trim() || !before.trim()) continue;
        // The paragraph must end inside this segment (else a quote carries on from it).
        if (k === chunks.length - 1 && !last) continue;
        // The previous paragraph must be all narration: it started in this segment.
        if (k - 1 === 0 && !first) continue;
        if (special(line) || special(before)) continue;
        if (sentencesAt(line).length !== 1 || words(line) > MAX_WORDS) continue;
        out.push({ sepStart: prev.sepStart, sepEnd: prev.sepEnd, line: line.trim() });
    }
    return out;
}

function flagsFor(segments, i) {
    return { first: i === 0, last: i === segments.length - 1 };
}

export default {
    id: "lone-lines",
    name: "Lone-line budget",
    description: "Past the budget, a one-line narration paragraph joins the paragraph before it: The room goes still.⏎⏎Nobody moves. → The room goes still. Nobody moves.",
    scope: "narration",
    order: 320,
    defaults: { enabled: false, budget: 3 },
    options: [{ key: "budget", type: "number", label: "One-line paragraphs kept per budget window (0 = none)", min: 0, max: 50 }],

    apply(text, ctx) {
        const seg = ctx.segment;
        if (!seg || !Array.isArray(seg.segments)) return text;
        const found = loneLines(text, flagsFor(seg.segments, seg.index));
        if (!found.length) return text;
        let seen = 0;
        for (let i = 0; i < seg.index; i++) {
            const x = seg.segments[i];
            if (x.type === "narration") seen += loneLines(String(x.text ?? ""), flagsFor(seg.segments, i)).length;
        }
        const max = windowLeft(ctx, "lone-lines", budgetOf(ctx.settings?.budget, 3), raw => countIn(raw, "narration", (t, _s, i, all) => loneLines(t, flagsFor(all, i))));
        const cut = found.filter(() => seen++ >= max);
        if (!cut.length) return text;
        let out = text;
        const hits = [];
        for (const c of [...cut].reverse()) {
            out = out.slice(0, c.sepStart) + MARK + " " + out.slice(c.sepEnd);
            hits.unshift({ kind: "lone-line", label: "one-line paragraph", before: `¶ ${c.line}`, after: c.line });
        }
        return { text: out, hits };
    },
};
