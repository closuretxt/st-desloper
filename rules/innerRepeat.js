// In-message repeats (docs/PLAN.md section 7, item 5). PURE: no SillyTavern imports.
//
// The same sentence twice in one reply: the later copy goes, the first stays.
//   Her eyes soften as she listens. The fire crackles. Her eyes soften as she listens.
//       -> Her eyes soften as she listens. The fire crackles.
// Same means the same words in the same order (case, punctuation and italics don't count).
// A sentence that only shares part of its words with an earlier one stays: cutting the shared
// part leaves a broken sentence, and rewording it would need real grammar (the stats still
// show it as "Repeat inside one reply").
// Never touched:
//   - short sentences (under 5 words by default): "She nods." twice can be two separate nods;
//   - dialogue, unless the option is on ("No. No. No.", a chant, a refrain are on purpose), and
//     a narration sentence is never matched against a line of dialogue or the other way round;
//   - a sentence that isn't whole on its own: one that starts lowercase (" she says, smiling.")
//     or doesn't end in . ! ? … (one leading into a quote);
//   - a sentence that opens or closes an italic (an odd number of * or _), or holds a protected
//     part (code, a tag, a macro);
//   - narration that would end up empty between two lines of dialogue (the two quotes would
//     run together and read as one).
// Runs first (order 80), on the reply as written: later rules may reword one copy and not the
// other (the stock-phrase picks differ per copy).

import { MARK } from "../core/marks.js";
import { splitSentences } from "../core/sentences.js";
import { placeholdersOf } from "../core/segments.js";

// The words of a sentence, for comparing: lowercase, curly apostrophes made straight.
export function sentenceKey(sentence) {
    const words =
        String(sentence ?? "")
            .toLowerCase()
            .replace(/[’‘]/g, "'")
            .match(/[\p{L}\p{N}']+/gu) || [];
    return words.map(w => w.replace(/^'+|'+$/g, "")).filter(Boolean);
}

// Can this sentence be cut out on its own and leave the rest reading right?
// endsQuote: the last sentence of a line of dialogue may end in a comma ("I'll stay," she says.);
// the repair step fixes the attribution when the whole quote goes.
function whole(sentence, endsQuote) {
    const t = sentence.trim();
    if (!/^[*_"“(]*[\p{Lu}\p{N}]/u.test(t)) return false;
    if (!/[.!?…][*_"”’)]*$/.test(t) && !(endsQuote && /,$/.test(t))) return false;
    if (((t.match(/\*/g) || []).length + (t.match(/_/g) || []).length) % 2) return false;
    return placeholdersOf(t).length === 0;
}

function inScope(type, inDialogue) {
    return type === "narration" || (inDialogue && type === "dialogue");
}

export default {
    id: "inner-repeat",
    name: "Repeated sentences",
    description: "The same sentence twice in one reply: the later copy goes. Her eyes soften as she listens. The fire crackles. Her eyes soften as she listens. → Her eyes soften as she listens. The fire crackles.",
    scope: "all",
    order: 80,
    defaults: { enabled: true, minWords: 5, inDialogue: false },
    options: [
        { key: "minWords", type: "number", label: "Shortest sentence that counts (words)", min: 3, max: 30 },
        { key: "inDialogue", type: "checkbox", label: "Also inside dialogue (lines of dialogue against each other)" },
    ],

    apply(text, ctx) {
        const s = ctx.settings || {};
        const seg = ctx.segment;
        if (!seg || !Array.isArray(seg.segments)) return text;
        if (!inScope(seg.type, s.inDialogue)) return text;
        const n = Number(s.minWords);
        const minWords = Number.isFinite(n) ? Math.max(3, n) : 5;

        // Every sentence of the same kind (narration or dialogue) earlier in the reply.
        const seen = new Set();
        for (let i = 0; i < seg.index; i++) {
            const x = seg.segments[i];
            if (x.type !== seg.type) continue;
            for (const p of splitSentences(x.text)) {
                const key = sentenceKey(p.text);
                if (key.length >= minWords) seen.add(key.join(" "));
            }
        }

        const parts = splitSentences(text);
        const removed = [];
        const lastPart = parts.findLastIndex(p => p.text.trim());
        const keep = parts.map((p, i) => {
            const key = sentenceKey(p.text);
            if (key.length < minWords) return true;
            const k = key.join(" ");
            if (!seen.has(k)) {
                seen.add(k);
                return true;
            }
            if (!whole(p.text, seg.type === "dialogue" && i === lastPart)) return true;
            removed.push(p.text);
            return false;
        });
        if (!removed.length) return text;

        const out = parts.map((p, i) => (keep[i] ? p.text + p.space : MARK)).join("");
        // Narration left empty between two quotes would run them together: leave it.
        if (!out.split(MARK).join("").trim()) {
            const prev = seg.segments[seg.index - 1];
            const next = seg.segments[seg.index + 1];
            if (seg.type === "narration" && prev?.type === "dialogue" && next?.type === "dialogue") return text;
            if (!seg.segments.some((x, i) => i !== seg.index && x.text.trim())) return text;
        }
        return { text: out, hits: removed.map(r => ({ kind: "repeat", before: r.trim(), after: "" })) };
    },
};
