// "Rewrite saved messages" mode (setting `rewriteSaved`, off by default). The display cleaning is
// written into the saved `mes` instead of `display_text`, so other extensions reading the chat get
// the cleaned text; the original is kept in the chat file (core/saved.js) and put back when the
// mode or the master switch is turned off: the open chat at once, every other chat the next time
// it's opened (a chat that isn't open can't be reached).
//
// The prompt is unchanged by the mode: st/interceptor.js cleans from the original, as before.

import { getContext } from "../../../../extensions.js";
import { cleanText, isAiMessage, chatNames, lastUserBefore, historyBefore, budgetWindow, rewriteActive } from "./cleaner.js";
import { originalText, writeCleaned, restoreMessage, hasRecord } from "../core/saved.js";
import { logDebug } from "../core/debug.js";

// One message. -> { mes, data } (core/saved.js writeCleaned)
export function rewriteMessage(chat, index, names = chatNames(), size = budgetWindow()) {
    const m = chat?.[index];
    // Empty: a swipe that's still being generated.
    if (!isAiMessage(m) || !m.mes) return { mes: false, data: false };
    const source = originalText(m);
    const out = cleanText(source, "display", names, lastUserBefore(chat, index), historyBefore(chat, index, size));
    // A reply cleaned down to nothing is kept as written.
    return writeCleaned(m, source, out.changed && out.text.trim() ? out.text : null);
}

const yieldToBrowser = () => new Promise(r => setTimeout(r, 0));

let saveTimer = null;
let saveChatId = null;
// Saves the open chat soon, once per burst of writes. Skipped if another chat is open by then:
// the writes were to a chat that's gone from memory (and its file never changed).
export function saveSoon() {
    const ctx = getContext();
    saveChatId = ctx.getCurrentChatId?.();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        try {
            const now = getContext();
            if (now.getCurrentChatId?.() !== saveChatId) return;
            await now.saveChat?.();
            logDebug("rewrite: chat saved");
        } catch (e) {
            console.error("[ST Desloper] saving the chat failed:", e);
        }
    }, 500);
}

// Brings the whole open chat in line with the mode: writes every reply's cleaning (newest first,
// so what's on screen is done first), or puts the originals back. Yields to the browser every
// ~12 ms so a long chat never freezes the page. -> Set of message ids whose shown text changed,
// or null if a newer run (or another chat) took over.
let run = 0;
export async function syncChat() {
    const my = ++run;
    const ctx = getContext();
    const chat = ctx.chat;
    const chatId = ctx.getCurrentChatId?.();
    const changed = new Set();
    if (!Array.isArray(chat) || !chat.length) return changed;
    const started = performance.now();
    let data = false;
    if (rewriteActive()) {
        const names = chatNames();
        const size = budgetWindow();
        let slice = performance.now();
        for (let i = chat.length - 1; i >= 0; i--) {
            try {
                const r = rewriteMessage(chat, i, names, size);
                if (r.mes) changed.add(i);
                data ||= r.data;
            } catch (e) {
                console.error(`[ST Desloper] rewrite of message ${i} failed:`, e);
            }
            if (performance.now() - slice > 12) {
                await yieldToBrowser();
                if (my !== run || getContext().getCurrentChatId?.() !== chatId) return null;
                slice = performance.now();
            }
        }
    } else {
        for (let i = 0; i < chat.length; i++) {
            if (!hasRecord(chat[i])) continue;
            const before = chat[i].mes;
            if (restoreMessage(chat[i])) data = true;
            if (chat[i].mes !== before) changed.add(i);
        }
    }
    if (data) saveSoon();
    if (data || changed.size) logDebug(`rewrite: ${rewriteActive() ? "wrote" : "restored"} ${changed.size} messages (${Math.round(performance.now() - started)} ms)`);
    return changed;
}
