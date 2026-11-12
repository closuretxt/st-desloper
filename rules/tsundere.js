// Tsundere filter (docs/PLAN.md section 7, item 14). PURE: no SillyTavern imports.
//
// A tsundere can be a tsundere without the cringe script. So the character stays,
// and only the stock beats go, each part with its own switch:
//   denials:  "It's not like I did it for you or anything! Eat." -> "Eat."
//             "Don't get the wrong idea!" / "I'm not blushing!" / "Who said I was worried?"
//   insults:  "Idiot." / "Baka!" as a line of their own, and as a tag: "Shut up, idiot." -> "Shut up."
//             ("You're an idiot if you go" stays: that's an opinion.)
//   hmph:     "Hmph. Fine." -> "Fine."  ("She huffs." in narration stays.)
//   blushes:  a reply keeps its first blush (setting); later ones go where the sentence stands
//             without them: "She looks away, her cheeks burning." -> "She looks away."
// Stammers and huffs have their own budgets (stutter budget, gesture budget).
// Global on purpose: a tsundere card gets the same treatment, and stays a tsundere.

import { sentencesAt, looseOf, LEAD, sentenceEdit, applyEdits, offSet, persons, earlier, budgetOf, windowLeft, countIn } from "../core/speech.js";

const END = String.raw`[.!?…~]*$`;
const INSULT = String.raw`(?:idiot|baka|dummy|dork|moron|dumbass|airhead|blockhead|dimwit|doofus|pervert|perv)`;
const TAG = String.raw`(?:,\s+(?:you\s+)?(?:big\s+|stupid\s+|total\s+)?${INSULT})?`;
const re = s => new RegExp(s, "u");

const DENIALS = [
    re(String.raw`${LEAD}(?:it's|it is|its) not (?:like|as if) i\b(?=.*\b(?:for you|about you|or anything|i care|like you|i like|i wanted to|i was (?:worried|waiting|jealous)))[^.!?]*${END}`),
    re(String.raw`${LEAD}(?:don't|do not) (?:get|go getting) (?:the wrong idea|any (?:weird |funny |strange )?ideas)(?:,? (?:okay|ok|got it|alright))?${TAG}${END}`),
    re(String.raw`${LEAD}(?:don't|do not) misunderstand(?: me| this)?${TAG}${END}`),
    re(String.raw`${LEAD}(?:i'm|i am) not (?:blushing|embarrassed|flustered|jealous|pouting)${TAG}${END}`),
    re(String.raw`${LEAD}(?:i )?(?:wasn't|was not) (?:staring|blushing)(?: at you)?${TAG}${END}`),
    re(String.raw`${LEAD}(?:who|who said|who says) (?:said )?i (?:was|am|'m) (?:worried|jealous|waiting|staring|blushing|happy)(?: (?:about|for|at) you)?${TAG}${END}`),
    re(String.raw`${LEAD}(?:it's|this is|that's|this isn't|it isn't) (?:not )?what it looks like${TAG}${END}`),
    re(String.raw`${LEAD}(?:i )?(?:didn't|did not) (?:do|make|buy|get|bring|save) (?:it|this|that|these|them) for you${TAG}${END}`),
    // "…not… you… or anything!" ("I didn't wait for you or anything!")
    /^(?=[^.!?]*(?:\bnot\b|n't\b))(?=[^.!?]*\byou\b)[^.!?]*\bor anything[.!?…~]*$/u,
];
// A lone "Whatever!" only with a stammer or "!" ("Whatever." is plain speech).
const WHATEVER = re(String.raw`${LEAD}whatever!+[!?~…]*$`);
const INSULT_LINE = re(String.raw`^(?:you\s+)?(?:big\s+|stupid\s+|total\s+|complete\s+)?${INSULT}s?[.!?~…]*$`);
// As a tag at the end of a sentence, or a call at its start ("Idiot, you could've died!").
const INSULT_TAIL = new RegExp(String.raw`,\s+(?:you\s+)?(?:big\s+|stupid\s+|total\s+)?${INSULT}(?=[.!?~…]*[*_]?$)`, "iu");
const INSULT_HEAD = new RegExp(String.raw`^([*_]?)(?:you\s+)?(?:big\s+|stupid\s+)?${INSULT},\s+(?=\p{L})`, "iu");
// "Hmph" as an interjection in speech, with the punctuation after it.
const HMPH = /(?<=^[\s*_]*|[.!?…~]["”’*_)\]]*\s+|,\s*)(?:\p{L}-)?h+m+p+h+[.!?~…]*(?=[\s*_]|$)/giu;

// ---- blushes -----------------------------------------------------------------------------
const BLUSH_VERB = String.raw`(?:flush|flushes|flushed|flushing|redden|reddens|reddened|reddening|burn|burns|burned|burnt|burning|heat|heats|heated|heating|pinken|pinkens|pinkened|pinkening|colou?r|colou?rs|colou?red|colou?ring|darken|darkens|darkened|darkening|warm|warms|warmed|warming|(?:go|goes|went|turn|turns|turned|turning)\s+(?:bright\s+|deep\s+|faintly\s+)?(?:red|pink|crimson|scarlet))`;
const BLUSH_ING = String.raw`(?:flushing|reddening|burning|heating|pinkening|colou?ring|darkening|warming|(?:going|turning)\s+(?:bright\s+|deep\s+)?(?:red|pink|crimson|scarlet)|flushed|aflame|(?:bright\s+)?(?:red|pink|crimson|scarlet))`;
const SPREAD = String.raw`(?:creeps|creeping|crept|spreads|spreading|spread|rises|rising|rose|blooms|blooming|bloomed|dusts|dusting|dusted|colou?rs|colou?ring|colou?red|stains|staining|stained|tints|tinting|tinted|crawls|crawling|crawled|climbs|climbing|climbed)`;
const BLUSH_ADJ = String.raw`(?:(?:faint|deep|bright|light|soft|rosy|pink|furious|telltale|slight|warm|hot)\s+)?`;
const PARTS = String.raw`(?:cheeks|face|ears|neck)`;

const blushCache = new Map();
function blushRes(names) {
    const p = persons(names);
    if (blushCache.has(p.NAMES)) return blushCache.get(p.NAMES);
    const POSS = p.POSS;
    const r = {
        core: new RegExp(
            [
                String.raw`\b${POSS}\s+${PARTS}\s+${BLUSH_VERB}\b`,
                String.raw`\b(?:blush|blushes|blushed|blushing)\b`,
                String.raw`\ban?\s+${BLUSH_ADJ}(?:blush|flush)\s+${SPREAD}\b`,
                String.raw`\b(?:red|pink) as an? (?:tomato|beet|cherry|apple)\b`,
                String.raw`\b(?:beet|tomato|cherry)-red\b`,
                String.raw`,\s+(?:${POSS}\s+)?${PARTS}\s+${BLUSH_ING}\b`,
            ].join("|"),
            "giu",
        ),
        tails: [
            new RegExp(String.raw`,\s+(?:${POSS}\s+)?${PARTS}\s+${BLUSH_ING}(?:\s+(?:bright|deep|faintly|slightly|a little))?(?:\s+(?:red|pink|crimson|scarlet))?(?=\s*[.!?…;"”*_]|\s*$)`, "giu"),
            new RegExp(String.raw`,\s+(?:an?\s+)?${BLUSH_ADJ}(?:blush|flush)\s+${SPREAD}\b[^.!?;,"”*\n]*(?=[.!?…;"”*_]|$)`, "giu"),
            new RegExp(String.raw`,\s+blushing(?:\s+(?:furiously|deeply|slightly|faintly|hard|bright red|scarlet|crimson))?(?=\s*[.!?…;"”*_]|\s*$)`, "giu"),
            new RegExp(String.raw`,?\s+with\s+an?\s+${BLUSH_ADJ}blush(?=\s*[.!?…;,"”*_]|\s*$)`, "giu"),
        ],
        sentence: new RegExp(
            String.raw`^[*_]?(?:${POSS}\s+${PARTS}\s+${BLUSH_VERB}|(?:An?|The)\s+${BLUSH_ADJ}(?:blush|flush)\s+${SPREAD}|${p.SUBJ}\s+(?:blushes|blushed|blush))\b[^.!?\n]{0,60}[.!]+[*_]?$`,
            "u",
        ),
    };
    if (blushCache.size > 20) blushCache.clear();
    blushCache.set(p.NAMES, r);
    return r;
}

export function blushes(text, names) {
    const r = blushRes(names);
    r.core.lastIndex = 0;
    const out = [];
    for (const m of String(text).matchAll(r.core)) {
        if (out.length && m.index < out.at(-1).end) continue;
        out.push({ start: m.index, end: m.index + m[0].length });
    }
    return out;
}

export const ENTRIES = [
    { id: "denial", label: "Denials", example: '"It\'s not like I did it for you or anything! Eat." → "Eat."  Also "Don\'t get the wrong idea!", "I\'m not blushing!"' },
    { id: "insult", label: 'Fond insults ("Idiot!", "Baka!")', example: '"Shut up, idiot." → "Shut up."  A lone "Baka!" goes; "You\'re an idiot if you go" stays' },
    { id: "hmph", label: '"Hmph"', example: '"Hmph. Fine." → "Fine."' },
    { id: "blush", label: "Blushes past the budget", example: "She looks away, her cheeks burning. → She looks away. (blushes stay while the budget lasts)" },
];

function speechEdits(text, off) {
    const edits = [];
    const sents = sentencesAt(text);
    for (const s of sents) {
        const l = looseOf(s.text);
        const stammered = /\p{L}-\p{L}/u.test(s.text);
        if (!off.has("denial") && (DENIALS.some(r => r.test(l)) || (WHATEVER.test(l) || (stammered && /^whatever[.!?~…]*$/.test(l))))) {
            edits.push(sentenceEdit(s, { kind: "denial", label: ENTRIES[0].label }));
            continue;
        }
        if (off.has("insult")) continue;
        if (INSULT_LINE.test(l)) {
            edits.push(sentenceEdit(s, { kind: "insult", label: ENTRIES[1].label }));
            continue;
        }
        const t = INSULT_TAIL.exec(s.text);
        if (t) edits.push({ start: s.start + t.index, end: s.start + t.index + t[0].length, text: "", kind: "insult", label: ENTRIES[1].label });
        const h = INSULT_HEAD.exec(s.text);
        if (h) edits.push({ start: s.start + h[1].length, end: s.start + h[0].length, text: "", kind: "insult", label: ENTRIES[1].label });
    }
    if (!off.has("hmph")) {
        HMPH.lastIndex = 0;
        for (const m of text.matchAll(HMPH)) edits.push({ start: m.index, end: m.index + m[0].length, text: "", kind: "hmph", label: ENTRIES[2].label });
    }
    return edits;
}

function blushEdits(text, ctx) {
    const names = ctx.names || [];
    const found = blushes(text, names);
    if (!found.length) return [];
    let seen = earlier(ctx, t => blushes(t, names), s => s.type === "narration", `blush\u0001${names.join("\u0002")}`).length;
    const max = windowLeft(ctx, `tsundere-blush\u0001${names.join("\u0002")}`, budgetOf(ctx.settings?.blushBudget, 3), raw => countIn(raw, "narration", t => blushes(t, names)));
    const extra = found.filter(() => seen++ >= max);
    if (!extra.length) return [];
    const r = blushRes(names);
    const sents = sentencesAt(text);
    const edits = [];
    for (const f of extra) {
        let edit = null;
        for (const t of r.tails) {
            t.lastIndex = 0;
            for (const m of text.matchAll(t)) {
                if (m.index <= f.start + 2 && m.index + m[0].length >= f.end) {
                    edit = { start: m.index, end: m.index + m[0].length, text: "", kind: "blush", label: ENTRIES[3].label };
                    break;
                }
            }
            if (edit) break;
        }
        if (!edit) {
            const s = sents.find(x => x.start <= f.start && x.end >= f.end);
            if (s && sents.length > 1 && r.sentence.test(s.text.trim())) edit = sentenceEdit(s, { kind: "blush", label: ENTRIES[3].label });
        }
        if (edit) edits.push(edit);
    }
    return edits;
}

export default {
    id: "tsundere",
    name: "Tsundere filter",
    description: '"It\'s not like I did it for you or anything! Eat." → "Eat."  "Shut up, idiot." → "Shut up."  The character stays; the script goes.',
    scope: "all",
    order: 165,
    defaults: { enabled: true, blushBudget: 3, off: [] },
    options: [
        { key: "blushBudget", type: "number", label: "Blushes kept per budget window (0 = none)", min: 0, max: 50 },
        { key: "off", type: "phrases", label: "Parts (switch one off to leave it as written)" },
    ],
    entries: ENTRIES,

    apply(text, ctx) {
        const off = offSet(ctx.settings?.off);
        if (ctx.segment?.type === "dialogue") return applyEdits(text, speechEdits(text, off), ctx);
        if (off.has("blush")) return text;
        return applyEdits(text, blushEdits(text, ctx), ctx);
    },
};
