// Sentence splitter. PURE: no SillyTavern imports.
//
// splitSentences(text) -> [{ text, space }], where `text` is the sentence (with its end
// punctuation and any closing quote / asterisk) and `space` the whitespace after it.
// Joining every text + space gives back the input exactly. Leading whitespace comes back as a
// first entry with empty text.
//
// A sentence ends at . ! ? … ~ ♡ (or a run of them) when whitespace follows and the next
// thing looks like a new sentence (capital letter, digit, quote, asterisk...). A lowercase word
// after it means it wasn't an end ("Wait... no", "e.g. this"). A line break always ends one.

const TERM = /[.!?…~♡]/;
const CLOSER = /["”’»」』*_)\]]/;
const ABBREVIATIONS = new Set([
    "mr", "mrs", "ms", "dr", "st", "vs", "etc", "jr", "sr", "prof", "lt", "sgt", "capt", "mt",
    "gen", "col", "rev", "fig", "no", "e.g", "i.e", "approx", "dept", "est",
]);

function isBoundary(text, start, termStart, termEnd, next) {
    if (next === undefined || next === "\n") return true;
    if (/\p{Ll}/u.test(next)) return false;
    // A single period after a known abbreviation or an initial ("J. R.") isn't an end.
    if (text.slice(termStart, termEnd) === ".") {
        const word = (text.slice(start, termStart).match(/([A-Za-z.]+)$/) || [])[1] || "";
        // "No. 5" is an abbreviation; "No. You can't." is the word no, so only before a number.
        if (word.toLowerCase() === "no") return !/\d/.test(next);
        if (ABBREVIATIONS.has(word.toLowerCase())) return false;
        if (/^[A-Z]$/.test(word)) return false;
    }
    return true;
}

export function splitSentences(text) {
    const s = String(text ?? "");
    const out = [];
    let i = 0;
    let start = 0;
    const lead = s.match(/^\s*/)[0];
    if (lead) {
        out.push({ text: "", space: lead });
        i = start = lead.length;
    }
    while (i < s.length) {
        const ch = s[i];
        if (ch === "\n") {
            let k = i;
            while (k < s.length && /\s/.test(s[k])) k++;
            const body = s.slice(start, i).replace(/[ \t]+$/, "");
            out.push({ text: body, space: s.slice(start + body.length, k) });
            i = start = k;
            continue;
        }
        if (TERM.test(ch)) {
            let termEnd = i;
            while (termEnd < s.length && TERM.test(s[termEnd])) termEnd++;
            let j = termEnd;
            while (j < s.length && CLOSER.test(s[j])) j++;
            if (j < s.length && /[ \t]/.test(s[j])) {
                let k = j;
                while (k < s.length && /[ \t]/.test(s[k])) k++;
                if (isBoundary(s, start, i, termEnd, s[k])) {
                    while (k < s.length && /\s/.test(s[k])) k++;
                    out.push({ text: s.slice(start, j), space: s.slice(j, k) });
                    i = start = k;
                    continue;
                }
            }
            i = termEnd;
            continue;
        }
        i++;
    }
    if (start < s.length) {
        const body = s.slice(start);
        const trail = body.match(/\s*$/)[0];
        out.push({ text: body.slice(0, body.length - trail.length), space: trail });
    }
    return out;
}

export function joinSentences(list) {
    return list.map(x => x.text + x.space).join("");
}
