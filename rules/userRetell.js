// Your line retold (docs/PLAN.md section 7, item 47). PURE: no SillyTavern imports.
//
// The reply quotes the user's own line back and narrates the user saying it:
//   user:  I lift the cup. "Is it warm?"
//   reply: "Is it warm?" you ask while your hand lifts the cup. She nods.
//       -> She nods.
// Echo trim can't see this: its short-line case needs "repeats / echoes", and it only touches the
// quote, so "you ask while your hand…" would stay. Here the quote must be attributed to "you" with
// a speech verb right after it, and its words must be the user's (a run of the user's words, or
// 80% of its word triples for a longer line). The quote and the rest of that sentence go. Left
// alone: a sentence that carries another quote ("…you ask, and she says, "Yes.""), a reply that
// would be left empty, a quote the user never said.

import { wordsOf } from "./echoTrim.js";

const VERBS = "ask|say|said|murmur|whisper|mutter|tease|add|repl(?:y|ie)|continue|inquire|wonder|joke|chuckle|laugh|hum|breathe|prod|question|purr|drawl|call|offer";
const RETOLD = new RegExp(
    `(^|[\\s(])[*_]*(["“])([^"“”\\n]{1,200})["”]\\s*,?\\s*[*_]*\\s*you\\s+(?:\\p{L}+ly\\s+)?(?:${VERBS})(?:s|es|ed|d)?\\b`,
    "gu",
);
// The end of the attribution sentence: . ! ? … then space + not lowercase, or the text's end.
const SENT_END = /[.!?…]+[*_]*(?=\s+[^\s\p{Ll}]|\s*$)/u;

function runIn(hay, needle) {
    if (needle.length < 2 || needle.length > hay.length) return false;
    outer: for (let i = 0; i + needle.length <= hay.length; i++) {
        for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
        return true;
    }
    return false;
}

function tripleShare(q, user) {
    const set = new Set();
    for (let i = 0; i + 3 <= user.length; i++) set.add(user.slice(i, i + 3).join(" "));
    let n = 0;
    let hit = 0;
    for (let i = 0; i + 3 <= q.length; i++, n++) if (set.has(q.slice(i, i + 3).join(" "))) hit++;
    return n ? hit / n : 0;
}

export function isUsersLine(quote, lastUser) {
    // The quote is the user speaking, so its "I" and "you" read as in the user's message.
    const q = wordsOf(quote, "user");
    const u = wordsOf(lastUser, "user");
    if (!q.length || !u.length) return false;
    return runIn(u, q) || (q.length >= 4 && tripleShare(q, u) >= 0.8);
}

export default {
    id: "user-retell",
    name: "Your line retold",
    description: '"Is it warm?" you ask while your hand lifts the cup. She nods. → She nods.',
    scope: "message",
    order: 85,
    defaults: { enabled: true },
    options: [],

    apply(text, ctx) {
        try {
            const lastUser = String(ctx.lastUser ?? "");
            if (!lastUser.trim() || !/\byou\b/i.test(text)) return text;
            RETOLD.lastIndex = 0;
            let m;
            while ((m = RETOLD.exec(text))) {
                const start = m.index + m[1].length;
                if (!isUsersLine(m[3], lastUser)) continue;
                const afterVerb = m.index + m[0].length;
                const end = SENT_END.exec(text.slice(afterVerb));
                const stop = end ? afterVerb + end.index + end[0].length : text.length;
                if (/["“”]/.test(text.slice(afterVerb, stop))) continue; // another quote in it
                let before = text.slice(0, start).replace(/[ \t]+$/, "");
                let after = text.slice(stop).replace(/^[ \t]+/, "");
                if (!before.trim()) after = after.replace(/^\s+/, "");
                if (!after.trim()) before = before.replace(/\s+$/, "");
                const out = before && after && !/\n$/.test(before) && !/^\n/.test(after) ? `${before} ${after}` : before + after;
                if (!out.replace(/[\s*_]/g, "")) return text; // nothing left to show
                return { text: out, hits: [{ kind: "retold", before: text.slice(start, stop), after: "" }] };
            }
            return text;
        } catch (e) {
            ctx.log?.(`failed (${e?.message}); left as written`);
            return text;
        }
    },
};
