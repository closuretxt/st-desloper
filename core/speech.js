// Shared pieces for the rules that remove whole lines of speech or keep a per-reply budget
// (docs/PLAN.md section 7, round 4). PURE: no SillyTavern imports.
//
// - sentencesAt(text): the sentences of one segment, with where each starts and ends.
// - plainOf / looseOf: a sentence as matchers see it (italics out, apostrophes straight; loose
//   also lowercase with stammers folded, so "Y-you can't *just* say that!" reads as
//   "you can't just say that!").
// - applyEdits: puts a set of { start, end, text } edits into a segment with edit markers, so
//   the shared repair step fixes what's left (an emptied quote loses its attribution, as with
//   "Deal?"). Refuses an edit that would leave the reply with nothing in it.
// - earlier(ctx, find): what a finder finds in this reply's earlier segments, for budgets.
// - persons(names): subject and possessive patterns for "she / Seraphina" and "her / Seraphina's".

import { MARK } from "./marks.js";
import { splitSentences } from "./sentences.js";
import { placeholdersOf, protect, skipKey, splitSegments } from "./segments.js";

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every sentence of a segment with its offsets (blank entries dropped).
export function sentencesAt(text) {
    let pos = 0;
    const out = [];
    for (const s of splitSentences(text)) {
        if (s.text.trim()) out.push({ text: s.text, space: s.space, start: pos, end: pos + s.text.length });
        pos += s.text.length + s.space.length;
    }
    return out;
}

export function plainOf(s) {
    return String(s ?? "")
        .replace(/[*_]/g, "")
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .trim();
}

// A stammer: "W-what", "Wh-why", "I-I-I", "Y-you". Folded to the word for matching.
export const STAMMER_RE = /(?<![\p{L}\p{N}'’-])(\p{L}{1,3})(?:-\1)*-(?=\1)/giu;
export function looseOf(s) {
    return plainOf(s).replace(STAMMER_RE, "").toLowerCase();
}

// Interjections that may open a line without changing what it says ("Oh, you can't just say that!").
export const LEAD = String.raw`^(?:(?:and|but|so|oh|ah|eh|hey|huh|ugh|geez|jeez|god|gods|honestly|seriously|well|heh|hah|hmph|look|listen|you know|i mean|what)[,.!?~…]*\s+)*`;

export const hasPlaceholder = s => placeholdersOf(s).length > 0;
// An odd number of asterisks: the sentence opens or closes an italic, so it can't go alone.
export const oddStars = s => ((s.match(/\*/g) || []).length % 2 === 1);

// Whether the reply has text outside this segment.
export function othersHaveText(ctx) {
    const seg = ctx?.segment;
    return (seg?.segments || []).some((s, i) => i !== seg.index && String(s.text ?? "").trim());
}

// Removes a whole sentence: from its start to the next one's start.
export function sentenceEdit(s, extra = {}) {
    return { start: s.start, end: s.end + s.space.length, text: "", before: s.text.trim(), ...extra };
}

// edits: [{ start, end, text, kind, label, before? }] -> { text, hits } or the text unchanged.
// Overlaps: the earlier edit in the list wins. An edit that would empty the segment is allowed
// only in speech when the reply has other text (repair then drops the quote and fixes its
// attribution); narration that would end up empty stays as written.
export function applyEdits(text, edits, ctx) {
    if (!edits.length) return text;
    const taken = [];
    for (const e of edits) {
        if (e.end <= e.start && !e.text) continue;
        if (taken.some(t => e.start < t.end && t.start < e.end)) continue;
        const piece = text.slice(e.start, e.end);
        if (hasPlaceholder(piece)) continue;
        if (oddStars(piece)) continue;
        taken.push(e);
    }
    if (!taken.length) return text;
    taken.sort((a, b) => b.start - a.start);
    let out = text;
    const hits = [];
    for (const e of taken) {
        out = out.slice(0, e.start) + MARK + e.text + out.slice(e.end);
        hits.unshift({ kind: e.kind, label: e.label, before: (e.before ?? text.slice(e.start, e.end)).trim(), after: String(e.after ?? e.text).trim() });
    }
    if (!out.split(MARK).join("").replace(/[\s.,!?;:…~*_—–-]/g, "")) {
        if (ctx?.segment?.type !== "dialogue" || !othersHaveText(ctx)) return text;
    }
    return { text: out, hits };
}

// What `find(segmentText, segment)` returns for each earlier segment of this reply, flattened.
// The segments are the reply as it was before this rule ran.
// key: names what `find` + `inScope` look for (include anything their result depends on). With a
// key, each segment's result is kept for the rest of this rule's run (the segments array is fresh
// per rule and never changes), so a reply split into thousands of segments (a run of quote marks)
// costs one pass, not one pass per segment.
const earlierCache = new WeakMap();
export function earlier(ctx, find, inScope = () => true, key = null) {
    const seg = ctx?.segment;
    if (!seg || !Array.isArray(seg.segments)) return [];
    let per = null;
    if (key !== null) {
        let store = earlierCache.get(seg.segments);
        if (!store) earlierCache.set(seg.segments, (store = new Map()));
        per = store.get(key);
        if (!per) store.set(key, (per = []));
    }
    const out = [];
    for (let i = 0; i < seg.index; i++) {
        let found = per?.[i];
        if (found === undefined) {
            const x = seg.segments[i];
            found = inScope(x) ? find(String(x.text ?? ""), x) : [];
            if (per) per[i] = found;
        }
        for (const f of found) out.push(f);
    }
    return out;
}

// A budget setting -> a whole number >= 0 (anything else: the fallback).
export function budgetOf(value, fallback = 1) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// Subject and possessive patterns for the chat's names (built once per name list).
const personCache = new Map();
export function persons(names) {
    const list = (Array.isArray(names) ? names : []).filter(n => typeof n === "string" && /^[\p{L}][\p{L}'’ -]*$/u.test(n.trim())).map(n => n.trim());
    const key = list.join("\u0001");
    if (personCache.has(key)) return personCache.get(key);
    const alt = list.sort((a, b) => b.length - a.length).map(esc).join("|");
    const NAMES = alt || "(?!)";
    const p = {
        NAMES,
        SUBJ: String.raw`(?:[Ss]he|[Hh]e|[Tt]hey|I|[Yy]ou|[Ww]e|${NAMES})`,
        POSS: String.raw`(?:[Hh]er|[Hh]is|[Tt]heir|[Mm]y|[Yy]our|[Oo]ur|(?:${NAMES})['’]s)`,
    };
    if (personCache.size > 20) personCache.clear();
    personCache.set(key, p);
    return p;
}

// ---- budgets over a window of replies (PLAN section 7, item 20) ---------------------------
// A per-reply budget lets 20 replies carry 20 stammers, one each, so the habit still builds up
// in the history. With a window, a budget of 3 means "3 in any run of N replies": once earlier
// replies used it up, this one keeps none.
// ctx.window: { size, history } — history: the earlier AI replies as written, oldest first.

// How many of one kind a reply holds, counted on its segments of one type.
// find(segmentText, segment, index, segments) -> array of hits.
export function countIn(raw, type, find) {
    const prot = protect(String(raw ?? ""));
    if (!prot) return 0;
    const segs = splitSegments(prot.text);
    let n = 0;
    segs.forEach((s, i) => {
        if (s.type === type) n += find(String(s.text ?? ""), s, i, segs).length;
    });
    return n;
}

const counted = new Map();
function countOnce(key, raw, countReply) {
    // skipKey: a newly skipped tracker block changes what a reply counts.
    const k = `${key}\u0001${skipKey()}\u0001${raw}`;
    if (counted.has(k)) return counted.get(k);
    let n = 0;
    try {
        n = countReply(raw);
    } catch {
        n = 0;
    }
    if (counted.size > 5000) counted.clear();
    counted.set(k, n);
    return n;
}
const sum = a => a.reduce((x, y) => x + y, 0);

// What's left of `budget` for this reply. key: the rule id plus anything that changes what
// countReply finds (names, switched-off parts), for the count cache.
// The earlier replies are walked oldest first, each keeping what was left for it then, so this
// reply sees what the history really kept, not what the model first wrote. The walk starts three
// windows back; further back no longer matters in practice.
export function windowLeft(ctx, key, budget, countReply) {
    const size = Math.floor(Number(ctx?.window?.size));
    const history = Array.isArray(ctx?.window?.history) ? ctx.window.history : [];
    if (!(size > 1) || !history.length) return budget;
    const found = history.slice(-size * 3).map(t => countOnce(key, String(t ?? ""), countReply));
    const kept = [];
    for (let k = 0; k < found.length; k++) {
        const used = sum(kept.slice(Math.max(0, k - (size - 1)), k));
        kept.push(Math.min(found[k], Math.max(0, budget - used)));
    }
    return Math.max(0, budget - sum(kept.slice(-(size - 1))));
}

// The "off" list of a rule with switchable parts -> a Set of ids.
export function offSet(value) {
    return new Set(Array.isArray(value) ? value.map(String) : []);
}
