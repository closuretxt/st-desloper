// Adverb fragments (docs/PLAN.md section 7, item 19). PURE: no SillyTavern imports.
//
// The dramatic one-word sentence after an action, on the same line or on a line of its own:
//   She puts the cup down. Slowly.          -> She puts the cup down, slowly.
//   She puts the cup down.\n\nSlowly.        -> She puts the cup down, slowly.
//   He turns. Slowly. Deliberately.         -> He turns, slowly and deliberately.
// Narration only ("Lovely." or "Seriously." in speech is a real answer). Left alone:
// - a fragment that opens a line with more after it (it may belong to the next sentence),
// - three or more adverbs in a row (folding them makes a list),
// - after a sentence ending in "!", "?", "…" or an italic, or one of a single word,
// - -ly words that aren't manner adverbs (only, family, lovely…) and names (Emily, a chat name,
//   or any -ly word written with a capital mid-sentence elsewhere in the reply).
// On by default.

import { MARK } from "../core/marks.js";
import { sentencesAt, hasPlaceholder } from "../core/speech.js";

// -ly words that are nouns, adjectives or names, not "how she did it".
const NOT_ADVERB = new Set(`
only holy lily family reply supply apply comply imply rely ally rally tally belly jelly bully ugly silly
lovely friendly lonely lively likely unlikely daily weekly monthly yearly hourly nightly oily curly chilly
hilly holly jolly folly dolly anomaly assembly butterfly dragonfly fly july italy bubbly cuddly deadly costly
elderly ghastly ghostly godly homely lowly manly measly motherly fatherly brotherly sisterly orderly prickly
saintly scholarly smelly sickly sly stately surly timely unruly wily wobbly woolly wrinkly burly gnarly
grisly gravelly steely beastly cowardly courtly comely crumbly frilly giggly jiggly squiggly wiggly worldly
heavenly earthly leisurely melancholy monopoly underbelly emily kelly molly polly sally shelly beverly
kimberly ashley stanley bradley
`.trim().split(/\s+/));

const ADV = String.raw`(\p{L}{2,}ly)`;
const ONE = new RegExp(String.raw`^(?:(?:[Vv]ery|[Tt]oo|[Ss]o|[Aa]lmost)\s+)?${ADV}\.$`, "u");
const TWO = new RegExp(String.raw`^${ADV}(,\s*|\s+and\s+)${ADV}\.$`, "u");
// The sentence before: ends in a plain "." right after a letter, digit or ")", two words or more.
const PREV_END = /[\p{L}\p{N})]\.$/u;
const words = s => (s.match(/[\p{L}\p{N}'’]+/gu) || []).length;

// "slowly" -> its fragment parts, or null.
function adverbsOf(sentence) {
    const t = sentence.trim();
    let m = t.match(ONE);
    if (m) return { lead: t.slice(0, t.length - m[1].length - 1), advs: [m[1]], joiner: null };
    m = t.match(TWO);
    if (m) return { lead: "", advs: [m[1], m[3]], joiner: m[2] };
    return null;
}

// A word written with a capital right after a lowercase word, anywhere in the reply: a name.
function namedIn(word, whole) {
    const cap = word[0].toUpperCase() + word.slice(1).toLowerCase();
    return new RegExp(String.raw`\p{Ll}[,;]?\s+${cap}(?![\p{L}])`, "u").test(whole);
}

function lower(word) {
    // "Slowly" -> "slowly"; "SLOWLY" (shouting) stays as written.
    return /^\p{Lu}\p{Ll}+$/u.test(word) ? word.toLowerCase() : word;
}

export function fragments(text, { names = [], whole = text, last = true } = {}) {
    const sents = sentencesAt(text);
    const nameSet = new Set(names.filter(n => typeof n === "string").map(n => n.trim().toLowerCase()));
    const okWord = w => {
        const lw = w.toLowerCase();
        return !NOT_ADVERB.has(lw) && !nameSet.has(lw) && !namedIn(w, whole);
    };
    const out = [];
    for (let i = 1; i < sents.length; i++) {
        const prev = sents[i - 1];
        const cur = sents[i];
        const p = prev.text.trim();
        if (!PREV_END.test(p) || words(p) < 2 || hasPlaceholder(p)) continue;
        const a = adverbsOf(cur.text);
        if (!a || !a.advs.every(okWord)) continue;
        const newLine = /\n/.test(prev.space);
        // A second fragment right after, on the same line: "Slowly. Deliberately."
        let run = [cur];
        let advs = [...a.advs];
        const next = sents[i + 1];
        if (next && !/\n/.test(cur.space)) {
            const b = adverbsOf(next.text);
            if (b && b.advs.every(okWord)) {
                run.push(next);
                advs.push(...b.advs);
                const third = sents[i + 2];
                if (third && !/\n/.test(next.space) && adverbsOf(third.text)) continue; // a list: leave it
            }
        }
        if (advs.length > 2 || (a.lead && run.length > 1)) continue;
        const end = run[run.length - 1];
        // On a line of its own, the fragment must end its line.
        if (newLine) {
            const after = end.space;
            const endsLine = /\n/.test(after) || (i + run.length - 1 === sents.length - 1 && last && !after.trim());
            if (!endsLine) continue;
        }
        const lw = advs.map(lower);
        const tail = run.length === 2 ? `${lw[0]} and ${lw[1]}` : a.advs.length === 2 ? `${lw[0]}${a.joiner}${lw[1]}` : `${a.lead.toLowerCase()}${lw[0]}`;
        // From the "." that ends the sentence before through the fragment's own ".".
        const start = prev.start + prev.text.trimEnd().length - 1;
        const stop = end.start + end.text.trimEnd().length;
        out.push({ start, stop, before: text.slice(prev.start, stop).trim(), after: `${p.slice(0, -1)}, ${tail}.`, text: `, ${tail}.` });
        i += run.length - 1;
    }
    return out;
}

export default {
    id: "adverb-fragments",
    name: "Adverb fragments",
    description: "A one-word adverb after an action joins it: She puts the cup down. Slowly. → She puts the cup down, slowly. Works across a line break too.",
    scope: "narration",
    order: 315,
    defaults: { enabled: true },
    options: [],

    apply(text, ctx) {
        const seg = ctx.segment;
        const segs = Array.isArray(seg?.segments) ? seg.segments : [];
        const whole = segs.length ? segs.map(s => String(s.text ?? "")).join(" ") : text;
        const last = !segs.length || seg.index === segs.length - 1;
        const found = fragments(text, { names: ctx.names || [], whole, last });
        if (!found.length) return text;
        let out = text;
        const hits = [];
        for (const f of [...found].reverse()) {
            out = out.slice(0, f.start) + MARK + f.text + out.slice(f.stop);
            hits.unshift({ kind: "fragment", label: "adverb fragment", before: f.before, after: f.after });
        }
        return { text: out, hits };
    },
};
