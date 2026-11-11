// Three in a row (docs/PLAN.md section 7, item 32). PURE: no SillyTavern imports.
//
// Three or more short sentences that repeat the same opening, for rhythm:
//   It was a plea. It was a promise. It was a prayer.  -> It was a plea, a promise, a prayer.
//   She looked at him. She looked at the door. She looked at the floor.
//                                                      -> She looked at him, the door, the floor.
// The words all stay; only the repeated opening goes, so the list reads as one sentence instead
// of a drum roll. A switch picks "a, b, c" (default) or "a, b and c".
// Only when the merge can't break the grammar: the shared opening ends on a linking word ("was",
// "felt", "looked at"…) or every rest starts with "a / the / her…"; each rest is 1-6 words with no
// verb of its own ("She knew the answer. She knew the way. She knew the guards would come." stays),
// all in one paragraph, plain statements ending in a full stop. Only narration.

import { MARK } from "../core/marks.js";
import { sentencesAt, hasPlaceholder } from "../core/speech.js";

const DETERMINER = new Set(["a", "an", "the", "her", "his", "their", "my", "your", "our", "its", "some", "this", "that", "every", "each", "no"]);
const LINKER = new Set([
    "was", "is", "were", "are", "felt", "feels", "feel", "seemed", "seems", "looked", "looks", "became", "becomes", "sounded", "sounds",
    "tasted", "tastes", "smelled", "smells", "at", "of", "like", "for", "to", "with", "about", "into", "toward", "towards", "on", "in", "from",
]);
// A rest with one of these has a verb of its own: the merge would read as broken grammar.
const CLAUSE_WORD = /^(?:would|could|should|will|shall|can|may|might|must|was|were|is|are|am|had|has|have|did|does|do|didn['’]t|wasn['’]t|isn['’]t|couldn['’]t|wouldn['’]t|she|he|they|i|we|it|you|that|which|who|and|but|or|because|when|if)$/i;
const MAX_REST = 6;

const words = s => s.split(/\s+/).filter(Boolean);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// A sentence as the merge sees it, or null: plain words, ends in ".".
function parse(s, i, last) {
    let t = s.text;
    const lead = /^[*_]*/.exec(t)[0];
    const tail = /[*_]*$/.exec(t)[0];
    t = t.slice(lead.length, t.length - tail.length);
    if ((lead && i !== 0) || (tail && !last)) return null;
    if (!/^[^.!?…]+\.$/.test(t) || /[,;:"“”()\[\]—–*_]/.test(t) || hasPlaceholder(t)) return null;
    return { lead, tail, body: t.slice(0, -1), w: words(t.slice(0, -1)) };
}

// The runs in one narration segment: [{ start, end, text }] edits.
export function runsIn(text, join = "commas") {
    const sents = sentencesAt(text);
    const edits = [];
    let i = 0;
    while (i < sents.length - 2) {
        const a = parse(sents[i], 0, false);
        const b = parse(sents[i + 1], 1, false);
        if (!a || !b || /\n/.test(sents[i].space)) {
            i++;
            continue;
        }
        // The shared opening of the first two.
        let n = 0;
        while (n < a.w.length - 1 && n < b.w.length - 1 && same(a.w[n], b.w[n])) n++;
        // Back off "a / the / her" so each rest keeps its own ("a plea, a promise").
        while (n > 0 && DETERMINER.has(a.w[n - 1].toLowerCase())) n--;
        if (n < 2) {
            i++;
            continue;
        }
        // Extend the run while the next sentence starts the same way.
        const run = [a, b];
        let j = i + 2;
        while (j < sents.length && !/\n/.test(sents[j - 1].space)) {
            const p = parse(sents[j], 1, true);
            if (!p || p.w.length <= n || !a.w.slice(0, n).every((x, k) => same(x, p.w[k]))) break;
            run.push(p);
            j++;
        }
        const rests = run.map(r => r.w.slice(n));
        const linker = LINKER.has(a.w[n - 1].toLowerCase());
        const ok =
            run.length >= 3 &&
            rests.every(r => r.length >= 1 && r.length <= MAX_REST && !r.some(x => CLAUSE_WORD.test(x))) &&
            new Set(rests.map(r => r.join(" ").toLowerCase())).size === rests.length &&
            (linker || rests.every(r => DETERMINER.has(r[0].toLowerCase())));
        if (!ok) {
            i++;
            continue;
        }
        // The last sentence may close an italic: its tail marks stay outside the edit.
        const lastS = sents[j - 1];
        const lastP = parse(lastS, 1, true);
        const start = sents[i].start + a.lead.length;
        const end = lastS.end - lastP.tail.length;
        const parts = rests.map(r => r.join(" "));
        const list = join === "and" ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join(", ");
        const rep = `${a.w.slice(0, n).join(" ")} ${list}.`;
        edits.push({ start, end, text: rep, before: text.slice(start, end) });
        i = j;
    }
    return edits;
}

export default {
    id: "three-in-a-row",
    name: "Three in a row",
    description: "It was a plea. It was a promise. It was a prayer. → It was a plea, a promise, a prayer.",
    scope: "narration",
    order: 240,
    defaults: { enabled: true, join: "commas" },
    options: [
        {
            key: "join",
            type: "select",
            label: "Join the list as",
            choices: [
                ["commas", "a plea, a promise, a prayer"],
                ["and", "a plea, a promise and a prayer"],
            ],
        },
    ],

    apply(text, ctx) {
        const edits = runsIn(text, ctx.settings?.join === "and" ? "and" : "commas");
        if (!edits.length) return text;
        let out = text;
        const hits = [];
        for (const e of [...edits].reverse()) {
            out = out.slice(0, e.start) + MARK + e.text + out.slice(e.end);
            hits.unshift({ kind: "three-in-a-row", label: "three in a row", before: e.before.trim(), after: e.text });
        }
        return { text: out, hits };
    },
};
