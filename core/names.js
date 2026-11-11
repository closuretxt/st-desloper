// Names found in the reply itself. PURE: no SillyTavern imports.
// Why: ST only tells us the card's name and the user's. On a card that plays many characters
// ("Corin Ashby doesn't flinch; instead, she tilts her head.") the speaker is nobody ST knows, so
// negation flip, contrast frame and the repair step treated "Corin Ashby" as an unknown subject and
// left the sentence alone.
//
// A word run counts as a name only on evidence, never because it's capitalized at a sentence
// start ("Slowly she turns" must not make "Slowly" a name):
//   - two or three capitalized words in a row, after dropping leading function words
//     ("Then Corin Ashby" -> "Corin Ashby"; "The Committee" -> nothing);
//   - one capitalized word that also shows up capitalized mid-sentence somewhere in the reply
//     ("Careful, Tobin," makes "Tobin" a name everywhere in that reply).

const LEAD = new Set(
    (
        "the a an this that these those her his their my your our its it i he she they we you " +
        "then but and or so when while as if though although because after before once still even " +
        "just only maybe perhaps yes no oh ah well now here there what why how who where which " +
        "every each some any all both not never okay ok nothing something everyone someone nobody " +
        "everything anyone instead meanwhile finally suddenly slowly again also too"
    ).split(" "),
);
const NOT_NAMES = new Set(
    (
        "monday tuesday wednesday thursday friday saturday sunday january february march april may " +
        "june july august september october november december god"
    ).split(" "),
);
const MAX_NAMES = 30;

const RUN = /(?<![\p{L}\p{N}'’-])\p{Lu}[\p{L}'’-]*(?:[ \t]+\p{Lu}[\p{L}'’-]*){0,3}(?![\p{L}\p{N}])/gu;
// What may come right before a sentence (or a line of dialogue) starts.
const STARTS_SENTENCE = /(?:^|[.!?…~♡]["”’»」』)\]*_]*\s+|\n|["“「『(*_]\s*)$/;

const clean = w => w.replace(/['’]s$/, "").replace(/[-'’]+$/, "");

export function namesInText(text) {
    const s = String(text ?? "");
    const multi = new Set();
    const midSingles = new Set();
    const singles = new Set();
    RUN.lastIndex = 0;
    let m;
    while ((m = RUN.exec(s))) {
        let words = m[0].split(/[ \t]+/).map(clean);
        let lead = 0;
        while (lead < words.length && LEAD.has(words[lead].toLowerCase())) lead++;
        words = words.slice(lead).filter(Boolean);
        if (!words.length) continue;
        if (words.some(w => LEAD.has(w.toLowerCase()) || NOT_NAMES.has(w.toLowerCase()))) {
            // "Ashby I" / "Tobin Monday": keep only single words, judged on their own below.
            words = words.filter(w => !LEAD.has(w.toLowerCase()) && !NOT_NAMES.has(w.toLowerCase()));
            for (const w of words) singles.add(w);
            continue;
        }
        if (words.length >= 2) {
            multi.add(words.join(" "));
            continue;
        }
        const w = words[0];
        if (w.length < 2) continue;
        singles.add(w);
        // Mid-sentence: the run itself didn't start a sentence and had no function word before it.
        if (lead === 0 && !STARTS_SENTENCE.test(s.slice(0, m.index))) midSingles.add(w);
    }
    const out = [...multi];
    for (const w of singles) if (midSingles.has(w)) out.push(w);
    return out.slice(0, MAX_NAMES);
}

// The chat's known names plus the ones found in this reply, no duplicates (any case).
export function mergeNames(known, text) {
    const seen = new Set();
    const out = [];
    for (const n of [...(Array.isArray(known) ? known : []), ...namesInText(text)]) {
        if (typeof n !== "string" || !n.trim()) continue;
        const k = n.trim().toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(n.trim());
    }
    return out;
}
