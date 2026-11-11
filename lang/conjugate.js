// A small conjugator: "pressing" -> press / presses / pressed. PURE: no SillyTavern imports.
//
// Own code instead of a library (docs/PLAN.md section 5): strip -ing, undouble (sitting -> sit),
// put back a lost -e (making -> make), plus the tables in lang/words.js for what the rules get
// wrong. When it isn't confident it returns null and the caller leaves the sentence alone.

import { IRREGULAR_PAST, DOUBLE_ON_PAST, ING_TO_BASE, NOT_PARTICIPLES, SPEECH_VERBS } from "./words.js";

function syllables(word) {
    const w = word.replace(/qu/g, "q").replace(/^y/, "j");
    return (w.match(/[aeiouy]+/g) || []).length;
}

// consonant-vowel-consonant at the end (w, x, y don't count as the last consonant).
function endsCvc(word) {
    return /(?:^|[^aeiou])[aeiou][^aeiouwxy]$/.test(word.replace(/qu/g, "q"));
}

// Unstressed last syllables: "whispering" -> whisper, "opening" -> open, "visiting" -> visit.
const NO_E_ENDINGS = /(er|en|on|et|it|el|al|om|ot|ol|op|ur)$/;

// -> { base, doubled } or null. `doubled` remembers sitting -> sit, so the past doubles too.
export function baseFromParticiple(word) {
    const w = String(word ?? "").toLowerCase();
    if (!/^[a-z]+ing$/.test(w) || NOT_PARTICIPLES.has(w)) return null;
    if (Object.hasOwn(ING_TO_BASE, w)) return { base: ING_TO_BASE[w], doubled: false };
    const stem = w.slice(0, -3);
    if (stem.length < 2 || !/[aeiouy]/.test(stem)) return null;
    const plain = { base: stem, doubled: false };
    const withE = { base: `${stem}e`, doubled: false };

    const dbl = stem.match(/([b-df-hj-np-tv-z])\1$/);
    if (dbl) {
        // fall, press, sniff, buzz keep their double; the rest undouble (sitting -> sit).
        if ("lsfz".includes(dbl[1])) return plain;
        return { base: stem.slice(0, -1), doubled: true };
    }
    if (/u$/.test(stem)) return withE; // arguing -> argue
    if (/[aeioywx]$/.test(stem)) return plain; // seeing, going, crying, drawing, relaxing
    if (/[cv]$/.test(stem)) return withE; // glancing -> glance, moving -> move
    if (/[aeiou]{2}[sz]$/.test(stem)) return withE; // raising -> raise, squeezing -> squeeze
    if (/[nlrp]s$/.test(stem)) return withE; // rinsing -> rinse, pulsing -> pulse
    if (/[rdl]g$/.test(stem)) return withE; // urging -> urge, nudging -> nudge
    if (/[^aeiourwl]l$/.test(stem)) return withE; // trembling -> tremble, settling -> settle
    if (endsCvc(stem)) {
        // One syllable with a single final consonant: the base had an -e (a base without one
        // would have doubled: sit -> sitting). smiling -> smile, biting -> bite.
        if (syllables(stem) === 1) return withE;
        if (/at$/.test(stem) || /iz$/.test(stem)) return withE; // hesitating, realizing
        if (NO_E_ENDINGS.test(stem)) return plain;
        return null; // "encasing": not sure, so no rewrite
    }
    return plain; // turning, holding, reaching, leaning
}

export function toThird(base) {
    if (base === "be") return "is";
    if (base === "have") return "has";
    if (/(s|sh|ch|x|z)$/.test(base)) return `${base}es`;
    if (/[^o]o$/.test(base)) return `${base}es`; // goes, echoes (but coos)
    if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`;
    return `${base}s`;
}

export function toPast(base, { doubled = false } = {}) {
    if (base === "be") return null; // was / were depends on the subject
    if (Object.hasOwn(IRREGULAR_PAST, base)) return IRREGULAR_PAST[base];
    if (doubled || DOUBLE_ON_PAST.has(base) || (syllables(base) === 1 && endsCvc(base))) {
        return `${base}${base.at(-1)}ed`;
    }
    if (/e$/.test(base)) return `${base}d`;
    if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ied`;
    if (/[^c]c$/.test(base)) return `${base}ked`; // panicked
    return `${base}ed`;
}

// form: 'third' (she presses), 'past' (she pressed), 'base' (they press). null = not confident.
export function conjugateParticiple(word, form) {
    const info = baseFromParticiple(word);
    if (!info) return null;
    let out = null;
    if (form === "third") out = toThird(info.base);
    else if (form === "past") out = toPast(info.base, info);
    else if (form === "base") out = info.base === "be" ? null : info.base;
    if (!out) return null;
    return /^[A-Z]/.test(String(word)) ? out[0].toUpperCase() + out.slice(1) : out;
}

// Every form of every speech verb -> { base, tense }: "says" -> third, "said" -> past.
export function speechVerbIndex() {
    const map = new Map();
    for (const base of SPEECH_VERBS) {
        map.set(base, { base, tense: "base" });
        map.set(toThird(base), { base, tense: "third" });
        const past = toPast(base);
        if (past) map.set(past, { base, tense: "past" });
    }
    return map;
}

export function isSpeechParticiple(word) {
    const info = baseFromParticiple(word);
    return !!info && SPEECH_VERBS.includes(info.base);
}
