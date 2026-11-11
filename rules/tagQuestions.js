// "Deal?" and friends (docs/PLAN.md section 6). PURE: no SillyTavern imports.
// The user: "Deal is ass overall. Remove it." So the tag goes wherever it stands on its own:
//   "Ten coins. Deal?"                      -> "Ten coins."
//   "Ten coins, deal?"                      -> "Ten coins."
//   "Deal?" she asks, holding out her hand. -> She holds out her hand.   (the repair step)
//   "Fine. Do we have a deal?"              -> "Fine."
// Only as a sentence of its own: "We made a deal? When?" and "Deal." (agreeing) stay.

import { MARK } from "../core/marks.js";

// The full-sentence forms of "Deal?", removed when "Deal?" is in the list.
const DEAL_SENTENCES = [
    "do we have a deal",
    "do we have ourselves a deal",
    "have we got a deal",
    "is that a deal",
    "is it a deal",
    "deal or no deal",
    "deal or not",
];

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "Deal?" -> "deal\?+[!?]*" (also "Deal?!"); "Understood." -> "understood\.+".
function tagPattern(tag) {
    const m = /^(.*?)([?!.…~]*)$/s.exec(tag.trim());
    const body = m[1].trim();
    if (!/\p{L}/u.test(body)) return null;
    const words = escapeRe(body).replace(/\s+/g, "\\s+");
    const end = m[2] ? `${escapeRe(m[2][0])}+[!?]*` : "[?!.]+";
    return words + end;
}

const cache = new Map();
function finderFor(tags) {
    const key = tags.join("\u0001");
    if (cache.has(key)) return cache.get(key);
    const alts = tags.map(tagPattern).filter(Boolean);
    if (tags.some(t => t.trim().toLowerCase() === "deal?")) alts.push(...DEAL_SENTENCES.map(s => `${s.replace(/ /g, "\\s+")}\\?+[!?]*`));
    // Standing on its own: after the start, a sentence end, a comma or a dash; followed by the
    // end, a space or a closing asterisk/bracket.
    const re = alts.length
        ? new RegExp(
              `(?<=^[ \\t*_(]*|[.!?…~♡]["”’»」』)\\]*_]*[ \\t]+|,[ \\t]*|[—–][ \\t]*|\\n[ \\t]*)(?:${alts.join("|")})(?=[*_)\\]]*(?:\\s|$))`,
              "giu",
          )
        : null;
    if (cache.size > 20) cache.clear();
    cache.set(key, re);
    return re;
}

function listOf(value) {
    if (Array.isArray(value)) return value.filter(v => typeof v === "string" && v.trim());
    if (typeof value === "string") return value.split("\n").filter(v => v.trim());
    return [];
}

export default {
    id: "tag-questions",
    name: "Deal? (tag questions)",
    description: '"Ten coins. Deal?" → "Ten coins."  "Deal?" she asks, holding out her hand. → She holds out her hand.',
    scope: "all",
    order: 200,
    defaults: { enabled: true, words: ["Deal?"] },
    options: [{ key: "words", type: "list", label: "Tags to remove (one per line)", placeholder: "Deal?" }],

    apply(text, ctx) {
        const re = finderFor(listOf(ctx.settings?.words));
        if (!re) return text;
        re.lastIndex = 0;
        const hits = [];
        const out = text.replace(re, found => {
            hits.push({ before: found, after: "" });
            return MARK;
        });
        return hits.length ? { text: out, hits } : text;
    },
};
