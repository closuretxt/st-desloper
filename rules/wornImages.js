// Worn images (docs/PLAN.md section 7, item 33). PURE: no SillyTavern imports.
//
// The same few metaphors for "her mood changed": edges that soften or fray, a mask or composure
// that cracks or slips. One is fine; every reply is slop. A word swap doesn't help ("fraying" ->
// "slipping" is still the image), so this is a budget like the gesture budget: the first N in a
// window of replies stay (default 2 per window, core/speech.js windowLeft), never the same family
// twice in a reply, and an extra one is cut only in a shape where the sentence stands without it:
//   "Her grin shifts, the theatrical edges softening."     -> "Her grin shifts."      (a trailing clause)
//   "She meets his eyes, her composure fraying at the edges." -> "She meets his eyes."
//   "Her composure frays at the edges."                    -> "Her composure frays."  (the filler goes)
//   "…, a crack in her armor."                             -> removed
// The image as the sentence's own verb ("Her mask slips.") still counts but stays.
// Only abstract edges count: "the edges of the map curling" is a real map.
// Narration only.

import { earlier, budgetOf, persons, applyEdits, offSet, windowLeft, countIn } from "../core/speech.js";

const ABSTRACT = String.raw`(?:composure|control|calm|smile|grin|smirk|voice|tone|words|laugh|mask|patience|resolve|fa[cç]ade|expression|confidence|bravado|act|performance|nerves|temper|demeanou?r|cool|poise|restraint|teasing|playfulness|amusement|charm|bluster|swagger|arrogance|defen[cs]es|armou?r|walls|guard|front|veneer|mood|anger|fury|irritation|annoyance|smugness|sarcasm|mockery|edge)`;
const EDGE_ADJ = String.raw`(?:theatrical|sharp|sharper|hard|harsh|playful|cold|mocking|teasing|practi[cs]ed|performative|brittle|guarded|jagged|rough|cutting|icy|steely|smug|cocky|bitter|biting|careful|polished|professional|haughty|defensive|prickly|sardonic|sarcastic|wry|bratty|rigid)`;
const EDGE_ING = String.raw`(?:softening|sharpening|blurring|fading|melting|dissolving|smoothing|crumbling|fraying|cracking|giving\s+way|rounding\s+off|dulling|thawing|loosening|wearing\s+(?:off|away|thin)|slipping|easing|falling\s+away|bleeding\s+(?:away|out)|going\s+soft|smoothing\s+out)`;
// Words that "at the edges" trails as filler.
const AT_EDGE_WORD = String.raw`(?:fray|frays|frayed|fraying|crack|cracks|cracked|cracking|crumble|crumbles|crumbled|crumbling|soften|softens|softened|softening|blur|blurs|blurred|blurring|blurry|fuzzy|rough|ragged|worn|thin|thinning|unravel|unravels|unraveled|unravelled|unraveling|unravelling|fade|fades|faded|fading|melt|melts|melted|melting|soft|frazzled|curl|curls|curled|curling)`;
const MASK = String.raw`(?:mask|fa[cç]ade|composure|armou?r|walls|defen[cs]es|veneer|bravado|poise|front|act|performance|control|calm|cool|shell|guard|preten[cs]e|bluster|swagger)`;
const MASK_ING = String.raw`(?:slipping(?:\s+away)?|cracking|crumbling|fraying|faltering|wavering|breaking|shattering|melting|dissolving|splintering|fracturing|coming\s+down|falling\s+away|giving\s+way|chipping\s+away|wearing\s+thin|unravell?ing|eroding|thinning)`;
const MASK_FIN = String.raw`(?:slips|slipped|cracks|cracked|crumbles|crumbled|frays|frayed|falters|faltered|wavers|wavered|breaks|broke|shatters|shattered|melts|melted|splinters|splintered|comes\s+down|came\s+down|falls\s+away|fell\s+away|gives\s+way|gave\s+way|wears\s+thin|wore\s+thin|unravels|unravel+ed)`;
const ADJS = String.raw`(?:[\p{Ll}-]+\s+){0,2}?`;
// The rest of a trailing clause, up to the sentence's end (never past ", and …" that carries on).
const BODY = String.raw`(?:(?!,\s+(?:and|but|then|before|as|while|yet)\b)[^.!?;…"”*\n]){0,80}?`;
const TAIL_END = String.raw`(?=\s*[.!?;…"”*_)]|\s*$|,\s+(?:and|but|then|before|as|while|yet)\b)`;
const AT_END = String.raw`(?=\s*[.,;!?…"”*_)]|\s*$|\s+(?:and|as|while|when|before)\b)`;

export const FAMILIES = [
    { id: "edges", label: "the edges softening / fraying at the edges" },
    { id: "mask", label: "her composure cracking / a crack in her armor" },
];

const cache = new Map();
function compiled(names) {
    const p = persons(names);
    if (cache.has(p.NAMES)) return cache.get(p.NAMES);
    const P = p.POSS;
    // "the theatrical composure cracks": "the" is fine for the inner kinds; walls, armor, a shell
    // or a front with "the" may be real ones.
    const OWNER = String.raw`(?:${P}|the(?=\s+${ADJS}(?:composure|poise|bravado|fa[cç]ade|mask|veneer|calm|cool|control|act|performance|preten[cs]e)\b))`;
    const ABS_EDGES = String.raw`(?:${P}\s+(?:${EDGE_ADJ}\s+)?edges|the\s+${EDGE_ADJ}\s+edges|(?:${P}|the)\s+(?:${EDGE_ADJ}\s+)?edges\s+of\s+${P}\s+${ADJS}${ABSTRACT})`;
    const c = {
        // [family, regex, fix]: fix "cut" removes the match; "count" only counts it.
        edges: [
            [new RegExp(String.raw`,\s+${ABS_EDGES}\s+${EDGE_ING}\b${BODY}${TAIL_END}`, "giu"), "cut"],
            [new RegExp(String.raw`(?<=\b${AT_EDGE_WORD})\s+(?:at|around)\s+the\s+(?:very\s+)?edges\b${AT_END}`, "giu"), "at"],
            [new RegExp(String.raw`\b${ABS_EDGES}`, "giu"), "count"],
        ],
        mask: [
            [new RegExp(String.raw`,\s+${OWNER}\s+${ADJS}${MASK}\s+${MASK_ING}\b${BODY}${TAIL_END}`, "giu"), "cut"],
            [new RegExp(String.raw`,\s+(?:a|the\s+first)\s+(?:(?:small|tiny|hairline|rare|brief|faint|visible|first)\s+)?(?:crack|chink|fissure|fracture)\s+in\s+${P}\s+${ADJS}${MASK}\b${BODY}${TAIL_END}`, "giu"), "cut"],
            [new RegExp(String.raw`\b${OWNER}\s+${ADJS}${MASK}\s+(?:${MASK_FIN}|${MASK_ING})\b`, "giu"), "count"],
            [new RegExp(String.raw`\b(?:a|the\s+first)\s+(?:\p{Ll}+\s+)?(?:crack|chink)\s+in\s+${P}\s+${ADJS}${MASK}\b`, "giu"), "count"],
        ],
    };
    if (cache.size > 20) cache.clear();
    cache.set(p.NAMES, c);
    return c;
}

// "at the edges" counts only after something abstract in the same clause ("her composure fraying
// at the edges", not "the old map, frayed at the edges").
const ABSTRACT_RE = new RegExp(String.raw`\b${ABSTRACT}\b`, "iu");
function abstractBefore(text, at) {
    const from = Math.max(text.lastIndexOf(",", at - 1), text.lastIndexOf(".", at - 1), text.lastIndexOf("!", at - 1), text.lastIndexOf("?", at - 1), text.lastIndexOf(";", at - 1), text.lastIndexOf("\n", at - 1)) + 1;
    return ABSTRACT_RE.test(text.slice(from, at));
}

// Every image in a text, overlapping finds merged into one: [{ id, start, end, cut }], where
// `cut` is the widest removable piece among them (or null: counted, left as written).
export function images(text, names, off = new Set()) {
    const s = String(text ?? "");
    const c = compiled(names);
    const raw = [];
    for (const fam of FAMILIES) {
        if (off.has(fam.id)) continue;
        for (const [re, fix] of c[fam.id]) {
            re.lastIndex = 0;
            for (const m of s.matchAll(re)) {
                if (fix === "at" && !abstractBefore(s, m.index)) continue;
                const span = { start: m.index, end: m.index + m[0].length };
                raw.push({ id: fam.id, ...span, cut: fix === "count" ? null : span });
            }
        }
    }
    raw.sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    for (const r of raw) {
        const last = out.at(-1);
        if (last && r.start < last.end) {
            last.end = Math.max(last.end, r.end);
            if (r.cut && (!last.cut || r.cut.end - r.cut.start > last.cut.end - last.cut.start)) last.cut = r.cut;
            continue;
        }
        out.push({ ...r });
    }
    return out;
}

export default {
    id: "worn-images",
    name: "Worn images",
    description: "Past the budget (and the same image twice), edge and mask metaphors go where the sentence stands without them: Her grin shifts, the theatrical edges softening. → Her grin shifts.",
    scope: "narration",
    order: 265,
    defaults: { enabled: true, budget: 2, off: [] },
    options: [
        { key: "budget", type: "number", label: "Worn images kept per budget window (0 = none)", min: 0, max: 50 },
        { key: "off", type: "phrases", label: "Images (switch one off to never count or cut it)" },
    ],
    entries: FAMILIES.map(f => ({ id: f.id, label: f.label, example: `${f.label}: kept while the budget lasts (never twice in one reply), then cut where the sentence stands without it` })),

    apply(text, ctx) {
        const names = ctx.names || [];
        const off = offSet(ctx.settings?.off);
        const found = images(text, names, off);
        if (!found.length) return text;
        const key = `worn-images\u0001${names.join("\u0002")}\u0001${[...off].join(",")}`;
        const before = earlier(ctx, t => images(t, names, off), s => s.type === "narration", key);
        const max = windowLeft(ctx, key, budgetOf(ctx.settings?.budget, 2), raw => countIn(raw, "narration", t => images(t, names, off)));
        const seenIds = new Set(before.map(x => x.id));
        let seen = before.length;
        const edits = [];
        for (const f of found) {
            const over = seen >= max || seenIds.has(f.id);
            seen++;
            seenIds.add(f.id);
            if (over && f.cut) edits.push({ start: f.cut.start, end: f.cut.end, text: "", kind: f.id, label: FAMILIES.find(x => x.id === f.id).label });
        }
        return applyEdits(text, edits, ctx);
    },
};
