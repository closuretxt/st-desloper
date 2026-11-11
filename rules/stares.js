// Stares (docs/PLAN.md section 7, item 44). PURE: no SillyTavern imports.
//
// The filler beat models lean on most: she keeps her eyes on his face, her gaze stays locked on
// him, she holds his gaze, she doesn't look away, she studies his face. One now and then is fine;
// one in every reply is the tic (the user, 2026-11-11). So this is a budget: N stares per window of
// replies (default 1 per 2 replies = never in two replies in a row, core/speech.js windowLeft). An
// extra one is cut only in a shape where the sentence stands without it:
//   "She keeps her eyes on his face, watching."  -> removed       (a sentence that's only the stare)
//   "She nods, her eyes fixed on him."           -> "She nods."   (a trailing clause)
//   "She sits back and holds his gaze."          -> "She sits back."
//   "She smiles, studying his face."             -> "She smiles."
// Only stares at the person ("on him", "on his face", "on Seraphina"): "her eyes on the door"
// says where she's looking and doesn't count. Anything else stays and still counts.
// Narration only.

import { earlier, budgetOf, persons, sentencesAt, applyEdits, windowLeft, countIn } from "../core/speech.js";

const FIX = String.raw`(?:(?:still|firmly|steadily|intently|unwaveringly|squarely)\s+)?(?:locked|fixed|glued|trained|pinned|riveted|set|steady)`;
// What may follow the stare without saying anything of its own.
const ADV = String.raw`(?:\s+(?:closely|intently|carefully|steadily|unblinkingly|unwaveringly|the\s+whole\s+time|the\s+entire\s+time|without\s+blinking))*`;
const TRAIL = String.raw`(?:,\s+(?:watching|unblinking|unwavering|steady|waiting|searching|curious|silent|expectant|patient))*`;
const END = String.raw`(?=\s*[.!?…;"”*_)]|\s*$)`;
const TAIL_END = String.raw`(?=\s*[.!?…;"”*_)]|\s*$|,\s+(?:\p{Ll}+ing|then|and)\b)`;

const cache = new Map();
function compiled(names) {
    const p = persons(names);
    if (cache.has(p.NAMES)) return cache.get(p.NAMES);
    const P = p.POSS;
    // The person looked at: "him", "his face", a bare "his" ("her eyes stay on his"), a name.
    const WHO = String.raw`(?:${P}(?:\s+(?:face|eyes|expression|features|lips|mouth|profile|reaction))?|him|her|them|you|me|${p.NAMES})(?![\p{L}'’])`;
    const NEED_ADV = String.raw`(?:\s+(?:closely|intently|carefully|steadily|unblinkingly|without\s+blinking))+`;
    const STUDY_OBJ = String.raw`${P}\s+(?:face|expression|features|eyes|reaction)`;
    const v = (base, third, past, ing) => ({ fin: `(?:${base}|${third}|${past})`, ing });
    const keep = v("keep", "keeps", "kept", "keeping");
    const hold = v("hold", "holds", "held", "holding");
    const watch = v("watch", "watches", "watched", "watching");
    const study = v("study", "studies", "studied", "studying");
    const phrase = verb => [
        String.raw`${verb === "fin" ? keep.fin : keep.ing}\s+${P}\s+(?:eyes|gaze|attention)\s+(?:${FIX}\s+)?on\s+${WHO}`,
        String.raw`${verb === "fin" ? hold.fin : hold.ing}\s+${P}\s+gaze`,
        String.raw`${verb === "fin" ? watch.fin : watch.ing}\s+${WHO}${NEED_ADV}`,
        String.raw`${verb === "fin" ? study.fin : study.ing}\s+${STUDY_OBJ}`,
        verb === "fin" ? String.raw`(?:doesn['’]t|does\s+not|didn['’]t|did\s+not|never)\s+looks?\s+away(?:\s+from\s+${WHO})?` : String.raw`(?:never|not|without)\s+looking\s+away(?:\s+from\s+${WHO})?`,
    ].join("|");
    const FIN = phrase("fin");
    const ING = phrase("ing");
    // "Her eyes stay on his face" / "Her gaze never leaves him": the eyes as the subject.
    const EYES = String.raw`${P}\s+(?:eyes|gaze|stare)\s+(?:(?:stay|stays|stayed|remain|remains|remained|are|is|were|was|linger|lingers|lingered|rest|rests|rested)\s+(?:${FIX}\s+)?on\s+${WHO}|(?:never|don['’]t|doesn['’]t|didn['’]t|do\s+not|does\s+not|did\s+not)\s+(?:leave|leaves|left)\s+${WHO})`;
    // ", her eyes fixed on him" / ", her gaze never leaving his face".
    const ABS = String.raw`${P}\s+(?:eyes|gaze)\s+(?:still\s+)?(?:${FIX}\s+on|never\s+leaving|not\s+leaving)\s+${WHO}`;
    const c = {
        core: new RegExp(String.raw`\b(?:${FIN}|${ING}|${EYES}|${ABS})`, "giu"),
        tail: new RegExp(String.raw`,\s+(?:${ING}|${ABS})${ADV}${TRAIL}${TAIL_END}`, "giu"),
        with: new RegExp(String.raw`,?\s+with\s+${P}\s+(?:eyes|gaze)\s+${FIX}\s+on\s+${WHO}${ADV}${TRAIL}${TAIL_END}`, "giu"),
        and: new RegExp(String.raw`,?\s+and\s+(?:${FIN})${ADV}${TRAIL}${END}`, "giu"),
        sentence: new RegExp(String.raw`^[*_]?(?:(?:Then|Still|Meanwhile|For\s+a\s+(?:moment|while|long\s+moment)),?\s+)?(?:${p.SUBJ}\s+(?:(?:just|simply|only|still|then|merely)\s+)?(?:${FIN})|${EYES})${ADV}${TRAIL}[.!]+[*_]?$`, "u"),
    };
    if (cache.size > 20) cache.clear();
    cache.set(p.NAMES, c);
    return c;
}

// Every stare in a text: [{ start, end }].
export function stares(text, names) {
    const c = compiled(names);
    c.core.lastIndex = 0;
    return [...String(text ?? "").matchAll(c.core)].map(m => ({ start: m.index, end: m.index + m[0].length }));
}

export default {
    id: "stares",
    name: "Stares",
    description: "Past the budget, stock stares go where the sentence stands without them: She keeps her eyes on his face, watching. → removed  She nods, her eyes fixed on him. → She nods.",
    scope: "narration",
    order: 262,
    defaults: { enabled: true, budget: 1, window: 2 },
    options: [
        { key: "budget", type: "number", label: "Stares kept per window (0 = none)", min: 0, max: 20 },
        { key: "window", type: "number", label: "Window in replies (2 = never two replies in a row; 1 = per reply)", min: 1, max: 20 },
    ],

    apply(text, ctx) {
        const names = ctx.names || [];
        const found = stares(text, names);
        if (!found.length) return text;
        const key = `stares\u0001${names.join("\u0002")}`;
        const before = earlier(ctx, t => stares(t, names), s => s.type === "narration", key);
        // Its own window, not the global one: the point is "not again in the next reply".
        const size = budgetOf(ctx.settings?.window, 2);
        const history = Array.isArray(ctx.window?.history) ? ctx.window.history : [];
        const max = windowLeft({ window: { size, history } }, `${key}\u0001${size}`, budgetOf(ctx.settings?.budget, 1), raw => countIn(raw, "narration", t => stares(t, names)));
        let seen = before.length;
        const extra = found.filter(() => seen++ >= max);
        if (!extra.length) return text;

        const c = compiled(names);
        const sents = sentencesAt(text);
        const edits = [];
        for (const f of extra) {
            let edit = null;
            for (const re of [c.tail, c.with, c.and]) {
                re.lastIndex = 0;
                for (const m of text.matchAll(re)) {
                    if (m.index <= f.start && m.index + m[0].length >= f.end) {
                        edit = { start: m.index, end: m.index + m[0].length, text: "", kind: "stare", label: "stare" };
                        break;
                    }
                }
                if (edit) break;
            }
            if (!edit) {
                const s = sents.find(x => x.start <= f.start && x.end >= f.end);
                // A sentence that's only the stare. When it's the segment's only sentence the
                // stare stays (applyEdits keeps narration from going empty).
                if (s && c.sentence.test(s.text.trim())) edit = { start: s.start, end: s.end + s.space.length, text: "", before: s.text, kind: "stare", label: "stare" };
            }
            if (edit) edits.push(edit);
        }
        return applyEdits(text, edits, ctx);
    },
};
