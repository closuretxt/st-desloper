// "Rewrite saved messages" mode, the data side (st/rewrite.js runs it). The cleaned text goes into
// the saved `mes`, so every extension that reads the chat (TTS, summaries, memory) gets it too, and
// the original is kept beside it in `extra.st_deslopper = { original, cleaned }` so it can be put
// back. `extra` is where ST keeps per-swipe data: it copies it into `swipe_info[k].extra` and back
// on every swipe, so each swipe carries its own record.
//
// Chats saved before the spelling fix hold the record under `extra.st_desloper`: it's still read,
// and replaced by the new key the next time the message is written or restored.
//
// Pure: no SillyTavern imports, tested by .tests/run.mjs.

export const RECORD_KEY = "st_deslopper";
const OLD_RECORD_KEY = "st_desloper";

function recordOf(extra) {
    if (!extra || typeof extra !== "object") return null;
    const rec = extra[RECORD_KEY] ?? extra[OLD_RECORD_KEY];
    return rec && typeof rec.original === "string" && typeof rec.cleaned === "string" ? rec : null;
}

function dropRecord(extra) {
    if (!extra || typeof extra !== "object") return;
    delete extra[RECORD_KEY];
    delete extra[OLD_RECORD_KEY];
}

// The text as the model wrote it, from a saved text and its record. If the text no longer
// matches what Deslopper wrote, someone changed it since: a "continue" glued more text on (kept,
// on top of the original), or the user or another extension edited it (their text wins and
// becomes the new original).
function originalOf(text, extra) {
    const rec = recordOf(extra);
    if (typeof text !== "string" || !rec) return text;
    if (text === rec.cleaned) return rec.original;
    if (rec.cleaned && text.startsWith(rec.cleaned)) return rec.original + text.slice(rec.cleaned.length);
    return text;
}

// The reply as the model wrote it. Normally that's `mes`.
export function originalText(message) {
    return originalOf(message?.mes, message?.extra);
}

export function hasRecord(message) {
    if (recordOf(message?.extra)) return true;
    return Array.isArray(message?.swipe_info) && message.swipe_info.some(info => recordOf(info?.extra));
}

// Keeps the open swipe's copy in step with `mes`, the way ST's own syncMesToSwipe does. The text
// is only copied when the swipe held what `mes` held before: if they already differed, ST has a
// reason (a fresh greeting keeps its macros unresolved in `swipes`), so it's left alone.
function syncSwipe(message, before) {
    const k = message.swipe_id;
    if (Array.isArray(message.swipes) && message.swipes[k] === before) message.swipes[k] = message.mes;
    const info = Array.isArray(message.swipe_info) ? message.swipe_info[k] : null;
    if (!info || typeof info !== "object") return;
    const rec = recordOf(message.extra);
    if (rec) {
        if (!info.extra || typeof info.extra !== "object") info.extra = {};
        dropRecord(info.extra);
        info.extra[RECORD_KEY] = { original: rec.original, cleaned: rec.cleaned };
    } else {
        dropRecord(info.extra);
    }
}

// Saves `cleaned` as the message's text, keeping `source` (its originalText) to put back later.
// `cleaned` null or equal to the source: the message goes back to the source with no record.
// -> { mes: the shown text changed, data: anything that's saved changed }
export function writeCleaned(message, source, cleaned) {
    const before = message.mes;
    const hadRec = recordOf(message.extra);
    const oldKey = !!message.extra?.[OLD_RECORD_KEY];
    if (cleaned == null || cleaned === source) {
        if (!hadRec && before === source) return { mes: false, data: false };
        dropRecord(message.extra);
        message.mes = source;
    } else {
        if (!oldKey && hadRec && hadRec.original === source && hadRec.cleaned === cleaned && before === cleaned) return { mes: false, data: false };
        if (!message.extra || typeof message.extra !== "object") message.extra = {};
        dropRecord(message.extra);
        message.extra[RECORD_KEY] = { original: source, cleaned };
        message.mes = cleaned;
    }
    syncSwipe(message, before);
    return { mes: message.mes !== before, data: true };
}

// Puts the original back, on the open swipe and every other one. -> true if anything changed.
export function restoreMessage(message) {
    if (!message || typeof message !== "object") return false;
    let changed = false;
    if (recordOf(message.extra)) {
        const before = message.mes;
        message.mes = originalText(message);
        dropRecord(message.extra);
        syncSwipe(message, before);
        changed = true;
    }
    if (Array.isArray(message.swipe_info)) {
        message.swipe_info.forEach((info, k) => {
            if (!recordOf(info?.extra)) return;
            if (Array.isArray(message.swipes) && typeof message.swipes[k] === "string") message.swipes[k] = originalOf(message.swipes[k], info.extra);
            dropRecord(info.extra);
            changed = true;
        });
    }
    return changed;
}
