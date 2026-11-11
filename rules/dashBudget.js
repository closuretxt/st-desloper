// Dash and ellipsis budget (docs/PLAN.md section 7, item 4). PURE: no SillyTavern imports.
//
// Counting, not guessing: a reply may have N dashes (and N ellipses) per 100 words, at least
// one. The first ones stay as written; each one past the budget becomes plain punctuation, but
// only when what follows says which:
//   "He nodded—she was right."       -> "He nodded. She was right."     (a clause: period)
//   "She smiled—a small smile."      -> "She smiled, a small smile."    (a phrase: comma)
//   "The fire crackled—and died."    -> "The fire crackled and died."
//   "She frowned—but said nothing."  -> "She frowned, but said nothing."
//   "He turned—very slowly—to her."  -> "He turned, very slowly, to her." (a pair: two commas)
//   "He waited... Nothing happened." -> "He waited. Nothing happened."
//   "She paused... then smiled."     -> "She paused, then smiled."
// Never touched (they still count toward the budget): a dash or ellipsis that ends a line
// (cut off), starts one, a stammer ("I—I"), a pair with commas inside, a dash after "knew /
// thought / said…" or before a name (unsure what follows), "...?", number ranges (1990–2000),
// "---" lines, an ellipsis mid-phrase ("such a... *substantial*", "tastes like... fire").
// Dialogue only when its option is on (dashes and ellipses each have one), and there a trailing
// "..." always stays.

import { MARK } from "../core/marks.js";
import { earlier } from "../core/speech.js";

const SPACE = "[ \\t]*";
// The long dashes: em dash —, horizontal bar ― (some models write it in place of —), two- and
// three-em ⸺ ⸻, small em ﹘. A doubled one ("——") is one mark.
export const EM_DASHES = "—―⸺⸻﹘";
// a long dash, a spaced or between-letters –, a spaced or bare -- (not ---), a spaced single -.
const DASH_RE = new RegExp(String.raw`${SPACE}[${EM_DASHES}]+${SPACE}|[ \t]+–[ \t]+|(?<=\p{L})–(?=\p{L})|${SPACE}(?<!-)--(?!-)${SPACE}|[ \t]+(?<!-)-(?!-)[ \t]+`, "gu");
const ELLIPSIS_RE = /[ \t]*(?:\.{3,}|…|\. \. \.)[ \t]*/g;

const SUBJECTS = new Set(["i", "you", "he", "she", "it", "we", "they", "there"]);
const JOIN_PLAIN = new Set(["and"]); // "crackled—and died" -> "crackled and died"
const JOIN_COMMA = new Set(["then", "but", "yet", "so", "or", "though", "because"]);
// After these, what follows the dash is what was known / said: a period or comma changes it.
const REPORTING = new Set(
    (
        "know knew knows thought think thinks realized realize realizes realised felt feel feels saw see sees " +
        "wondered wonder wonders hoped hope hopes feared fear fears said say says whispered whispers meant mean means " +
        "understood understand understands remembered remember remembers decided decide decides prayed wished wish"
    ).split(" "),
);

// Words a phrase can't stop on: an ellipsis after them is a pause mid-phrase.
const MID_PHRASE = new Set(
    (
        "a an the such so very quite really too my your his her its our their this that these those " +
        "of to in on at by for with from into like as than about and or but nor if is was are were be " +
        "am been being has have had do does did can could will would should shall may might must just"
    ).split(" "),
);

const lastWord = s => (s.match(/([\p{L}'’]+)[^\p{L}]*$/u) || [])[1]?.toLowerCase() || "";
const firstWord = s => (s.match(/^[^\p{L}\n]*?([\p{L}'’]+)/u) || [])[1] || "";
const cap = s => s.replace(/^([^\p{L}]*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());

function wordCount(text) {
    return (String(text).match(/[\p{L}\p{N}'’]+/gu) || []).length;
}

// What sits around a mark: a line start / end counts as an edge.
function atLineStart(before) {
    return /(?:^|\n)[ \t*_]*$/.test(before);
}
function atLineEnd(after) {
    return /^[ \t]*["”’*_)\]]*[ \t]*(?:\n|$)/.test(after);
}
// A dash or ellipsis right after punctuation (",—", "?...") is someone's style: leave it.
function afterWord(before) {
    return /[\p{L}\p{N})'’*]$/u.test(before);
}

// The text either side of a mark, as far as the checks need it. Taking the whole rest of the
// text for every mark made a reply with hundreds of dashes take seconds. A cut side gets a letter
// at the cut, so it never reads as a line start / end.
const NEAR = 300;
function around(text, start, end) {
    const from = Math.max(0, start - NEAR);
    const to = Math.min(text.length, end + NEAR * 2);
    return { before: (from > 0 ? "x" : "") + text.slice(from, start), after: text.slice(end, to) + (to < text.length ? "x" : "") };
}

// Every dash use in a text, in order. A pair counts as one use.
// -> [{ start, end, text, keep, hit }] where text is the replacement (null = can't convert).
export function dashUses(text) {
    const marks = [...text.matchAll(DASH_RE)].map(m => ({ start: m.index, end: m.index + m[0].length, raw: m[0] }));
    const uses = [];
    for (let i = 0; i < marks.length; i++) {
        const d = marks[i];
        const { before, after } = around(text, d.start, d.end);
        // Number ranges are not dashes at all.
        if (/\d$/.test(before) && /^\d/.test(after)) continue;
        const use = { start: d.start, end: d.end, text: null };
        uses.push(use);
        if (atLineStart(before) || atLineEnd(after) || !afterWord(before)) continue;
        if (lastWord(before) && lastWord(before) === firstWord(after).toLowerCase()) continue; // "I—I"

        // A pair: the next dash closes it within the same sentence, a few words later.
        const next = marks[i + 1];
        if (next) {
            const inner = text.slice(d.end, next.start);
            const words = wordCount(inner);
            if (words >= 1 && words <= 12 && !/[.!?…\n]/.test(inner)) {
                i++;
                use.end = next.end;
                const tail = around(text, next.start, next.end).after;
                if (inner.includes(",") || !/^[\p{L}\p{N}'’"“*]/u.test(inner) || atLineEnd(tail)) continue;
                use.text = /^[,.;:!?…]/.test(tail) ? `, ${inner.trim()}` : `, ${inner.trim()}, `;
                continue;
            }
        }

        if (REPORTING.has(lastWord(before))) continue;
        const w = firstWord(after);
        const lw = w.toLowerCase();
        if (!w || !/^\p{L}/u.test(after)) continue; // a quote, a number, a symbol: unsure
        if (JOIN_PLAIN.has(lw)) use.text = " ";
        else if (JOIN_COMMA.has(lw)) use.text = ", ";
        else if (SUBJECTS.has(lw) && /^\p{L}+[ \t]+\p{L}/u.test(after) && !/^\p{L}+[ \t]+(?:and|or|but)\b/iu.test(after)) use.text = ". ";
        // A comma where the rest of the sentence has commas of its own blurs it ("She shook her
        // head, no, she wouldn't."), so only a clean phrase gets one.
        else if (/^\p{Ll}/u.test(after) && !after.split(/[.!?…\n]/)[0].includes(",")) use.text = ", ";
        // A capital word (a name?) may start a clause or be a noun: unsure, leave it.
    }
    return uses;
}

// Every ellipsis use in a text. trailingKeep: in dialogue a trailing "..." is speech fading out.
export function ellipsisUses(text, { trailingKeep = false } = {}) {
    const uses = [];
    for (const m of text.matchAll(ELLIPSIS_RE)) {
        const start = m.index;
        const end = start + m[0].length;
        const { before, after } = around(text, start, end);
        const use = { start, end, text: null };
        uses.push(use);
        if (atLineStart(before) || !afterWord(before) || /^[?!]/.test(after)) continue;
        if (atLineEnd(after)) {
            // The end of the line or of the narration before a quote: a plain period (the space
            // before a following quote stays).
            if (!trailingKeep) use.text = `.${m[0].match(/[ \t]*$/)[0]}`;
            continue;
        }
        // A pause inside a phrase ("such a... substantial", "tastes like... fire"): any mark
        // there breaks the sentence, so it stays.
        if (MID_PHRASE.has(lastWord(before))) continue;
        const w = firstWord(after).toLowerCase();
        // Italic marks don't start a sentence: "a... *substantial*" goes by the word inside.
        const word = after.replace(/^[*_]+/, "");
        if (/^\p{Ll}/u.test(word)) use.text = JOIN_PLAIN.has(w) ? " " : ", ";
        else if (/^[\p{Lu}"“]/u.test(word)) use.text = ". ";
    }
    return uses;
}

function inScope(seg, inDialogue) {
    return seg.type === "narration" || (inDialogue && seg.type === "dialogue");
}

function allowed(perHundred, words) {
    const n = Number(perHundred);
    if (!Number.isFinite(n) || n < 0) return Infinity;
    if (n === 0) return 0;
    return Math.max(1, Math.floor((words * n) / 100));
}

// A few words either side, for the hit list.
function snippet(text, start, end, replacement) {
    const left = (text.slice(Math.max(0, start - 30), start).match(/\S+\s*$/) || [""])[0];
    const right = (text.slice(end, end + 30).match(/^\s*\S+/) || [""])[0];
    return { before: left + text.slice(start, end) + right, after: left + replacement + right };
}

export default {
    id: "dash-budget",
    name: "Dash and ellipsis budget",
    description: "Past the budget, dashes and ellipses become plain punctuation where what follows makes it clear: He nodded—she was right. → He nodded. She was right.",
    scope: "all",
    order: 300,
    defaults: { enabled: true, dashesPer100: 1, ellipsesPer100: 1, inDialogue: false, ellipsesInDialogue: false },
    options: [
        { key: "dashesPer100", type: "number", label: "Dashes allowed per 100 words (at least one per reply; 0 = none)", min: 0, max: 20 },
        { key: "ellipsesPer100", type: "number", label: "Ellipses allowed per 100 words (at least one per reply; 0 = none)", min: 0, max: 20 },
        { key: "inDialogue", type: "checkbox", label: "Dashes inside dialogue too" },
        { key: "ellipsesInDialogue", type: "checkbox", label: "Ellipses inside dialogue too (pauses in speech; usually best left)" },
    ],

    apply(text, ctx) {
        const s = ctx.settings || {};
        const seg = ctx.segment;
        if (!seg || !Array.isArray(seg.segments)) return text;
        // Dashes and ellipses each have their own dialogue switch: a dash in speech is often just
        // the model's habit, an ellipsis is how the line is said.
        const speech = seg.type === "dialogue";
        const doDash = !speech || !!s.inDialogue;
        const doDots = !speech || !!s.ellipsesInDialogue;
        if (!doDash && !doDots) return text;
        if (!/[—―⸺⸻﹘–-]|\.\.\.|…|\. \. \./.test(text)) return text;

        // The budget is for the whole reply; the uses in earlier segments come first.
        const words = seg.segments.reduce((a, x) => a + wordCount(x.text), 0);
        const maxDash = allowed(s.dashesPer100, words);
        const maxDots = allowed(s.ellipsesPer100, words);
        // Cached per segment for this run (core/speech.js earlier), so many segments stay cheap.
        let dashSeen = earlier(ctx, t => dashUses(t), x => inScope(x, s.inDialogue), `dash\u0001${!!s.inDialogue}`).length;
        let dotsSeen = earlier(ctx, (t, x) => ellipsisUses(t, { trailingKeep: x.type === "dialogue" }), x => inScope(x, s.ellipsesInDialogue), `dots\u0001${!!s.ellipsesInDialogue}`).length;

        const edits = [];
        if (doDash) for (const u of dashUses(text)) if (dashSeen++ >= maxDash && u.text !== null) edits.push({ ...u, kind: "dash", label: "dash" });
        if (doDots) {
            for (const u of ellipsisUses(text, { trailingKeep: speech })) {
                if (dotsSeen++ >= maxDots && u.text !== null) edits.push({ ...u, kind: "ellipsis", label: "ellipsis" });
            }
        }
        if (!edits.length) return text;

        edits.sort((a, b) => b.start - a.start);
        let out = text;
        const hits = [];
        let lastStart = Infinity;
        for (const e of edits) {
            if (e.end > lastStart) continue; // overlap (shouldn't happen)
            let rest = out.slice(e.end);
            if (e.text.startsWith(".")) rest = cap(rest); // a new sentence
            out = out.slice(0, e.start) + MARK + e.text + rest;
            lastStart = e.start;
            const sn = snippet(text, e.start, e.end, e.text);
            hits.unshift({ kind: e.kind, label: e.label, before: sn.before.trim(), after: sn.after.trim() });
        }
        return { text: out, hits };
    },
};
