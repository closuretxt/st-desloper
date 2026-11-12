// The text to show for a reply that's still streaming in (st/stream.js): the finished lines
// cleaned, the line still being written as it comes (a rule could misread half a sentence).
// clean(text) -> { text, changed } (st/cleaner.js cleanText). Pure, tested by .tests/run.mjs.
//
// Settled lines stay put (pass a `state` from liveState()): every new finished line means the
// whole text so far is cleaned again, and rules that judge the reply as a whole (budgets,
// repeats, end-of-reply closers) can then change a line that's already on screen, which shows as
// flicker. So once a line has a later line under it, the way it was shown is kept for the rest of
// the stream; only the newest finished line can still change. The full clean when the reply is
// done (st/display.js) settles everything once.
export function liveState() {
    // frozen: the lines kept as shown; aligned: frozen[i] is line i of the text as written.
    return { frozen: [], aligned: true };
}

const filled = s => s.trim() !== "";

// Where the line `line` sits in `lines`, the match nearest `near` (lines can repeat).
function nearest(lines, line, near) {
    for (let d = 0; d < lines.length; d++) {
        if (lines[near - d] === line) return near - d;
        if (lines[near + d] === line) return near + d;
    }
    return -1;
}

export function liveText(text, clean, state = null) {
    if (typeof text !== "string") return text;
    const cut = text.lastIndexOf("\n");
    if (cut <= 0) return text;
    // The blank lines after the last finished line stay out of the clean and go back as written:
    // the pipeline drops trailing line breaks, which turned a paragraph gap into a single break
    // (a different spacing) whenever the paragraph above had a fix.
    const whole = text.slice(0, cut);
    const done = whole.replace(/\s+$/, "");
    const gap = whole.slice(done.length);
    if (!done) return text;
    const out = clean(done);
    // Cleaned down to nothing: shown as written, like a finished reply.
    const cleaned = out && out.changed && out.text.trim() ? out.text : done;
    if (!state) return cleaned === done ? text : cleaned + gap + text.slice(cut);
    const lines = cleaned.split("\n");
    // Line i of the clean is line i as written while no rule added or removed a whole line.
    const sameCount = lines.length === done.split("\n").length;
    let shown = lines;
    let aligned = sameCount;
    const k = state.frozen.length;
    if (k) {
        // The new lines are the ones after the kept ones: by position when both line up with the
        // text as written, else after the last kept line wherever it is now. If that can't be
        // found (a rule changed or removed it), show the fresh clean rather than risk dropping text.
        if (sameCount && state.aligned) {
            shown = state.frozen.concat(lines.slice(k));
        } else {
            const at = nearest(lines, state.frozen[k - 1], k - 1);
            if (at >= 0) {
                shown = state.frozen.concat(lines.slice(at + 1));
                aligned = state.aligned && at === k - 1 && sameCount;
            } else {
                state.frozen = [];
            }
        }
    }
    // Keep everything above the newest filled line, ending on a filled line (so the next tick
    // has a line to find).
    let last = shown.length - 1;
    while (last >= 0 && !filled(shown[last])) last--;
    let keep = last - 1;
    while (keep >= 0 && !filled(shown[keep])) keep--;
    if (keep + 1 > state.frozen.length) {
        state.aligned = state.frozen.length ? state.aligned && aligned : aligned;
        state.frozen = shown.slice(0, keep + 1);
    }
    const result = shown.join("\n");
    return result === done ? text : result + gap + text.slice(cut);
}
