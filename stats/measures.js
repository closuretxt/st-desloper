// The stats: pure string work over a chat's AI replies. PURE: no SillyTavern imports.
// Ported from an earlier style-measuring engine of the author's,
// cut down to what fits a roleplay chat and extended with Desloper's own fixes (docs/PLAN.md section 8).
//
// Two passes, so changing the window or the baseline in the popup is instant:
//   analyze(messages, opts)  -> one record per AI reply (the slow part: runs once per opening)
//   buildReport(records, …)  -> every measure for a window, its baseline value and a verdict
//
// Everything is measured on the ORIGINAL text (what the model actually wrote), so the numbers show
// whether cleaning the prompt makes the model write less slop over time.

import { splitSegments, stripSkipped } from "../core/segments.js";
import { COGNITIVE_VERBS } from "../lang/words.js";
import { STOCK_PHRASES } from "./lexicon.js";
import { speechTics } from "./speechTics.js";

// id -> [group, label, unit, better]. Labels are what the popup shows.
export const METRICS = {
    slop_score: ["overview", "Slop score (0 clean, 100 all slop)", "points", "lower"],
    inner_repeat: ["repetition", "Replies that repeat a sentence inside themselves", "share", "lower"],
    cross_overlap: ["repetition", "Replies that mostly repeat one of the previous 10", "share", "lower"],
    opener_top: ["repetition", "Replies starting with the most common first word", "share", "lower"],
    opener_variety: ["repetition", "Variety of first words (1 = never the same twice)", "score", "higher"],
    closer_top: ["repetition", "Replies ending with the most common last words", "share", "lower"],
    same_start: ["repetition", "Replies with 3+ sentences in a row starting the same way", "share", "lower"],
    motif_top: ["repetition", "Replies with the most repeated phrase", "share", "lower"],
    motif_load: ["repetition", "Replies with any phrase the model keeps reusing", "share", "lower"],
    stock_phrases: ["llmisms", "Stock phrases per 1000 words", "per1k", "lower"],
    contrast_frame: ["llmisms", "Replies with a \"not X, but Y\" frame", "share", "lower"],
    tricolon: ["llmisms", "Replies with a three-item list", "share", "lower"],
    negated_actions: ["llmisms", "Replies with a negated action (\"she doesn't…\")", "share", "lower"],
    em_dash: ["llmisms", "Dashes per reply", "avg", "lower"],
    ellipsis: ["llmisms", "Ellipses per reply", "avg", "lower"],
    echo: ["llmisms", "Replies that open by repeating the user's message", "share", "lower"],
    most_people: ["speech", "Replies comparing to \"most people\"", "share", "lower"],
    firsts: ["speech", "Replies with \"no one has ever…\" / \"you're the first…\"", "share", "lower"],
    protests: ["speech", "Replies with \"you can't just say that\"", "share", "lower"],
    hurry: ["speech", "Replies ending on a hurry or handover line", "share", "lower"],
    ends_question: ["speech", "Replies ending on a question", "share", "lower"],
    stutter: ["speech", "Stammers per reply", "avg", "lower"],
    gestures: ["speech", "Stock gestures per reply (head tilts, smirks…)", "avg", "lower"],
    tsundere: ["speech", "Tsundere script per 1000 words (denials, \"idiot\", hmph, blushes)", "per1k", "lower"],
    smug: ["speech", "Smug script per 1000 words (\"Oh?\", pet names, purring, \"good girl\")", "per1k", "lower"],
    lone_lines: ["speech", "One-line paragraphs per reply", "avg", "lower"],
    flat_questions: ["speech", "Questions ending in a period, per reply", "avg", "lower"],
    words: ["shape", "Words per reply", "count", "none"],
    length_spread: ["shape", "How much reply lengths vary (0 = always the same)", "score", "none"],
    sent_len: ["shape", "Words per sentence", "count", "none"],
    fingerprint: ["voice", "How far the voice moved from the baseline (0 same, 1 unrecognizable)", "distance", "lower"],
};

export const GROUPS = {
    overview: "Overview",
    fixes: "Desloper's fixes (per 1000 words)",
    repetition: "Repetition",
    llmisms: "LLM-isms",
    speech: "Speech and gestures",
    shape: "Shape",
    voice: "Voice",
};

// Voice fingerprint features: name -> [words when it went up, words when it went down].
const FEATURES = {
    sent_len: ["longer sentences", "shorter sentences"],
    word_len: ["longer words", "shorter words"],
    ttr: ["a richer vocabulary", "a smaller vocabulary"],
    contractions: ["more contractions", "fewer contractions"],
    first_person: ["more \"I\"", "less \"I\""],
    second_person: ["more \"you\"", "less \"you\""],
    questions: ["more questions", "fewer questions"],
    exclaims: ["more exclamations", "fewer exclamations"],
    commas: ["more commas", "fewer commas"],
    ellipses: ["more trailing off", "less trailing off"],
};

const FUNCTION_WORDS = new Set(
    ("the a an and but or so to of in on at for with it that this is was be just really very too not no yes " +
        "oh um well maybe i you we me my your if then now here there all some what how").split(" "),
);
const STOP = new Set([
    ...FUNCTION_WORDS,
    ..."are am i'm it's you're do don't have has will can i'll i've as by from get got one up out she he her his him they them their into".split(" "),
]);
const FIRST = new Set(["i", "me", "my", "mine", "myself", "i'm", "i'll", "i've", "i'd"]);
const SECOND = new Set(["you", "your", "yours", "you're", "you'll", "you've", "yourself"]);

export const MIN_BASELINE = 15;
const SPARK_CHUNK = 25;

// ---- text helpers ------------------------------------------------------------------

const WORD_RE = /[a-z0-9]+(?:'[a-z]+)?/g;
const SENT_RE = /(?<=[.!?]["')*\]]*)\s+/;

// Comparable text: tags stripped, quotes and ellipses unified, lowercase.
export function norm(text) {
    return String(text ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/…/g, "...")
        .replace(/\s*(?:[—―⸺⸻﹘]+|–)\s*/g, " — ")
        .toLowerCase()
        .trim();
}

export const wordsOf = text => text.match(WORD_RE) || [];
const sentencesOf = text => text.split(SENT_RE).map(s => s.trim()).filter(Boolean);

function grams(ws, n) {
    const out = new Set();
    for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
    return out;
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let both = 0;
    for (const g of a) if (b.has(g)) both++;
    return both / (a.size + b.size - both);
}

export function clip(text, cap = 160) {
    const t = String(text ?? "").replace(/<[^>]*>/g, " ").split(/\s+/).join(" ").trim();
    return t.length <= cap ? t : `${t.slice(0, cap).trimEnd()}…`;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A phrase from the lexicon -> a whole-word regex on normalized text. {x} = any one word.
export function compilePhrase(phrase) {
    const p = norm(phrase);
    if (!p) return null;
    const body = escapeRe(p).replace(/\\\{x\\\}/g, "[a-z']+");
    return { phrase: String(phrase).trim(), re: new RegExp(`(?<![a-z0-9'])${body}(?![a-z0-9])`, "g") };
}

// "Not X, but Y" and its cousins: "It wasn't anger. It was something softer."
const CONTRAST = [
    /\bnot (?:just|only|merely|simply) [^.?!]{1,60}?,? but\b/,
    /\b(?:it|this|that)(?:'s| is| was) not [^.?!]{1,40}?[,;:—-]+ (?:it's|it is|it was|but)\b/,
    /\b(?:it|this|that) (?:isn't|wasn't|is not|was not) [^.?!"]{1,40}[.;] +(?:it|this|that)(?:'s| is| was)\b/,
    /\bnot (?:with|in|because|from|for|out of) [^.?!]{1,60}?, but (?:with|in|because|from|for|out of)\b/,
    /\bnot [a-z']+, but [a-z']+/,
];
// Only the comma-before-"and" form ("breathless, flushed, and whole"): without it, the first word
// is often the end of another clause ("…the chaos, sharp and authoritative"), not a list item.
const TRICOLON = /\b[a-z']{3,}, [a-z']{3,}, and [a-z']{3,}\b/;
const PARTICLE = "away|back|up|down|off|out|over|around|aside|go|on";

function negationRe(names) {
    const subj = ["she", "he", "they", "i", "you", "we", ...names.map(n => escapeRe(n.toLowerCase()))].join("|");
    return new RegExp(
        `\\b(?:${subj})\\s+(?:doesn't|does not|didn't|did not|don't|do not)\\s+(?:(?:even|really|just|quite|ever|actually)\\s+)?([a-z]+)(?:\\s+(${PARTICLE})\\b)?`,
        "gi",
    );
}

// Apostrophes unified, case kept (the examples quote it).
const soft = text => String(text ?? "").replace(/[’‘]/g, "'");

// ---- examples that show the hit itself ----------------------------------------------
// Why: examples used to quote the reply's first 160 characters (or a long sentence's start), so
// the thing being counted was often cut off. Now each example is a window around the hit.

// What examples quote from: tags out, curly apostrophes straight. Positions are in this text.
const display = raw => String(raw ?? "").replace(/<[^>]*>/g, " ").replace(/[’‘]/g, "'");

// About `cap` characters around [start, end): from the sentence start when it's close, else a
// little before; "…" where it's cut. Whitespace is collapsed after slicing, so positions hold.
export function around(text, start, end = start, cap = 200) {
    const s = String(text ?? "");
    const lead = 70;
    let from = Math.max(0, start - lead);
    const head = s.slice(from, start);
    const sent = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf("\n"), head.lastIndexOf('" '));
    let midSentence = from > 0;
    if (sent >= 0) {
        from += sent + 1;
        midSentence = false; // starts where a sentence starts: no "…" in front
    } else if (from > 0) {
        const sp = s.indexOf(" ", from);
        if (sp >= 0 && sp < start) from = sp + 1;
    }
    let to = Math.min(s.length, Math.max(end, from + cap));
    if (to < s.length) {
        const sp = s.lastIndexOf(" ", to);
        if (sp > end) to = sp;
    }
    const body = s.slice(from, to).split(/\s+/).join(" ").trim();
    return `${midSentence ? "…" : ""}${body}${to < s.length ? "…" : ""}`;
}

// Normalized words ("her blue green scarf") back in the reply's own text ("her blue-green scarf"):
// any non-letters between the words. `last` picks the last match (the repeat, not the original).
export function quoteFor(text, words, { last = false, cap = 200 } = {}) {
    const ws = (Array.isArray(words) ? words : String(words ?? "").split(/\s+/)).filter(Boolean);
    if (!ws.length) return null;
    const body = ws.map(w => escapeRe(w).replace(/'/g, "['’]")).join("[^\\p{L}\\p{N}]+");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
    let hit = null;
    let m;
    while ((m = re.exec(text))) {
        hit = m;
        if (!last) break;
        if (m[0] === "") re.lastIndex++;
    }
    return hit ? around(text, hit.index, hit.index + hit[0].length, cap) : null;
}

// A hit found in normalized text ("half-lidded" shows as "half lidded"): its words, then quoteFor.
const quoteWords = (text, found, opts) => (found ? quoteFor(text, wordsOf(norm(found)), opts) : null);

// The first match of `re` in the reply's own text.
function quoteRe(text, re) {
    const m = re.exec(text);
    return m ? around(text, m.index, m.index + m[0].length) : null;
}

function narrationOf(raw) {
    return splitSegments(raw).filter(s => s.type === "narration").map(s => s.text).join(" ");
}

// Negated actions (not thoughts: "doesn't know" is left out) in narration -> [{ phrase, quote }].
function negationsIn(narration, re) {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(narration))) {
        const verb = m[1].toLowerCase();
        if (COGNITIVE_VERBS.has(verb)) continue;
        // A purpose ("…steps aside so she doesn't block the door", "in case they don't…") says
        // why, not what she didn't do: not the tic.
        if (/\b(?:so|so that|in case|to make sure|making sure|careful that)\s+$/i.test(narration.slice(Math.max(0, m.index - 20), m.index))) continue;
        out.push({ phrase: m[2] ? `${verb} ${m[2].toLowerCase()}` : verb, quote: around(narration, m.index, m.index + m[0].length) });
    }
    return out;
}

// The longest run of sentences starting with the same word, if it's 3 or more.
function sameStartRun(narration) {
    let best = null;
    let run = 0;
    let prev = null;
    let first = null; // the words of the run's first sentence, for the example
    for (const s of sentencesOf(narration)) {
        const sw = wordsOf(s);
        const w = sw[0] || null;
        if (w && w === prev) run++;
        else {
            run = 1;
            first = sw;
        }
        prev = w;
        if (run >= 3 && (!best || run > best.run)) best = { word: w, run, first };
    }
    return best;
}

// Weighted slop points per 1000 words -> 0-100. Weights: a Desloper fix, a stock phrase or a
// contrast frame = 1; a three-item list, a negation Desloper left alone, each dash past two = 0.5.
// 5 points per 1000 words is about 28, 15 is about 63.
export function slopScore(points, words) {
    if (!words) return 0;
    return Math.round(100 * (1 - Math.exp(-(points * 1000) / Math.max(words, 50) / 15)));
}

// ---- pass 1: one record per AI reply ------------------------------------------------

// messages: [{ index, text, isUser }] in chat order (AI replies and user messages only).
// opts: { clean(text, lastUserText, messageIndex) -> { text, hits }, userNames, charNames, lexicon }
export function analyze(messages, opts = {}) {
    const lexicon = (Array.isArray(opts.lexicon) && opts.lexicon.length ? opts.lexicon : STOCK_PHRASES)
        .map(compilePhrase)
        .filter(Boolean);
    // ❌ "User's name in dialogue" was dropped: in long replies saying the
    // user's name is normal, not a tic. userNames still feed the negation finder.
    const names = [...(opts.charNames || []), ...(opts.userNames || [])].filter(Boolean);
    const negRe = negationRe(names);
    const records = [];
    let lastUser = null;
    for (const m of messages || []) {
        if (m.isUser) {
            lastUser = m;
            continue;
        }
        try {
            records.push(analyzeReply(m, lastUser, records, { lexicon, negRe, clean: opts.clean, names }));
        } catch {
            // One odd message must not stop the stats.
        }
        lastUser = null; // a second reply in a row answers nothing new
    }
    return records;
}

function analyzeReply(m, lastUser, prev, { lexicon, negRe, clean, names = [] }) {
    // Skipped blocks (trackers, [Time: …]) out first: the same text every reply isn't a reused phrase.
    const raw = stripSkipped(String(m.text ?? ""));
    const t = norm(raw);
    const ws = wordsOf(t);
    const sents = sentencesOf(t);
    const tri = grams(ws, 3);

    // A sentence (4+ words) twice, or any 6-word span twice.
    // `repeated` keeps the words that came back, so the example can show the second copy.
    const long = sents.map(s => wordsOf(s).join(" ")).filter(s => s.split(" ").length >= 4);
    let repeated = long.find((s, i) => long.indexOf(s) !== i) || null;
    if (!repeated) {
        const six = new Set();
        for (let i = 0; i + 6 <= ws.length && !repeated; i++) {
            const g = ws.slice(i, i + 6).join(" ");
            if (six.has(g)) repeated = g;
            six.add(g);
        }
    }
    const inner = !!repeated;

    let cross = null;
    if (ws.length >= 5) {
        for (const p of prev.slice(-10)) {
            const j = jaccard(tri, p.tri);
            if (j >= 0.35 && (!cross || j > cross.j)) cross = { index: p.index, j };
        }
    }

    // The reply's first two sentences mostly made of the user's own wording.
    let echo = false;
    if (lastUser) {
        const userTri = grams(wordsOf(norm(lastUser.text)), 3);
        const head = grams(wordsOf(sents.slice(0, 2).join(" ")), 3);
        let shared = 0;
        for (const g of head) if (userTri.has(g)) shared++;
        echo = head.size >= 3 && shared / head.size >= 0.5;
    }

    const contrastHit = CONTRAST.map(re => t.match(re)).find(Boolean);
    const triHit = t.match(TRICOLON);
    const stock = {};
    let stockHits = 0;
    let stockFound = null; // the first stock phrase as written, for the example
    for (const p of lexicon) {
        p.re.lastIndex = 0;
        const found = t.match(p.re) || [];
        if (found.length) {
            stock[p.phrase] = found.length;
            stockHits += found.length;
            stockFound ??= found[0];
        }
    }
    const narration = norm(narrationOf(raw));
    const negationList = negationsIn(soft(narrationOf(raw)), negRe);

    // Desloper's fixes, and the negations it left alone (grows the flip table).
    const fixes = {};
    const fixExamples = {};
    const fixLabels = {}; // rule -> { label: count }, for rules whose hits name a phrase
    let fixHits = 0;
    let leftovers = [];
    if (typeof clean === "function") {
        const out = clean(raw, lastUser?.text ?? "", m.index);
        for (const h of out?.hits || []) {
            fixes[h.rule] = (fixes[h.rule] || 0) + 1;
            fixHits++;
            fixExamples[h.rule] ??= { before: h.before, after: h.after };
            if (h.label) {
                fixLabels[h.rule] ??= {};
                fixLabels[h.rule][h.label] = (fixLabels[h.rule][h.label] || 0) + 1;
            }
        }
        leftovers = negationsIn(soft(narrationOf(out?.text ?? raw)), negRe);
    } else {
        leftovers = negationList;
    }

    const dashes = (t.match(/ — | -- /g) || []).length;
    const ellipses = (t.match(/\.\.\./g) || []).length;
    // One tic counts once: a stock phrase or contrast frame Desloper fixed is already a fix.
    // Dashes and ellipses weigh half: a converted dash is one of the "dashes past two".
    const dashFixes = fixLabels["dash-budget"]?.dash || 0;
    const dotFixes = fixLabels["dash-budget"]?.ellipsis || 0;
    const points =
        fixHits -
        (fixes["dash-budget"] || 0) -
        // Curly quotes, spaces and leaked thinking aren't prose slop: listed, not scored.
        (fixes["text-fixes"] || 0) -
        (fixes["leaked-text"] || 0) -
        (fixes["contractions"] || 0) +
        Math.max(0, stockHits - (fixes["phrase-lexicon"] || 0)) +
        (contrastHit && !fixes["contrast-frame"] ? 1 : 0) +
        (triHit ? 0.5 : 0) +
        0.5 * leftovers.length +
        0.5 * Math.max(Math.max(0, dashes - 2), dashFixes) +
        0.5 * dotFixes;

    const fw = {};
    for (const w of ws) if (FUNCTION_WORDS.has(w)) fw[w] = (fw[w] || 0) + 1;

    // Each measure's example, cut around its own hit (falls back to the reply's start).
    const disp = display(raw);
    const run = sameStartRun(narration);
    const tics = speechTics(raw, names);
    const ticQuote = key => (tics.examples[key] ? quoteFor(disp, wordsOf(norm(tics.examples[key])).slice(0, 8)) || clip(tics.examples[key]) : null);
    const quotes = {
        ...Object.fromEntries(Object.keys(tics.counts).map(k => [`tic_${k}`, ticQuote(k)])),
        inner: repeated ? quoteFor(disp, repeated.split(" ").slice(0, 8), { last: true }) : null,
        contrast: quoteWords(disp, contrastHit?.[0]),
        tricolon: quoteWords(disp, triHit?.[0]),
        stock: quoteWords(disp, stockFound),
        dash: quoteRe(disp, /\s[—―⸺⸻﹘–]\s|[—―⸺⸻﹘]+|\s--?\s|--/),
        ellipsis: quoteRe(disp, /\.\.\.|…/),
        run: run ? quoteFor(disp, run.first.slice(0, 8)) : null,
        closer: disp.trim() ? around(disp, Math.max(0, disp.trimEnd().length - 1)) : null,
    };

    return {
        index: m.index,
        quote: clip(raw),
        disp,
        quotes,
        ws,
        tri,
        words: ws.length,
        sentences: sents.length || 1,
        inner,
        cross,
        echo,
        contrast: contrastHit ? contrastHit[0] : null,
        tricolon: triHit ? triHit[0] : null,
        stock,
        stockHits,
        negations: negationList.length,
        negQuote: negationList[0]?.quote ?? null,
        leftovers,
        fixes,
        fixExamples,
        fixLabels,
        tics: tics.counts,
        dashes,
        ellipses,
        run,
        opener: ws[0] || null,
        closer: ws.length ? ws.slice(-3).join(" ") : null,
        points,
        score: slopScore(points, ws.length),
        feat: {
            wordLen: ws.reduce((a, w) => a + w.length, 0),
            contractions: ws.filter(w => w.includes("'")).length,
            first: ws.filter(w => FIRST.has(w)).length,
            second: ws.filter(w => SECOND.has(w)).length,
            questions: sents.filter(s => /\?["')*\]]*$/.test(s)).length,
            exclaims: sents.filter(s => /!["')*\]]*$/.test(s)).length,
            commas: (t.match(/,/g) || []).length,
            ellipses,
        },
        fw,
    };
}

// ---- pass 2: measures over a set of records ------------------------------------------

function mattr(ws, w = 50) {
    if (ws.length < w) return ws.length ? new Set(ws).size / ws.length : 0;
    const step = Math.max(1, Math.floor((ws.length - w) / 200));
    let sum = 0;
    let n = 0;
    for (let i = 0; i + w <= ws.length; i += step) {
        sum += new Set(ws.slice(i, i + w)).size / w;
        n++;
    }
    return sum / n;
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function pstdev(xs) {
    const m = mean(xs);
    return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
}

// key: which of the reply's `quotes` to show (the window around that measure's hit); without
// one, or when it wasn't found, the reply's start.
const example = (r, key) => ({ index: r.index, quote: (key && r.quotes?.[key]) || r.quote });
const lastExamples = (rows, key) => rows.slice(-3).map(r => example(r, key));

// 3-5 word phrases found in many replies (counted once per reply, ones with fewer than two
// non-stopwords dropped);
// overlapping wordings of one phrase are reported once, by the longest.
function findMotifs(records) {
    const n = records.length;
    const counts = new Map();
    for (const r of records) {
        const seen = new Set();
        for (const size of [3, 4, 5]) for (const g of grams(r.ws, size)) seen.add(g);
        for (const g of seen) {
            // At least two real words: "in front of", "the back of", "down at the" are plain
            // English every writer reuses, not a tic (they used to fill half the list). "her amber
            // eyes", "she tilts her head" keep two.
            if (g.split(" ").filter(w => !STOP.has(w)).length < 2) continue;
            counts.set(g, (counts.get(g) || 0) + 1);
        }
    }
    const floor = Math.max(3, Math.ceil(0.04 * n));
    const rec = [...counts.entries()]
        .filter(([, c]) => c >= floor)
        .sort((a, b) => b[1] - a[1] || b[0].split(" ").length - a[0].split(" ").length || (a[0] < b[0] ? -1 : 1))
        .slice(0, 400);
    const flat = records.map(r => ` ${r.ws.join(" ")} `);
    const where = new Map(rec.map(([g]) => [g, new Set(flat.flatMap((t, i) => (t.includes(` ${g} `) ? [i] : [])))]));
    const motifs = [];
    for (const [g, c] of rec) {
        const wg = where.get(g);
        const gw = new Set(g.split(" "));
        const dup = motifs.findIndex(([m]) => {
            const shared = m.split(" ").filter(w => gw.has(w)).length;
            const wm = where.get(m);
            let both = 0;
            for (const i of wg) if (wm.has(i)) both++;
            return shared >= 2 && both >= 0.6 * Math.min(wg.size, wm.size);
        });
        if (dup < 0) motifs.push([g, c]);
        else if (c >= motifs[dup][1] && g.split(" ").length > motifs[dup][0].split(" ").length) motifs[dup] = [g, c];
        if (motifs.length >= 12) break;
    }
    // Grow each one to its full wording ("she tilts her head" + "head slightly and studies you"
    // are one phrase), then drop any that turned into a part of one already kept.
    const out = [];
    for (const [g] of motifs) {
        const rows = [...where.get(g)].map(i => records[i]);
        const phrase = extendPhrase(g, rows);
        if (out.some(m => ` ${m.phrase} `.includes(` ${phrase} `) || ` ${phrase} `.includes(` ${m.phrase} `))) continue;
        const hit = rows.filter(r => ` ${r.ws.join(" ")} `.includes(` ${phrase} `));
        out.push({ phrase, count: hit.length, share: n ? hit.length / n : 0, rows: hit });
    }
    return out.sort((a, b) => b.count - a.count);
}

// Adds the word before / after while at least 80% of the replies with the phrase agree on it.
function extendPhrase(phrase, rows) {
    let p = phrase;
    while (p.split(" ").length < 12) {
        let grown = false;
        for (const side of ["after", "before"]) {
            const next = new Map();
            for (const r of rows) {
                const t = ` ${r.ws.join(" ")} `;
                const i = t.indexOf(` ${p} `);
                if (i < 0) continue;
                const w = side === "after" ? t.slice(i + p.length + 2).split(" ")[0] : t.slice(0, i).trim().split(" ").pop();
                if (w) next.set(w, (next.get(w) || 0) + 1);
            }
            const best = [...next.entries()].sort((a, b) => b[1] - a[1])[0];
            if (best && best[1] >= 0.8 * rows.length) {
                p = side === "after" ? `${p} ${best[0]}` : `${best[0]} ${p}`;
                grown = true;
            }
        }
        if (!grown) break;
    }
    return p;
}

// A reused phrase's latest three replies, each cut around the phrase.
function motifExamples(m) {
    const words = m.phrase.split(" ");
    return m.rows.slice(-3).map(r => ({ index: r.index, quote: (r.disp && quoteFor(r.disp, words)) || r.quote }));
}

function topOf(records, key) {
    const counts = new Map();
    const sample = new Map();
    for (const r of records) {
        const k = r[key];
        if (!k) continue;
        counts.set(k, (counts.get(k) || 0) + 1);
        if (!sample.has(k)) sample.set(k, r);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return { counts, sorted, sample };
}

// -> { n, values: { id: { value, hits, examples, detail } }, features, fw, motifs }
export function summarize(records, ruleIds = []) {
    const n = records.length;
    const values = {};
    const put = (id, value, hits = 0, examples = [], detail = null) => {
        values[id] = { value: Number.isFinite(value) ? value : 0, hits, examples, detail };
    };
    const share = rows => (n ? rows.length / n : 0);
    const flag = (id, test, key) => {
        const rows = records.filter(test);
        put(id, share(rows), rows.length, lastExamples(rows, key));
    };
    const totalWords = records.reduce((a, r) => a + r.words, 0);
    const W = totalWords || 1;

    // Overview
    const points = records.reduce((a, r) => a + r.points, 0);
    const worst = records.filter(r => r.words >= 30).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 5);
    put("slop_score", slopScore(points, totalWords), 0, [], worst.filter(r => r.score > 0).map(r => ({ index: r.index, quote: r.quote, score: r.score })));

    // Desloper's fixes
    const ids = new Set(ruleIds);
    for (const r of records) for (const id of Object.keys(r.fixes)) ids.add(id);
    for (const id of ids) {
        const rows = records.filter(r => r.fixes[id]);
        const hits = rows.reduce((a, r) => a + r.fixes[id], 0);
        const examples = rows.slice(-3).map(r => ({ index: r.index, ...r.fixExamples[id] }));
        // Rules whose hits name a phrase (stock phrases) get a count per phrase instead.
        const labels = {};
        for (const r of rows) for (const [label, c] of Object.entries(r.fixLabels?.[id] || {})) labels[label] = (labels[label] || 0) + c;
        const perPhrase = Object.entries(labels)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([phrase, count]) => ({ phrase, count }));
        put(`fix:${id}`, (hits * 1000) / W, hits, examples, perPhrase.length ? perPhrase : { share: share(rows) });
    }

    // Repetition
    flag("inner_repeat", r => r.inner, "inner");
    const crossRows = records.filter(r => r.cross);
    put("cross_overlap", share(crossRows), crossRows.length, crossRows.slice(-3).map(r => ({ ...example(r), note: `like #${r.cross.index}` })));

    const op = topOf(records, "opener");
    const [topOpen, topOpenCount] = op.sorted[0] || [null, 0];
    put("opener_top", share({ length: topOpenCount }), topOpenCount, topOpen ? [example(op.sample.get(topOpen))] : [],
        op.sorted.slice(0, 8).map(([phrase, count]) => ({ phrase, count, share: count / n })));
    const total = [...op.counts.values()].reduce((a, b) => a + b, 0);
    const ent = -[...op.counts.values()].reduce((a, c) => a + (c / total) * Math.log(c / total), 0);
    put("opener_variety", op.counts.size > 1 ? ent / Math.log(op.counts.size) : 0);
    const cl = topOf(records, "closer");
    const [topClose, topCloseCount] = cl.sorted[0] || [null, 0];
    put("closer_top", share({ length: topCloseCount }), topCloseCount, topClose ? [example(cl.sample.get(topClose), "closer")] : [],
        cl.sorted.slice(0, 8).map(([phrase, count]) => ({ phrase, count, share: count / n })));
    const runRows = records.filter(r => r.run);
    put("same_start", share(runRows), runRows.length, runRows.slice(-3).map(r => ({ ...example(r, "run"), note: `${r.run.run} in a row start with "${r.run.word}"` })));

    const motifs = n ? findMotifs(records) : [];
    const top = motifs[0];
    put("motif_top", top ? top.share : 0, top ? top.count : 0, top ? motifExamples(top) : [],
        motifs.map(m => ({ phrase: m.phrase, count: m.count, share: m.share })));
    const motifRows = new Set(motifs.flatMap(m => m.rows));
    put("motif_load", share([...motifRows]), motifRows.size);

    // LLM-isms
    const perPhrase = new Map();
    let stockHits = 0;
    for (const r of records) {
        stockHits += r.stockHits;
        for (const [p, c] of Object.entries(r.stock)) perPhrase.set(p, (perPhrase.get(p) || 0) + c);
    }
    put("stock_phrases", (stockHits * 1000) / W, stockHits, lastExamples(records.filter(r => r.stockHits), "stock"),
        [...perPhrase.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([phrase, count]) => ({ phrase, count })));
    const contrastRows = records.filter(r => r.contrast);
    put("contrast_frame", share(contrastRows), contrastRows.length, contrastRows.slice(-3).map(r => ({ index: r.index, quote: r.quotes?.contrast || r.contrast })));
    const triRows = records.filter(r => r.tricolon);
    put("tricolon", share(triRows), triRows.length, triRows.slice(-3).map(r => ({ index: r.index, quote: r.quotes?.tricolon || r.tricolon })));
    const negRows = records.filter(r => r.negations > 0);
    put("negated_actions", share(negRows), negRows.length, negRows.slice(-3).map(r => ({ index: r.index, quote: r.negQuote })));
    put("em_dash", mean(records.map(r => r.dashes)), records.reduce((a, r) => a + r.dashes, 0), lastExamples(records.filter(r => r.dashes > 2), "dash"));
    put("ellipsis", mean(records.map(r => r.ellipses)), records.reduce((a, r) => a + r.ellipses, 0), lastExamples(records.filter(r => r.ellipses > 2), "ellipsis"));
    flag("echo", r => r.echo);

    // Speech and gestures (counted whether or not the matching fix is on).
    const tic = r => r.tics || {};
    flag("most_people", r => tic(r).most, "tic_most");
    flag("firsts", r => tic(r).firsts, "tic_firsts");
    flag("protests", r => tic(r).protest, "tic_protest");
    flag("hurry", r => tic(r).hurry, "tic_hurry");
    flag("ends_question", r => tic(r).endsQuestion, "tic_endsQuestion");
    const avgTic = (id, key) => {
        const total = records.reduce((a, r) => a + (tic(r)[key] || 0), 0);
        put(id, n ? total / n : 0, total, lastExamples(records.filter(r => tic(r)[key]), `tic_${key}`));
    };
    const perKTic = (id, key) => {
        const total = records.reduce((a, r) => a + (tic(r)[key] || 0), 0);
        put(id, (total * 1000) / W, total, lastExamples(records.filter(r => tic(r)[key]), `tic_${key}`));
    };
    avgTic("stutter", "stutter");
    avgTic("gestures", "gestures");
    perKTic("tsundere", "tsundere");
    perKTic("smug", "smug");
    avgTic("lone_lines", "lone");
    avgTic("flat_questions", "flat");

    // Shape
    const lens = records.map(r => r.words);
    put("words", mean(lens));
    put("length_spread", lens.length > 1 && mean(lens) ? pstdev(lens) / mean(lens) : 0);
    const sentences = records.reduce((a, r) => a + r.sentences, 0) || 1;
    put("sent_len", totalWords / sentences);

    // Voice fingerprint features (the distance needs a baseline: buildReport).
    const sum = k => records.reduce((a, r) => a + r.feat[k], 0);
    const features = {
        sent_len: totalWords / sentences,
        word_len: sum("wordLen") / W,
        ttr: mattr(records.flatMap(r => r.ws)),
        contractions: sum("contractions") / W,
        first_person: sum("first") / W,
        second_person: sum("second") / W,
        questions: sum("questions") / sentences,
        exclaims: sum("exclaims") / sentences,
        commas: sum("commas") / W,
        ellipses: sum("ellipses") / sentences,
    };
    const fw = {};
    for (const r of records) for (const [w, c] of Object.entries(r.fw)) fw[w] = (fw[w] || 0) + c;

    return { n, values, features, fw, motifs };
}

// Relative feature distance (clipped) + function-word Jensen-Shannon divergence.
export function fingerprint(cur, base) {
    const moves = [];
    const dists = [];
    for (const [name, [up, down]] of Object.entries(FEATURES)) {
        const a = cur.features[name] || 0;
        const b = base.features[name] || 0;
        const d = Math.min(1, Math.abs(a - b) / Math.max(Math.abs(b), 1e-3));
        dists.push(d);
        moves.push([d, a > b ? up : down]);
    }
    const keys = new Set([...Object.keys(cur.fw), ...Object.keys(base.fw)]);
    const ta = Object.values(cur.fw).reduce((x, y) => x + y, 0) || 1;
    const tb = Object.values(base.fw).reduce((x, y) => x + y, 0) || 1;
    let js = 0;
    for (const k of keys) {
        const p = (cur.fw[k] || 0) / ta;
        const q = (base.fw[k] || 0) / tb;
        const m = (p + q) / 2;
        if (p) js += 0.5 * p * Math.log2(p / m);
        if (q) js += 0.5 * q * Math.log2(q / m);
    }
    moves.sort((x, y) => y[0] - x[0]);
    return { value: 0.6 * mean(dists) + 0.4 * js, moves: moves.slice(0, 2).filter(([d]) => d >= 0.15).map(([, w]) => w) };
}

// worse / better / moved / steady / new: the change must clear an absolute floor and a relative
// one; for shares, also a difference of at least 3 replies (small chats are noisy).
export function status(unit, better, value, base, hits = null, baseHits = null) {
    if (base === null || base === undefined) return "new";
    const floor = { share: 0.03, per1k: 0.5, count: 3, avg: 0.3, score: 0.08, distance: 0.08, points: 8 }[unit] ?? 0.05;
    const band = Math.max(floor, (unit === "points" ? 0.1 : 0.35) * Math.abs(base));
    const diff = value - base;
    if (Math.abs(diff) < band) return "steady";
    if (unit === "share" && hits !== null && baseHits !== null && Math.abs(hits - baseHits) < 3) return "steady";
    if (better === "none") return "moved";
    return (better === "lower" ? diff > 0 : diff < 0) ? "worse" : "better";
}

// A share in the baseline is compared as a share, but its "hits" scale with the baseline's size;
// this puts the baseline's hits on the window's scale for the 3-reply rule.
const scaled = (hits, from, to) => (from ? (hits * to) / from : hits);

// records: every reply of the chat (analyze). window / baseline: [start, end) positions in records,
// or null. opts: { ruleIds, ruleNames: { id: name } }.
export function buildReport(records, { window = [0, records.length], baseline = null, ruleIds = [], ruleNames = {} } = {}) {
    const win = records.slice(...window);
    const baseRows = baseline ? records.slice(...baseline) : [];
    const cur = summarize(win, ruleIds);
    const old = baseRows.length >= MIN_BASELINE ? summarize(baseRows, ruleIds) : null;
    let moves = [];
    if (old && cur.n) {
        const fp = fingerprint(cur, old);
        cur.values.fingerprint = { value: fp.value, hits: 0, examples: [], detail: fp.moves };
        old.values.fingerprint = { value: 0, hits: 0, examples: [], detail: null };
        moves = fp.moves;
    }

    // Sparklines: every measure over the whole chat in chunks of 25 replies.
    const chunks = [];
    for (let i = 0; i + SPARK_CHUNK <= records.length; i += SPARK_CHUNK) chunks.push(summarize(records.slice(i, i + SPARK_CHUNK), ruleIds).values);

    const metrics = [];
    for (const [id, v] of Object.entries(cur.values)) {
        const fix = id.startsWith("fix:");
        const [group, label, unit, better] = fix ? ["fixes", ruleNames[id.slice(4)] || id.slice(4), "per1k", "lower"] : METRICS[id] || ["other", id, "score", "none"];
        const b = old?.values[id];
        const base = b ? b.value : null;
        metrics.push({
            id,
            group,
            label,
            unit,
            better,
            value: v.value,
            hits: v.hits,
            base,
            status: cur.n >= 10 ? status(unit, better, v.value, base, v.hits, b ? scaled(b.hits, old.n, cur.n) : null) : "steady",
            examples: v.examples,
            detail: v.detail,
            spark: chunks.length >= 2 && id !== "fingerprint" ? chunks.map(c => c[id]?.value ?? 0) : null,
        });
    }

    // How often each current motif showed in the baseline.
    const baseFlat = baseRows.map(r => ` ${r.ws.join(" ")} `);
    const motifs = cur.motifs.map(m => ({
        phrase: m.phrase,
        count: m.count,
        share: m.share,
        base: baseFlat.length >= MIN_BASELINE ? baseFlat.filter(t => t.includes(` ${m.phrase} `)).length / baseFlat.length : null,
        examples: motifExamples(m),
    }));

    // Negations Desloper left alone, most common first: candidates for the flip table.
    const left = new Map();
    for (const r of win) {
        for (const { phrase, quote } of r.leftovers) {
            const e = left.get(phrase) || { phrase, count: 0, examples: [] };
            e.count++;
            if (!e.examples.some(x => x.index === r.index)) e.examples.push({ index: r.index, quote });
            left.set(phrase, e);
        }
    }
    const leftovers = [...left.values()].sort((a, b) => b.count - a.count || (a.phrase < b.phrase ? -1 : 1)).slice(0, 15).map(e => ({ ...e, examples: e.examples.slice(-3) }));

    return {
        n: cur.n,
        baseN: old ? old.n : baseRows.length,
        hasBaseline: !!old,
        score: cur.values.slop_score.value,
        metrics,
        motifs,
        leftovers,
        moves,
    };
}
