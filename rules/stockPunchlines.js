// Stock punchlines (docs/PLAN.md section 7, item 37). PURE: no SillyTavern imports.
//
// The forced joke a model tacks onto a line, always from the same small set:
//   "That's not in the rulebook. I checked."            -> "That's not in the rulebook."
//   The plan was simple. Mostly.                         -> The plan was simple.
//   "Hurry up. She has a very busy schedule of doing absolutely nothing today." -> "Hurry up."
//   Spoiler alert: it didn't.                            -> It didn't.
// Three parts, each with its own switch:
//   tag      a deadpan tag sentence ("I checked.", "Don't ask.", "Not that I was counting."), only
//            as the last sentence of a quote or paragraph with another sentence before it, so a
//            one-line answer ("Did you lock it?" "I checked.") stays.
//   nothing  the "busy schedule of doing nothing" gag: the whole sentence goes, when the segment
//            has more.
//   aside    "Spoiler alert:" / "Plot twist:" in front of a sentence: only the label goes, what
//            it introduces stays.
// A fresh joke (a new comparison, a one-off quip) can't be told from a real line by code, so it
// stays as written.

import { sentencesAt, looseOf, sentenceEdit, applyEdits, offSet } from "../core/speech.js";

const TAGS = [
    String.raw`i (?:checked|counted|asked|timed it|looked it up|looked|did the math|tried|have notes|made a chart)`,
    String.raw`i(?:'ve| have) (?:checked|counted|asked|looked it up|done the math|tried|seen it)`,
    String.raw`(?:twice|three times|several times|repeatedly)`,
    String.raw`(?:don't|do not) ask(?: (?:me )?(?:how i know|why|how))?`,
    String.raw`ask me how i know`,
    String.raw`(?:it's |it is )?(?:a )?long story`,
    String.raw`not that (?:i was|i'm|i am|anyone was|anyone's|anyone is) (?:counting|keeping count|keeping track|complaining)`,
    String.raw`not that anyone asked`,
    String.raw`i(?:'d| would) know`,
    String.raw`(?:yes|yeah),? really`,
    String.raw`(?:mostly|probably|allegedly|supposedly|in theory|theoretically|technically)`,
    String.raw`true story`,
    String.raw`(?:you're|you are) welcome`,
    String.raw`no further questions`,
    String.raw`ask anyone`,
];
const TAG_RE = new RegExp(String.raw`^(?:${TAGS.join("|")})[.!…~]*$`, "u");

const BUSY = String.raw`(?:busy|packed|full|demanding|grueling|gruelling|hectic|important|exhausting|tight|jam-packed|rigorous|strenuous)`;
const SLOT = String.raw`(?:schedule|day|afternoon|morning|evening|night|agenda|calendar|week|itinerary|business|work|job|plans?|routine|career)`;
const NOTHING_RE = new RegExp(String.raw`\b${BUSY}\s+${SLOT}\s+(?:of|full of)\s+(?:doing\s+|being\s+)?(?:absolutely\s+|precisely\s+|exactly\s+|literally\s+|a\s+whole\s+lot\s+of\s+|a\s+lot\s+of\s+)?nothing\b`, "u");

// The label as written, after any italic marks: "Spoiler alert: it didn't." -> "It didn't."
const ASIDE_RE = /^([*_]*)((?:spoiler(?:\s+alert)?|plot\s+twist|fun\s+fact|news\s+flash|newsflash)\s*[:,—–-]\s*)(\p{L})/iu;

export const ENTRIES = [
    { id: "tag", label: 'Deadpan tags ("I checked.")', example: '"That\'s not in the rulebook. I checked." → "That\'s not in the rulebook."  Also "Don\'t ask.", "Twice.", "Mostly.", "Not that I was counting."' },
    { id: "nothing", label: 'Busy doing nothing', example: '"Hurry. She has a very busy schedule of doing absolutely nothing." → "Hurry."' },
    { id: "aside", label: 'Joke labels ("Spoiler alert:")', example: "Spoiler alert: it didn't. → It didn't.  Also \"Plot twist:\", \"Fun fact:\"." },
];
const LABEL = Object.fromEntries(ENTRIES.map(e => [e.id, e.label]));

export default {
    id: "stock-punchlines",
    name: "Stock punchlines",
    description: '"That\'s not in the rulebook. I checked." → "That\'s not in the rulebook."  Also "Don\'t ask.", "a busy schedule of doing nothing", "Spoiler alert:".',
    scope: "all",
    order: 155,
    defaults: { enabled: true, off: [] },
    options: [{ key: "off", type: "phrases", label: "Punchlines (switch one off to leave it as written)" }],
    entries: ENTRIES,

    apply(text, ctx) {
        if (!ctx.segment) return text;
        const off = offSet(ctx.settings?.off);
        const sents = sentencesAt(text);
        if (!sents.length) return text;
        const edits = [];
        const gone = new Set();

        // The tag: the last sentence, with another before it.
        if (!off.has("tag") && sents.length > 1) {
            const last = sents[sents.length - 1];
            if (TAG_RE.test(looseOf(last.text))) {
                // From the end of the sentence before, so no stray space is left at the end.
                const prev = sents[sents.length - 2];
                edits.push({ start: prev.end, end: last.end + last.space.length, text: "", before: last.text.trim(), kind: "punchline", label: LABEL.tag });
                gone.add(last);
            }
        }
        if (!off.has("nothing") && sents.length > 1) {
            for (const s of sents) {
                if (gone.has(s) || !NOTHING_RE.test(looseOf(s.text))) continue;
                edits.push(sentenceEdit(s, { kind: "punchline", label: LABEL.nothing }));
                gone.add(s);
            }
        }
        if (!off.has("aside")) {
            for (const s of sents) {
                if (gone.has(s)) continue;
                const m = ASIDE_RE.exec(s.text);
                if (!m || s.text.length - m[0].length < 3) continue;
                const at = s.start + m[1].length;
                edits.push({ start: at, end: at + m[2].length + 1, text: m[3].toUpperCase(), before: s.text.trim(), kind: "punchline", label: LABEL.aside });
            }
        }
        return applyEdits(text, edits, ctx);
    },
};
