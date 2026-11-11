// Stock gesture budget (docs/PLAN.md section 7, item 13). PURE: no SillyTavern imports.
//
// Gestures can be good (the user), so this is a budget, not a ban: the first N stock beats in a
// window of replies stay (default 3 per 10 replies, core/speech.js windowLeft), and never the
// same one twice in a reply. An extra one is removed only in a shape
// where the sentence stands without it:
//   "She smiles, tilting her head."          -> "She smiles."             (a trailing participle)
//   "She shrugs and tilts her head."         -> "She shrugs."             ("and" + the beat, at the end)
//   "She answers with a tilt of her head."   -> "She answers."            ("with" + the beat)
//   "She tilts her head. The rain picks up." -> "The rain picks up."      (a short sentence that's only the beat)
// Anything else stays and still counts ("She tilts her head toward the door" says where).
// Narration only. Off by default.

import { earlier, budgetOf, persons, sentencesAt, applyEdits, offSet, windowLeft, countIn } from "../core/speech.js";

// What may trail a beat without meaning anything on its own.
const ADV = String.raw`(?:\s+(?:slightly|a little|a bit|curiously|thoughtfully|playfully|innocently|knowingly|questioningly|expectantly|skeptically|sceptically|lazily|again|once|in curiosity|in thought|in amusement|in challenge|in question|in response|to (?:one|the) side|to the (?:left|right)|at (?:you|him|her|them|me|that|this)))*`;
const END = String.raw`(?=\s*[.!?…;"”*_)]|\s*$)`;
// A comma may also follow a tail when another participle or "then / and" comes next
// (", tilting her head, studying you", ", rolling his eyes, then laughs").
const TAIL_END = String.raw`(?=\s*[.!?…;"”*_)]|\s*$|,\s+(?:\p{Ll}+ing|then|and)\b)`;

// Each beat: verb forms (base|third|past|ing), its object (POSS = her/his/a name's), and the
// noun form that goes after "with".
export const GESTURES = [
    {
        id: "head-tilt",
        label: "tilts her head",
        verbs: [["tilt", "tilts", "tilted", "tilting"], ["cock", "cocks", "cocked", "cocking"]],
        obj: String.raw`POSS\s+head`,
        noun: String.raw`(?:a\s+)?(?:slight\s+|small\s+|curious\s+|quick\s+)?(?:tilt|cock)\s+of\s+POSS\s+head`,
    },
    {
        id: "hair",
        label: "tucks her hair behind her ear",
        verbs: [["tuck", "tucks", "tucked", "tucking"], ["brush", "brushes", "brushed", "brushing"], ["push", "pushes", "pushed", "pushing"], ["sweep", "sweeps", "swept", "sweeping"]],
        obj: String.raw`(?:an?\s+(?:stray\s+|loose\s+|errant\s+)?(?:lock|strand|curl|wisp)\s+of\s+)?(?:POSS\s+)?hair\s+(?:back\s+)?(?:behind\s+POSS\s+ears?|out\s+of\s+POSS\s+(?:face|eyes))`,
        extra: [{ verbs: [["run", "runs", "ran", "running"]], obj: String.raw`an?\s+hand\s+through\s+POSS\s+hair` }],
    },
    {
        id: "lean-in",
        label: "leans in closer",
        verbs: [["lean", "leans", "leaned", "leaning"], ["lean", "leans", "leant", "leaning"]],
        obj: String.raw`(?:in|closer|forward)(?:\s+(?:closer|close|slightly|a little|in))?`,
    },
    {
        id: "smirk",
        label: "smirks",
        verbs: [["smirk", "smirks", "smirked", "smirking"]],
        obj: "",
        noun: String.raw`(?:an?\s+)?(?:small\s+|slight\s+|knowing\s+|sly\s+|playful\s+|lopsided\s+|wry\s+|faint\s+|little\s+|crooked\s+)?smirk`,
        sentence: String.raw`(?:An?|The)\s+(?:\p{Ll}+\s+)?smirk\s+(?:plays|played|tugs|tugged|curls|curled|pulls|pulled|forms|formed|spreads|spread|crosses|crossed)\b[^.!?\n]{0,60}`,
    },
    {
        id: "eyebrow",
        label: "raises an eyebrow",
        verbs: [["raise", "raises", "raised", "raising"], ["arch", "arches", "arched", "arching"], ["quirk", "quirks", "quirked", "quirking"], ["lift", "lifts", "lifted", "lifting"]],
        obj: String.raw`(?:an?\s+|one\s+|a\s+single\s+|POSS\s+)(?:eye)?brows?`,
        noun: String.raw`(?:an?\s+)?(?:raised|arched|quirked|lifted)\s+(?:eye)?brow`,
    },
    {
        id: "arms-crossed",
        label: "crosses her arms",
        verbs: [["cross", "crosses", "crossed", "crossing"], ["fold", "folds", "folded", "folding"]],
        obj: String.raw`POSS\s+arms(?:\s+(?:over|across|under)\s+POSS\s+chest)?`,
        noun: String.raw`POSS\s+arms\s+(?:crossed|folded)(?:\s+(?:over|across|under)\s+POSS\s+chest)?`,
    },
    {
        id: "lip-bite",
        label: "bites her lip",
        verbs: [["bite", "bites", "bit", "biting"], ["worry", "worries", "worried", "worrying"], ["chew", "chews", "chewed", "chewing"]],
        obj: String.raw`(?:on\s+)?POSS\s+(?:lower\s+|bottom\s+)?lip`,
    },
    {
        id: "eye-roll",
        label: "rolls her eyes",
        verbs: [["roll", "rolls", "rolled", "rolling"]],
        obj: String.raw`POSS\s+eyes`,
        noun: String.raw`(?:an?\s+)?eye[- ]?roll`,
    },
    {
        id: "huff",
        label: "huffs",
        verbs: [["huff", "huffs", "huffed", "huffing"]],
        obj: "",
        noun: String.raw`(?:an?\s+)?(?:small\s+|soft\s+|indignant\s+|little\s+|quiet\s+)?huff`,
    },
];

// Regexes per gesture for a set of names, built once.
const cache = new Map();
function compiled(names) {
    const p = persons(names);
    const key = p.NAMES;
    if (cache.has(key)) return cache.get(key);
    const fill = s => s.replace(/POSS/g, p.POSS);
    const out = GESTURES.map(g => {
        const groups = [{ verbs: g.verbs, obj: g.obj }, ...(g.extra || [])];
        // verb + object, per form; an object-less verb stands alone.
        const vo = forms => groups.map(x => `(?:${[...new Set(x.verbs.flatMap(v => forms.map(i => v[i])))].join("|")})${x.obj ? String.raw`\s+${fill(x.obj)}` : ""}`).join("|");
        const finite = vo([0, 1, 2]);
        const ing = vo([3]);
        const any = vo([0, 1, 2, 3]);
        const noun = g.noun ? fill(g.noun) : null;
        return {
            g,
            // Every mention, for counting.
            core: new RegExp(String.raw`\b(?:${any})\b${noun ? String.raw`|\bwith\s+${noun}\b` : ""}${g.sentence ? `|${g.sentence}` : ""}`, "giu"),
            tail: new RegExp(String.raw`,\s+(?:${ing})${ADV}${TAIL_END}`, "giu"),
            and: new RegExp(String.raw`,?\s+and\s+(?:${finite})${ADV}${END}`, "giu"),
            with: noun ? new RegExp(String.raw`,?\s+with\s+${noun}${ADV}(?=\s*[.!?…;,"”*_)]|\s*$)`, "giu") : null,
            sentence: new RegExp(String.raw`^[*_]?(?:Then,?\s+)?(?:${p.SUBJ})\s+(?:(?:just|simply|only|then|merely)\s+)?(?:${finite})${ADV}[.!]+[*_]?$|^[*_]?(?:${g.sentence || "(?!)"})[.!]+[*_]?$`, "u"),
        };
    });
    if (cache.size > 20) cache.clear();
    cache.set(key, out);
    return out;
}

// Every gesture mention in a text, in order: [{ id, start, end }].
export function gestures(text, names, off = new Set()) {
    const out = [];
    for (const c of compiled(names)) {
        if (off.has(c.g.id)) continue;
        c.core.lastIndex = 0;
        for (const m of String(text).matchAll(c.core)) out.push({ id: c.g.id, start: m.index, end: m.index + m[0].length });
    }
    return out.sort((a, b) => a.start - b.start).filter((x, i, all) => !i || x.start >= all[i - 1].end);
}

export default {
    id: "gesture-budget",
    name: "Stock gesture budget",
    description: "Past the budget (and the same beat twice), stock beats go where the sentence stands without them: She smiles, tilting her head. → She smiles.",
    scope: "narration",
    order: 260,
    defaults: { enabled: false, budget: 3, off: [] },
    options: [
        { key: "budget", type: "number", label: "Stock gestures kept per budget window (0 = none)", min: 0, max: 50 },
        { key: "off", type: "phrases", label: "Gestures (switch one off to never count or cut it)" },
    ],
    entries: GESTURES.map(g => ({ id: g.id, label: g.label, example: `${g.label}: kept while the budget lasts (never twice in one reply), then removed where the sentence stands without it` })),

    apply(text, ctx) {
        const names = ctx.names || [];
        const off = offSet(ctx.settings?.off);
        const found = gestures(text, names, off);
        if (!found.length) return text;
        const key = `gesture-budget\u0001${names.join("\u0002")}\u0001${[...off].join(",")}`;
        const before = earlier(ctx, t => gestures(t, names, off), s => s.type === "narration", key);
        const max = windowLeft(ctx, key, budgetOf(ctx.settings?.budget, 3), raw => countIn(raw, "narration", t => gestures(t, names, off)));
        const seenIds = new Set(before.map(x => x.id));
        let seen = before.length;
        const extra = [];
        for (const f of found) {
            const over = seen >= max || seenIds.has(f.id);
            seen++;
            seenIds.add(f.id);
            if (over) extra.push(f);
        }
        if (!extra.length) return text;

        const byId = new Map(compiled(names).map(c => [c.g.id, c]));
        const sents = sentencesAt(text);
        const edits = [];
        for (const f of extra) {
            const c = byId.get(f.id);
            const label = c.g.label;
            let edit = null;
            // A shape that covers this mention.
            for (const re of [c.tail, c.and, c.with]) {
                if (!re) continue;
                re.lastIndex = 0;
                for (const m of text.matchAll(re)) {
                    if (m.index <= f.start && m.index + m[0].length >= f.end) {
                        edit = { start: m.index, end: m.index + m[0].length, text: "", kind: f.id, label };
                        break;
                    }
                }
                if (edit) break;
            }
            if (!edit) {
                const s = sents.find(x => x.start <= f.start && x.end >= f.end);
                // A short sentence that's only the beat, when the segment has more to say.
                if (s && sents.length > 1 && c.sentence.test(s.text.trim())) {
                    edit = { start: s.start, end: s.end + s.space.length, text: "", before: s.text, kind: f.id, label };
                }
            }
            if (edit) edits.push(edit);
        }
        return applyEdits(text, edits, ctx);
    },
};
