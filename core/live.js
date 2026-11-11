// The text to show for a reply that's still streaming in (st/stream.js): the finished lines
// cleaned, the line still being written as it comes (a rule could misread half a sentence).
// clean(text) -> { text, changed } (st/cleaner.js cleanText). Pure, tested by .tests/run.mjs.
export function liveText(text, clean) {
    if (typeof text !== "string") return text;
    const cut = text.lastIndexOf("\n");
    if (cut <= 0) return text;
    const out = clean(text.slice(0, cut));
    // Cleaned down to nothing: shown as written, like a finished reply.
    if (!out || !out.changed || !out.text.trim()) return text;
    return out.text + text.slice(cut);
}
