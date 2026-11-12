// "…, before dinner." time tails (docs/PLAN.md section 6). PURE: no SillyTavern imports.
// The finder is a hand-written regex (its lookbehinds keep "back before noon", "done before
// dinner"...), with one addition: a comma that ends the quote also counts as an end, so
// `"…the report, before dinner," she says.` is caught too. On top of it: skip when fewer than
// `minWords` words would be left in the sentence ("Sometime before dinner." stays). The comma
// before the tail goes with it; the end punctuation stays. Left alone too: a clause whose verb is
// "be" (the time is what it says: "curfew isn't until ten", "we could be at the station before
// five"); "will be scrubbing the floor until dawn" is a real verb, so it still goes.

import { MARK } from "../core/marks.js";

// Also: more time words ("…by Friday.", "…until dawn."), "by" and "till", clock times in digits,
// and the bell with its verb ("…before the bell rang."). The time must still close the sentence,
// so "until dawn, when…" or "by Friday's meeting" stay.
const GUARD = "meet|leave|back|home|done|finish|finished|ready|wait|open|closed|free|busy|due";
const NUMBER = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
// Times that read right after before / until / till / by.
const WHEN_WORDS = [
    "lunch|dinner|supper|breakfast|noon|midday|midnight|class|practice|bedtime|curfew|lights out",
    "tonight|tomorrow|morning|afternoon|evening",
    "sunset|sundown|sunrise|dawn|dusk|nightfall|daybreak",
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday|the weekend|the end of the (?:day|week|month)",
    // Digits only with a clock mark: "before 10 people" is not a time.
    "(?:1[0-2]|[1-9])(?::[0-5]\\d(?: ?[ap]\\.?m\\.?)?| ?[ap]\\.?m\\.?| o.clock)",
].join("|");
const WHEN = `${WHEN_WORDS}|(?:${NUMBER})(?: o.clock| thirty)?`;
// After "by", a number word counts only with o'clock / thirty: a bare one is a count, not a time
// ("one by one", "two by two", "won by three", "missed it by one").
const WHEN_BY = `${WHEN_WORDS}|(?:${NUMBER})(?: o.clock| thirty)`;
// The bell only after before / until: "woken by the bell" is who woke you, not when.
const BELL = "the (?:first |final |last )?bell(?: (?:even |had |has )?(?:rang|rings|rung))?";
const AFTER = "(?: in the [a-z]+| tonight| tomorrow| today| this (?:morning|afternoon|evening|week))?";

const TAIL_RE = new RegExp(
    `(?<!\\b(?:${GUARD}))(?<!\\b(?:${GUARD}),),? (?:(?:before|until|till) (?:${BELL}|${WHEN})|by (?:${WHEN_BY}))${AFTER}(?=[.!?~♡"”…]|,?$)`,
    "gi",
);

// The time is the point of the clause, not a tail, when the clause's verb is "be" ("curfew isn't
// until ten", "we could be at the station before five"): cutting it leaves "curfew isn't." Not
// "be" + -ing ("will be standing in the window by Friday"): that's the verb, the time a tail.
const BE = /(?:\b(?:is|isn['’]t|are|aren['’]t|was|wasn['’]t|were|weren['’]t|am|be|been)\b|\b(?:it|that|this|he|she|there|what|who|where|which)['’]s\b|['’](?:re|m)\b)(?!\s+(?:\p{L}+ly\s+)?\p{L}+ing\b)/iu;

// The clause before position `at`: back to the last comma, semicolon, dash or sentence start.
function clauseBefore(text, at) {
    const head = text.slice(0, at);
    const cut = Math.max(...[/[.!?…~♡]["”’»」』)\]*_]*\s+/g, /[,;:—–]|\n/g].map(re => {
        let last = 0;
        for (const m of head.matchAll(re)) last = m.index + m[0].length;
        return last;
    }));
    return head.slice(cut);
}

// Words in the sentence before position `at` (a sentence starts after . ! ? … ~ ♡ or a line break).
function wordsBefore(text, at) {
    const head = text.slice(0, at);
    let start = 0;
    const re = /[.!?…~♡]["”’»」』)\]*_]*\s+|\n/g;
    let m;
    while ((m = re.exec(head))) start = m.index + m[0].length;
    return (head.slice(start).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

export default {
    id: "time-tails",
    name: "Time tails",
    description: '"I\'ll finish the report, before dinner." → "I\'ll finish the report."',
    scope: "all",
    order: 220,
    defaults: { enabled: true, minWords: 3 },
    options: [{ key: "minWords", type: "number", label: "Words that must be left in the sentence", min: 1, max: 10 }],

    apply(text, ctx) {
        if (!/\b(?:before|until|till|by)\b/i.test(text)) return text;
        const min = Number.isFinite(Number(ctx.settings?.minWords)) ? Number(ctx.settings.minWords) : 3;
        const hits = [];
        TAIL_RE.lastIndex = 0;
        const out = text.replace(TAIL_RE, (found, ...rest) => {
            const at = rest[rest.length - 2];
            if (wordsBefore(text, at) < min) return found;
            if (BE.test(clauseBefore(text, at))) return found;
            hits.push({ before: found.trim().replace(/^,\s*/, ""), after: "" });
            return MARK;
        });
        return hits.length ? { text: out, hits } : text;
    },
};
