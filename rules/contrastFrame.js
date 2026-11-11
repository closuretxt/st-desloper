// Contrast frames (docs/PLAN.md section 7, item 1). PURE: no SillyTavern imports.
// The tic: the narration says what something is NOT before what it is. Keep the "is" half.
//
//   1. It wasn't X. It was Y.          It wasn't anger. It was something softer. -> It was something softer.
//      (also ; , — between them)       It's not fear, it's awe.                   -> It's awe.
//      S1 wasn't X. S2 was Y.          Seraphina wasn't angry; she was worried.   -> Seraphina was worried.
//                                      Her voice isn't cold. It's tired.          -> Her voice is tired.
//   2. It wasn't X, but Y.             It wasn't anger, but something softer.     -> It was something softer.
//   3. not P X, but P Y                She looks at him not with anger, but with pity. -> She looks at him with pity.
//                                      He left not because he was angry, but because he was afraid.
//                                                                                 -> He left because he was afraid.
// Off by default (options): "not just / only X, but Y" (it means X AND Y, so dropping X loses
// something), and dialogue (a character's own voice).
// Left alone: clefts ("It wasn't the cold that made her shiver"), "It's not that…", questions,
// a second half that's negated or a clause of its own, anything the rule can't read for sure.

import { MARK } from "../core/marks.js";
import { NOT_PARTICIPLES } from "../lang/words.js";

// "raining" yes, "something" no.
function startsWithParticiple(s) {
    const w = (/^\s*([A-Za-z]+)/.exec(s) || [])[1]?.toLowerCase();
    return !!w && w.endsWith("ing") && !NOT_PARTICIPLES.has(w);
}

const NEG_WORD = "(?:is|was|are|were|am)\\s+not|isn['’]t|wasn['’]t|aren['’]t|weren['’]t";
const POS_OF = { is: "is", was: "was", are: "are", were: "were", am: "am" };
const CONTRACTED = { s: "is", re: "are", m: "am" };
const PRONOUNS = "[Ii]t|[Tt]his|[Tt]hat|[Ss]he|[Hh]e|[Tt]hey|I|[Yy]ou|[Ww]e";
const DETERMINER = "(?:[Tt]he|[Aa]n?|[Hh]er|[Hh]is|[Tt]heir|[Mm]y|[Yy]our|[Oo]ur|[Ii]ts)";
const PREPOSITIONS = "with|in|from|for|out\\s+of|because\\s+of|because|by|to|as|through|at";
const SENTENCE_START = /(?:^[\s*_(]*|[.!?…~♡]["”’»」』)\]*_]*\s+[*_(]*|\n[\s*_(]*)$/;
const NEGATED = /\b(?:not|never|nor|no longer)\b|n['’]t\b/i;
// A first half that holds what the second leans on: "It wasn't the cold that made her shiver."
const CLAUSE_WORD = /\b(?:that|who|which|what|whom|whose)\b/i;
// "It wasn't anger, but <Y>": Y must be a thing, not a clause ("but the wind howled").
const THING_START = /^(?:something|someone|somewhere|a|an|more|less|pure|only|just|rather)\b/i;
const NOT_THING_START = /^(?:she|he|they|i|you|we|it|this|that|the|her|his|their|my|your|our|its|because|when|as)\b/i;

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const cache = new Map();
function grammar(names) {
    const clean = [...new Set((names || []).filter(n => typeof n === "string" && n.trim()).map(n => n.trim()))];
    const key = clean.join("\u0001");
    if (cache.has(key)) return cache.get(key);
    const nameAlts = clean.sort((a, b) => b.length - a.length).map(escapeRe);
    const named = nameAlts.length ? `${nameAlts.join("|")}|` : "";
    const g = {
        // The first half: subject + negated "be" (+ just / only), at a sentence start (checked apart).
        first: new RegExp(
            `(?<![\\p{L}\\p{N}'’])(${named}${PRONOUNS}|${DETERMINER}(?:\\s+[\\p{Ll}'’-]+){1,2}?)(?:\\s+(${NEG_WORD})|(['’](?:s|re|m))\\s+not)\\s+(?:(just|only|merely|simply)\\s+)?`,
            "gu",
        ),
        // The second half's start: subject + positive "be".
        second: new RegExp(`^(${named}${PRONOUNS})(?:\\s+(is|was|are|were|am)|(['’](?:s|re|m)))\\s+(?!not\\b)`, "u"),
        names: new Set(clean.map(n => n.toLowerCase())),
        // not P X, but P Y. Not after an auxiliary: "He did not with any joy…" is a negated verb.
        inline: new RegExp(
            `(,\\s*)?(?<![\\p{L}'’])(?<!\\b(?:is|was|are|were|do|does|did|could|would|should|will|can|has|have|had|am)\\s)not\\s+(${PREPOSITIONS})\\s+([^,.;!?"“”\\n]{1,50}?)\\s*,?\\s+but\\s+(?:rather\\s+)?(?:also\\s+)?(\\2)\\s+`,
            "giu",
        ),
        inlineJust: /(?<![\p{L}'’])not\s+(?:just|only|merely|simply)\s+([^,.;!?"“”\n]{1,50}?)\s*,?\s+but\s+(?:also\s+)?(?:rather\s+)?/giu,
    };
    if (cache.size > 20) cache.clear();
    cache.set(key, g);
    return g;
}

// The end of the sentence starting at `from` -> { end (before the punctuation), punct }.
function sentenceEnd(text, from) {
    const re = /([.!?…~♡]+)(["”’»」』)\]*_]*)(?=\s+[^\s\p{Ll}]|\s*$)|\n/gu;
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) return { end: text.length, punct: "" };
    if (m[0] === "\n") return { end: m.index, punct: "" };
    return { end: m.index, punct: m[1] };
}

const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const unmark = s => s.split(MARK).join("");

function positiveBe(neg, contracted) {
    if (contracted) return CONTRACTED[contracted.slice(1).toLowerCase()];
    return POS_OF[neg.toLowerCase().replace(/n['’]t$/, "").replace(/\s+not$/, "")] || null;
}

// The X half: short, one part, not a clause, not a progressive ("It wasn't raining").
function goodX(x) {
    const t = x.trim();
    if (!t || t.split(/\s+/).length > 10) return false;
    if (CLAUSE_WORD.test(t) || /[,"“”*]/.test(t)) return false;
    // A place in X tells what "it" is: "It wasn't anger in her eyes; it was grief." -> "It was
    // grief." loses where.
    if (/\b(?:in|on|at|behind|beneath|under|inside|across|through|within)\s+(?:the|a|an|her|his|their|my|your|our|its)\b/i.test(t)) return false;
    return !startsWithParticiple(t);
}

// The Y half: there, not negated, and not a lone word that points back at X ("It wasn't her
// fault. It was his." -> "It was his." means nothing).
const POINTER = /^(?:his|hers|mine|yours|theirs|ours|him|her|me|them|you|us|it|this|that|those|these|one)$/i;
function goodY(y) {
    const t = y.trim().replace(/[*_]+$/, "");
    return !!t && !NEGATED.test(t) && !POINTER.test(t);
}

// Can the first subject stand in for the second? Same word, a name for she/he/they, or a
// short noun phrase / "this" / "that" for "it".
function sameThing(s1, s2, g) {
    const a = s1.toLowerCase();
    const b = s2.toLowerCase();
    if (a === b) return "same";
    if (g.names.has(a) && /^(?:she|he|they)$/.test(b)) return "carry";
    if (b === "it" && (/^(?:this|that)$/.test(a) || a.includes(" "))) return "carry";
    if (b === "they" && a.includes(" ")) return "carry"; // "His eyes weren't cold. They were tired."
    return null;
}

function framesIn(text, g, includeJust) {
    const edits = [];
    g.first.lastIndex = 0;
    let m;
    while ((m = g.first.exec(text))) {
        const start = m.index;
        if (!SENTENCE_START.test(text.slice(0, start))) continue;
        const [whole, s1, neg, contr, just] = m;
        if (just && !includeJust) continue;
        const be = positiveBe(neg || "", contr);
        if (!be) continue;
        const after = start + whole.length;
        const rest = text.slice(after);

        // 1. "It wasn't X. It was Y." / ";" / "," / "—"
        const sep = /^([^.!?;,—–"“”\n*]{1,80}?)\s*(?:([.;])\s+|,\s+|\s*[—–]\s*|\s+--\s+)/u.exec(rest);
        // About a person, two whole sentences are often two facts ("She wasn't sure. She was
        // tired."), so only the linked forms count there (; , —). "It wasn't X. It was Y." is the tic.
        const person = !/^(?:it|this|that)$/i.test(s1) && !s1.includes(" ");
        if (sep && !(person && sep[2] === ".")) {
            const yAt = after + sep[0].length;
            const s = g.second.exec(text.slice(yAt));
            if (s && goodX(sep[1])) {
                const kind = sameThing(s1, s[1], g);
                const yRestAt = yAt + s[0].length;
                const { end, punct } = sentenceEnd(text, yRestAt);
                const y = text.slice(yRestAt, end);
                if (kind && /^[.!…]/.test(punct) && goodY(y) && !startsWithParticiple(y)) {
                    const built = kind === "same" ? capitalize(text.slice(yAt, end)) : `${s1} ${be} ${y}`;
                    edits.push({ start, end, text: MARK + built, kind: "two-halves" });
                    continue;
                }
            }
        }

        // 2. "It wasn't X, but Y."
        const but = /^([^.!?;,—–"“”\n*]{1,80}?)\s*,?\s+but\s+(?:rather\s+|also\s+)?/u.exec(rest);
        if (but && goodX(but[1])) {
            const yAt = after + but[0].length;
            const { end, punct } = sentenceEnd(text, yAt);
            const y = text.slice(yAt, end);
            const words = y.trim().split(/\s+/);
            const thing = words.length <= 6 && (THING_START.test(y) || (words.length <= 2 && !NOT_THING_START.test(y) && !/ed\b/.test(y)));
            if (/^[.!…]/.test(punct) && thing && goodY(y)) {
                const built = contr ? `${s1}${contr} ${y}` : `${s1} ${be} ${y}`;
                edits.push({ start, end, text: MARK + built, kind: "but" });
            }
        }
    }

    // 3. "not with X, but with Y" -> "with Y"
    g.inline.lastIndex = 0;
    while ((m = g.inline.exec(text))) {
        if (!goodInline(m[3])) continue;
        edits.push({ start: m.index, end: m.index + m[0].length, text: `${MARK}${m[1] ? " " : ""}${m[4]} `, kind: "inline" });
    }
    if (includeJust) {
        g.inlineJust.lastIndex = 0;
        while ((m = g.inlineJust.exec(text))) {
            if (!goodInline(m[1])) continue;
            edits.push({ start: m.index, end: m.index + m[0].length, text: MARK, kind: "inline-just" });
        }
    }
    return edits;
}

function goodInline(x) {
    return x.trim().split(/\s+/).length <= 10 && !/["“”*]/.test(x);
}

export default {
    id: "contrast-frame",
    name: "Contrast frames",
    description: "It wasn't anger. It was something softer. → It was something softer.  …not with anger, but with pity. → …with pity.",
    scope: "all",
    order: 120,
    defaults: { enabled: true, includeJust: false, inDialogue: false },
    options: [
        { key: "includeJust", type: "checkbox", label: 'Also "not just X, but Y" (drops X)' },
        { key: "inDialogue", type: "checkbox", label: "Also in dialogue" },
    ],

    apply(text, ctx) {
        try {
            if (ctx.segment?.type === "dialogue" && !ctx.settings?.inDialogue) return text;
            const g = grammar(ctx.names);
            const edits = framesIn(text, g, !!ctx.settings?.includeJust).sort((a, b) => a.start - b.start);
            let out = "";
            let last = 0;
            const hits = [];
            for (const e of edits) {
                if (e.start < last) continue; // overlaps an earlier edit
                out += text.slice(last, e.start) + e.text;
                hits.push({ kind: e.kind, before: text.slice(e.start, e.end).trim(), after: unmark(e.text).trim() });
                last = e.end;
            }
            if (!hits.length) return text;
            return { text: out + text.slice(last), hits };
        } catch (e) {
            ctx.log?.(`failed (${e?.message}); left as written`);
            return text;
        }
    },
};
