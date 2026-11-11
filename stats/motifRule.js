// Motif breaker (docs/PLAN.md section 7, item 6). PURE: no SillyTavern imports.
//
// The stats find phrases the model keeps reusing across replies ("tilts her head slightly").
// From the stats page the user can turn one into a pattern in "Your patterns": delete it, or
// swap it for one of several wordings (picked per message, stable). Nothing is added on its own:
// the user writes the replacements and sees what they do to the chat's own replies first.
//
// Deleting a phrase can leave a broken sentence ("She tilts her head slightly and studies you"
// -> "She and studies you"); the preview shows that before anything is saved, and the repair
// step only fixes spaces and punctuation, not grammar.

import { blankPattern, patternRule, compileFind } from "../rules/patternRules.js";
import { runPipeline } from "../core/pipeline.js";
import { splitSentences } from "../core/sentences.js";

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The stats phrase (lowercase words, punctuation dropped) -> a "find" for a pattern.
// Plain text when it can be (readable in "Your patterns": any case, whole words, any spacing);
// a regex only when an apostrophe needs to match a curly one too.
export function motifFind(phrase) {
    const words = String(phrase ?? "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    if (!words.some(w => w.includes("'"))) return words.join(" ");
    const body = words.map(w => escapeRe(w).replace(/'/g, "['’]")).join("\\s+");
    return `/(?<![\\p{L}\\p{N}'’])${body}(?![\\p{L}\\p{N}])/iu`;
}

// A pattern for "Your patterns". Narration only unless asked: a phrase in dialogue may be the
// character's own way of talking. Runs on the display and the prompt, so the model stops seeing
// (and copying) its own phrase.
export function motifPattern(phrase, { replace = "", inDialogue = false } = {}) {
    return {
        ...blankPattern(),
        name: `Reused: "${String(phrase ?? "").trim()}"`,
        find: motifFind(phrase),
        replace: String(replace ?? ""),
        scope: inDialogue ? "all" : "narration",
    };
}

// Is there already a pattern for this phrase?
export function hasMotifPattern(patterns, phrase) {
    const find = motifFind(phrase);
    return Array.isArray(patterns) && patterns.some(p => p && String(p.find ?? "").trim() === find);
}

// The sentences that differ between two versions of a text (common start and end dropped).
export function changedPart(a, b) {
    const x = splitSentences(a).map(s => s.text).filter(t => t.trim());
    const y = splitSentences(b).map(s => s.text).filter(t => t.trim());
    let start = 0;
    while (start < x.length && start < y.length && x[start] === y[start]) start++;
    let end = 0;
    while (end < x.length - start && end < y.length - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
    return { before: x.slice(start, x.length - end).join(" "), after: y.slice(start, y.length - end).join(" ") };
}

// What the pattern would do to the chat's replies, on its own (the other rules aren't run, so
// only its change shows). replies: [{ index, text, lastUser }].
// -> { error } or { changed: n, examples: [{ index, before, after }] } (up to `max` examples, latest first).
export function previewMotif(pattern, replies, { names = [], max = 3 } = {}) {
    const { error } = compileFind(pattern?.find);
    if (error) return { error };
    const rule = patternRule({ ...pattern, enabled: true }, 0);
    let changed = 0;
    const examples = [];
    for (let i = (replies || []).length - 1; i >= 0; i--) {
        const r = replies[i];
        const out = runPipeline(r.text, [rule], { names, lastUser: r.lastUser || "" });
        if (!out.changed) continue;
        changed++;
        if (examples.length < max) examples.push({ index: r.index, ...changedPart(r.text, out.text) });
    }
    return { changed, examples };
}
