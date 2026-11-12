// Contractions written out. PURE: no SillyTavern imports.
//
//   She doesn't look up. -> She does not look up.     It's late. -> It is late.
//   I'd rather stay.     -> I would rather stay.       She'd gone. -> She had gone.
// A style choice, not slop: off by default, and narration only unless "inside dialogue" is on,
// so a casual character still talks casually. Only forms with one sure reading are written out:
//   n't      always (doesn't -> does not); "ain't" stays (no single long form)
//   won't / can't / shan't  only with "hardcore" on (off by default): the long form is another
//            word, so it changes the voice the most
//   're 'm 'll 've   always, after a pronoun or who / what / there / that
//   's       after it / he / she / that / there / here / what / who / where / how: "is", or
//            "has" before been / got / gotten / had. A name's 's stays: possessive or "is"?
//   'd       "had" before a past participle (she'd gone, she'd tried) or better; "would" before
//            a plain verb (she'd go, I'd rather). Anything else stays.
// Not a word swap, so no pool: the long form is the only right one. The stats don't score it.

const APOS = "['’]";
const B = "(?<![\\p{L}\\p{N}'’])";
const E = "(?![\\p{L}\\p{N}'’])";

const NEGATIVE = {
    do: "do not", does: "does not", did: "did not", is: "is not", are: "are not", was: "was not",
    were: "were not", have: "have not", has: "has not", had: "had not",
    would: "would not", could: "could not", should: "should not", must: "must not",
    need: "need not", might: "might not", dare: "dare not",
};
// The ones whose long form is a different word: the strongest change, so their own switch (off
// by default): "won't" -> "will not" reads far stiffer than "doesn't" -> "does not".
const STRONG = { wo: "will not", ca: "cannot", sha: "shall not" };
const NEG_RE = new RegExp(`${B}(${Object.keys(NEGATIVE).join("|")})n${APOS}t${E}`, "giu");
const STRONG_RE = new RegExp(`${B}(${Object.keys(STRONG).join("|")})n${APOS}t${E}`, "giu");

const PRONOUN = "i|you|he|she|it|we|they";
const OTHER = [
    { re: new RegExp(`${B}(you|we|they|who|what|there)${APOS}re${E}`, "giu"), long: "are" },
    { re: new RegExp(`${B}(i)${APOS}m${E}`, "giu"), long: "am" },
    { re: new RegExp(`${B}(${PRONOUN}|that|there|who|what)${APOS}ll${E}`, "giu"), long: "will" },
    { re: new RegExp(`${B}(i|you|we|they|who|could|would|should|might|must)${APOS}ve${E}`, "giu"), long: "have" },
];
const IS_RE = new RegExp(`${B}(it|he|she|that|there|here|what|who|where|how)${APOS}s${E}(\\s+\\p{L}+)?`, "giu");
const D_RE = new RegExp(`${B}(${PRONOUN}|that|there|who)${APOS}d${E}((?:\\s+(?:never|already|just|ever|always|really|only|probably|still|not))*)(\\s+\\p{L}+)?`, "giu");

const PARTICIPLES = new Set(
    "been gone seen done taken given known gotten got had made said told thought left felt found come become run begun written eaten fallen forgotten spoken broken chosen driven hidden ridden risen shaken stolen worn torn sworn drawn grown thrown flown shown kept slept meant heard held brought bought caught taught fought lost sent spent built sat stood understood won put let set cut hit hurt shut read lent bent swum sung rung drunk sunk begun woken frozen".split(" "),
);
// Words after 'd that are not a verb: leave it.
const NOT_VERB = new Set("the a an to of in on at by for with and or but so if as that this his her their my your our its it him them me us".split(" "));

// The long form in the original's case: "Don't" -> "Do not", "DON'T" -> "DO NOT".
function caseLike(long, orig) {
    const letters = orig.replace(/[^\p{L}]/gu, "");
    if (letters.length > 1 && letters === letters.toUpperCase()) return long.toUpperCase();
    if (/^\p{Lu}/u.test(orig)) return long[0].toUpperCase() + long.slice(1);
    return long;
}
// The head word kept as written, the added word in the head's case ("I'M" -> "I AM").
function joinLike(head, word, orig) {
    const letters = orig.replace(/[^\p{L}]/gu, "");
    const loud = letters.length > 2 && letters === letters.toUpperCase();
    return `${head} ${loud ? word.toUpperCase() : word}`;
}

function dForm(next) {
    const w = (next || "").trim().toLowerCase();
    if (!w || NOT_VERB.has(w)) return null;
    if (w === "better" || PARTICIPLES.has(w)) return "had";
    if (/ed$/.test(w) && !/eed$/.test(w) && w.length > 3) return "had";
    if (w === "rather" || w === "have" || w === "be") return "would";
    if (/ing$|ly$/.test(w) || (/s$/.test(w) && !/ss$/.test(w))) return null;
    return "would";
}

export default {
    id: "contractions",
    name: "Contractions written out",
    description: "She doesn't look up. → She does not look up.  It's late. → It is late.  Narration only unless you turn on dialogue.",
    scope: "all",
    order: 900,
    defaults: { enabled: false, inDialogue: false, negatives: true, strong: false, others: true },
    options: [
        { key: "inDialogue", type: "checkbox", label: "Also inside dialogue (off keeps casual characters casual)" },
        { key: "negatives", type: "checkbox", label: "don't, doesn't, isn't, couldn't… → do not, does not, is not, could not" },
        { key: "strong", type: "checkbox", label: "Hardcore: won't, can't, shan't → will not, cannot, shall not" },
        { key: "others", type: "checkbox", label: "I'm, you're, it's, she'll, they've, he'd… → I am, you are, it is…" },
    ],

    apply(text, ctx) {
        if (!/['’]/.test(text)) return text;
        const s = ctx.settings || {};
        if (ctx.segment?.type === "dialogue" && !s.inDialogue) return text;
        const hits = [];
        const hit = (before, after) => {
            hits.push({ before, after });
            return after;
        };
        let out = text;
        if (s.negatives !== false) {
            out = out.replace(NEG_RE, (all, head) => hit(all, caseLike(NEGATIVE[head.toLowerCase()], all)));
        }
        if (s.strong === true) {
            out = out.replace(STRONG_RE, (all, head) => hit(all, caseLike(STRONG[head.toLowerCase()], all)));
        }
        if (s.others !== false) {
            for (const { re, long } of OTHER) out = out.replace(re, (all, head) => hit(all, joinLike(head, long, all)));
            out = out.replace(IS_RE, (all, head, next = "") => {
                const word = /^\s+(?:been|got|gotten|had)$/i.test(next) ? "has" : "is";
                return hit(all.slice(0, all.length - next.length), joinLike(head, word, all.slice(0, all.length - next.length))) + next;
            });
            out = out.replace(D_RE, (all, head, advs = "", next = "") => {
                const form = dForm(next);
                const short = all.slice(0, all.length - advs.length - next.length);
                if (!form) return all;
                return hit(short, joinLike(head, form, short)) + advs + next;
            });
        }
        return hits.length ? { text: out, hits } : text;
    },
};
