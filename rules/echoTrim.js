// Echo trim (docs/PLAN.md section 7, item 3). PURE: no SillyTavern imports.
//
// The reply opens by saying the user's line back to them:
//   user:  I want to leave the forest tonight.
//   reply: "You want to leave the forest tonight?" she asks, tilting her head. "Why?"
//       -> She tilts her head. "Why?"
// Only the first line of dialogue, at the start of the reply (at most one short sentence of
// narration before it), and only its leading sentences. The repair step fixes the attribution
// when the whole quote goes ("she asks, tilting her head" -> "She tilts her head.").
//
// How close is "an echo": the share of the sentence's word triples that are also in the user's
// message (containment, not the plan's Jaccard: the user's message is often much longer than
// the part that's echoed, which would sink a Jaccard score). The user's "I" and the reply's
// "you" are the same word (see mapPerson). A sentence counts when:
//   - it's a question back with at least the set share (60%), or
//   - the narration says it's an echo (repeats / echoes / parrots) and it's at least the set share,
//     or it's short (1-3 words) and every word is the user's ("A dragon egg?" she echoes.).
// A statement that repeats the user, even word for word, stays: it can be agreement
// ("Let's go to the river," she agrees.) or an answer ("What I know about the dragon is little").

import { MARK } from "../core/marks.js";
import { splitSentences } from "../core/sentences.js";

const ECHO_VERB = /\b(?:repeat(?:s|ed|ing)?|echo(?:es|ed|ing)?|parrot(?:s|ed|ing)?)\b/i;

// Who a pronoun points at, so the user's "I" and the reply's "you" are the same word (@u) and
// the reply's "I" is someone else (@a). "Can you help me?" -> "Can I help you?" matches, but
// "I love you." answered with "I love you." doesn't (that's an answer, not an echo).
// Contractions are split ("don't" -> do not).
const FIRST = { i: "@1", me: "@1", my: "@1s", mine: "@1ss", myself: "@1self" };
const SECOND = { you: "@2", your: "@2s", yours: "@2ss", yourself: "@2self" };
const OTHER = { am: "@be", are: "@be", dont: "do not", cant: "can not", wont: "will not", didnt: "did not", "can't": "can not", "won't": "will not", "ain't": "@be not" };
const JOINED_PRONOUN = { "i'm": "i @be", im: "i @be", "you're": "you @be", "i've": "i have", "you've": "you have", "i'll": "i will", "you'll": "you will", "i'd": "i would", "you'd": "you would" };

// side 'user': I = the user (@u), you = the character (@a). side 'reply': the other way round.
export function wordsOf(text, side = "reply") {
    const raw = String(text ?? "")
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .match(/[\p{L}\p{N}']+/gu) || [];
    const out = [];
    for (let w of raw) {
        w = w.replace(/^'+|'+$/g, "");
        if (!w) continue;
        const parts = (JOINED_PRONOUN[w] || (w.endsWith("n't") && !OTHER[w] ? `${w.slice(0, -3)} not` : w)).split(" ");
        for (const p of parts) out.push(...mapPerson(p, side).split(" "));
    }
    return out;
}

// @u = the user, @a = the character, whoever is speaking.
function mapPerson(w, side) {
    const userSpeaks = side === "user";
    if (FIRST[w]) return FIRST[w].replace("@1", userSpeaks ? "@u" : "@a");
    if (SECOND[w]) return SECOND[w].replace("@2", userSpeaks ? "@a" : "@u");
    return OTHER[w] || w;
}

function triples(words) {
    const set = new Set();
    for (let i = 0; i + 3 <= words.length; i++) set.add(words.slice(i, i + 3).join(" "));
    return set;
}

// -> share of the sentence's triples found in the user's message (0..1), or null if too short.
export function overlap(sentence, user) {
    const s = triples(wordsOf(sentence));
    if (!s.size) return null;
    let shared = 0;
    for (const t of s) if (user.triples.has(t)) shared++;
    return shared / s.size;
}

function isEcho(sentence, user, minShare, saysEcho) {
    const words = wordsOf(sentence);
    if (!words.length) return false;
    if (words.length <= 3) return saysEcho && words.every(w => user.words.has(w));
    const share = overlap(sentence, user);
    if (share === null || share < minShare) return false;
    return saysEcho || /\?["”’*_)\]]*$/.test(sentence.trim());
}

const userCache = new Map();
function userInfo(text) {
    if (userCache.has(text)) return userCache.get(text);
    const words = wordsOf(text, "user");
    const info = { words: new Set(words), triples: triples(words) };
    if (userCache.size > 50) userCache.clear();
    userCache.set(text, info);
    return info;
}

const stripStyle = t => t.replace(/[*_]/g, " ").trim();

export default {
    id: "echo-trim",
    name: "Echo trim",
    description: 'The reply opens by saying your line back: "You want to leave the forest tonight?" she asks, tilting her head. "Why?" → She tilts her head. "Why?"',
    scope: "dialogue",
    order: 90,
    defaults: { enabled: true, minShare: 60 },
    options: [{ key: "minShare", type: "number", label: "How much of the line must be your words (%)", min: 30, max: 100 }],

    apply(text, ctx) {
        const lastUser = String(ctx.lastUser ?? "");
        const seg = ctx.segment;
        if (!lastUser.trim() || !seg || !Array.isArray(seg.segments)) return text;
        const { index, segments } = seg;

        // The first line of dialogue, with at most one short sentence of narration before it.
        const before = segments.slice(0, index);
        if (before.some(s => s.type !== "narration")) return text;
        const lead = stripStyle(before.map(s => s.text).join(""));
        const leadSentences = splitSentences(lead).filter(s => s.text.trim());
        if (leadSentences.length > 1 || lead.split(/\s+/).filter(Boolean).length > 12) return text;

        const after = segments[index + 1]?.type === "narration" ? segments[index + 1].text : "";
        const saysEcho = ECHO_VERB.test(after.split(/\s+/).slice(0, 6).join(" ")) || ECHO_VERB.test(lead.split(/\s+/).slice(-4).join(" "));
        const pct = Number(ctx.settings?.minShare);
        const minShare = Number.isFinite(pct) ? Math.min(1, Math.max(0.3, pct / 100)) : 0.6;
        const user = userInfo(lastUser);

        const parts = splitSentences(text);
        let cut = 0; // how many leading parts are echoes (an empty leading part is whitespace)
        const removed = [];
        for (const p of parts) {
            if (!p.text.trim()) {
                cut++;
                continue;
            }
            if (!isEcho(p.text, user, minShare, saysEcho)) break;
            removed.push(p.text);
            cut++;
        }
        if (!removed.length) return text;

        const rest = parts.slice(cut).map(p => p.text + p.space).join("");
        if (!rest.trim()) {
            // The whole quote goes: only if the reply has something else to show.
            const others = segments.filter((s, i) => i !== index && stripStyle(s.text).length);
            if (!others.length) return text;
        } else if (saysEcho) {
            return text; // `"No," she repeats.` would be wrong
        }
        return { text: MARK + rest, hits: [{ kind: "echo", before: removed.join(" "), after: "" }] };
    },
};
