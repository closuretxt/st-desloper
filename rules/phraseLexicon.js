// Stock phrases (docs/PLAN.md section 7, item 2). PURE: no SillyTavern imports.
//
// Not a find-and-replace list (section 1b). Each phrase has the few shapes it really comes in,
// and each shape knows what to keep:
//   "her voice barely above a whisper"         -> "her voice low"         (the voice stays)
//   "she says, barely above a whisper"         -> "she says quietly"      (the verb stays)
//   "a breath she didn't know she was holding" -> "a breath"              (only the cliché goes)
//   "His voice sends a shiver down her spine"  -> "His voice makes her shiver"
//   "She grins, her eyes sparkling with mischief." -> "She grins."        (pure decoration)
//   "She can't help but smile."                -> "She smiles."
// A shape that isn't one of these is left alone ("barely above a whisper of light").
// Picks from a pool are stable and varied: each message shuffles each pool with its own seed and
// deals from it in order, so a reply with the phrase three times gets three different words.

import { MARK } from "../core/marks.js";
import { dealFrom } from "../core/seed.js";
import { toThird, toPast, conjugateParticiple, speechVerbIndex } from "../lang/conjugate.js";

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const capLike = (word, like) => (/^[A-Z]/.test(like) ? word[0].toUpperCase() + word.slice(1) : word);
const article = word => (/^[aeiou]/i.test(word) ? "an" : "a");

// Where a sentence starts: the segment start or after . ! ? … (closing quotes/asterisks allowed).
const SENT_START = String.raw`(?<=^[\s*_("“]*|[.!?…~]["”’*_)\]]*\s+)`;

// her / his / Seraphina's -> who that is, as subject and object, and whether the verb takes -s.
const POSSESSIVE_INFO = {
    her: { subj: "she", obj: "her", third: true },
    his: { subj: "he", obj: "him", third: true },
    their: { subj: "they", obj: "them", third: false },
    my: { subj: "I", obj: "me", third: false },
    your: { subj: "you", obj: "you", third: false },
    our: { subj: "we", obj: "us", third: false },
};
function personOf(possessive) {
    const p = POSSESSIVE_INFO[possessive.toLowerCase()];
    if (p) return p;
    const name = possessive.replace(/['’]s$/, "");
    return { subj: name, obj: name, third: true };
}

const SPEECH_FORMS = [...speechVerbIndex().keys(), "speaks", "spoke", "speaking", "talk", "talks", "talked", "talking", "whispering", "murmuring"];

// "dripping with sarcasm" -> sarcastic. Only nouns with a sure adjective.
const DRIPPING = {
    sarcasm: "sarcastic", venom: "venomous", contempt: "contemptuous", disdain: "disdainful",
    mockery: "mocking", condescension: "condescending", amusement: "amused", honey: "sweet",
    sweetness: "sweet", malice: "malicious", scorn: "scornful", derision: "derisive",
    menace: "menacing", innuendo: "suggestive", seduction: "seductive",
};

// "catch" -> catching, "stop" -> stopping, "pause" -> pausing. Leans on toPast for doubling.
function toIng(base) {
    if (toPast(base) === `${base}${base.at(-1)}ed`) return `${base}${base.at(-1)}ing`;
    if (/ie$/.test(base)) return `${base.slice(0, -2)}ying`;
    if (/[^e]e$/.test(base)) return `${base.slice(0, -1)}ing`;
    return `${base}ing`;
}
// A pool entry like "catch" or "go still" in the form the matched verb had. Only the first word
// is conjugated. null when the conjugator isn't sure.
function verbForm(phrase, form) {
    const [head, ...rest] = phrase.split(/\s+/);
    const b = head.toLowerCase();
    const v = form === "third" ? toThird(b) : form === "past" ? toPast(b) : form === "ing" ? toIng(b) : b;
    return v ? [v, ...rest].join(" ") : null;
}
const formOf = verb => (/ing$/i.test(verb) ? "ing" : /ed$/i.test(verb) ? "past" : /e?s$/i.test(verb) ? "third" : "base");

// What may follow a phrase we shorten: the end of the clause, a joining word, or a small adverb
// that fits any replacement ("her breath hitches again" -> "her breath catches again").
const CLAUSE_END = String.raw`(?=\s*[.,;:!?…"”*)\]—–]|\s+(?:and|as|at|when|while|before|then|but|again|once|slightly|sharply|briefly)\b|\s*$)`;

const SHIVER_PRESENT_SG = "runs|races|crawls|creeps|travels|goes|shoots|slides|ripples|snakes|skitters|courses|dances|trickles|rolls";
const SHIVER_PRESENT_PL = "run|race|crawl|creep|travel|go|shoot|slide|ripple|snake|skitter|course|dance|trickle|roll";
const SHIVER_PAST = "ran|raced|crawled|crept|traveled|travelled|went|shot|slid|rippled|snaked|skittered|coursed|danced|trickled|rolled";
const SHIVER_PAST_SET = new Set(SHIVER_PAST.split("|"));
const SHIVER_MOTION = "run|running|race|racing|crawl|crawling|creep|creeping|go|going|travel|traveling|travelling|shoot|shooting|slide|sliding|ripple|rippling|snake|snaking|roll|rolling";

// Meaning tails ("…, a silent promise."): the words that make one sure, and the rest of the tail
// up to the sentence's end (never past a ", and …" that carries on with a new action).
const MEANING_ADJ = "silent|unspoken|wordless|quiet|tacit|mute|unvoiced|soundless|unsaid|subtle|gentle|clear|unmistakable|tender|soft";
const MEANING_NOUN = "promise|reminder|declaration|challenge|invitation|plea|warning|vow|confession|apology|question|reassurance|acknowledge?ment|agreement|understanding|offering|admission|command|demand|threat|dare|comfort|message|statement|claim|signal|encouragement|permission|surrender|truce|answer|thank-you|thanks|apology|goodbye|farewell|request|prayer";
const MEANING_SURE = String.raw`(?:a|an)\s+(?:${MEANING_ADJ})(?:,?\s+(?:${MEANING_ADJ}))?\s+(?:${MEANING_NOUN})\b`;
const MEANING_SHAPE = String.raw`(?:a\s+reminder\s+(?:that|of\s+(?:who|what|how|where|why|whose))\b|a\s+promise\s+of\s+(?:more|things\s+to\s+come|what(?:['’]s|\s+was|\s+is)\s+(?:to\s+come|coming)|something\s+more)\b)`;
const MEANING_BODY = String.raw`(?:(?!,\s+(?:and|but|then|before|as|while|yet)\b)[^.!?;…"”*\n]){0,100}?`;
const MEANING_SURE_RE = new RegExp(String.raw`^,\s+${MEANING_SURE}`, "iu");
// The clause ends on a thing ("…gives him a note"): an unsure tail may be naming it.
const ENDS_ON_THING = /\b(?:a|an|the|some|this|that)\s+[\p{L}'’-]+(?:\s+[\p{L}'’-]+)?\s*$/iu;

// "Something more X" tails: "softening into something less performed", "replaced by something
// more raw", "plum blossoms and something warmer, muskier". The vague "something" adds nothing the
// sentence before it didn't say. An adjective is any lowercase word that isn't a small grammar
// word; the chain ends only at the clause's end, so "something soft enough to…", "something like
// a laugh" and "something else" never match (the "something" carries content there).
const SOMETHING_ADJ = String.raw`(?!(?:else|like|that|than|to|of|in|on|at|for|about|she|he|they|it|i|you|we|her|his|their|its|my|your|the|a|an|and|or|but|which|who|enough|so|too)\b)\p{Ll}[\p{Ll}-]*`;
const SOMETHING_TAIL = String.raw`something\s+(?:(?:far|much|a\s+little|a\s+bit|slightly|even|\p{Ll}+ly)\s+)?(?:(?:more|less)\s+)?${SOMETHING_ADJ}(?:(?:\s*,\s*|\s+(?:and|or)\s+)(?:(?:more|less)\s+)?${SOMETHING_ADJ}){0,2}`;
const SOMETHING_END = String.raw`(?=\s*[.;!?…"”*)\]—–]|\s*$|,\s|\s+(?:and|as|while|when|before|then|but)\b)`;
// Verbs whose "into something X" can go and leave the verb standing ("softens into something
// warmer" -> "softens"). Not turn / become / change / morph: those need what they turn into.
const INTO_VERBS = (() => {
    const bases = ["soften", "shift", "melt", "settle", "ease", "fade", "dissolve", "warm", "deepen", "darken", "bloom", "blossom", "relax", "sharpen", "curl", "slide", "slip", "twist", "cool", "crack", "fray", "sour", "harden", "mellow", "thaw", "loosen", "tighten", "smooth", "drift"];
    const forms = new Set();
    for (const b of bases) for (const f of [b, toThird(b), toPast(b), toIng(b)]) if (f) forms.add(f);
    return [...forms].sort((a, b) => b.length - a.length).join("|");
})();
// The sentence is about a smell, taste or sound: "X and something warmer" is then the vague
// second half of a sensory list.
const SENSE_RE = /\b(?:scent|scents|scented|smell|smells|smelled|smelling|smelt|aroma|perfume|fragrance|odou?r|musk|taste|tastes|tasted|tasting|flavou?r|notes?|sound|sounds|voice|breath|air)\b/i;
const NOT_VERB_NEXT = /^(?:she|he|they|it|i|you|we|her|his|their|the|a|an|and|or|but|then|as|while|when|which|who)$/i;

// Grammar pieces that depend on the chat's names, built once per name list.
const grammarCache = new Map();
function grammar(names) {
    const key = names.join("\u0001");
    if (grammarCache.has(key)) return grammarCache.get(key);
    const nameAlt = names.filter(n => /^[\p{L}][\p{L}'’ -]*$/u.test(n)).sort((a, b) => b.length - a.length).map(esc).join("|");
    const NAMES = nameAlt || "(?!)";
    const POSS = String.raw`(?:her|his|their|my|your|our|(?:${NAMES})['’]s)`;
    const PRON = String.raw`(?:she|he|they|i|you|we|${NAMES})`;
    const WHISPER = String.raw`(?:(?:barely|just|scarcely|hardly|only just)\s+(?:above|louder than|more than)|little more than|no louder than|not much louder than)\s+a\s+whisper\b`;
    const EYES = String.raw`(?:${POSS}\s+)?eyes\s+(?:sparkling|twinkling|glinting|dancing|gleaming|glittering|shining|alight|bright)\s+with\s+(?:playful\s+)?(?:mischief|amusement|mirth|playfulness)`;
    const GLINT = String.raw`with\s+(?:(?:a|the)\s+(?:mischievous|playful|knowing|wicked|devilish|impish)\s+(?:glint|twinkle|sparkle|gleam)|a\s+(?:glint|twinkle|sparkle|gleam)\s+of\s+(?:mischief|amusement|mirth))\s+in\s+${POSS}\s+eyes?`;
    const AFTER = String.raw`(?=\s*[.!?;…,"”*]|\s*$)`;
    const g = {
        whisper: new RegExp(
            String.raw`\b(?:(in an?)\s+(voice|tone|murmur)(?:,?\s+(?:that's|that is|that was|which was))?,?\s+|(voice|words|tone)(\s+(?:is|was|are|were|comes out|came out|coming out))?\s+|(${SPEECH_FORMS.join("|")})(,)?\s+)${WHISPER}`,
            "gi",
        ),
        breath: new RegExp(
            String.raw`\bbreath((?:\s+(?:that|which))?\s+${PRON}\s+(?:didn't|didn’t|did not|hadn't|hadn’t|had not|never)(?:\s+even)?\s+(?:know|known|knew|realize|realized|realise|realised|notice|noticed)(?:\s+that)?\s+${PRON}(?:\s+(?:was|were|had been)|['’]d\s+been)\s+holding)\b`,
            "gi",
        ),
        shiverSend: new RegExp(String.raw`\b(send|sends|sent|sending)\s+(?:a\s+shiver|shivers|a\s+chill|chills)\s+(?:down|up|along)\s+(${POSS})\s+spines?\b`, "gi"),
        // "cold" and "icy" are already in "shiver"; any other adjective would be lost, so no match.
        shiverRunSg: new RegExp(String.raw`${SENT_START}(?:a|the)\s+(?:(?:cold|icy)\s+)?(?:shiver|chill)\s+(${SHIVER_PRESENT_SG}|${SHIVER_PAST})\s+(?:down|up|along)\s+(${POSS})\s+spine\b`, "gi"),
        shiverRunPl: new RegExp(String.raw`${SENT_START}(?:shivers|chills)\s+(${SHIVER_PRESENT_PL}|${SHIVER_PAST})\s+(?:down|up|along)\s+(${POSS})\s+spines?\b`, "gi"),
        shiverFeel: new RegExp(String.raw`\b(feel|feels|felt|feeling)\s+(?:a\s+shiver|shivers|a\s+chill|chills)(?:\s+(?:${SHIVER_MOTION}))?\s+(?:down|up|along)\s+${POSS}\s+spines?\b`, "gi"),
        eyesBetween: new RegExp(String.raw`,\s*(?:with\s+)?${EYES},(?=\s+(?:and|then|before|as|while)\b)`, "gi"),
        eyesEnd: new RegExp(String.raw`,\s*(?:with\s+)?${EYES}${AFTER}`, "gi"),
        glint: new RegExp(String.raw`,?\s+${GLINT}${AFTER}`, "gi"),
        eyesSentence: new RegExp(
            String.raw`${SENT_START}${POSS}\s+eyes\s+(?:sparkle|sparkled|twinkle|twinkled|dance|danced|glint|glinted|gleam|gleamed|shine|shone|glitter|glittered)\s+with\s+(?:playful\s+)?(?:mischief|amusement|mirth)[.!]+(?:\s+|$)`,
            "gi",
        ),
        // Only after a word that takes an object ("shows / feels / with / there's a mix of"). As
        // the subject ("A mix of fear and awe crosses her face") the verb would stop agreeing,
        // and after a comma it's an aside that needs the noun.
        mix: /(?<=\b[a-z’']+\s+)(?<!\b(?:and|or|but|then|while|as|when|because|so|yet)\s+)\ban?\s+(?:mix|mixture|blend|combination|cocktail|swirl|tangle)\s+of\s+(?=[a-z'-]+(?:\s+[a-z'-]+){0,2}(?:,\s+[a-z'-]+(?:\s+[a-z'-]+){0,2})*,?\s+(?:and|or)\s+[a-z'-]+)/gi,
        ozone: /(?<!\bthe\s+)\bozone\b(?![\s-]+(?:layer|hole|depletion|depleting|generators?|levels?|concentrations?))/gi,
        primal: /\b(something)\s+primal\b/gi,
        ghost: /\b(a|the)\s+(?:ghost|whisper)\s+of\s+an?\s+(smile|grin|smirk)\b/gi,
        // "a testament to" is the narrator's commentary: removed where the sentence stands
        // without it, a plain verb where it's the sentence's own verb.
        testamentTail: /,\s+(?:a\s+)?(?:(?:true|living|clear|silent|real|quiet|lasting)\s+)?testament\s+to\s+[^.!?;…"”*\n,]+(?=[.!?;…"”*]|$)/gi,
        testamentOpener: new RegExp(String.raw`${SENT_START}A\s+(?:(?:true|living|clear|silent|real|quiet|lasting)\s+)?testament\s+to\s+[^,.!?;\n]{1,80},\s+(\p{Ll})`, "giu"),
        testamentSentence: new RegExp(
            String.raw`${SENT_START}(?:It|This|That|All\s+of\s+(?:it|this))(?:['’]s|\s+(?:is|was|stands\s+as|stood\s+as|remains|remained))\s+(?:a|an)\s+(?:(?:true|living|clear|silent|real|quiet|lasting)\s+)?testament\s+to\s+[^.!?\n]*[.!?]+["”*]?(?:\s+|$)`,
            "giu",
        ),
        testamentVerb: /\b(is|was|are|were|stands\s+as|stand\s+as|stood\s+as|remains|remain|remained)\s+(?:a|an)\s+(?:(?:true|living|clear|silent|real|quiet|lasting)\s+)?testament\s+to\b/gi,
        // Ozone: dropped from a list of smells, or with the whole sentence when it's only the
        // background smell; elsewhere a storm-flavoured swap keeps the hint.
        ozoneListFront: /\b(?:(?:sharp|faint|acrid|crisp|metallic|electric|heavy|clean)\s+)?ozone\s+and\s+(?=[a-z])/gi,
        ozoneListBack: /,?\s+and\s+(?:(?:sharp|faint|acrid|crisp|metallic|electric|heavy|clean)\s+)?ozone\b(?![\s-]+(?:layer|hole|depletion|generators?|levels?))/gi,
        ozoneSentence: new RegExp(
            String.raw`${SENT_START}(?:(?:The|A|An)\s+)?(?:[a-z]+\s+)?(?:air|scent|smell|tang|stench|odou?r|whiff)\b[^.!?\n]{0,60}\bozone\b[^.!?\n]{0,40}[.!?]+(?:\s+|$)`,
            "giu",
        ),
        dripping: new RegExp(
            String.raw`\b(?:(in an?)\s+(voice|tone)\s+dripping\s+with\s+(${Object.keys(DRIPPING).join("|")})|(voice|words|tone)(\s+(?:is|was|are|were))?\s+dripping\s+with\s+(${Object.keys(DRIPPING).join("|")}))\b`,
            "gi",
        ),
        cantHelp: new RegExp(
            String.raw`\b(she|he|it|they|i|you|we|${NAMES})\s+((?:can't|can’t|cannot|can not)|(?:couldn't|couldn’t|could not))\s+help\s+(?:but\s+([a-z]+)\b|([a-z]+ing)\b)`,
            "gi",
        ),
        maybe: /\b(maybe|perhaps)(?:,\s+just\s+(?:maybe|perhaps),?|\s*[—–]\s*just\s+(?:maybe|perhaps)\s*[—–])(?=\s*\S)/gi,
        // Only with an owner ("her breath hitches"), so the sentence keeps its subject, and only
        // at the end of a clause: "her breath hitched in her throat" would read oddly as "paused".
        hitch: new RegExp(String.raw`\b(${POSS}\s+breath)\s+(hitch|hitches|hitched|hitching)\b${CLAUSE_END}`, "gi"),
        swallow: new RegExp(String.raw`\b(swallow|swallows|swallowed|swallowing)\s+hard\b${CLAUSE_END}`, "gi"),
        // "with the practiced ease of a dancer" says who: left alone.
        practiced: new RegExp(String.raw`\bwith\s+(?:a\s+)?(?:well-)?(?:practiced|practised)\s+ease\b(?!\s+of\b)${CLAUSE_END}`, "gi"),
        darkly: new RegExp(String.raw`\b(chuckle|chuckles|chuckled|chuckling|laugh|laughs|laughed|laughing)\s+darkly\b${CLAUSE_END}`, "gi"),
        // Must follow a word (or its comma), never a sentence end: "…door. Despite herself, she…"
        // is despiteStart's job.
        despiteMid: new RegExp(String.raw`(?<![.!?…"”*_)\]\s]),?\s+despite\s+(?:herself|himself|themselves|themself|myself|yourself|ourselves)\b(?=\s*[.,;!?…"”*)]|\s*$)`, "gi"),
        despiteStart: new RegExp(String.raw`${SENT_START}despite\s+(?:herself|himself|themselves|themself|myself|yourself|ourselves),\s+(\p{Ll})`, "giu"),
        // Smell quips. "…cedar and something uniquely him" (the tail goes), "…cheap beer and bad
        // decisions" (the abstract half goes), and in speech "You smell like X and Y." (the line goes).
        smellSelf: new RegExp(
            String.raw`,?\s+(?:and|with)\s+something\s+(?:(?:uniquely|distinctly|purely|entirely|undeniably|unmistakably|inherently|essentially|wholly|so|just|very|all)\s+)?(?:him|her|them|you|${NAMES})(?:self)?\b(?=\s*[.!?;…,"”*)]|\s*$)`,
            "giu",
        ),
        smellAbstract: new RegExp(
            String.raw`(?<=\b(?:smell|smells|smelled|smelling|smelt|reek|reeks|reeked|stink|stinks|stank|scent|scented|aroma|odou?r)\b[^.!?\n]{1,60}?)\s+and\s+(?:(?:cheap|old|bad|poor|stale|broken|lost|faded|wasted)\s+)?(?:bad\s+decisions|poor\s+choices|bad\s+choices|bad\s+ideas|questionable\s+choices|life\s+choices|regrets?|trouble|sin|danger|mischief|heartbreak|desperation|broken\s+promises|lies|secrets|sex|adventure|freedom|home|nostalgia|loneliness|sadness|victory|defeat|poor\s+life\s+choices|promises|memories|dreams|sins)\b(?=\s*[.!?;…,"”*)]|\s*$)`,
            "giu",
        ),
        smellYou: new RegExp(
            String.raw`${SENT_START}(?:(?:and|god|ugh|hmph|wow|gods)[,.!]?\s+)?(?:you|ya)\s+(?:smell|reek|stink)\s+(?:like|of)\s+[^.!?\n]{1,60}?\s+and\s+[^.!?\n,]{1,50}?(?:[.!?…]+(?:\s+|$)|,\s*$)`,
            "giu",
        ),
        // "…, as if daring him to argue." / "…, daring her to look away." The tail only says the
        // look is a challenge, which the look already shows. Bare "daring" only after a comma.
        daring: new RegExp(
            String.raw`(?:,?\s+(?:as\s+(?:if|though)|almost)\s+|,\s+(?:silently\s+|practically\s+|just\s+)?)daring\s+(?:him|her|them|me|you|us|anyone|anybody|someone|somebody|everyone|the\s+[\p{L}-]+|${NAMES})\s+to\s+[^.!?;…"”*\n,—–]{1,60}(?=[.!?;…"”*]|$)`,
            "giu",
        ),
        // Meaning tails: "…, a silent promise that she'd stay." The narrator telling what the
        // gesture means, which the gesture already shows. Sure with a "silent"-type word; without
        // one only the commentary shapes ("a reminder that…", "a promise of more"), and only
        // when the clause doesn't end on a handed-over thing ("She gives him a note, a reminder
        // that…" may be saying what the note is).
        meaningBetween: new RegExp(String.raw`,\s+${MEANING_SURE}${MEANING_BODY},(?=\s+(?:and|then|before|as|while)\b)`, "giu"),
        meaningEnd: new RegExp(String.raw`,\s+(?:${MEANING_SURE}|${MEANING_SHAPE})${MEANING_BODY}(?=[.!?;…"”*]|$)`, "giu"),
        meaningSentence: new RegExp(
            String.raw`${SENT_START}(?:It|This|That)(?:['’]s|\s+(?:is|was|felt\s+like|feels\s+like|became|becomes))\s+${MEANING_SURE}${MEANING_BODY}[.!]+["”*]?(?:\s+|$)`,
            "giu",
        ),
        somethingInto: new RegExp(String.raw`\b(${INTO_VERBS})\s+into\s+${SOMETHING_TAIL}${SOMETHING_END}`, "giu"),
        somethingReplaced: new RegExp(String.raw`,\s+(?:(?:replaced|supplanted)\s+(?:by|with)|giving\s+way\s+to|making\s+way\s+for|yielding\s+to)\s+${SOMETHING_TAIL}${SOMETHING_END}`, "giu"),
        // The chain may be followed by the comma that closes the subject ("…and something warmer,
        // muskier, fills the room"): that comma goes too, checked in find().
        somethingAnd: new RegExp(String.raw`(?<=[\p{L}])\s+and\s+${SOMETHING_TAIL}(?:(,)(?=\s+([\p{L}'’]+))|(?=\s*[.;!?…"”*)\]—–]|\s*$))`, "giu"),
        // "She repeats the word like she's tasting it, rolling it around." The simile only says
        // she's saying it slowly. "it" alone only when the sentence is about words (else she may
        // be tasting food); the bare "rolling it around" follow-up goes with it or on its own.
        tasting: new RegExp(
            String.raw`,?\s+(?:like|as\s+if|as\s+though)\s+(?:${PRON}(?:['’]s|['’]re|\s+(?:is|was|were|are))?\s+)?(?:(?:tasting|savou?ring)\s+(it|the\s+(?:word|words|name|sound|phrase|question|idea|syllables?)|each\s+(?:word|syllable))|testing\s+(?:out\s+)?(?:the\s+(?:word|words|name|sound|phrase)|each\s+(?:word|syllable)))(?:\s+out)?(?:\s+on\s+${POSS}\s+tongue)?(?:\s+for\s+the\s+first\s+time)?(?:,?\s+(?:and\s+)?(?:rolling|turning)\s+it\s+(?:around|over)(?:\s+(?:on|in)\s+${POSS}\s+(?:tongue|mouth|head))?)?(?=\s*[.;!?…"”*)\]—–]|\s*$|,\s)`,
            "giu",
        ),
        // "Her mouth opens, closes, opens again." A whole sentence of nothing but that beat.
        mouthOpens: new RegExp(String.raw`${SENT_START}(?:${POSS}\s+)?mouth\s+(?:opens|opened|falls\s+open|fell\s+open),\s+(?:then\s+)?(?:closes|closed|shuts|shut|snaps\s+shut|snapped\s+shut)(?:,?\s+(?:and\s+|then\s+)?(?:opens|opened)\s+again)?(?:,?\s+(?:and\s+|then\s+)?(?:closes|closed|shuts|shut)\s+again)?[.!]+["”*]?(?:\s+|$)`, "giu"),
        // "her cheeks flushing a deeper shade of pink that reaches all the way to her ears"
        // -> "her cheeks flushing pink to her ears". The colour and where it goes stay.
        shade: /\b(?:an?\s+)?(?:even\s+)?(?:deeper|darker|brighter|richer|new|fresh|vivid|alarming|impressive|lovely|pretty|interesting|charming)\s+shade\s+of\s+(?=(?:pink|red|crimson|scarlet|rose|vermilion|cherry|magenta)\b)/gi,
        shadeReach: new RegExp(String.raw`(?<=\b(?:pink|red|crimson|scarlet|rose|vermilion|cherry|magenta))\s+(?:that|which)\s+(?:reaches|reached|spreads|spread|creeps|crept|crawls|crawled|travels|traveled|travelled|extends|extended|climbs|climbed|stretches|stretched)\s+(?:all\s+the\s+way\s+)?((?:up|down)\s+(?:to\s+)?|to\s+)(${POSS}\s+(?:ears|neck|throat|chest|collarbones?|hairline))\b`, "giu"),
        rolling: new RegExp(String.raw`,\s+(?:rolling|turning)\s+(?:it|the\s+(?:word|words|name|phrase))\s+(?:around|over)\s+(?:on|in)\s+${POSS}\s+(?:tongue|mouth)(?=\s*[.;!?…"”*)\]—–]|\s*$)|,\s+(?:the\s+)?(?:words?|name)\s+rolling\s+off\s+${POSS}\s+tongue(?=\s*[.;!?…"”*)\]—–]|\s*$)`, "giu"),
        // "…, curious, a little nervous underneath the bravado." The narrator spelling out the
        // feeling under a front the scene already shows. Only "underneath / beneath" and a
        // front that isn't a thing ("hidden behind the mask" can be a real mask): left alone.
        underneath: new RegExp(
            String.raw`,\s+(?:(?:a\s+little|a\s+bit|just\s+a\s+little|slightly|faintly|secretly|quietly|still)\s+)?(?!(?:hidden|tucked|buried|concealed|lost)\b)\p{Ll}+(?:\s+and\s+\p{Ll}+)?\s+(?:underneath|beneath)\s+(?:it\s+all|(?:all\s+)?(?:the|${POSS}|that|this)\s+(?:bravado|confidence|swagger|teasing|bluster|composure|show|performance|attitude|sass|banter|act|front|facade|façade|smirk|grin|jokes?|humou?r|bravura|cockiness|nonchalance))(?=\s*[.!?;…"”*)\]—–]|\s*$)`,
            "giu",
        ),
        // "Her eyes stay on his face, watching." The look already says she's watching.
        eyesWatching: new RegExp(
            String.raw`(?<=\b(?:eyes|gaze|stare)\s+(?:(?:stay|stays|stayed|remain|remains|remained|linger|lingers|lingered|rest|rests|rested|settle|settles|settled|are|is|were|was)\s+)?(?:(?:still|fixed|locked|glued|trained|firmly|steadily|intently)\s+)*on\s+[^,.!?;\n"“”]{1,40}),\s+watching(?=\s*[,.;!?…"”*)\]—–]|\s*$)`,
            "giu",
        ),
        eternity: /\bwhat\s+(?:felt|feels|seemed|seems)\s+like\s+(?:an\s+)?eternity\b/gi,
        adams: new RegExp(String.raw`,\s*(?:${POSS}\s+)?adam['’]s\s+apple\s+(?:bobbing|bobs|bobbed)(?:\s+(?:as\s+(?:he|she|they)\s+(?:swallows|swallowed|swallow)|once|visibly))?(?=\s*[.!?;…"”*]|\s*$)`, "gi"),
    };
    if (grammarCache.size > 20) grammarCache.clear();
    grammarCache.set(key, g);
    return g;
}

// Removing a whole sentence only when something else is left in the segment: a reply that is
// nothing but "The air smells of ozone." gets the swap instead of nothing.
const hasRest = (text, m) => !!(text.slice(0, m.index).trim() || text.slice(m.index + m[0].length).trim());
// The sentence a position sits in (rough: between . ! ? … or line breaks).
function sentenceAround(text, at) {
    const from = Math.max(text.lastIndexOf(".", at - 1), text.lastIndexOf("!", at - 1), text.lastIndexOf("?", at - 1), text.lastIndexOf("\n", at - 1)) + 1;
    const rest = text.slice(at).search(/[.!?\n]/);
    return text.slice(from, rest < 0 ? text.length : at + rest);
}

// One edit per match: { start, end, text } (text = what goes in; "" = removed).
function* each(re, text) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) yield m;
}

// The phrases. `pools` are the replacement choices the user can edit in the settings.
// Rule (docs/PLAN.md 1b): a replacement always varies. A pool has at least 3 choices, or one
// fixed word just becomes the next stock phrase (a test checks it). Removing words is fine.
export const ENTRIES = [
    {
        id: "whisper",
        label: "barely above a whisper",
        example: "her voice barely above a whisper → her voice low; she says, barely above a whisper → she says quietly",
        pools: { adjective: { label: "Voice words", value: ["low", "soft", "hushed"] }, adverb: { label: "After a verb", value: ["softly", "quietly", "low", "in a murmur"] } },
        find(text, g, pickFrom) {
            const out = [];
            for (const m of each(g.whisper, text)) {
                const [all, inA, inNoun, noun, be, verb] = m;
                let rep;
                if (inA) {
                    const adj = pickFrom("adjective", m);
                    rep = `${inA.replace(/an?$/i, article(adj))} ${adj} ${inNoun}`;
                } else if (noun) rep = `${noun}${be || ""} ${pickFrom("adjective", m)}`;
                else if (verb) rep = /^whisper/i.test(verb) ? verb : `${verb} ${pickFrom("adverb", m)}`; // "whispers quietly" says it twice
                else continue;
                out.push({ start: m.index, end: m.index + all.length, text: rep });
            }
            return out;
        },
    },
    {
        id: "held-breath",
        label: "a breath she didn't know she was holding",
        example: "She lets out a breath she didn't know she was holding. → She lets out a breath.",
        find(text, g) {
            return [...each(g.breath, text)].map(m => ({ start: m.index + 6, end: m.index + m[0].length, text: "" }));
        },
    },
    {
        id: "spine-shiver",
        label: "a shiver down her spine",
        example: "His voice sends a shiver down her spine. → His voice makes her shiver. A chill ran down his spine. → He shivered.",
        find(text, g) {
            const out = [];
            const MAKE = { send: "make", sends: "makes", sent: "made", sending: "making" };
            for (const m of each(g.shiverSend, text)) {
                const make = capLike(MAKE[m[1].toLowerCase()], m[1]);
                out.push({ start: m.index, end: m.index + m[0].length, text: `${make} ${personOf(m[2]).obj} shiver` });
            }
            for (const re of [g.shiverRunSg, g.shiverRunPl]) {
                for (const m of each(re, text)) {
                    const who = personOf(m[2]);
                    const verb = SHIVER_PAST_SET.has(m[1].toLowerCase()) ? "shivered" : who.third ? "shivers" : "shiver";
                    out.push({ start: m.index, end: m.index + m[0].length, text: `${who.subj[0].toUpperCase()}${who.subj.slice(1)} ${verb}` });
                }
            }
            const FEEL = { feel: "shiver", feels: "shivers", felt: "shivered", feeling: "shivering" };
            for (const m of each(g.shiverFeel, text)) {
                out.push({ start: m.index, end: m.index + m[0].length, text: capLike(FEEL[m[1].toLowerCase()], m[1]) });
            }
            return out;
        },
    },
    {
        id: "mischief-eyes",
        label: "eyes sparkling with mischief",
        example: "She grins, her eyes sparkling with mischief. → She grins.",
        find(text, g) {
            const out = [];
            for (const re of [g.eyesBetween, g.eyesEnd, g.glint, g.eyesSentence]) {
                for (const m of each(re, text)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            }
            return out;
        },
    },
    {
        id: "mix-of",
        label: "a mix of X and Y",
        example: "Her face shows a mix of fear and awe. → Her face shows fear and awe.",
        find(text, g) {
            return [...each(g.mix, text)].map(m => ({ start: m.index, end: m.index + m[0].length, text: "" }));
        },
    },
    {
        id: "ozone",
        label: "ozone",
        example: "smells of ozone and rot → smells of rot; The air smells of ozone. → removed; Ozone stung her nose. → Storm air stung her nose.",
        pools: { noun: { label: "Instead of ozone (when it can't just go)", value: ["storm air", "rain", "hot metal", "lightning"] } },
        find(text, g, pickFrom) {
            const out = [];
            const realOzone = s => /ozone[\s-]+(?:layer|hole|depletion|generators?|levels?|concentrations?)/i.test(s);
            for (const re of [g.ozoneListFront, g.ozoneListBack]) {
                for (const m of each(re, text)) if (!realOzone(text.slice(m.index, m.index + m[0].length + 20))) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            }
            for (const m of each(g.ozoneSentence, text)) {
                // Only a sentence that's just the smell: one with "and" or a comma says more.
                if (/\band\b|,/.test(m[0]) || realOzone(m[0]) || !hasRest(text, m)) continue;
                out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            }
            // The swap skips a choice the sentence already has ("ozone, rain and smoke").
            for (const m of each(g.ozone, text)) out.push({ start: m.index, end: m.index + m[0].length, text: capLike(pickFrom("noun", m, sentenceAround(text, m.index)), m[0]) });
            return out;
        },
    },
    {
        id: "primal",
        label: "something primal",
        example: "Something primal stirs in her chest. → Something wild stirs in her chest.",
        pools: { adjective: { label: "Instead of primal", value: ["wild", "fierce", "raw"] } },
        find(text, g, pickFrom) {
            return [...each(g.primal, text)].map(m => ({ start: m.index, end: m.index + m[0].length, text: `${m[1]} ${pickFrom("adjective", m)}` }));
        },
    },
    {
        id: "ghost-smile",
        label: "the ghost of a smile",
        example: "The ghost of a smile tugs at her lips. → A faint smile tugs at her lips.",
        pools: { adjective: { label: "Kind of smile", value: ["faint", "small", "slight", "thin"] } },
        find(text, g, pickFrom) {
            return [...each(g.ghost, text)].map(m => {
                const adj = pickFrom("adjective", m);
                return { start: m.index, end: m.index + m[0].length, text: `${capLike(article(adj), m[1])} ${adj} ${m[2]}` };
            });
        },
    },
    {
        id: "testament",
        label: "a testament to",
        example: "…, a testament to her will. → removed; It was a testament to their bond. → removed; Her survival is a testament to her strength. → Her survival shows her strength.",
        pools: { verb: { label: "Verb when it can't just go (plain form)", value: ["show", "reveal", "speak of"] } },
        find(text, g, pickFrom) {
            const out = [];
            // Removals first: an overlap goes to the earlier edit, and dropping beats swapping.
            for (const m of each(g.testamentSentence, text)) if (hasRest(text, m)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            for (const m of each(g.testamentTail, text)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            for (const m of each(g.testamentOpener, text)) out.push({ start: m.index, end: m.index + m[0].length, text: m[1].toUpperCase() });
            const FORM = { is: "third", stands: "third", remains: "third", are: "base", stand: "base", remain: "base", was: "past", were: "past", stood: "past", remained: "past" };
            for (const m of each(g.testamentVerb, text)) {
                const verb = verbForm(pickFrom("verb", m), FORM[m[1].split(/\s+/)[0].toLowerCase()]);
                if (verb) out.push({ start: m.index, end: m.index + m[0].length, text: verb });
            }
            return out;
        },
    },
    {
        id: "meaning-tail",
        label: "…, a silent promise",
        example: "She squeezes his hand, a silent promise that she's here. → She squeezes his hand.  It was an unspoken apology. → removed",
        find(text, g) {
            const out = [];
            for (const m of each(g.meaningSentence, text)) if (hasRest(text, m)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            for (const m of each(g.meaningBetween, text)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            for (const m of each(g.meaningEnd, text)) {
                if (!MEANING_SURE_RE.test(m[0]) && ENDS_ON_THING.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
                out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            }
            return out;
        },
    },
    {
        id: "underneath",
        label: "…, a little nervous underneath the bravado",
        example: "She grins, curious, a little nervous underneath the bravado. → She grins, curious.  Her eyes stay on his face, watching, curious. → Her eyes stay on his face, curious.",
        find(text, g) {
            const out = [];
            for (const re of [g.underneath, g.eyesWatching]) {
                for (const m of each(re, text)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            }
            return out;
        },
    },
    {
        id: "something-more",
        label: "into something more X",
        example: "her grin softening into something less performed → her grin softening; …, replaced by something more raw. → removed; plum blossoms and something warmer, muskier, fills → plum blossoms fills",
        find(text, g) {
            const out = [];
            for (const m of each(g.somethingInto, text)) out.push({ start: m.index, end: m.index + m[0].length, text: m[1] });
            for (const m of each(g.somethingReplaced, text)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            for (const m of each(g.somethingAnd, text)) {
                if (!SENSE_RE.test(sentenceAround(text, m.index))) continue;
                // A comma after the chain closes the subject ("…, fills the room"): it goes with
                // the chain. Before "she / then / and …" it starts an aside, so it stays.
                const end = m[1] && NOT_VERB_NEXT.test(m[2] || "") ? m.index + m[0].length - 1 : m.index + m[0].length;
                out.push({ start: m.index, end, text: "" });
            }
            return out;
        },
    },
    {
        id: "tasting-word",
        label: "like she's tasting the word",
        example: "She repeats the word like she's tasting it, rolling it around. → She repeats the word.",
        find(text, g) {
            const out = [];
            for (const m of each(g.tasting, text)) {
                // Bare "it": only when the sentence is about words, not food.
                if (m[1] && /^it$/i.test(m[1]) && !/\b(?:word|words|name|phrase|question|repeats?|repeated|repeating|echoe?s|echoed|says|said|asks|asked|speaks|spoke|murmurs|murmured|whispers|whispered)\b|["“]/i.test(sentenceAround(text, m.index))) continue;
                out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            }
            for (const m of each(g.rolling, text)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            return out;
        },
    },
    {
        id: "mouth-opens",
        label: "her mouth opens, closes, opens again",
        example: "Her mouth opens, closes, opens again. → removed (when the reply has more)",
        find(text, g) {
            return [...each(g.mouthOpens, text)].filter(m => hasRest(text, m)).map(m => ({ start: m.index, end: m.index + m[0].length, text: "" }));
        },
    },
    {
        id: "shade-of",
        label: "a deeper shade of pink",
        example: "her cheeks flushing a deeper shade of pink that reaches all the way to her ears → her cheeks flushing pink to her ears",
        find(text, g) {
            const out = [];
            for (const m of each(g.shade, text)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            for (const m of each(g.shadeReach, text)) out.push({ start: m.index, end: m.index + m[0].length, text: ` ${m[1].toLowerCase()}${m[2]}` });
            return out;
        },
    },
    {
        id: "dripping",
        label: "voice dripping with sarcasm",
        example: "Her voice dripping with sarcasm, she bows. → Her voice sarcastic, she bows.",
        find(text, g) {
            const out = [];
            for (const m of each(g.dripping, text)) {
                const [all, inA, inNoun, inWhat, noun, be, what] = m;
                const adj = DRIPPING[(inWhat || what).toLowerCase()];
                if (!adj) continue;
                const rep = inA ? `${inA.replace(/an?$/i, article(adj))} ${adj} ${inNoun}` : `${noun}${be || ""} ${adj}`;
                out.push({ start: m.index, end: m.index + all.length, text: rep });
            }
            return out;
        },
    },
    {
        id: "cant-help",
        label: "can't help but",
        example: "She can't help but smile. → She smiles. Seraphina couldn't help but notice → Seraphina noticed",
        find(text, g) {
            const out = [];
            for (const m of each(g.cantHelp, text)) {
                const [all, subj, modal, base, ing] = m;
                const past = /^could/i.test(modal);
                const third = !/^(they|i|you|we)$/i.test(subj); // she, he, it or a name
                let verb = null;
                if (base) {
                    if (/^(be|to|it|that|this|the|a|an|him|her|them|me|you|us)$/i.test(base) || /(ing|ed)$/.test(base)) continue;
                    const b = base.toLowerCase();
                    verb = past ? toPast(b) : third ? toThird(b) : b;
                } else {
                    verb = conjugateParticiple(ing.toLowerCase(), past ? "past" : third ? "third" : "base");
                }
                if (!verb) continue;
                const start = m.index + subj.length;
                out.push({ start, end: m.index + all.length, text: ` ${verb}` });
            }
            return out;
        },
    },
    {
        id: "maybe",
        label: "maybe, just maybe",
        example: "Maybe, just maybe, he was right. → Maybe he was right.",
        find(text, g) {
            // The dash form has no space before the next word: "Maybe—just maybe—he" -> "Maybe he".
            return [...each(g.maybe, text)].map(m => ({ start: m.index, end: m.index + m[0].length, text: /[—–]$/.test(m[0]) ? `${m[1]} ` : m[1] }));
        },
    },
    {
        id: "breath-hitch",
        label: "her breath hitches",
        example: "Her breath hitches. → Her breath catches. His breath hitched as she leaned in. → His breath stalled as she leaned in.",
        pools: { verb: { label: "Instead of hitch (plain form)", value: ["catch", "stall", "falter", "pause", "stop short"] } },
        find(text, g, pickFrom) {
            const out = [];
            for (const m of each(g.hitch, text)) {
                const verb = verbForm(pickFrom("verb", m), formOf(m[2]));
                if (verb) out.push({ start: m.index, end: m.index + m[0].length, text: `${m[1]} ${verb}` });
            }
            return out;
        },
    },
    {
        id: "swallow-hard",
        label: "swallows hard",
        example: "He swallows hard and looks away. → He swallows and looks away.",
        find(text, g) {
            return [...each(g.swallow, text)].map(m => ({ start: m.index, end: m.index + m[0].length, text: m[1] }));
        },
    },
    {
        id: "practiced-ease",
        label: "with practiced ease",
        example: "She draws the blade with practiced ease. → She draws the blade smoothly.",
        pools: { adverb: { label: "Instead", value: ["smoothly", "easily", "deftly", "neatly", "without effort"] } },
        find(text, g, pickFrom) {
            return [...each(g.practiced, text)].map(m => ({ start: m.index, end: m.index + m[0].length, text: capLike(pickFrom("adverb", m), m[0]) }));
        },
    },
    {
        id: "chuckle-darkly",
        label: "chuckles darkly",
        example: "He chuckles darkly. → He chuckles.",
        find(text, g) {
            return [...each(g.darkly, text)].map(m => ({ start: m.index, end: m.index + m[0].length, text: m[1] }));
        },
    },
    {
        id: "despite-herself",
        label: "despite herself",
        example: "She smiles despite herself. → She smiles. Despite himself, he laughed. → He laughed.",
        find(text, g) {
            const out = [];
            for (const m of each(g.despiteMid, text)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            for (const m of each(g.despiteStart, text)) out.push({ start: m.index, end: m.index + m[0].length, text: m[1].toUpperCase() });
            return out;
        },
    },
    {
        id: "eternity",
        label: "what felt like an eternity",
        example: "They stood there for what felt like an eternity. → They stood there for a long while.",
        pools: { phrase: { label: "Instead", value: ["a long while", "a long time", "some time", "ages"] } },
        find(text, g, pickFrom) {
            return [...each(g.eternity, text)].map(m => ({ start: m.index, end: m.index + m[0].length, text: capLike(pickFrom("phrase", m), m[0]) }));
        },
    },
    {
        id: "smell-quip",
        label: "you smell like X and Y",
        example: '"You smell like pine and cheap beer." → line removed; He smells of cedar and something uniquely him. → He smells of cedar.',
        // Runs in speech too, even with "inside dialogue" off: that's where these lines live.
        dialogue: true,
        find(text, g, pickFrom, ctx) {
            const out = [];
            const inSpeech = ctx?.segment?.type === "dialogue";
            if (inSpeech) {
                for (const m of each(g.smellYou, text)) out.push({ start: m.index, end: m.index + m[0].length, text: "", wholeLine: true });
            }
            for (const m of each(g.smellSelf, text)) {
                // Only about a smell: "a voice with something uniquely her" isn't this.
                if (/\b(?:smell|smells|smelled|smelt|scent|scents|aroma|musk|reek|reeks)\b/i.test(sentenceAround(text, m.index))) {
                    out.push({ start: m.index, end: m.index + m[0].length, text: "" });
                }
            }
            for (const m of each(g.smellAbstract, text)) out.push({ start: m.index, end: m.index + m[0].length, text: "" });
            return out;
        },
    },
    {
        id: "as-if-daring",
        label: "as if daring him to",
        example: "She lifts her chin, as if daring him to argue. → She lifts her chin.",
        find(text, g) {
            return [...each(g.daring, text)].map(m => ({ start: m.index, end: m.index + m[0].length, text: "" }));
        },
    },
    {
        id: "adams-apple",
        label: "his Adam's apple bobbing",
        example: "He swallows, his Adam's apple bobbing. → He swallows.",
        find(text, g) {
            return [...each(g.adams, text)].map(m => ({ start: m.index, end: m.index + m[0].length, text: "" }));
        },
    },
];

function cleanList(v) {
    return Array.isArray(v) ? v.map(x => String(x ?? "").trim()).filter(Boolean) : [];
}

export default {
    id: "phrase-lexicon",
    name: "Stock phrases",
    description: "Rewrites stock phrases in the shapes where the meaning survives: her voice barely above a whisper → her voice low; She can't help but smile. → She smiles.",
    scope: "all",
    order: 150,
    defaults: { enabled: true, inDialogue: false, off: [], pools: {} },
    options: [
        { key: "inDialogue", type: "checkbox", label: "Also inside dialogue (a character's own words)" },
        { key: "off", type: "phrases", label: "Phrases (switch one off to leave it as written; edit the choices, separated by |)" },
    ],
    entries: ENTRIES,

    apply(text, ctx) {
        // In speech only the phrases marked `dialogue` run, unless the user turned dialogue on.
        const speechOnlyMarked = ctx.segment?.type === "dialogue" && !ctx.settings?.inDialogue;
        const off = new Set(cleanList(ctx.settings?.off));
        const ownPools = ctx.settings?.pools && typeof ctx.settings.pools === "object" ? ctx.settings.pools : {};
        const g = grammar(Array.isArray(ctx.names) ? ctx.names : []);
        const edits = [];
        for (const entry of ENTRIES) {
            if (off.has(entry.id) || (speechOnlyMarked && !entry.dialogue)) continue;
            // Stable, varied picks (core/seed.js dealFrom): keyed on the message and how many
            // cards this pool has dealt so far, never on the position (an earlier rule's edit,
            // on screen but not in the prompt, would shift it).
            // `near`: text the pick must not repeat; a choice sharing a word (3+ letters) with it
            // drops out ("storm air" in "…in the air tonight"). All of them out -> the whole list.
            const pickFrom = (pool, m, near = "") => {
                const own = cleanList(ownPools[entry.id]?.[pool]);
                const list = own.length ? own : entry.pools[pool].value;
                const nearWords = new Set(near.toLowerCase().match(/[a-z]{3,}/g) || []);
                const fresh = list.filter(c => !(c.toLowerCase().match(/[a-z]{3,}/g) || []).some(w => nearWords.has(w)));
                return dealFrom(ctx, `${entry.id}|${pool}`, fresh.length ? fresh : list);
            };
            let found;
            try {
                found = entry.find(text, g, pickFrom, ctx);
            } catch (e) {
                ctx.log?.(`${entry.id}: ${e?.message}; skipped`);
                continue;
            }
            for (const f of found) edits.push({ ...f, entry });
        }
        if (!edits.length) return text;

        // Earlier phrases in the list win an overlap; then apply from the end.
        const taken = [];
        for (const e of edits) {
            if (taken.some(t => e.start < t.end && t.start < e.end)) continue;
            taken.push(e);
        }
        taken.sort((a, b) => b.start - a.start);
        let out = text;
        const hits = [];
        for (const e of taken) {
            const before = text.slice(e.start, e.end);
            out = out.slice(0, e.start) + MARK + e.text + out.slice(e.end);
            hits.unshift({ kind: e.entry.id, label: e.entry.label, before: before.trim(), after: e.text.trim() });
        }
        // A segment that was nothing but the phrase ("Her eyes sparkle with mischief.") stays:
        // removing it could empty the whole reply. The one exception is a whole line of speech
        // (smell quips) when the reply has other text: the shared repair step then drops the
        // empty quote and fixes its attribution ('"…" she says, grinning.' -> "She grins.").
        if (!out.split(MARK).join("").trim()) {
            const others = (ctx.segment?.segments || []).some((s, i) => i !== ctx.segment.index && String(s.text ?? "").trim());
            if (!(taken.every(e => e.wholeLine) && others)) return text;
        }
        return { text: out, hits };
    },
};
