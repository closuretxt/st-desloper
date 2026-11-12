// Hurry closers (docs/PLAN.md section 7, items 16 and 21). PURE: no SillyTavern imports.
//
// The line a reply ends on to push the user along, instead of letting the scene sit:
//   "Sit. Eat before it gets cold!"                       -> "Sit."
//   "Come on. Hurry up, we'll be late. Don't keep me waiting." -> "Come on."   (a run of them)
//   "Here." She sets the bowl down. "Eat up, darling."    -> "Here." She sets the bowl down.
//   "Drink your tea before it gets cold."                 -> "Drink your tea."  (the tail only)
//   ...the door creaks open. What do you do?              -> ...the door creaks open.
// Parts, each with its own switch: food ("…before it gets cold"), waiting ("Don't keep me
// waiting", "Tick tock", "Come on."), handovers ("Your move.", "What do you say?"), dares ("Show me
// what you've got.", "Prove it."; mid-reply too with "dare-mid", when the quote keeps another
// line) and the narrator's hook
// ("What do you do?"), plus the made-up rush tail ("Lift me up before the claw warms up!" ->
// "Lift me up!"), cut from speech like the cold-food tail.
//
// Where: only the end of the reply. A run of closers at the end of the reply's last quote goes
// (narration after it, like "she says, turning away.", may follow). A quote that is nothing but
// closers goes only when she said something earlier in the reply, so she never loses her only
// line. The narrator's hook goes only as the reply's very last sentence. Mid-reply they stay: there
// they can be the plot ("Hurry! The bridge is going!" then more). The "before it gets cold" tail
// is cut anywhere it ends a sentence with a real instruction in front of it.
//
// The waiting beat ("wait-beat") is the narration's call to action: the character freezes and
// hands the turn to the user ("…, looking up at him, waiting." / "She waits for his answer." /
// "…and looks at him expectantly."). Banned anywhere in narration, not budgeted (the user,
// 2026-11-11: "that's a call to action"). The tail goes; a sentence that's only the beat goes
// when the narration keeps another sentence.

import { sentencesAt, looseOf, LEAD, sentenceEdit, applyEdits, offSet, othersHaveText, persons } from "../core/speech.js";

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = s => new RegExp(s, "u");

// Who a closer may be said to, as its last word: "Eat up, darling." / "Hurry, Seraphina!"
const VOCATIVE = String.raw`now|then|okay|ok|alright|already|darling|dear|love|sweetie|sweetheart|honey|hon|kid|child|little one|you two|everyone|all of you|boys|girls|guys`;
const COLD = String.raw`(?:before (?:it|they|the [a-z]+|your [a-z]+) (?:gets?|goes|go|turns?|grows?) cold|while (?:it's|it is|they're|they are) (?:still )?(?:hot|warm|fresh))`;
const NUDGE = String.raw`(?:(?:now|come on|go on|so|okay|ok|here)[,!]? )?`;

const FOOD = [
    String.raw`${NUDGE}(?:(?:eat|drink)(?: up)?|finish (?:it|that|up|your [a-z]+)),? ${COLD}`,
    String.raw`${NUDGE}(?:eat up|drink up|dig in|eat,? eat|tuck in)`,
    String.raw`${NUDGE}(?:don't|do not) let (?:it|them|the [a-z]+|your [a-z]+) (?:get|go|grow|turn) cold`,
    String.raw`(?:it's|it is|they're|they are|(?:your|the) [a-z]+(?:'s| is)) (?:getting|going|gonna get|going to get) cold`,
    String.raw`(?:it|they)(?:'ll| will) (?:get|go) cold`,
    String.raw`${NUDGE}${COLD}`,
    String.raw`(?:it|that|the food) won't eat itself`,
];
const WAITING = [
    String.raw`${NUDGE}(?:hurry(?: up)?|quickly|quick,? quick|chop,? chop|tick,? tock|move it|get moving|get a move on|step on it|pick up the pace|keep up)`,
    String.raw`(?:let's (?:go|move),? )+let's (?:go|move)`,
    String.raw`${NUDGE}(?:don't|do not) keep (?:me|us|them|her|him|everyone|the [a-z]+) waiting`,
    String.raw`(?:i|we) (?:don't|do not|haven't|have not) (?:got |have )?all (?:day|night|week)`,
    String.raw`(?:the )?clock(?:'s| is) ticking`,
    String.raw`time(?:'s| is) (?:wasting|running out)`,
    String.raw`we(?:'re| are) (?:losing|wasting) (?:time|daylight)`,
    String.raw`we(?:'ll| will|'re going to| are going to|'re gonna| are gonna) be late`,
    String.raw`(?:we|we'd) (?:should|better|had better|ought to) (?:get going|get moving|head out|head back|go now|be going|hurry|get a move on)`,
    String.raw`(?:let's|let us) (?:get going|get moving|head out|hurry|get a move on)`,
    String.raw`(?:well,? )?i'm waiting`,
    // A bare "Come on, kid." nudge: one word may follow as who it's said to.
    String.raw`(?:come on|c'mon)(?:,? [a-z]+)?`,
];
// The dare: "Show me what you've got." At the reply's end ("dare"), or anywhere in speech with
// its own switch ("dare-mid"). One word may follow as who it's said to ("…best shot, rookie.").
const DARE = [
    String.raw`${NUDGE}(?:show me|let's see|let me see)(?:,? then,?)? what you(?:'ve| have)?(?: really)? got(?:,? [a-z]+)?`,
    String.raw`${NUDGE}(?:prove it|impress me|dazzle me|bring it(?: on)?|do your worst|give it your best shot|give me your best shot|hit me with your best shot|let's see you try)(?:,? [a-z]+)?`,
];
const HANDOVER = [
    String.raw`(?:so,? |well,? |now,? )?what are you waiting for`,
    String.raw`(?:so,? |well,? |now,? )?(?:your move|your call|your turn|the choice is yours(?: to make)?|the decision is yours|it's your (?:choice|call|move|turn|decision)|it's up to you|(?:the )?ball's in your court|the ball is in your court|over to you|what do you say|what'll it be|what will it be|what's it (?:going to|gonna) be|what's your answer|shall we|ready when you are|well|so)`,
];
// The narrator asking the player: only as the reply's last sentence, in narration.
const HOOK = [
    String.raw`(?:so,? |now,? |well,? )?what (?:do|will|would|does|should|can) (?:you|PERSON) do(?: next| now| about (?:it|this|that|him|her|them))?`,
    String.raw`(?:what's|what is) your (?:next )?move`,
    String.raw`how (?:do|will) (?:you|PERSON) (?:respond|answer|react)`,
    String.raw`what (?:do|will) (?:you|PERSON) say`,
    String.raw`(?:the )?(?:choice|decision|next move) is yours(?: to make)?`,
    String.raw`(?:it's|it is) your (?:move|turn|call|choice)`,
];

export const ENTRIES = [
    { id: "food", label: 'Food ("…before it gets cold!")', example: '"Sit. Eat before it gets cold!" → "Sit."  "Drink your tea before it gets cold." → "Drink your tea."' },
    { id: "waiting", label: 'Waiting ("Don\'t keep me waiting")', example: '"Come on. Hurry up, we\'ll be late." → "Come on."  Also "Tick tock.", "I don\'t have all day."' },
    { id: "handover", label: 'Handovers ("Your move.")', example: '"Here\'s the map. Your move." → "Here\'s the map."  Also "What do you say?", "Well?"' },
    { id: "dare", label: 'Dares ("Show me what you\'ve got.")', example: '"Not bad. Show me what you\'ve got." → "Not bad."  Also "Prove it.", "Impress me.", "Do your worst."' },
    { id: "come-on", label: '"Come on" + an order ("Come on. Show me!")', example: '…her eyes wide. "Come on, rookie. Send me flying!" → …her eyes wide.  Only at the reply\'s end; goes even as her only line when there\'s narration.' },
    { id: "dare-mid", label: "Dares mid-reply", example: '"Okay, I\'m ready. Give me your best shot." She leans in. → "Okay, I\'m ready." She leans in.  Only when the quote has another line.' },
    { id: "rush", label: 'Made-up rush ("…before it sells out!")', example: '"Lift me up before the claw warms up!" → "Lift me up!"  Also "…before someone else grabs it", "…before the line gets long".' },
    { id: "hook", label: 'Narrator\'s hook ("What do you do?")', example: "…the door creaks open. What do you do? → …the door creaks open.  Only as the reply's last sentence." },
    { id: "wait-beat", label: 'Waiting beat (", looking up at him, waiting.")', example: "She pulls back, looking up at him, waiting. → She pulls back.  Also \"She waits for his answer.\", \"…and looks at him expectantly.\" Anywhere in narration." },
];

// The waiting beat, built once per name list (on the text as written, so "iu").
const waitCache = new Map();
function waitMatchers(names) {
    const p = persons(names);
    if (waitCache.has(p.NAMES)) return waitCache.get(p.NAMES);
    const WHO = String.raw`(?:${p.POSS}(?:\s+(?:face|eyes))?|him|her|them|you|me|${p.NAMES})(?![\p{L}'’])`;
    const WHO_SUBJ = String.raw`(?:he|she|they|you|${p.NAMES})`;
    // What may follow "waiting": who for, what for, how.
    const FOR = String.raw`(?:\s+(?:for\s+(?:${p.POSS}|an?|the)\s+(?:answer|response|reply|move|next\s+move|decision|verdict|reaction|turn)|for\s+(?:him|her|them|you|${p.NAMES})\s+to\s+(?:answer|respond|reply|speak|talk|say\s+something|decide|react|continue|go\s+on|make\s+(?:a|the\s+first|the\s+next|${p.POSS})\s+move)|to\s+see\s+what\s+${WHO_SUBJ}(?:\s+(?:will|would)|['’]ll|['’]d)?\s+(?:do|does|did|say|says|said|decide|decides|decided)))?`;
    const HOW = String.raw`(?:\s+(?:patiently|expectantly|quietly|silently|eagerly|hopefully))?`;
    const WAIT = String.raw`(?:waiting${FOR}${HOW}|expectant)`;
    const LOOK = String.raw`(?:\s+(?:up|down|back|over))?\s+at\s+${WHO}`;
    const LOOK_ING = String.raw`(?:looking|gazing|peering|staring)${LOOK}`;
    const LOOK_FIN = String.raw`(?:looks|looked|gazes|gazed|peers|peered|stares|stared)${LOOK}`;
    const END = String.raw`(?=[*_]{0,3}[.!?…~])`;
    const c = {
        tail: [
            // ", looking up at him, waiting." / ", looking at him expectantly." / ", waiting."
            new RegExp(String.raw`,\s+(?:${LOOK_ING}(?:\s+expectantly)?,\s+${WAIT}|${LOOK_ING}\s+expectantly|${WAIT})${END}`, "giu"),
            // "…and waits for his answer." / "…and looks at him expectantly."
            new RegExp(String.raw`,?\s+and\s+(?:(?:waits|waited)${FOR}${HOW}|${LOOK_FIN}(?:\s+expectantly|,\s+${WAIT}))${END}`, "giu"),
        ],
        // A bare ", waiting." goes only after a person ("She leans back, waiting."), not after
        // "The taxi idles at the curb, waiting."
        bare: /^,\s+(?:waiting|expectant)$/iu,
        person: new RegExp(String.raw`^[*_]?${p.SUBJ}(?![\p{L}'’])`, "u"),
        sentence: new RegExp(String.raw`^[*_]?(?:(?:Then|And|Now|So),?\s+)?(?:${p.SUBJ}\s+)?(?:(?:just|simply|only|then|merely|still)\s+)?(?:(?:waits|waited)${FOR}${HOW}|${LOOK_FIN}(?:\s+expectantly|,\s+${WAIT})),?[.!…]+[*_]?$`, "iu"),
    };
    if (waitCache.size > 20) waitCache.clear();
    waitCache.set(p.NAMES, c);
    return c;
}

// Matchers for one name list (built once per list).
const cache = new Map();
function matchers(names) {
    const list = (names || []).filter(n => typeof n === "string" && n.trim()).map(n => esc(n.trim().toLowerCase()));
    const key = list.join("\u0001");
    if (cache.has(key)) return cache.get(key);
    const person = list.length ? list.join("|") : "(?!)";
    const voc = String.raw`(?:,?\s+(?:${VOCATIVE}|${person}))*`;
    // A "," may end it before a tag: "Don't keep me waiting," she says.
    const whole = parts => parts.map(p => re(String.raw`${LEAD}${p.replace(/PERSON/g, person)}${voc}[.,!?…~]*$`));
    // "Hurry up and …" counts with whatever follows: at the end of a reply the rest is the
    // over-explained errand ("Hurry up and unlock the door, my keys are on the shelf by the
    // window!"); a short line before it ("Well?!") already says she wants in (user, 2026-11-09).
    const opener = re(String.raw`${LEAD}${NUDGE}hurry(?: up)?(?: and\b|,\s)`);
    const m = { food: whole(FOOD), waiting: [...whole(WAITING), opener], handover: whole(HANDOVER), dare: whole(DARE), hook: whole(HOOK) };
    if (cache.size > 20) cache.clear();
    cache.set(key, m);
    return m;
}

// The "before it gets cold" tail at a sentence's end, on the text as written.
const COLD_TAIL = /,?\s+(?:before (?:it|they|the \p{L}+|your \p{L}+)\s+(?:gets?|goes|go|turns?|grows?)\s+cold|while (?:it['’]s|it is|they['’]re|they are) (?:still )?(?:hot|warm|fresh))(?=[*_]{0,3}[.!?…~]*[*_]{0,3}\s*$)/iu;
// A made-up race at a request's end: "Lift me up before the claw warms up!", "…get the bear before
// the stall next door sells out!". Only things nobody is racing in the scene (selling out,
// warming up, filling up, someone else taking it); "before the gate closes" can be the plot.
const RUSH_TAIL = /,?\s+before\s+(?:the|that|this|those|these|it|they|someone|somebody|anyone|anybody|everyone|everybody|all|my|your|our|his|her|their)(?:\s+[\p{L}'’-]+){0,3}?\s+(?:(?:sells?|sold|runs?|ran)\s+out|warms?\s+up|cools?\s+(?:down|off)|fills?\s+up|gets?\s+(?:too\s+|any\s+)?(?:crowded|busy|packed|full|long|longer)|(?:takes?|grabs?|snatches?|steals?|gets?|nabs?)\s+(?:it|them|that|those|the\s+\p{L}+|our\s+\p{L}+|my\s+\p{L}+|your\s+\p{L}+)(?:\s+first)?|changes?\s+(?:its|his|her|their|my|your)\s+mind)(?=[*_]{0,3}[.!?…~]*[*_]{0,3}\s*$)/iu;

// "Come on, kid." as its own sentence, or "Come on, kid, …" in front of the order.
const COME_ALONE = /^(?:(?:oh|hey|well|so)[,!]?\s+)?(?:come on|c'mon|go on)(?:[,!]?\s+[a-z'-]+)?[.!…~]*$/;
const COME_LEAD = /^(?:(?:oh|hey|well|so)[,!]?\s+)?(?:come on|c'mon|go on)(?:[,!]\s+[a-z'-]+)?[,!]\s+/;
// An order: no subject in front, short, not a question ("Send me flying!", "Let's go!",
// "Don't be shy!"). "You can do it!" or "It's fine." aren't orders.
const NOT_COMMAND = /^(?:i|i'm|i'll|i've|i'd|you|you're|you'll|you've|you'd|he|he's|she|she's|we|we're|we'll|they|they're|it|it's|this|that|that's|these|those|there|there's|here|here's|the|a|an|my|your|his|her|our|their|its|what|who|why|how|when|where|is|are|was|were|do|does|did|can|could|would|will|should|shall|maybe|no|yes|yeah|not|nothing|everyone|someone|okay|ok|fine|well|now|and|but|so|if|because|or|oh|ah|hm+|mm+|heh|ha)\b/;
function isCommand(l) {
    const t = l.replace(/^please,?\s+/, "").trim();
    if (!/^[a-z]/.test(t) || /\?/.test(t) || NOT_COMMAND.test(t)) return false;
    return t.split(/\s+/).length <= 12;
}

// A head too bare to keep alone ("Eat", "Come on, drink"): the whole line is the closer then.
const BARE = /^[\s*_"]*(?:(?:now|come on|go on|so|okay|ok|here)[,!]?\s+)*(?:eat|drink|hurry|eat up|drink up|go|quick(?:ly)?|finish(?: up)?)[\s*_,]*$/i;

function lastSpeech(ctx) {
    const seg = ctx.segment;
    if (!seg || seg.type !== "dialogue") return false;
    return !seg.segments.slice(seg.index + 1).some(s => s.type === "dialogue" && String(s.text ?? "").trim());
}
function earlierSpeech(ctx) {
    const seg = ctx.segment;
    return (seg?.segments || []).slice(0, seg.index).some(s => s.type === "dialogue" && String(s.text ?? "").trim());
}
function lastText(ctx) {
    const seg = ctx.segment;
    return !(seg?.segments || []).slice(seg.index + 1).some(s => String(s.text ?? "").trim());
}

export default {
    id: "hurry-closers",
    name: "Hurry closers",
    description: '"Sit. Eat before it gets cold!" → "Sit."  Only at the end of the reply; also "Don\'t keep me waiting", "Your move.", "What do you do?".',
    scope: "all",
    order: 162,
    defaults: { enabled: true, off: [] },
    options: [{ key: "off", type: "phrases", label: "Closers (switch one off to leave it as written)" }],
    entries: ENTRIES,

    apply(text, ctx) {
        const seg = ctx.segment;
        if (!seg) return text;
        const off = offSet(ctx.settings?.off);
        const speech = seg.type === "dialogue";
        const sents = sentencesAt(text);
        if (!sents.length) return text;
        const m = matchers(ctx.names);
        const parts = speech ? ["food", "waiting", "handover", "dare"] : ["hook"];
        const kindOf = s => {
            const l = looseOf(s.text);
            return parts.find(p => !off.has(p) && m[p].some(r => r.test(l)));
        };
        const edits = [];
        const gone = new Set();

        // A run of closers at the very end of the reply's last quote, or the narrator's last line.
        const atEnd = speech ? lastSpeech(ctx) : lastText(ctx);
        if (atEnd) {
            let j = sents.length - 1;
            const run = [];
            for (let k; j >= 0 && (k = kindOf(sents[j])); j--) run.push({ s: sents[j], k });
            // Narration: the hook is one line, the last one.
            if (!speech && run.length > 1) run.splice(1);
            if (!speech) j = sents.length - 1 - run.length;
            // A quote that is all closers ("Well?! Hurry up and unlock the door…"): the first one
            // stays. A short "Well?!" says she wants in without spelling it out.
            if (speech && j < 0 && run.length > 1) {
                run.pop();
                j = 0;
            }
            const keep = j >= 0 || (speech ? earlierSpeech(ctx) : othersHaveText(ctx));
            if (run.length && keep) {
                for (const { s, k } of run) {
                    edits.push(sentenceEdit(s, { kind: "hurry", part: k, label: ENTRIES.find(e => e.id === k).label }));
                    gone.add(s);
                }
            }
        }

        // "Come on, kid. Show me the way!" at the reply's end: the nudge and the order it pushes
        // count as one closer. Unlike the others it goes even as her only line, when the reply
        // has narration to end on (the user, 2026-11-11: "it's literally come on").
        if (speech && atEnd && !gone.size && !off.has("come-on")) {
            const label = ENTRIES.find(e => e.id === "come-on").label;
            for (let c = sents.length - 1; c >= Math.max(0, sents.length - 3); c--) {
                const l = looseOf(sents[c].text);
                let hit = false;
                if (COME_ALONE.test(l)) {
                    const rest = sents.slice(c + 1);
                    hit = rest.length >= 1 && rest.length <= 2 && rest.every(s => isCommand(looseOf(s.text)));
                } else if (c === sents.length - 1) {
                    const lead = COME_LEAD.exec(l);
                    hit = !!lead && isCommand(l.slice(lead[0].length));
                }
                if (!hit) continue;
                if (c > 0 || earlierSpeech(ctx) || othersHaveText(ctx)) {
                    for (const s of sents.slice(c)) {
                        edits.push(sentenceEdit(s, { kind: "hurry", part: "come-on", label }));
                        gone.add(s);
                    }
                }
                break;
            }
        }

        // Dares anywhere in speech, when the quote keeps a line that isn't one.
        if (speech && !off.has("dare-mid")) {
            const isDare = s => m.dare.some(r => r.test(looseOf(s.text)));
            const dares = sents.filter(s => !gone.has(s) && isDare(s));
            if (dares.length && sents.some(s => !gone.has(s) && !isDare(s))) {
                const label = ENTRIES.find(e => e.id === "dare-mid").label;
                for (const s of dares) {
                    edits.push(sentenceEdit(s, { kind: "hurry", part: "dare-mid", label }));
                    gone.add(s);
                }
            }
        }

        // The waiting beat, anywhere in narration.
        if (!speech && !off.has("wait-beat")) {
            const w = waitMatchers(ctx.names);
            const label = ENTRIES.find(e => e.id === "wait-beat").label;
            for (const s of sents) {
                if (gone.has(s)) continue;
                const body = s.text.trim();
                if (sents.length > 1 && w.sentence.test(body)) {
                    edits.push(sentenceEdit(s, { kind: "hurry", part: "wait-beat", label }));
                    gone.add(s);
                    continue;
                }
                for (const r of w.tail) {
                    r.lastIndex = 0;
                    const t = [...s.text.matchAll(r)].find(x => !w.bare.test(x[0]) || w.person.test(body));
                    if (!t) continue;
                    edits.push({ start: s.start + t.index, end: s.start + t.index + t[0].length, text: "", kind: "hurry", part: "wait-beat", label });
                    break;
                }
            }
        }

        // The tail alone, where a real instruction stands in front of it.
        if (!off.has("food")) {
            for (const s of sents) {
                if (gone.has(s)) continue;
                const t = COLD_TAIL.exec(s.text);
                if (!t || BARE.test(s.text.slice(0, t.index))) continue;
                edits.push({ start: s.start + t.index, end: s.start + t.index + t[0].length, text: "", kind: "hurry", part: "food", label: ENTRIES[0].label });
            }
        }
        // The made-up race, in speech, anywhere it ends a sentence with a real request in front.
        if (speech && !off.has("rush")) {
            const label = ENTRIES.find(e => e.id === "rush").label;
            for (const s of sents) {
                if (gone.has(s)) continue;
                const t = RUSH_TAIL.exec(s.text);
                if (!t || BARE.test(s.text.slice(0, t.index))) continue;
                edits.push({ start: s.start + t.index, end: s.start + t.index + t[0].length, text: "", kind: "hurry", part: "rush", label });
            }
        }
        return applyEdits(text, edits, ctx);
    },
};
