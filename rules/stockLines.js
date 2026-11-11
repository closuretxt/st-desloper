// Stock lines (docs/PLAN.md section 7, items 10 and 11). PURE: no SillyTavern imports.
//
// Whole lines models reach for, removed where the rest still says everything:
//   "You noticed. Most people don't."           -> "You noticed."
//   "Unlike most people, you came back."        -> "You came back."
//   "No one has ever asked me that before."     -> removed (switchable: sometimes it's true)
//   "You can't just say that!" She laughs.      -> She laughs.
//   …she leans into him. And for now, that was enough.  -> …she leans into him.  (narration,
//                                                  only as the reply's last line)
//   "Say it again." / "You don't get to leave." / "There's a difference."  -> removed (speech)
// The shared repair step fixes what's left: an emptied quote goes and its attribution's action
// stays ('"You can't just say that!" she says, turning red.' -> "She turns red.").
//
// Left alone (each has a fixture): a line the next one leans on ("Most people would run. You
// didn't."), worldbuilding ("Most people here don't trust outsiders."), a real refusal ("You
// can't do that!"), "How could you say that?" without "so casually" (can be real hurt), and a
// reply that is nothing but the line.

import { sentencesAt, plainOf, looseOf, LEAD, sentenceEdit, applyEdits, offSet, othersHaveText } from "../core/speech.js";

// This segment is the reply's last text (nothing after it but blanks).
function lastText(ctx) {
    const seg = ctx.segment;
    return !!seg && !(seg.segments || []).slice(seg.index + 1).some(s => String(s.text ?? "").trim());
}

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

// ---- dramatic replays of the user's words ----------------------------------------------
// "Say it again." / "You don't get to do that." / "There's a difference." The character making a
// scene out of what was just said. "Say that again?" (didn't hear) stays: only ., ! or … endings.
// "There's a difference between X and Y" says what the difference is, so only the bare line goes.
const DRAMA = [
    re(String.raw`${LEAD}(?:(?:please|god|gods|no|wait|again)[,.!…]*\s+)*say (?:it|that|those words|my name)(?: (?:again|one more time|once more|out loud))+(?:,? (?:please|for me))?[.!…~]*$`),
    re(String.raw`${LEAD}(?:(?:no|and|but|so)[,.]?\s+)*you (?:don't|do not|didn't|did not) get to\b`),
    re(String.raw`${LEAD}there(?:'s| is| was) a (?:big |huge |real |massive |world of )?difference${END}`),
];
const DRAMA_QUESTION = /\?[^.!…]*$/;

// ---- moral closers ---------------------------------------------------------------------
// The narrator's last line summing up the feeling: "And for now, that was enough." Only as the
// reply's very last sentence, in narration, with something before it. "It was fine." alone can be
// an answer, so the soft words (okay / fine) need a "for now"-type lead.
const SOFT = String.raw`(?:for now|for once|for tonight|for the moment|for this moment|in that moment|right now|tonight|somehow|maybe|perhaps|just this once|for today|in the end|at least for now|and for now)`;
const BE = String.raw`(?:'s| is| was| would be| would have to be| had to be| will be| felt like| feels like| seemed| seems)`;
const MORAL = [
    re(String.raw`^(?:and |but )?(?:${SOFT},? )*(?:that|this|it)${BE} (?:all that mattered|all that matters|what mattered|what matters|all (?:she|he|they|i|we) (?:needed|need|wanted|could ask for))(?: for now)?${END}`),
    re(String.raw`^(?:(?:and |but )(?:${SOFT},? )*|(?:and |but )?(?:${SOFT},? )+)(?:that|this|it)${BE} (?:enough|everything)(?: for now)?${END}`),
    re(String.raw`^(?:and |but )?(?:that|this|it)(?: would have to be| had to be) enough${END}`),
    re(String.raw`^(?:and |but )?(?:${SOFT},? )+(?:that|this|it)(?:'s| is| was| felt| feels) (?:okay|ok|alright|all right|fine)${END}`),
    re(String.raw`^(?:and |but )?(?:${SOFT},? )*nothing else (?:mattered|matters)${END}`),
    re(String.raw`^(?:and |but )?(?:${SOFT},? )*(?:that|it) (?:made|makes) all the difference${END}`),
    re(String.raw`^(?:and |but )?(?:${SOFT},? )*(?:she|he|they|i|we) (?:wouldn't|would not) have (?:it|had it) any other way${END}`),
];

// ---- grudging yes, and the debt that closes it -----------------------------------------
// "Fine. Since you asked so nicely." The "Fine." is the answer; the quip after it is the habit.
const NICELY = String.raw`(?:(?:but|and)\s+)?(?:only\s+|just\s+)?(?:since|because|cause|'cause|cuz)\s+you\s+asked\s+(?:so\s+|very\s+|real\s+)?(?:nicely|politely|sweetly|kindly)`;
const NICELY_LINE = re(String.raw`^${NICELY}${END}`);
const NICELY_TAIL = new RegExp(String.raw`,\s+${NICELY}(?=[.!?…~]*[*_]?$)`, "iu");
// "But you owe me a big dinner after this. The fancy one with the cake." A favour turned into a
// debt as the quote's last word, then a detail about it. Only when nothing but such details
// follows to the end of the quote: "You owe me. I saved your life." is an argument and stays.
const OWE = re(String.raw`^(?:(?:but|and|oh,? and|just so you know,?|of course,?)\s+)?(?:you(?:'ll|'re going to| will)?\s+(?:so\s+|totally\s+|definitely\s+)?owe\s+me|this means you owe me|you(?:'re| are) (?:so )?(?:buying|paying for|treating me to))\b`);
// A detail fragment: short, and no one doing anything ("The fancy one with the whole fish.").
const DETAIL = s => s.split(/\s+/).length <= 14 && !/\b(?:i|you|we|he|she|they|it|i'm|you're|we're|it's|that's|let's)\b/.test(s);

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
    {
        id: "moral-closer",
        label: '"And for now, that was enough."',
        example: "…she rests her head on his shoulder. And for now, that was enough. → …she rests her head on his shoulder.  Only as the reply's last line; also \"Nothing else mattered.\"",
    },
    {
        id: "asked-nicely",
        label: '"Fine. Since you asked so nicely."',
        example: '"Fine. Since you asked so nicely." → "Fine."  "Fine, since you asked so nicely." → "Fine."',
    },
    {
        id: "owe-me",
        label: '"But you owe me a big dinner."',
        example: '"Okay. But you owe me a big dinner after this. The fancy one with the cake." → "Okay."  Only as the quote\'s last line; "You owe me. I saved your life." stays.',
    },
    {
        id: "drama",
        label: '"Say it again." / "You don\'t get to…"',
        example: '"Say it again. You don\'t get to just leave. There\'s a difference." → removed; "Say that again?" (didn\'t hear) stays',
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

        // A debt closer: the owe line plus the detail fragments after it, to the quote's end.
        let oweFrom = -1;
        if (speech && !off.has("owe-me")) {
            for (let i = 0; i < sents.length; i++) {
                if (!OWE.test(looseOf(sents[i].text))) continue;
                if (sents.slice(i + 1).every(x => DETAIL(looseOf(x.text)))) {
                    oweFrom = i;
                    break;
                }
            }
        }

        sents.forEach((s, i) => {
            const l = looseOf(s.text);
            if (oweFrom >= 0 && i >= oweFrom) {
                edits.push(sentenceEdit(s, { kind: "owe-me", label: ENTRIES[5].label }));
                return;
            }
            if (speech && !off.has("asked-nicely")) {
                if (NICELY_LINE.test(l) && sents.length > 1) {
                    edits.push(sentenceEdit(s, { kind: "asked-nicely", label: ENTRIES[4].label }));
                    return;
                }
                const t = NICELY_TAIL.exec(s.text.replace(/[’‘]/g, "'"));
                if (t) {
                    edits.push({ start: s.start + t.index, end: s.start + t.index + t[0].length, text: "", kind: "asked-nicely", label: ENTRIES[4].label });
                    return;
                }
            }
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
                return;
            }
            // "You don't get to decide that. I do." The next line leans on it: both stay.
            if (speech && !off.has("drama") && !DRAMA_QUESTION.test(l) && DRAMA.some(r => r.test(l)) && !leansNext(i)) {
                edits.push(sentenceEdit(s, { kind: "drama", label: ENTRIES[6].label }));
                return;
            }
            if (!speech && !off.has("moral-closer") && i === sents.length - 1 && lastText(ctx) && (i > 0 || othersHaveText(ctx)) && MORAL.some(r => r.test(l))) {
                // The space before it goes too, so no blank line is left at the reply's end.
                const prev = sents[i - 1];
                const e = sentenceEdit(s, { kind: "moral-closer", label: ENTRIES[3].label });
                if (prev) e.start = prev.end;
                edits.push(e);
            }
        });
        return applyEdits(text, edits, ctx);
    },
};
