// "Tsk" -> a sigh (docs/PLAN.md section 6). Tsk becomes a sigh; a tongue click is cringe.
// PURE: no SillyTavern imports.
//
//   As an interjection (opening a sentence, or tagged on after a comma):
//     "Tsk. You're late."   -> "Haah… You're late."     (the next word starts a new sentence)
//     "Tsk," she says.      -> "Haah…" she says.        ("Haah…" never gets a "," or "." after it)
//     "Late again, tsk."    -> "Late again, haah…"
//   As a word (verb or noun), in narration or speech:
//     She tsks.             -> She sighs.
//     She tsked softly.     -> She sighed softly.
//     with a soft tsk       -> with a soft sigh
//     "Don't tsk at me."    -> "Don't sigh at me."
// Mode "remove" drops the interjection instead and leaves the rest to the shared repair step;
// the word forms still become the sigh word (removing a verb would break the sentence).
// Both the sigh text and the narration word are choice lists ("Haah… | Hmph. | Ugh."), dealt
// per message (core/seed.js dealFrom): one fixed sigh would just become the next tic (PLAN 1b).

import { MARK } from "../core/marks.js";
import { dealFrom, choiceList } from "../core/seed.js";
import { toThird, toPast } from "../lang/conjugate.js";

// Narration words must work as a verb and a noun: "She huffs." / "with a soft huff".
const DEFAULT_SIGHS = ["Haah…", "Hah…", "Hmph.", "Ugh."];
const DEFAULT_WORDS = ["sigh", "huff", "scoff", "snort"];

const TSK = "[Tt]s+k+";
// One Tsk, a run of them ("Tsk, tsk", "Tsk-tsk", "Tsk tsk tsk", "Tsk. Tsk"), and an optional
// verb ending (tsks, tsked, tsk'd, tsking).
const TSK_RE = new RegExp(
    `(?<![\\p{L}\\p{N}'’\\-])(${TSK}(?:[ \\t]*[,.\\-–—]?[ \\t]*${TSK})*)(s|ed|['’]d|ing)?(?![\\p{L}\\p{N}'’\\-])`,
    "gu",
);
const TERMINAL_END = /[.!?…~♡]$/;
// Punctuation an interjection takes with it when the replacement brings its own ("Tsk." -> "Haah…").
const TRAILING_PUNCT = /^[ \t]*[,.!?;:…~♡—–-]+/;
const STOP_AFTER = /^[ \t]*(?:[,.!?;:…~♡—–-]|\n|$)/;

function atSentenceStart(before) {
    return /^[ \t*_(]*$/.test(before) || /(?:[.!?…~♡]["”’»」』)\]*_]*[ \t]+|\n[ \t]*|[—–][ \t]*)[*_(]*$/.test(before);
}

function toIng(base) {
    if (/ie$/.test(base)) return `${base.slice(0, -2)}ying`;
    if (/[^aeiou]e$/.test(base) && !/ee$/.test(base)) return `${base.slice(0, -1)}ing`;
    return `${base}ing`;
}

function wordForm(word, suffix) {
    if (!suffix) return word;
    if (suffix === "s") return toThird(word);
    if (suffix === "ing") return toIng(word);
    return toPast(word) || `${word}ed`;
}

function matchCase(original, word) {
    return /^[A-Z]/.test(original) ? word[0].toUpperCase() + word.slice(1) : word;
}

function readSettings(s) {
    // Not set -> the built-in lists; set but empty -> remove (the old "clear the box" meaning).
    const replacements = s?.replacement === undefined ? DEFAULT_SIGHS : choiceList(s.replacement);
    // Each word one plain word, or its forms can't be built; nothing usable -> the built-in list.
    const words = choiceList(s?.narrationWord).map(w => w.toLowerCase()).filter(w => /^[a-z]+$/.test(w));
    return {
        remove: s?.mode === "remove" || !replacements.length,
        replacements,
        words: words.length ? words : DEFAULT_WORDS,
    };
}

export default {
    id: "tsk",
    name: "Tsk → sigh",
    description: '"Tsk. You\'re late." → "Haah… You\'re late." / "Hmph. You\'re late."  She tsks. → She sighs / huffs / scoffs.',
    scope: "all",
    order: 210,
    defaults: { enabled: true, mode: "replace", replacement: DEFAULT_SIGHS.join(" | "), narrationWord: DEFAULT_WORDS.join(" | ") },
    options: [
        {
            key: "mode",
            type: "select",
            label: "Tsk in speech",
            choices: [
                ["replace", "Replace"],
                ["remove", "Remove"],
            ],
        },
        { key: "replacement", type: "text", label: "Sigh text (choices separated by |)", placeholder: DEFAULT_SIGHS.join(" | ") },
        { key: "narrationWord", type: "text", label: "Word in narration (choices separated by |)", placeholder: DEFAULT_WORDS.join(" | ") },
    ],

    apply(text, ctx) {
        if (!/[Tt]s+k/.test(text)) return text;
        const opt = readSettings(ctx.settings);
        const dialogue = ctx.segment?.type === "dialogue";
        const hits = [];
        let out = "";
        let last = 0;
        TSK_RE.lastIndex = 0;
        let m;
        while ((m = TSK_RE.exec(text))) {
            const [all, run, suffix] = m;
            const before = text.slice(0, m.index);
            const afterAt = m.index + all.length;
            const after = text.slice(afterAt);
            const start = atSentenceStart(before);
            // An interjection opens a sentence ("Tsk, you're late"), or in speech is tagged on
            // after a comma ("Late again, tsk."). In narration only a capitalized "Tsk" followed
            // by punctuation counts: a lowercase one is the verb or the noun ("she tsks").
            const interjection =
                !suffix &&
                (dialogue
                    ? start || (/,[ \t]*$/.test(before) && STOP_AFTER.test(after))
                    : start && /^T/.test(run) && STOP_AFTER.test(after));

            if (!interjection) {
                const word = matchCase(run, wordForm(dealFrom(ctx, "word", opt.words), suffix));
                out += text.slice(last, m.index) + word + MARK;
                last = afterAt;
                hits.push({ before: all, after: word });
                continue;
            }
            if (opt.remove) {
                out += text.slice(last, m.index) + MARK;
                last = afterAt;
                hits.push({ before: all, after: "" });
                continue;
            }
            let repl = dealFrom(ctx, "sigh", opt.replacements);
            if (!start && /^[a-z]/.test(run)) repl = repl[0].toLowerCase() + repl.slice(1);
            if (TERMINAL_END.test(repl)) {
                // The replacement ends the sentence itself, so it takes the punctuation after
                // Tsk with it. When it opened the sentence, what follows starts a new one (the
                // marker after it lets the repair step give that word a capital).
                const punct = (after.match(TRAILING_PUNCT) || [""])[0];
                const rest = after.slice(punct.length);
                const space = /^[\p{L}\p{N}"“]/u.test(rest) ? " " : "";
                out += start ? `${text.slice(last, m.index)}${repl}${MARK}${space}` : `${text.slice(last, m.index)}${MARK}${repl}${space}`;
                last = afterAt + punct.length;
            } else {
                out += `${text.slice(last, m.index)}${MARK}${repl}${MARK}`;
                last = afterAt;
            }
            hits.push({ before: all, after: repl });
        }
        if (!hits.length) return text;
        return { text: out + text.slice(last), hits };
    },
};
