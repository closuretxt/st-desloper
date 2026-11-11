// Cleaning while a reply streams in (setting `streamClean`, on by default). ST re-renders the
// streaming message from its raw text on every tick, writing the message's .mes_text; a
// MutationObserver on that element runs right after each write, before the browser paints, and
// puts the cleaned version in its place, so the raw text never shows.
//
// Only the finished lines are cleaned: everything up to the last line break. The line still being
// written is shown raw, since a rule could misread half a sentence. Finished lines hit the cache
// on every later tick, so a tick costs one extra render, not a pipeline run. Rules that look at
// the reply as a whole (the end of the reply, budgets) can judge differently once more text has
// come in; to stop lines already shown from changing (flicker), settled lines are kept as shown
// (core/live.js liveState). ST's last render shows the full clean, which settles everything.
//
// With ST's "stream fade-in" on, the clean version goes through ST's own fade-in function (word
// spans, morphed into place), so words already shown keep their place and new ones still fade in.

import { getContext } from "../../../../extensions.js";
import { cleanText, isAiMessage, chatNames, lastUserBefore, historyBefore, budgetWindow, speakerOf } from "./cleaner.js";
import { getSettings } from "../settings/settingsManager.js";
import { logDebug } from "../core/debug.js";
import { liveText, liveState } from "../core/live.js";

let observer = null;
let watched = null; // { el, id, names, lastUser, history }
let genType = null; // the running generation's type (GENERATION_STARTED)

// Exported for live checks only (CLAUDE.md: test without sending anything).
export function stopStreamWatch() {
    stop();
}

function stop() {
    observer?.disconnect();
    observer = null;
    watched = null;
}

function enabled() {
    const s = getSettings();
    return !!s?.enabled && s.streamClean !== false;
}

// ST's fade-in renderer, loaded on first need: a path that moved in some ST version must not
// stop the extension from loading. null: not found, plain rendering is used.
let fadeIn;
async function loadFadeIn() {
    if (fadeIn !== undefined) return;
    fadeIn = null;
    try {
        fadeIn = (await import("../../../../util/stream-fadein.js")).applyStreamFadeIn ?? null;
    } catch (e) {
        logDebug("stream: fade-in renderer not found, plain rendering", e);
    }
}

function fadeInOn() {
    return !!getContext().powerUserSettings?.stream_fade_in;
}

// ST marks the stream finished before its last render (onFinishStreaming); a stopped stream gets
// no last render and goes straight to the full clean.
function finalTick(ctx) {
    const sp = ctx.streamingProcessor;
    return !!sp && sp.isFinished === true && !sp.isStopped;
}

function onMutation() {
    try {
        if (!watched || !enabled()) return;
        const ctx = getContext();
        const m = ctx.chat?.[watched.id];
        if (!isAiMessage(m) || typeof m.mes !== "string") return;
        // The speaker is read each time: a group reply's `original_avatar` is set as it's made.
        const speaker = speakerOf(m, ctx);
        const clean = text => cleanText(text, "display", watched.names, watched.lastUser, watched.history, speaker);
        let shown;
        if (finalTick(ctx)) {
            // ST's last render of the whole reply: show the full clean now, the same call (and
            // cache entry) st/display.js makes next, so the hand-off changes nothing on screen.
            const out = clean(m.mes);
            shown = out.changed && out.text.trim() ? out.text : m.mes;
        } else {
            shown = liveText(m.mes, clean, watched.live);
        }
        if (shown === m.mes) return;
        const html = ctx.messageFormatting(shown, m.name, m.is_system, m.is_user, watched.id, {}, false);
        if (fadeInOn() && fadeIn) fadeIn(watched.el, html);
        else watched.el.innerHTML = html;
        // Our own write would wake the observer again.
        observer?.takeRecords();
    } catch (e) {
        console.error("[ST Desloper] stream cleaning failed:", e);
        stop();
    }
}

// Called on every streamed token: cheap unless the streaming element changed (the first token
// creates it; a new reply makes a new one).
export function watch() {
    // Impersonation streams into the input box, not a message.
    if (!enabled() || genType === "impersonate") return stop();
    const mes = document.querySelector("#chat .mes.last_mes");
    const el = mes?.querySelector(".mes_text");
    if (!el) return;
    if (watched?.el === el) return;
    stop();
    const id = Number(mes.getAttribute("mesid"));
    const chat = getContext().chat || [];
    if (!isAiMessage(chat[id])) return;
    watched = { el, id, names: chatNames(), lastUser: lastUserBefore(chat, id), history: historyBefore(chat, id, budgetWindow()), live: liveState() };
    if (fadeIn === undefined) loadFadeIn();
    observer = new MutationObserver(onMutation);
    // subtree + characterData: fade-in morphs the text inside the paragraphs, not just them.
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    logDebug(`stream: cleaning message ${id} as it streams`);
}

export function initStream(on) {
    const { eventTypes: E } = getContext();
    on(E.GENERATION_STARTED, "generation started", (type, _options, dryRun) => {
        if (!dryRun) genType = type;
    });
    on(E.STREAM_TOKEN_RECEIVED, "stream token", watch);
    // The full clean takes over from here (st/display.js).
    for (const name of ["MESSAGE_RECEIVED", "GENERATION_ENDED", "GENERATION_STOPPED", "IMPERSONATE_READY", "CHAT_CHANGED"]) {
        if (E[name]) on(E[name], `stream end (${name})`, stop);
    }
}
