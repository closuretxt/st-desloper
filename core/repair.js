// The shared repair step (docs/PLAN.md section 1b). PURE: no SillyTavern imports.
//
// Runs after every rule that changed something. It only works where the rule left an edit
// marker (core/marks.js), so the author's own text elsewhere is never "fixed":
//   1. dialogue left empty: the quote goes and its attribution is fixed to match
//        "Tsk," she says, turning away.  -> She turns away.
//        "Tsk," she mutters.             -> (removed)
//        "Tsk," she sighs.               -> She sighs.        (a sound keeps its meaning)
//   2. dialogue whose ending changed: the right comma / period before the closing quote
//   3. around every marker: spaces, leftover punctuation (", ." ";," ".." "~."), a capital at a
//      new sentence start, a line or paragraph that ended up empty.
// When it can't be sure the result reads right it gives up ({ ok: false }) and the pipeline
// drops that rule's change for the message. A missed tic is better than a broken sentence.

import { MARK, hasMark, stripMarks } from "./marks.js";
import { joinSegments } from "./segments.js";
import { conjugateParticiple, speechVerbIndex, isSpeechParticiple } from "../lang/conjugate.js";
import { NOT_PARTICIPLES, SUBJECT_PRONOUNS, POSSESSIVES, DETERMINERS } from "../lang/words.js";

const TERM = "[.!?…~♡]";
const CLOSE = "[\"”’»」』*_)\\]]";
// After a quote ending in one of these, the words that follow belong to the same sentence.
const CONTINUES_AFTER = [",", "—", "–", "-"];
const PRONOUN_START = /^(?:[Ss]he|[Hh]e|[Tt]hey|I|[Yy]ou|[Ww]e|[Ii]t)\b/;

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let verbIndex = null;
function speechVerbs() {
    verbIndex ??= speechVerbIndex();
    return verbIndex;
}

// Patterns for "subject + speech verb", built once per set of character names.
const grammarCache = new Map();
function grammar(names) {
    const clean = [...new Set((names || []).filter(n => typeof n === "string" && n.trim()).map(n => n.trim()))];
    const key = clean.join("\u0001");
    if (grammarCache.has(key)) return grammarCache.get(key);
    const nameAlts = clean.sort((a, b) => b.length - a.length).map(escapeRe);
    const named = nameAlts.length ? `${nameAlts.join("|")}|` : "";
    const subj = `(?:${named}[Ss]he|[Hh]e|[Tt]hey|[Ii]t|I|[Yy]ou|[Ww]e|(?:[Tt]he|[Aa]n?|[Hh]er|[Hh]is|[Tt]heir|[Mm]y|[Yy]our|[Oo]ur)\\s+[a-z]+(?:\\s+[a-z]+)?|[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)`;
    const forms = [...speechVerbs().keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
    const verb = `(?:${forms})`;
    const obj = `(?:${named}him|her|them|me|you|us|it|herself|himself|themselves|myself|yourself)`;
    // What may sit between the speech verb and the rest without carrying meaning of its own.
    const adv = `(?:\\s+[a-z]+ly)?(?:\\s+(?:to\\s+)?${obj}\\b)?(?:\\s+(?:[a-z]+ly|again|under\\s+(?:her|his|their|my|your|our)\\s+breath))?`;
    const invSubj = `(?:${named}[A-Z][a-z]+|the\\s+[a-z]+|she|he)`;
    const g = {
        subj,
        verb,
        adv,
        speechRe: new RegExp(`^(${subj})\\s+(${verb})\\b${adv}`),
        invertedRe: new RegExp(`^(${verb})\\s+(${invSubj})\\b${adv}`),
        actionRe: new RegExp(`^${subj}\\s+[a-z]+`),
        nameRe: nameAlts.length ? new RegExp(`^(?:${nameAlts.join("|")})\\b`) : null,
    };
    grammarCache.set(key, g);
    return g;
}

function startsWithSubject(clause, g) {
    const word = (clause.match(/^([A-Za-z']+)/) || [])[1];
    if (!word) return false;
    const lw = word.toLowerCase();
    if (SUBJECT_PRONOUNS.includes(lw) || POSSESSIVES.includes(lw) || DETERMINERS.includes(lw)) return true;
    if (g.nameRe?.test(clause)) return true;
    return /^[A-Z]/.test(word);
}

function isEmptyInner(text) {
    return stripMarks(text).replace(/[\s.,!?;:…~♡—–\-*_]/g, "") === "";
}

// An odd number of asterisks in a removed stretch means an italic was opened or closed there.
function starFix(removed) {
    return (removed.match(/\*/g) || []).length % 2 ? "*" : "";
}

// ---- 1. Dialogue left empty --------------------------------------------------------------

// The attribution after an emptied quote ("Tsk," she says, turning away.) -> its new text,
// null if what follows isn't an attribution (a new sentence), or { fail }.
function rewriteAfter(text, origEnd, g, followingSeg) {
    const lead = text.match(/^[ \t]*/)[0];
    let body = text.slice(lead.length);
    let star = "";
    if (/^\*(?!\*)/.test(body)) {
        star = "*";
        body = body.slice(1);
    }
    const speech = g.speechRe.exec(body);
    const inverted = speech ? null : g.invertedRe.exec(body);
    const lower = /^[a-z]/.test(body);
    const afterComma = !!origEnd && CONTINUES_AFTER.includes(origEnd);
    // "Deal?" Seraphina asks. -> attribution; "Deal?" She sighs. -> a new sentence.
    const namedAfterQuestion = /[?!~…]/.test(origEnd || "") && (speech || inverted) && !PRONOUN_START.test(body);
    if (!lower && !afterComma && !namedAfterQuestion) return null;

    const found = speech || inverted;
    if (found) {
        const subj = speech ? speech[1] : inverted[2];
        const verb = (speech ? speech[2] : inverted[1]).toLowerCase();
        const tense = speechVerbs().get(verb)?.tense;
        if (!tense) return { fail: `unknown speech verb "${verb}"` };
        return finishAttribution({ lead, star, body, subj, tense, rest: body.slice(found[0].length), followingSeg, g });
    }
    // Not a speech verb: an action of its own ("she smirks", "she sighs, turning away"). Keep it.
    if (g.actionRe.test(body)) return { text: lead + MARK + star + body };
    return { fail: "the words after the removed quote lean on it" };
}

function finishAttribution({ lead, star, body, subj, tense, rest, followingSeg, g }) {
    // a) The attribution is its whole sentence: it goes. "Tsk," she mutters. -> (removed)
    let m = /^[ \t]*[.!?…~♡]+(\*?)/.exec(rest);
    if (m) {
        let after = rest.slice(m[0].length);
        if (star && !m[1]) after = `*${after.replace(/^[ \t]+/, "")}`; // the italic goes on
        return { text: lead + MARK + after };
    }
    // b) A participle action: keep it as the sentence. ", turning away." -> She turns away.
    m = /^,[ \t]*([a-z]+ing)\b/.exec(rest);
    if (m) {
        const phraseAll = rest.slice(m[0].length - m[1].length);
        const end = /^(.*?)([.!?…~♡]+)(\*?)(?=[\s"”’»」』)]|$)/.exec(phraseAll);
        if (!end) return { fail: "the action after the attribution doesn't end in this sentence" };
        const first = conjugateParticiple(m[1], tense);
        if (!first) return { fail: `can't conjugate "${m[1]}"` };
        let bad = null;
        const phrase = (first + end[1].slice(m[1].length)).replace(/\b(and|or)(\s+)([a-z]+ing)\b/g, (all, conj, sp, w) => {
            if (NOT_PARTICIPLES.has(w)) return all;
            const c = conjugateParticiple(w, tense);
            if (!c) bad = w;
            return c ? conj + sp + c : all;
        });
        if (bad) return { fail: `can't conjugate "${bad}"` };
        const after = phraseAll.slice(end[0].length);
        return { text: `${lead}${MARK}${star}${subj} ${phrase}${end[2]}${end[3]}${after}` };
    }
    // c) "and"/"then" + its own clause. ", and her hand tightens" -> Her hand tightens.
    m = /^,?[ \t]+(?:and(?:[ \t]+then)?|then)[ \t]+/.exec(rest);
    if (m) {
        const clause = rest.slice(m[0].length);
        if (!/^[A-Za-z]/.test(clause)) return { fail: "nothing usable after and/then" };
        if (startsWithSubject(clause, g)) return { text: lead + MARK + star + clause };
        return { text: `${lead}${MARK}${star}${subj} ${clause}` };
    }
    // d) The attribution leads into the next quote: keep it. she mutters, "you're late." ->
    //    She mutters, "You're late."
    if (/^,[ \t]*$/.test(rest) && followingSeg?.type === "dialogue") {
        return { text: lead + MARK + star + body, markNextDialogue: true };
    }
    return { fail: "the attribution has more to it than a speech verb" };
}

// The narration leading into an emptied quote (She mutters, "Tsk.") -> its new text, or { fail }.
function rewriteBefore(text, g) {
    const tail = "[ \\t]*[,:]\\*?[ \\t]*$";
    // The whole last sentence is "subject + speech verb,": it goes.
    let m = new RegExp(`(^|${TERM}${CLOSE}*[ \\t]+|\\n[ \\t]*)(\\*?)(?:${g.subj})\\s+(?:${g.verb})\\b${g.adv}${tail}`).exec(text);
    if (m) return { text: text.slice(0, m.index + m[1].length) + MARK };
    // "She turns away and mutters," -> She turns away.
    m = new RegExp(`([a-z])(,?\\s+and\\s+(?:${g.verb})\\b${g.adv}${tail})`).exec(text);
    if (m) return { text: `${text.slice(0, m.index + 1)}.${starFix(m[2])}${MARK}` };
    // "She turns away, muttering," -> She turns away.
    m = new RegExp(`([a-z])(,\\s+([a-z]+ing)${g.adv}${tail})`).exec(text);
    if (m && isSpeechParticiple(m[3])) return { text: `${text.slice(0, m.index + 1)}.${starFix(m[2])}${MARK}` };
    // Any other clause leading into the quote just ends there: "She sighs," -> She sighs.
    m = /([^\s,:])([ \t]*[,:](\*?)[ \t]*)$/.exec(text);
    const last = text.split(/[.!?…~♡]["”’»」』*_)\]]*\s+/).pop();
    if (m && last.trim().split(/\s+/).length >= 3) return { text: `${text.slice(0, m.index + 1)}.${m[3]}${MARK}` };
    return { fail: "the narration leading into the removed quote can't be ended cleanly" };
}

function removeEmptyDialogue(segs, i, before, g) {
    const origEnd = stripMarks(before[i].text).replace(/[\s*_]+$/, "").slice(-1);
    const next = segs[i + 1];
    const prev = segs[i - 1];
    segs[i] = { ...segs[i], text: MARK, open: "", close: "" };
    if (next && next.type === "narration" && /^[ \t]*\S/.test(next.text)) {
        const r = rewriteAfter(next.text, origEnd, g, segs[i + 2]);
        if (r) {
            if (r.fail) return { ok: false, reason: r.fail };
            segs[i + 1] = { ...next, text: r.text };
            if (r.markNextDialogue) segs[i + 2] = { ...segs[i + 2], text: MARK + segs[i + 2].text };
            return { ok: true };
        }
    }
    if (prev && prev.type === "narration" && /[,:]\*?[ \t]*$/.test(prev.text)) {
        const r = rewriteBefore(prev.text, g);
        if (r.fail) return { ok: false, reason: r.fail };
        segs[i - 1] = { ...prev, text: r.text };
    }
    return { ok: true };
}

// ---- 2. Dialogue whose ending changed ----------------------------------------------------

// Verbs that only fit a question. When the question is gone, they become "say" in the same tense.
const QUESTION_VERBS = new Set(["ask", "inquire", "query"]);
const SAY = { base: "say", third: "says", past: "said" };

// "Ten coins. Deal?" she asks, holding out her hand. -> "Ten coins," she says, holding out her hand.
function fixQuestionVerb(segs, k, g) {
    const seg = segs[k];
    const lead = seg.text.match(/^[ \t]*\*?/)[0];
    const body = seg.text.slice(lead.length);
    const speech = g.speechRe.exec(body);
    const inverted = speech ? null : g.invertedRe.exec(body);
    if (!speech && !inverted) return;
    const verb = speech ? speech[2] : inverted[1];
    const info = speechVerbs().get(verb.toLowerCase());
    if (!info || !QUESTION_VERBS.has(info.base)) return;
    const at = lead.length + (speech ? speech[0].indexOf(verb, speech[1].length) : 0);
    segs[k] = { ...seg, text: seg.text.slice(0, at) + SAY[info.tense] + seg.text.slice(at + verb.length) };
}

// "Ten coins, deal?" -> "Ten coins," -> "Ten coins."   "Ten coins. Deal?" she says. -> "Ten coins," she says.
function fixDialogueEnding(segs, i, g) {
    const s = segs[i];
    const m = /[^\p{L}\p{N}]*$/u.exec(s.text);
    if (!hasMark(m[0])) return;
    const core = s.text.slice(0, m.index);
    if (!core) return;
    const punct = stripMarks(m[0]).trim();
    if (!["", ",", "."].includes(punct)) return;
    const next = segs[i + 1];
    const sameLine = next && next.type === "narration" && /^[ \t]*\S/.test(next.text);
    const body = sameLine ? next.text.replace(/^[ \t]*\*?/, "") : "";
    const speech = sameLine && (g.speechRe.test(body) || g.invertedRe.test(body));
    const attributed = sameLine && (/^[a-z]/.test(body) || (speech && !PRONOUN_START.test(body)));
    let want = null;
    if (punct === "") want = attributed ? "," : ".";
    else if (punct === "," && !attributed) want = ".";
    // A lowercase tag after the quote ('"Sit." she smirks') always takes a comma; a capital one
    // only when it's a speech tag ('"Sit." Seraphina says' vs '"Sit." She sighs.').
    else if (punct === "." && attributed && (speech || /^[a-z]/.test(body))) want = ",";
    if (want !== null) segs[i] = { ...s, text: core + want + MARK };
    // The quote no longer ends in "?" (it ends in "," or "."), so "she asks" can't stay.
    if (attributed) fixQuestionVerb(segs, i + 1, g);
}

// ---- 3. Around every marker --------------------------------------------------------------

function isSentenceStart(before, after) {
    if (/(^|\n)[ \t*_]*$/.test(before)) return true;
    if (/[“「『]$/.test(before)) return true;
    if (/(^|[\s(*—–])"$/.test(before)) return true;
    if (/[.!?…~♡]["”’»」』)\]*_]*[ \t]+[*_]*$/.test(before)) return true;
    return /[.!?…~♡]["”’»」』)\]*_]*$/.test(before) && /^[ \t]/.test(after);
}

// Calls fn(before, after) at each marker group; fn may return a new `after`.
function atEachMark(t, fn) {
    const parts = t.split(/(+)/);
    let before = "";
    for (let k = 0; k < parts.length; k++) {
        if (k % 2 === 0) {
            before += parts[k];
            continue;
        }
        const res = fn(before, parts[k + 1] ?? "");
        if (res !== undefined) parts[k + 1] = res;
    }
    return parts.join("");
}

function cleanOnce(t) {
    // Spaces around a marker collapse to one (kept after it, so a later step can drop it).
    t = t.replace(/[ \t]*(+)[ \t]*/g, (m, marks) => marks + (m.length > marks.length ? " " : ""));
    t = t.replace(/(^|\n)(+) /g, "$1$2");
    t = t.replace(/(+) +(?=\n|$)/g, "$1");
    // ...and none right after a line start, an opening asterisk or an opening quote.
    t = atEachMark(t, (before, after) =>
        /(^|\n)[ \t]*[*_]*$|[“「『]$|(^|[\s(*—–])"$/.test(before) ? after.replace(/^[ \t]+/, "") : undefined,
    );
    // A line or paragraph that ended up empty.
    t = t.replace(/(\n+)(+)(\n+)/g, (m, a, marks, b) => "\n".repeat(Math.max(a.length, b.length)) + marks);
    t = t.replace(/^\s+(+)/, "$1").replace(/^(+)\s+/, "$1");
    t = t.replace(/(+)\s+$/, "$1").replace(/\s+(+)$/, "$1");
    // Wrappers left empty: ** and ().
    t = t.replace(/(\*{1,3}|_{1,2})(+)\1/g, "$2").replace(/\((+)\)/g, "$1");
    // Punctuation left at a new sentence start: "Tsk. You're" -> ". You're" -> "You're".
    // When a whole sentence went ("crackles. A smile. She" -> "crackles.. She"), the space after
    // the period before it stays: "crackles. She", not "crackles.She".
    t = atEachMark(t, (before, after) => {
        if (!isSentenceStart(before, after)) return undefined;
        const m = /^[ \t]*(?:[,;:]|[.!?…~♡]+|[—–])[ \t]*/.exec(after);
        if (!m) return undefined;
        const rest = after.slice(m[0].length);
        const keepSpace = /[.!?…~♡]["”’»」』)\]*_]*$/.test(before) && /[ \t]/.test(m[0]) && /^[^\s]/.test(rest);
        return (keepSpace ? " " : "") + rest;
    });
    // No space before punctuation or a closing quote.
    t = t.replace(/(+) +(?=[,.;:!?…~♡)\]]|[”’»」』]|"(?=[\s.,!?;:~…*)\]]|$))/g, "$1");
    // Leftover punctuation pairs.
    t = t.replace(/[,;:](+)(?=[.!?…~♡])/g, "$1"); // ", ." -> "."
    t = t.replace(/,(+)(?=[,;:])/g, "$1"); // ",," ",;" -> keep the second
    t = t.replace(/([;:])(+),/g, "$1$2"); // ";," -> ";"
    t = t.replace(/([~!?♡])(+)\.(?!\.)/g, "$1$2"); // "Aah~." -> "Aah~"
    t = t.replace(/(^|[^.])\.(+)\.(?!\.)/g, "$1.$2"); // ".." -> "." (not an ellipsis)
    // A capital at a new sentence start.
    t = atEachMark(t, (before, after) =>
        isSentenceStart(before, after) ? after.replace(/^([ \t*_]*)(\p{Ll})/u, (m, a, c) => a + c.toUpperCase()) : undefined,
    );
    // A comma left at the end of a line becomes a period.
    t = t.replace(/,(+)(?=[ \t]*(?:\n|$))/g, ".$1");
    return t;
}

export function cleanAroundMarks(text) {
    let t = text;
    for (let n = 0; n < 6; n++) {
        const next = cleanOnce(t);
        if (next === t) break;
        t = next;
    }
    return t;
}

// ---- Entry point -------------------------------------------------------------------------

// segments: after the rule (with markers); before: the same segments before the rule.
// -> { ok: true, text } (markers removed) or { ok: false, reason }.
export function repair(segments, before, ctx = {}) {
    try {
        if (!Array.isArray(segments) || !Array.isArray(before) || segments.length !== before.length) {
            return { ok: false, reason: "segments out of step" };
        }
        const g = grammar(ctx.names);
        const segs = segments.map(s => ({ ...s }));
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            if (s.type !== "dialogue" || !s.open || !hasMark(s.text)) continue;
            if (isEmptyInner(s.text)) {
                const r = removeEmptyDialogue(segs, i, before, g);
                if (!r.ok) return r;
            } else {
                fixDialogueEnding(segs, i, g);
            }
        }
        return { ok: true, text: stripMarks(cleanAroundMarks(joinSegments(segs))) };
    } catch (e) {
        return { ok: false, reason: `repair error: ${e.message}` };
    }
}
