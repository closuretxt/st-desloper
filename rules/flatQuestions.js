// Flat questions (docs/PLAN.md section 7, item 18). PURE: no SillyTavern imports.
//
// Some models end questions with a period: "What are you doing." This puts the "?" back, only
// when the sentence is built as a question (a question word plus a helper verb, or a helper verb
// plus a subject):
//   "What are you doing."      -> "What are you doing?"
//   "Do you even know her."    -> "Do you even know her?"
// Left alone: "How dare you." / "Who cares." / "Why not." (no helper verb), "What a mess.",
// anything ending in "…" or "...". Some writers mean it as a deadpan line, so this starts off.
// Speech only.

import { sentencesAt, looseOf, LEAD, applyEdits } from "../core/speech.js";

const QUESTION = [
    new RegExp(String.raw`${LEAD}(?:what|why|where|who|when|which|how)(?:\s+the hell|\s+on earth)?\s+(?:are|is|was|were|do|does|did|have|has|had|can|could|would|will|should|am|shall|'s|'re)\b`, "u"),
    new RegExp(String.raw`${LEAD}(?:what's|who's|where's|how's|why's|when's|what're|who're|where're)\b`, "u"),
    new RegExp(String.raw`${LEAD}(?:are|is|do|does|did|can|could|would|will|have|has|was|were|should|shall|aren't|isn't|don't|doesn't|didn't|can't|won't|wouldn't|haven't)\s+(?:you|we|they|i|he|she|it|there)\b`, "u"),
];
// One period at the very end (not "..", "…").
const FLAT_END = /(?<![.…])\.([*_]*)$/;

export function flatQuestions(text) {
    const out = [];
    for (const s of sentencesAt(text)) {
        const t = s.text.trimEnd();
        const end = FLAT_END.exec(t);
        if (!end) continue;
        const l = looseOf(t);
        if (!QUESTION.some(re => re.test(l))) continue;
        const at = s.start + end.index;
        out.push({ start: at, end: at + 1, text: "?", before: t, after: `${t.slice(0, end.index)}?${end[1]}` });
    }
    return out;
}

export default {
    id: "flat-questions",
    name: "Flat questions",
    description: '"What are you doing." → "What are you doing?" (some writers mean it as deadpan, so this starts off)',
    scope: "dialogue",
    order: 330,
    defaults: { enabled: false },
    options: [],

    apply(text, ctx) {
        const found = flatQuestions(text).map(f => ({ ...f, kind: "flat-question", label: "flat question" }));
        return applyEdits(text, found, ctx);
    },
};
