// Flipped endings budget (docs/PLAN.md section 7, item 31). PURE: no SillyTavern imports.
//
// A short sentence that ends on a bare "didn't / wasn't" to land a reversal as its own beat:
//   Her hands shook. Her voice didn't.   -> Her hands shook, but her voice didn't.
// One now and then is fine; a model that does it every reply turns it into a drum. Past the
// budget (default 1 per window of replies, core/speech.js windowLeft) the reversal joins the
// sentence before it, so it rides in the same breath instead of on its own. Nothing is lost:
// the words stay, only the full stop becomes ", but" (or "yet" / "though", stable per message).
// Only narration, only when the sentence before is a plain statement (no "not", no question),
// both in the same paragraph, and the reversal is at most four words before its "didn't".
// Off by default.

import { MARK } from "../core/marks.js";
import { dealFrom } from "../core/seed.js";
import { sentencesAt, budgetOf, windowLeft, countIn } from "../core/speech.js";

const NEG_AUX = String.raw`(?:didn['’]t|did not|wasn['’]t|was not|weren['’]t|were not|couldn['’]t|wouldn['’]t|hadn['’]t|isn['’]t|doesn['’]t|don['’]t|won['’]t|can['’]t|aren['’]t|haven['’]t|hasn['’]t|shouldn['’]t)`;
// The reversal: optional But / And, a subject of 1-4 words, the bare auxiliary, a full stop.
const FLIP = new RegExp(String.raw`^(?:(?:But|And)\s+)?([\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,3}?)\s+${NEG_AUX}(?:\s+(?:quite|yet|either|anymore))?\.([*_]*)$`, "u");
const NEGATIVE = /\b(?:not|never|no|nothing|nobody|none)\b|n['’]t\b/i;
const KEEP_CASE = /^(?:I|I['’]\w+)$/;
const LOWER_OK = /^(?:she|he|they|it|we|you|her|his|their|its|our|my|your|the|a|an|this|that|these|those|some|none)$/i;

// The flips in one narration segment: [{ prev, sent, m }].
export function flipsIn(text) {
    const sents = sentencesAt(text);
    const out = [];
    for (let i = 1; i < sents.length; i++) {
        const prev = sents[i - 1];
        const s = sents[i];
        const m = FLIP.exec(s.text);
        if (!m || /[*_]/.test(s.text.slice(0, -m[2].length || undefined))) continue;
        if (/\n/.test(prev.space)) continue;
        const p = prev.text.replace(/^[*_]+/, "");
        if (!/\.$/.test(p) || /[*_"“”—–]/.test(p) || NEGATIVE.test(p)) continue;
        if ((p.match(/[\p{L}'’-]+/gu) || []).length > 25) continue;
        out.push({ prev, sent: s, m });
    }
    return out;
}

export default {
    id: "flipped-endings",
    name: "Flipped endings budget",
    description: "Past the budget, a reversal on a bare \"didn't\" joins the sentence before it: Her hands shook. Her voice didn't. → Her hands shook, but her voice didn't.",
    scope: "narration",
    order: 318,
    defaults: { enabled: false, budget: 1 },
    options: [{ key: "budget", type: "number", label: "Flipped endings kept per budget window (0 = none)", min: 0, max: 50 }],

    apply(text, ctx) {
        const seg = ctx.segment;
        const found = flipsIn(text);
        if (!found.length) return text;
        let seen = 0;
        for (let i = 0; seg && i < seg.index; i++) {
            const x = seg.segments[i];
            if (x.type === "narration") seen += flipsIn(String(x.text ?? "")).length;
        }
        const max = windowLeft(ctx, "flipped-endings", budgetOf(ctx.settings?.budget, 1), raw => countIn(raw, "narration", t => flipsIn(t)));
        const cut = found.filter(() => seen++ >= max);
        if (!cut.length) return text;
        let out = text;
        const hits = [];
        for (const c of [...cut].reverse()) {
            const body = c.sent.text.replace(/^(?:But|And)\s+/, "");
            const first = /^[\p{L}'’]+/u.exec(body)[0];
            const lowered = LOWER_OK.test(first) && !KEEP_CASE.test(first) ? body.charAt(0).toLowerCase() + body.slice(1) : body;
            const conj = dealFrom(ctx, "flipped-endings", ["but", "yet", "though"]);
            // From the full stop of the sentence before to the end of the reversal.
            const start = c.prev.end - 1;
            const rep = `, ${conj} ${lowered}`;
            out = out.slice(0, start) + MARK + rep + out.slice(c.sent.end);
            hits.unshift({ kind: "flipped-ending", label: "flipped ending", before: `${c.prev.text} ${c.sent.text}`, after: `${c.prev.text.slice(0, -1)}${rep}` });
        }
        return { text: out, hits };
    },
};
