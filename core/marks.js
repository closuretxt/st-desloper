// Edit markers. PURE: no SillyTavern imports.
//
// A rule (or the pipeline, by diff, when a rule doesn't) puts MARK where it changed the text.
// The repair step then works only around those spots, so it never "fixes" the author's own
// text elsewhere in the message (their style, their double spaces, their "Hello..").
// It's a private-use character, never in real chat text; the pipeline refuses text that has one.

export const MARK = "";

export function hasMark(s) {
    return typeof s === "string" && s.includes(MARK);
}

export function stripMarks(s) {
    return String(s ?? "").split(MARK).join("");
}

// For rules that return plain text: mark the start and end of the changed stretch (common
// prefix / suffix). One stretch per call, which is enough for the repair step to find it.
export function markDiff(oldText, newText) {
    if (hasMark(newText)) return newText;
    if (oldText === newText) return newText;
    const max = Math.min(oldText.length, newText.length);
    let p = 0;
    while (p < max && oldText[p] === newText[p]) p++;
    let s = 0;
    while (s < max - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
    const end = newText.length - s;
    return newText.slice(0, p) + MARK + newText.slice(p, end) + MARK + newText.slice(end);
}
