// Stock lines (docs/PLAN.md section 7, items 10 and 11). PURE: no SillyTavern imports.
//
// Whole lines models reach for, removed where the rest still says everything:
//   "You noticed. Most people don't."           -> "You noticed."
//   "Unlike most people, you came back."        -> "You came back."
//   "No one has ever asked me that before."     -> removed (switchable: sometimes it's true)
//   "You can't just say that!" She laughs.      -> She laughs.
// The shared repair step fixes what's left: an emptied quote goes and its attribution's action
// stays ('"You can't just say that!" she says, turning red.' -> "She turns red.").
//
// Left alone (each has a fixture): a line the next one leans on ("Most people would run. You
// didn't."), worldbuilding ("Most people here don't trust outsiders."), a real refusal ("You
// can't do that!"), "How could you say that?" without "so casually" (can be real hurt), and a
// reply that is nothing but the line.

import { sentencesAt, plainOf, looseOf, LEAD, sentenceEdit, applyEdits, offSet } from "../core/speech.js";

const END = String.raw`[.!?…~]*$`;
const re = s => new RegExp(s, "u");

// ---- "most people" ---------------------------------------------------------------------
const CROWD = String.raw`(?:most(?: other)? (?:people|folks|guys|girls|men|women|humans|others|of them)|not many(?: people| folks| others)?|(?:very )?few (?:people|others|folks)|hardly anyone|barely anyone|not everyone|no one else|nobody else|anyone else|other people|(?:the )?others|people)`;
const HABIT = String.raw`(?:don't|doesn't|do not|wouldn't|would not|would|would've|would have|never|can't|cannot|couldn't|won't|usually|normally|tend to|even|bother|ever|just)`;
const MOST = [
    re(String.raw`${LEAD}${CROWD}(?: [a-z']+){0,3}? ${HABIT}\b`),
    re(String.raw`${LEAD}(?:most|few|not many) (?:would|wouldn't|don't|never|can't|couldn't|won't|just|even)\b`),
    re(String.raw`${LEAD}(?:usually|normally|typically),? (?:people|guys|girls|folks|men|women|others)\b`),
    re(String.raw`${LEAD}(?:you(?:'re| are)|you were) (?:not|nothing) like (?:most|the others|other (?:people|guys|girls|men|women)|anyone else|the rest)\b`),
    re(String.raw`${LEAD}(?:you(?:'re| are)|you were) (?:so )?different from (?:most|the others|other (?:people|guys|girls|men|women)|everyone else)\b`),
    re(String.raw`${LEAD}not like most(?: people| others)?${END}`),
];
// A place word: "Most people here don't trust outsiders." is the world, not a compliment.
const PLACE = /\b(?:here|around here|in this|in these|in town|in the (?:city|village|capital|guild|kingdom|empire|north|south|east|west|old days)|these days|nowadays|in my (?:line|family|village|town|world)|back home|where i'm from|where i come from)\b/;
const FIRSTS = [
    re(String.raw`${LEAD}(?:no one|nobody)(?: else)?(?:'s| has| had)? ever (?:[a-z]+ ){0,1}(?:asked|said|told|done|looked|noticed|bothered|called|treated|made|given|cared|thought|offered|complimented|remembered|talked|spoken|stood|stayed|listened)\b`),
    re(String.raw`${LEAD}(?:you(?:'re| are)|you were) the (?:first|only) (?:one|person|man|woman|guy|girl)(?: (?:who|to|that|i've|ever))\b`),
];
// The next sentence leans on this one: "Most people would run. You didn't." / "Not you."
const LEANS = /^(?:but\s+)?(?:(?:you|he|she|they|i|we)\s+(?:[a-z]+\s+)?(?:did|didn't|do|don't|does|doesn't|would|wouldn't|could|couldn't|can|can't|will|won't|was|wasn't|were|weren't|have|haven't|had|hadn't|did not|do not)|not\s+(?:you|him|her|them|me|this one))\b[^.!?]*[.!?…~]*$/;
const UNLIKE = /^([*_]?)(?:unlike (?:most(?: people| others| guys| girls| folks)?|the others|other (?:people|guys|girls)|everyone else|anyone else)(?: (?:i know|i've met|around here))?),\s+(?=\p{L})/iu;
const MORE_THAN_MOST = /,\s+(?:which is |and that's )?more than (?:most|many|anyone else)(?: (?:people|folks|guys|girls))?(?: (?:can|could|would|do|did|ever do|bother(?: to)?)(?: (?:say|manage|do))?)?(?=[.!?…~]*[*_]?$)/iu;

// ---- scandalized protests --------------------------------------------------------------
const WHAT = String.raw`(?:that|this|it|things like that|stuff like that|something like that|such things|that kind of thing|those things|that sort of thing|stuff like this|things like this)`;
const HOW = String.raw`(?:so casually|out loud|like that|with a straight face|to me|to a girl|to a lady|anymore|in public|so easily|so suddenly|so bluntly|so calmly|so seriously|like it's nothing|right now)`;
const PROTEST = [
    re(String.raw`${LEAD}(?:you )?(?:can't|cannot|can not|shouldn't)(?: just)? (?:say|ask|tell me|blurt(?: out)?|go around saying|spring|drop)(?: (?:me|a girl|a lady|someone|people|her|him))? ${WHAT}(?: ${HOW})*${END}`),
    re(String.raw`${LEAD}(?:don't|do not)(?: just)? say (?:things|stuff|something|that|it)(?: like that)? ${HOW}(?: ${HOW})*${END}`),
    re(String.raw`${LEAD}(?:don't|do not) just say (?:things|stuff) like (?:that|this)${END}`),
    re(String.raw`${LEAD}how (?:can|could) you (?:just )?(?:say|ask) ${WHAT} ${HOW}(?: ${HOW})*${END}`),
];

// Hurry and handover closers ("Eat before it gets cold!") have their own rule: rules/hurryClosers.js.

export const ENTRIES = [
    {
        id: "most-people",
        label: '"Most people don\'t…"',
        example: '"You noticed. Most people don\'t." → "You noticed."  "Unlike most people, you came back." → "You came back."',
    },
    {
        id: "firsts",
        label: '"No one has ever…" / "You\'re the first…"',
        example: '"No one has ever asked me that before." → removed (switch off if your story needs it)',
    },
    {
        id: "protest",
        label: '"You can\'t just say that!"',
        example: '"You can\'t just say that!" She laughs. → She laughs.  ("You can\'t do that!" stays: a real refusal)',
    },
];

const aboutYou = text => /\b(?:you|your|you're|yours|yourself)\b/i.test(plainOf(text));

export default {
    id: "stock-lines",
    name: "Stock lines",
    description: '"You noticed. Most people don\'t." → "You noticed."  "You can\'t just say that!" She laughs. → She laughs.',
    scope: "all",
    order: 160,
    defaults: { enabled: true, off: [] },
    options: [{ key: "off", type: "phrases", label: "Lines (switch one off to leave it as written)" }],
    entries: ENTRIES,

    apply(text, ctx) {
        const off = offSet(ctx.settings?.off);
        const speech = ctx.segment?.type === "dialogue";
        const sents = sentencesAt(text);
        if (!sents.length) return text;
        const edits = [];
        const names = (ctx.names || []).map(n => String(n).toLowerCase());
        // "About you": in speech the quote talks to someone; in narration a neighbour sentence
        // says "you" or a name.
        const nearYou = i => {
            if (speech) return aboutYou(text);
            const near = [sents[i - 1]?.text, sents[i + 1]?.text].filter(Boolean).join(" ");
            const l = looseOf(near);
            return aboutYou(near) || names.some(n => n && l.includes(n));
        };
        const leansNext = i => {
            const next = sents[i + 1];
            if (!next) return false;
            const l = looseOf(next.text);
            return l.split(/\s+/).length <= 6 && LEANS.test(l);
        };

        sents.forEach((s, i) => {
            const l = looseOf(s.text);
            if (!off.has("most-people")) {
                if (MOST.some(r => r.test(l)) && !PLACE.test(l) && nearYou(i) && !leansNext(i)) {
                    edits.push(sentenceEdit(s, { kind: "most-people", label: ENTRIES[0].label }));
                    return;
                }
                const u = UNLIKE.exec(s.text);
                if (u) {
                    // The repair step capitalizes the new sentence start ("you came back" -> "You came back").
                    edits.push({ start: s.start + u[1].length, end: s.start + u[0].length, text: "", kind: "most-people", label: ENTRIES[0].label });
                    return;
                }
                const t = MORE_THAN_MOST.exec(s.text);
                if (t) {
                    edits.push({ start: s.start + t.index, end: s.start + t.index + t[0].length, text: "", kind: "most-people", label: ENTRIES[0].label });
                    return;
                }
            }
            if (speech && !off.has("firsts") && FIRSTS.some(r => r.test(l)) && !leansNext(i)) {
                edits.push(sentenceEdit(s, { kind: "firsts", label: ENTRIES[1].label }));
                return;
            }
            if (speech && !off.has("protest") && PROTEST.some(r => r.test(l))) {
                edits.push(sentenceEdit(s, { kind: "protest", label: ENTRIES[2].label }));
            }
        });
        return applyEdits(text, edits, ctx);
    },
};
