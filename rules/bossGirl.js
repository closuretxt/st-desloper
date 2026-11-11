// "Boss girl" filter (docs/PLAN.md section 7, item 15). PURE: no SillyTavern imports.
//
// The smug, always-in-control script every character drifts into. The character keeps their
// confidence; only the stock beats go, each part with its own switch:
//   openers:   "Oh? Is that so? Then prove it." -> "Then prove it."  (only as a quote's opening,
//              and only when more follows)
//   pet names: a reply keeps its first one (setting); later ones go: "Sit, darling." -> "Sit."
//   purring:   "…, her voice a low purr." -> removed; "she purrs" before or after a quote -> a
//              plain speech verb from a pool (says / murmurs / answers), varied per reply.
// Smirks, raised eyebrows and the rest ride on the gesture budget. "Good girl", "Eyes on me"
// and the like are only counted by the stats: in a scene they're content, not slop.

import { dealFrom, choiceList } from "../core/seed.js";
import { toThird, toPast } from "../lang/conjugate.js";
import { sentencesAt, looseOf, sentenceEdit, applyEdits, offSet, persons, earlier, budgetOf, windowLeft, countIn } from "../core/speech.js";

const OPENERS = [
    /^(?:oh+|ooh+|hm+|mm+|hoh|heh)(?:[?~]+!?|\?!|~\?)$/u,
    /^(?:my,? my|well,? well(?:,? well)?|is that so|is that right|is that a fact|oh,? is that so|bold|how bold|bold of you|cute|how cute|so cute|adorable|how adorable|interesting|how interesting|brave|how brave|brave words|bold words|big words)[.!?~…]*$/u,
];

const PET = String.raw`(?:my\s+)?(?:sweetheart|sweetie|darling|honey|hon|pet|kitten|little one|dearest|love|babe|baby|sugar|princess|cutie|handsome|gorgeous|sweet thing|little lamb|little mouse|puppy|little bird)`;
const PET_DEAR = String.raw`(?:${PET}|(?:my\s+)?dear)`;
// ", darling." / ", darling, " / "Darling, …" / a line that's only "Darling." ("Oh, dear." is not a pet name).
const PET_RES = [
    new RegExp(String.raw`,\s+${PET_DEAR}(?=\s*[.!?~…,]|\s*$)`, "giu"),
    new RegExp(String.raw`(?<=^[\s*_]*|[.!?…~]["”’*_)\]]*\s+)${PET},\s+(?=\p{L})`, "giu"),
];
const PET_LINE = new RegExp(String.raw`^(?:oh,?\s+)?${PET}[.!?~…]*$`, "u");

export function petNames(text) {
    const out = [];
    for (const r of PET_RES) {
        r.lastIndex = 0;
        for (const m of String(text).matchAll(r)) {
            // "Oh, dear." / "Oh my, dear me" is an exclamation, not a pet name.
            if (/\bdear\b/i.test(m[0]) && /(?:^|[^\p{L}])(?:oh|ah|my|oh my)\s*$/iu.test(String(text).slice(0, m.index))) continue;
            out.push({ start: m.index, end: m.index + m[0].length });
        }
    }
    for (const s of sentencesAt(text)) if (PET_LINE.test(looseOf(s.text))) out.push({ start: s.start, end: s.end + s.space.length, line: true });
    return out.sort((a, b) => a.start - b.start).filter((x, i, all) => !i || x.start >= all[i - 1].end);
}

const purrCache = new Map();
function purrRes(names) {
    const p = persons(names);
    if (purrCache.has(p.NAMES)) return purrCache.get(p.NAMES);
    const VOICE_ADJ = "(?:(?:low|soft|sultry|throaty|silky|velvet|velvety|husky|deep|lazy|dangerous|smooth)\\s+)*";
    const r = {
        tails: [
            new RegExp(String.raw`,\s+(?:${p.POSS}\s+)?voice\s+(?:(?:a|an)\s+)?${VOICE_ADJ}purr\b(?=\s*[.!?…;"”*_,]|\s*$)`, "giu"),
            new RegExp(String.raw`,\s+(?:${p.POSS}\s+)?voice\s+(?:dropping|dropped|lowering|lowered|sinking|sank)\s+(?:an\s+octave|(?:to\s+)?(?:a\s+)?(?:low\s+)?(?:purr|register|murmur))(?=\s*[.!?…;"”*_,]|\s*$)`, "giu"),
        ],
        sentence: new RegExp(String.raw`^[*_]?${p.POSS}\s+voice\s+(?:drops|dropped|lowers|lowered|dips|dipped)\s+(?:an\s+octave|to\s+an?\s+(?:low\s+|sultry\s+|silky\s+)?purr|low)[.!]+[*_]?$`, "u"),
        // "she purrs" right after a quote, or leading into one.
        after: new RegExp(String.raw`^(\s*[*_]?(?:${p.SUBJ})\s+)(purrs|purred|purr)\b`, "u"),
        before: new RegExp(String.raw`(?<=(?:^|[.!?…]\s+)[*_]?(?:${p.SUBJ})\s+)(purrs|purred|purr)(?=[^.!?…\n]{0,40}[,:][*_]?\s*$)`, "u"),
    };
    if (purrCache.size > 20) purrCache.clear();
    purrCache.set(p.NAMES, r);
    return r;
}

// A pool word ("say", "murmur") in the form the matched verb had: purrs -> says, purred -> said.
// Only the first word is conjugated ("say quietly" -> "says quietly"); null when unsure.
function verbIn(base, matched) {
    const [head, ...rest] = base.trim().split(/\s+/);
    const b = head.toLowerCase();
    const v = /ed$/.test(matched) ? toPast(b) : /s$/.test(matched) ? toThird(b) : b;
    return v ? [v, ...rest].join(" ") : null;
}

export const ENTRIES = [
    { id: "opener", label: 'Smug openers ("Oh?", "Is that so?")', example: '"Oh? Is that so? Then prove it." → "Then prove it."' },
    { id: "pet", label: "Pet names past the budget", example: '"Come here, darling. Sit, darling." → "Come here, darling. Sit."' },
    {
        id: "purr",
        label: "Purring voices",
        example: "…, her voice a low purr. → removed; she purrs → she says / murmurs / answers",
        pools: { verb: { label: 'Instead of "purrs" (plain form)', value: ["say", "murmur", "answer"] } },
    },
];

function speechEdits(text, ctx, off) {
    const edits = [];
    if (!off.has("opener")) {
        const sents = sentencesAt(text);
        // Only the quote's opening sentences, and something must be left after them.
        for (let i = 0; i < sents.length - 1; i++) {
            if (!OPENERS.some(r => r.test(looseOf(sents[i].text)))) break;
            edits.push(sentenceEdit(sents[i], { kind: "opener", label: ENTRIES[0].label }));
        }
    }
    if (!off.has("pet")) {
        const found = petNames(text);
        let seen = earlier(ctx, t => petNames(t), s => s.type === "dialogue", "pet").length;
        const max = windowLeft(ctx, "boss-girl-pet", budgetOf(ctx.settings?.petBudget, 3), raw => countIn(raw, "dialogue", petNames));
        for (const f of found) if (seen++ >= max) edits.push({ start: f.start, end: f.end, text: "", kind: "pet", label: ENTRIES[1].label });
    }
    return edits;
}

function narrationEdits(text, ctx) {
    const r = purrRes(ctx.names || []);
    const edits = [];
    for (const t of r.tails) {
        t.lastIndex = 0;
        for (const m of text.matchAll(t)) edits.push({ start: m.index, end: m.index + m[0].length, text: "", kind: "purr", label: ENTRIES[2].label });
    }
    const sents = sentencesAt(text);
    if (sents.length > 1) for (const s of sents) if (r.sentence.test(s.text.trim())) edits.push(sentenceEdit(s, { kind: "purr", label: ENTRIES[2].label }));

    const seg = ctx.segment;
    const prev = seg?.segments?.[seg.index - 1];
    const next = seg?.segments?.[seg.index + 1];
    const own = choiceList(ctx.settings?.pools?.purr?.verb);
    const pool = own.length ? own : ENTRIES[2].pools.verb.value;
    const swap = (at, verb) => {
        const base = dealFrom(ctx, "purr|verb", pool);
        const word = base ? verbIn(base, verb) : null;
        if (word) edits.push({ start: at, end: at + verb.length, text: word, before: verb, kind: "purr", label: ENTRIES[2].label });
    };
    const a = prev?.type === "dialogue" ? r.after.exec(text) : null;
    if (a) swap(a.index + a[1].length, a[2]);
    const b = next?.type === "dialogue" ? r.before.exec(text) : null;
    if (b && (!a || b.index !== a.index + a[1].length)) swap(b.index, b[1]);
    return edits;
}

export default {
    id: "boss-girl",
    name: '"Boss girl" filter',
    description: '"Oh? Is that so? Then prove it." → "Then prove it."  Past the pet-name budget, the rest go. The confidence stays; the script goes.',
    scope: "all",
    order: 170,
    defaults: { enabled: true, petBudget: 3, off: [], pools: {} },
    options: [
        { key: "petBudget", type: "number", label: "Pet names kept per budget window (0 = none)", min: 0, max: 50 },
        { key: "off", type: "phrases", label: "Parts (switch one off to leave it as written; edit the choices, separated by |)" },
    ],
    entries: ENTRIES,

    apply(text, ctx) {
        const off = offSet(ctx.settings?.off);
        if (ctx.segment?.type === "dialogue") return applyEdits(text, speechEdits(text, ctx, off), ctx);
        if (off.has("purr")) return text;
        const edits = narrationEdits(text, ctx);
        return edits.length ? applyEdits(text, edits, ctx) : text;
    },
};
