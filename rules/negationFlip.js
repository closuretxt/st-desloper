// Negated actions (docs/PLAN.md section 5). PURE: no SillyTavern imports.
// The tic: the narration says what a character does NOT do before what they do. Narration only.
//
//   1. S doesn't X but/and (instead) Y   She didn't pull away but leaned in.        -> She leaned in.
//                                        She doesn't answer, but her hand tightens. -> Her hand tightens.
//   2. S doesn't X; instead, Z           …, she doesn't pull back; instead, her lips stay still.
//                                                                                   -> …, her lips stay still.
//   3. S doesn't X, Ying (instead)       She doesn't pull away, pressing closer instead. -> She presses closer.
//   4. Instead of Xing, S Y              Instead of pulling away, she leans in.     -> She leans in.
//      S Y instead of Xing.              She leans in instead of pulling away.      -> She leans in.
//   5. S doesn't X. (alone)              flip from a checked table when the phrase is the whole
//                                        sentence (She doesn't let go. -> She holds on / keeps
//                                        hold / holds tight, dealt per message), delete
//                                        pure filler (She doesn't hesitate.), leave the rest.
//
// Subject = she / he / they / I / you / we or a character name. Thoughts are left alone
// ("He doesn't know what to say"), and anything the rule can't read for sure stays as written.

import { MARK } from "../core/marks.js";
import { dealFrom, choiceList } from "../core/seed.js";
import { toThird, toPast, conjugateParticiple } from "../lang/conjugate.js";
import { POSSESSIVE_OF, NOT_PARTICIPLES, IRREGULAR_PAST, COGNITIVE_VERBS, FLIP_TABLE, DELETE_VERBS } from "../lang/words.js";

// doesn't -> she presses (third), didn't -> she pressed (past), don't -> they press (base),
// won't -> null: it often means "refuses", so only rewrites that keep the other half's own verb.
function tenseOf(neg) {
    const n = neg.toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");
    if (n === "doesn't" || n === "does not") return "third";
    if (n === "didn't" || n === "did not") return "past";
    if (n === "don't" || n === "do not") return "base";
    return null;
}

const PAST_FORMS = new Set(Object.values(IRREGULAR_PAST));
const NOT_VERBS = new Set([
    "his", "this", "is", "was", "as", "us", "yes", "perhaps", "always", "sometimes", "hers", "its",
    "whereas", "unless", "thus", "less", "across", "towards", "afterwards", "besides", "the", "a",
    "an", "to", "not", "never", "with", "her", "their", "my", "your", "our", "for", "from", "in",
    "on", "at", "by", "of", "so", "that", "there", "it", "she", "he", "they", "we", "you", "i",
    "nothing", "something", "no", "also", "both", "either", "neither", "nor", "this", "these",
    "those", "what", "when", "where", "while", "until", "because", "if", "though", "although",
]);
const LY_VERBS = new Set(["reply", "apply", "rely", "fly", "supply", "comply", "imply", "multiply", "ally", "tally", "rally", "bully", "sully", "dally"]);
const LEADING_ADVERB = /^(?:always|still|just|only|simply|then|instead|even|again|merely|almost|nearly|slowly|finally|suddenly)$/;
const NEGATED = /\b(?:not|never|nor|no longer)\b|n['’]t\b/i;
// The negated part holds a whole clause of its own ("…when he kisses her"): deleting it loses
// what the rest leans on.
const SUBORDINATE = /\b(?:when|as|while|because|if|though|although|until|before|after|since|once|whenever)\b/i;
// The negated part names a thing (an object after the/his/of/from...), and the kept part points
// back with "it" / "them" / "this": "doesn't pull away from his touch, leaning into it" would
// leave "She leans into it" with nothing for "it" to mean.
const HAS_OBJECT = /\b(?:the|a|an|his|her|their|my|your|our|its|of|from|to|at|on|in|with|into|onto)\b/i;
// "that" / "one" only count at a clause end ("…leaning into that."): as a conjunction ("so tightly
// that the rope frays") or a number they point at nothing.
const POINTS_BACK = /\b(?:it|them|this|these|those)\b|\b(?:that|one)(?=\s*(?:[.,;!?…]|$))/i;
// Words that only mark the contrast with the negated half; they go with it ("She doesn't argue;
// she simply nods." -> "She nods.").
const CONTRAST_ADVERB = /^(?:simply|just|merely|only)\s+/;
// A short opener before a lone negation: "For a moment, she doesn't move." (one capitalized word
// and up to three more, then a comma, at a sentence start).
const LEAD_PHRASE = /(?:^|[.!?…~♡]["”’»」』)\]*_]*\s+|\n)[\s*_(]*[A-Z][a-z]*(?:\s+[a-z]+){0,3},\s+$/;
// A lone negation tagged on with "though / yet / but": "…, though she doesn't look away." The
// comma is often left out ('"Careful," she says but she doesn't pull away.').
const CONTRAST_TAG = /(?:,\s+|(?<=[\p{L}'’"”*])\s+)(?:though|yet|but)\s+$/u;
// Emphasis after a lone negation that a flip makes pointless: "doesn't move at all" -> "stays still".
const INTENSIFIER = /\s+(?:at all|(?:even )?for (?:a|one) (?:single )?(?:second|moment|instant)|(?:a|one) single (?:second|moment|instant))$/;

const CLAUSE_START = /(?:^[\s*_(]*|[.!?…~♡]["”’»」』)\]*_]*\s+[*_(]*|\n[\s*_(]*|[,;:—–]\s*|(?:^|\s)(?:and|but|then|so)\s+|(?:^[\s*_(]*|[.!?…~♡]["”’»」』)\]*_]*\s+[*_(]*|\n[\s*_(]*)(?:But|And|Yet|So|Then)\s+)$/;
// "But she doesn't pull away. Instead, her lips part" -> "Her lips part": the opener goes with the
// negated sentence when the whole sentence is cut.
const SENTENCE_OPENER = /(?:^[\s*_(]*|[.!?…~♡]["”’»」』)\]*_]*\s+[*_(]*|\n[\s*_(]*)((?:But|And|Yet|So|Then)\s+)$/;
const SENTENCE_START = /(?:^[\s*_(]*|[.!?…~♡]["”’»」』)\]*_]*\s+[*_(]*|\n[\s*_(]*)$/;

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const grammarCache = new Map();
function grammar(names) {
    const clean = [...new Set((names || []).filter(n => typeof n === "string" && n.trim()).map(n => n.trim()))];
    const key = clean.join("\u0001");
    if (grammarCache.has(key)) return grammarCache.get(key);
    const nameAlts = clean.sort((a, b) => b.length - a.length).map(escapeRe);
    const named = nameAlts.length ? `${nameAlts.join("|")}|` : "";
    const g = {
        // "it" is left out: "It doesn't matter, but…" is rarely the tic, and dropping it loses meaning.
        candidate: new RegExp(
            `(?<![\\p{L}\\p{N}'’])(${named}[Ss]he|[Hh]e|[Tt]hey|I|[Yy]ou|[Ww]e)\\s+(does\\s+not|doesn['’]t|did\\s+not|didn['’]t|do\\s+not|don['’]t|will\\s+not|won['’]t)\\s+`,
            "gu",
        ),
        // A clause that can stand on its own: a pronoun, a name, or the/a/possessive + noun.
        ownSubject: new RegExp(`^(?:(?:${named}[Ss]he|[Hh]e|[Tt]hey|I|[Yy]ou|[Ww]e)\\b|(?:[Tt]he|[Aa]n?|[Hh]er|[Hh]is|[Tt]heir|[Mm]y|[Yy]our|[Oo]ur)\\s+[a-z])`),
        isName: nameAlts.length ? new RegExp(`^(?:${nameAlts.join("|")})$`) : null,
    };
    if (grammarCache.size > 20) grammarCache.clear();
    grammarCache.set(key, g);
    return g;
}

// The end of the sentence starting at `from`: a run of . ! ? … ~ ♡ followed by the end or by a
// space and something that isn't lowercase ("Wait... no" goes on), or a line break.
function sentenceEnd(text, from) {
    const re = /([.!?…~♡]+)(["”’»」』)\]*_]*)(?=\s+[^\s\p{Ll}]|\s*$)|\n/gu;
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) return { end: text.length, punct: "" };
    if (m[0] === "\n") return { end: m.index, punct: "" };
    return { end: m.index, punct: m[1] };
}

function sentenceText(text) {
    return text.slice(0, sentenceEnd(text, 0).end);
}

// Does the clause start with a finite verb in this tense (after a leading adverb or two)?
// "leans in" fits doesn't, "leaned in" fits didn't, "nod" doesn't fit doesn't.
function fitsTense(clause, tense) {
    if (!tense) return false;
    const words = clause.split(/\s+/).slice(0, 4);
    let k = 0;
    while (k < 2 && k < words.length - 1 && (LEADING_ADVERB.test(words[k]) || (/^[a-z]{3,}ly$/.test(words[k]) && !LY_VERBS.has(words[k])))) k++;
    const w = (words[k] || "").replace(/[,.;:!?…~♡]+$/, "");
    if (!/^[a-z]+$/.test(w) || NOT_VERBS.has(w)) return false;
    if (tense === "third") return w.endsWith("s") && (!w.endsWith("ss") || w.endsWith("sses"));
    if (tense === "past") return w.endsWith("ed") || PAST_FORMS.has(w);
    return !w.endsWith("ing") && !w.endsWith("s");
}

function isParticiple(word) {
    return /^[a-z]+ing$/.test(word) && !NOT_PARTICIPLES.has(word);
}

// Conjugates a participle phrase: "pressing closer and wrapping her arms" -> "presses closer and
// wraps her arms". null when a word can't be conjugated for sure.
function conjugatePhrase(first, rest, tense) {
    const head = conjugateParticiple(first, tense);
    if (!head) return null;
    let bad = false;
    // "and gently stroking" too: an -ly adverb may sit between "and" and the -ing word.
    const tail = rest.replace(/\b(and|or|but|then)(\s+)((?:[a-z]+ly\s+)?)([a-z]+ing)\b/g, (all, conj, sp, adv, w) => {
        if (!isParticiple(w) || (adv && LY_VERBS.has(adv.trim()))) return all;
        const c = conjugateParticiple(w, tense);
        if (!c) bad = true;
        return c ? conj + sp + adv + c : all;
    });
    return bad ? null : head + tail;
}

function parseFlips(list) {
    const out = new Map();
    for (const line of Array.isArray(list) ? list : []) {
        const m = /^\s*(.+?)\s*=\s*(.+?)\s*$/.exec(String(line));
        if (m) out.set(m[1].toLowerCase().replace(/\s+/g, " "), m[2]);
    }
    return out;
}

function conjugateFlip(flip, tense, subject) {
    let phrase = flip;
    if (phrase.includes("{pos}")) {
        const pos = POSSESSIVE_OF[subject.toLowerCase()];
        if (!pos) return null; // a name: her or his? Not sure, so no flip.
        phrase = phrase.replace(/\{pos\}/g, pos);
    }
    const [first, ...rest] = phrase.split(" ");
    const verb = tense === "third" ? toThird(first) : tense === "past" ? toPast(first) : first;
    return verb ? [verb, ...rest].join(" ") : null;
}

function listOf(value, fallback) {
    return Array.isArray(value) ? value : fallback;
}

// One "S doesn't X…" candidate -> an edit { start, end, text, hit } or null.
function negatedEdit(text, m, g, opt) {
    const subject = m[1];
    const subjStart = m.index;
    const subjEnd = subjStart + subject.length;
    const negEnd = m.index + m[0].length;
    const before = text.slice(0, subjStart);
    // After ", though / yet / but" only a lone-negation flip may apply (case 5): the rewrites
    // below would cut into the clause the tag belongs to.
    const loneOnly = !CLAUSE_START.test(before);
    if (loneOnly && !CONTRAST_TAG.test(before)) return null;
    const tense = tenseOf(m[2]);
    const { end, punct } = sentenceEnd(text, negEnd);
    const clause = text.slice(negEnd, end); // everything after the negation, up to the sentence end
    if (!clause.trim() || /[-"“”「」『』]/.test(clause)) return null;

    // Thoughts are not the tic.
    const firstVerb = (clause.match(/^(?:(?:even|really|just|quite|ever)\s+)?([a-z]+)/) || [])[1];
    if (!firstVerb || COGNITIVE_VERBS.has(firstVerb)) return null;

    // The hit shows the whole sentence before and after, for the stats and the tester.
    const cut = (from, to, repl, kind, hitEnd = end + punct.length) => ({ start: from, end: to, text: repl, hitStart: subjStart, hitEnd: Math.max(to, hitEnd), kind });
    // The kept half has its own subject, so everything before it goes. If that drops a name
    // and the kept half starts with she / he, the name moves over: "Seraphina doesn't leave.
    // Instead, she settles…" -> "Seraphina settles…", not a "She" that may point elsewhere.
    const ownCut = (restStart, rest, kind, hitEnd) => {
        const pronoun = /^(?:[Ss]he|[Hh]e)\b/.exec(rest);
        if (pronoun && g.isName?.test(subject)) return cut(subjStart, restStart + pronoun[0].length, MARK + subject, kind, hitEnd);
        return cut(subjStart, restStart, MARK, kind, hitEnd);
    };
    // Deleting the negated part X must not take away something the kept part needs.
    const safeToDrop = (x, kept) => !SUBORDINATE.test(x) && !(HAS_OBJECT.test(x) && POINTS_BACK.test(kept));

    // The positive half: its own clause ("her hand tightens") replaces everything from the
    // subject; a bare verb in the right tense ("leans in") keeps the subject. A plain "and"
    // only joins a verb ("doesn't speak and stares"); "doesn't look up, and her voice is cold"
    // is two facts, not the tic.
    const positive = (x, restStart, rest, kind, allowOwnSubject = true) => {
        if (NEGATED.test(rest.split(",")[0])) return null; // "but she doesn't lean in either"
        if (!safeToDrop(x, rest)) return null;
        if (g.ownSubject.test(rest)) return allowOwnSubject ? ownCut(restStart, rest, kind) : null;
        if (fitsTense(rest, tense)) return cut(subjEnd, restStart, `${MARK} `, kind);
        return null;
    };

    // 2. "; instead, Z" / ", instead Z" in the same sentence.
    let c = loneOnly ? null : /^(.+?)(?:\s*[;,]|\s*[—–])\s*instead,?\s+(?=\S)/.exec(clause);
    if (c) {
        const edit = positive(c[1], negEnd + c[0].length, clause.slice(c[0].length), "instead");
        if (edit) return edit; // else maybe ", instead pressing closer" (case 3)
    }
    // 2b. "S doesn't X. Instead, Z" across two sentences: Z must be a full sentence.
    if (!loneOnly && /^[.!]$/.test(punct) && !/[,;]/.test(clause)) {
        const next = /^[.!]\s+Instead,?\s+/.exec(text.slice(end));
        const z = text.slice(end + (next ? next[0].length : 0));
        if (next && g.ownSubject.test(z) && safeToDrop(clause, sentenceText(z))) {
            const zStart = end + next[0].length;
            const zEnd = sentenceEnd(text, zStart);
            const edit = ownCut(zStart, z, "instead", zEnd.end + zEnd.punct.length);
            const opener = SENTENCE_OPENER.exec(before);
            if (opener) edit.start = edit.hitStart = subjStart - opener[1].length;
            return edit;
        }
    }
    // 2c. "S doesn't X; S (simply) Y": the same person right after a semicolon, no "instead".
    // Only the same subject (or she / he after a name): "She doesn't answer; he laughs." is two
    // people, two facts.
    c = loneOnly ? null : /^(.+?)\s*;\s+(?=\S)/.exec(clause);
    if (c) {
        const restStart = negEnd + c[0].length;
        const rest = clause.slice(c[0].length);
        const s = /^([Ss]he|[Hh]e|[Tt]hey|I|[Yy]ou|[Ww]e|[A-Z][\p{L}'’-]*(?: [A-Z][\p{L}'’-]*)*)\s+/u.exec(rest);
        const same = s && (s[1].toLowerCase() === subject.toLowerCase() || (g.isName?.test(subject) && /^(?:she|he)$/i.test(s[1])));
        if (same && !NEGATED.test(rest.split(",")[0]) && safeToDrop(c[1], rest)) {
            const after = rest.slice(s[0].length);
            const adv = CONTRAST_ADVERB.exec(after);
            const verb = after.slice(adv ? adv[0].length : 0);
            if (fitsTense(verb, tense)) {
                const keepFrom = restStart + s[0].length + (adv ? adv[0].length : 0);
                return cut(subjEnd, keepFrom, `${MARK} `, "semicolon");
            }
        }
    }
    // 1. "but / and (instead) Y".
    c = loneOnly ? null : /^(.+?)(,?\s+(but|and)(\s+instead)?,?\s+)(?=\S)/.exec(clause);
    if (c && !/[,;]/.test(c[1])) {
        const own = c[3] === "but" || !!c[4];
        const edit = positive(c[1], negEnd + c[0].length, clause.slice(c[0].length), "but", own);
        if (edit) return edit;
    }
    // 3. ", Ying (instead)": the participle becomes the verb.
    // "…, simply laying…": the contrast word goes with the negated half.
    c = loneOnly ? null : /^([^,;]+?),\s+(?:instead\s+|and\s+|(?:simply|just|merely|only)\s+)?([a-z]+ing)\b/.exec(clause);
    if (c && tense && isParticiple(c[2])) {
        // "instead" ends the participle phrase: at the end, or before a comma ("…closer instead, her voice low").
        let rest = clause.slice(c[0].length).replace(/,?\s+instead\s*(?=,|$)/, "");
        if (/\bnot\s+[a-z]+ing\b/.test(rest)) return null; // "and not daring to speak"
        if (!safeToDrop(c[1], rest)) return null;
        const phrase = conjugatePhrase(c[2], rest, tense);
        if (!phrase) return null;
        return cut(subjEnd, end, `${MARK} ${phrase}`, "participle");
    }
    // 5. Alone: only when "S doesn't X." is the whole sentence. A flip (never a delete) also
    // takes "For a moment, she doesn't move." and "…, though she doesn't look away.", and drops
    // emphasis the flip makes pointless ("at all", "for a single second").
    if (!punct || opt.mode === "leave" || /[,;:—–]/.test(clause) || !tense) return null;
    // "But she doesn't pull away." is a whole sentence too: the opener stays with a flip ("But she
    // stays close.") and goes with a delete.
    const opener = SENTENCE_OPENER.exec(before);
    const wholeSentence = (SENTENCE_START.test(before) && /^[A-Z]/.test(subject)) || !!opener;
    if (!wholeSentence && !LEAD_PHRASE.test(before) && !CONTRAST_TAG.test(before)) return null;
    const phrase = clause.trim().toLowerCase().replace(/\s+/g, " ");
    const key = opt.flips.has(phrase) ? phrase : phrase.replace(INTENSIFIER, "");
    const flip = opt.flips.get(key);
    if (flip) {
        // Deal from the plain choices, then conjugate, so "she keeps hold … they keep hold" is
        // seen as one repeat (a deck per conjugated list would not). A choice that doesn't fit
        // this subject ({pos} after a name) gives way to the first one that does.
        const choices = choiceList(flip);
        const dealt = dealFrom(opt.ctx, `flip|${key}`, choices);
        const flipped = conjugateFlip(dealt, tense, subject) || choices.map(f => conjugateFlip(f, tense, subject)).find(Boolean);
        if (flipped) return cut(subjEnd, end, `${MARK} ${flipped}`, "flip");
        return null;
    }
    if (wholeSentence && opt.mode === "flip+delete" && opt.deleteVerbs.has(phrase)) {
        const edit = cut(subjStart, end + punct.length, MARK, "delete");
        if (opener) edit.start = edit.hitStart = subjStart - opener[1].length;
        return edit;
    }
    return null;
}

// 4. "Instead of Xing, S Y" and "S Y instead of Xing." -> edits.
function insteadOfEdits(text, g) {
    const edits = [];
    const lead = /(?<![\p{L}\p{N}])(?:[Ii]nstead of|[Rr]ather than)\s+([a-z]+ing)\b([^,.!?;…~♡\n"“]*),\s+/gu;
    let m;
    while ((m = lead.exec(text))) {
        if (!isParticiple(m[1]) || !CLAUSE_START.test(text.slice(0, m.index))) continue;
        if (!g.ownSubject.test(text.slice(m.index + m[0].length))) continue;
        edits.push({ start: m.index, end: m.index + m[0].length, text: MARK, kind: "instead-of" });
    }
    const tail = /,?\s+(?:instead of|rather than)\s+([a-z]+ing)\b([^,.!?;…~♡\n"“]*)(?=[.!?…~♡]|$)/gu;
    while ((m = tail.exec(text))) {
        if (!isParticiple(m[1])) continue;
        const head = text.slice(0, m.index);
        const clauseStart = Math.max(head.search(/[^.!?…~♡\n,;]*$/), 0);
        if ((head.slice(clauseStart).match(/[\p{L}\p{N}]+/gu) || []).length < 2) continue;
        edits.push({ start: m.index, end: m.index + m[0].length, text: MARK, kind: "instead-of" });
    }
    return edits;
}

export default {
    id: "negation-flip",
    name: "Negated actions",
    description: "She doesn't pull away, pressing closer instead. → She presses closer.  She doesn't let go. → She holds on.",
    scope: "narration",
    order: 100,
    defaults: { enabled: true, mode: "flip+delete", flips: FLIP_TABLE, deleteVerbs: DELETE_VERBS },
    options: [
        {
            key: "mode",
            type: "select",
            label: 'Lone ones ("She doesn\'t let go.")',
            choices: [
                ["flip+delete", "Flip, delete filler"],
                ["flip", "Flip only"],
                ["leave", "Leave them"],
            ],
        },
        { key: "flips", type: "list", label: "Flips (negated = what happens; choices separated by |)", placeholder: "let go = hold on | keep hold | hold tight" },
        { key: "deleteVerbs", type: "list", label: "Deleted when alone", placeholder: "hesitate" },
    ],

    apply(text, ctx) {
        if (!/n['’]t\b|\bnot\b|\binstead of\b|\brather than\b/i.test(text)) return text;
        const g = grammar(ctx.names);
        const opt = {
            ctx,
            mode: ctx.settings?.mode || "flip+delete",
            flips: parseFlips(listOf(ctx.settings?.flips, FLIP_TABLE)),
            deleteVerbs: new Set(listOf(ctx.settings?.deleteVerbs, DELETE_VERBS).map(v => String(v).trim().toLowerCase())),
        };
        const edits = insteadOfEdits(text, g);
        g.candidate.lastIndex = 0;
        let m;
        while ((m = g.candidate.exec(text))) {
            const edit = negatedEdit(text, m, g, opt);
            if (edit) edits.push(edit);
        }
        if (!edits.length) return text;

        // Apply left to right; an edit overlapping an earlier one is skipped.
        edits.sort((a, b) => a.start - b.start || b.end - a.end);
        let out = "";
        let last = 0;
        const hits = [];
        const unmark = s => s.split(MARK).join("").replace(/\s{2,}/g, " ").trim();
        for (const e of edits) {
            if (e.start < last) continue;
            out += text.slice(last, e.start) + e.text;
            last = e.end;
            const hs = e.hitStart ?? e.start;
            const he = e.hitEnd ?? e.end;
            hits.push({ kind: e.kind, before: text.slice(hs, he).trim(), after: unmark(text.slice(hs, e.start) + e.text + text.slice(e.end, he)) });
        }
        return { text: out + text.slice(last), hits };
    },
};
