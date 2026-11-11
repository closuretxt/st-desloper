// What's displayed: the cleaned text goes into `message.extra.display_text`, which ST renders
// instead of `message.mes` (docs/PLAN.md section 2). The Edit box still shows `mes`.
//
// The cleaned text lives only in memory. display_text is set as a non-enumerable property, so
// JSON.stringify (ST's chat save) and structuredClone (ST's swipe copies) skip it: nothing
// Desloper writes ever lands in a chat file, and turning it off or uninstalling it leaves no
// trace. It's recomputed on chat load, which is cheap (string work, cached).
//
// Ownership: a WeakMap remembers the text Desloper put there. A display_text Desloper didn't
// write (the Translate extension's) is never overwritten or deleted.
//
// "Rewrite saved messages" mode (st/rewrite.js): the cleaned text is in `mes` itself, so nothing
// goes into display_text, except for "Show originals" (the original with the changes marked).
//
// Speed: re-rendering a message (ST's markdown + sanitizer) is what costs, not the cleaning. So
// a message is only re-rendered when what it shows actually changes, never twice for one new
// reply, newest first, and a long refresh yields to the browser between slices.

import { getContext } from "../../../../extensions.js";
import { cleanText, isAiMessage, lastUserBefore, chatNames, historyBefore, budgetWindow, originalText, rewriteActive, speakerOf } from "./cleaner.js";
import { rewriteMessage, syncChat, saveSoon } from "./rewrite.js";
import { getSettings } from "../settings/settingsManager.js";
import { logDebug } from "../core/debug.js";
import { markChanges, MARKERS, DEL_START, DEL_END, INS_START, INS_END } from "../core/diff.js";

const written = new WeakMap();

function isOurs(message) {
    const text = written.get(message);
    return text !== undefined && message.extra?.display_text === text;
}

function setDisplayText(message, text) {
    if (!message.extra || typeof message.extra !== "object") message.extra = {};
    Object.defineProperty(message.extra, "display_text", { value: text, writable: true, configurable: true, enumerable: false });
    written.set(message, text);
}

function clearDisplayText(message) {
    if (isOurs(message)) delete message.extra.display_text;
    written.delete(message);
}

function textElement(id) {
    return document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
}

// Re-rendering a message while its edit box is open would throw the edit away.
function isBeingEdited(id) {
    return !!document.querySelector(`#chat .mes[mesid="${id}"] #curEditTextarea`);
}

// What's on screen is Desloper's own render while the message text's first node is the one
// Desloper's render made: any re-render by ST (an edit, a swipe) replaces the nodes. Saves a
// second render of every new reply (ST's "rendered" event right after "received").
const renderedNode = new WeakMap();
function noteRendered(id, message) {
    const el = textElement(id);
    if (el) renderedNode.set(message, el.firstChild);
}
function showsOurRender(id, message) {
    const el = textElement(id);
    return !!el && renderedNode.has(message) && renderedNode.get(message) === el.firstChild;
}
// A new reply cleaned before its element exists: ST's first render will show the clean text by
// itself (it renders display_text, or the rewritten `mes`).
const firstRenderPending = new WeakSet();

// "Show originals" switch: every message shows the original with the changes marked.
// Memory only, on purpose: a saved switch would leave someone wondering weeks later why
// nothing gets cleaned. The prompt is cleaned either way.
let showAllOriginals = false;

export function setShowAllOriginals(on) {
    showAllOriginals = !!on;
    refreshAllSafely();
}

// "Show original" displays the original with Desloper's changes marked (core/diff.js). The
// marker characters ride through ST's rendering; this turns them into spans afterwards. A
// marked bit can start inside one element and end in another (an italic, a quote, the next
// paragraph), so it's done per text node, carrying the open marker along.
function decorate(id) {
    const root = textElement(id);
    if (!root || !MARKERS.test(root.textContent)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let state = null; // "sd_del" | "sd_ins" | null
    for (const node of nodes) {
        const text = node.nodeValue;
        if (!state && !MARKERS.test(text)) continue;
        const frag = document.createDocumentFragment();
        let buf = "";
        const flush = () => {
            if (!buf) return;
            if (state) {
                const span = document.createElement("span");
                span.className = state;
                span.textContent = buf;
                frag.appendChild(span);
            } else {
                frag.appendChild(document.createTextNode(buf));
            }
            buf = "";
        };
        for (const ch of text) {
            if (ch === DEL_START || ch === INS_START) {
                flush();
                state = ch === DEL_START ? "sd_del" : "sd_ins";
            } else if (ch === DEL_END || ch === INS_END) {
                flush();
                state = null;
            } else {
                buf += ch;
            }
        }
        flush();
        node.replaceWith(frag);
    }
}

function render(ctx, id, message) {
    ctx.updateMessageBlock(id, message);
    if (showAllOriginals) decorate(id);
    noteRendered(id, message);
}

// Brings one message's display in line with the current settings.
// render: re-render if the display text changed. force: re-render if Desloper's text should show
// but the screen may not have it (ST just rendered `mes` over it, e.g. after an edit). dirty:
// `mes` itself changed (rewrite mode), so the screen is stale whatever display_text does.
// ctx / names / size: passed in by refreshAll so 100 messages don't look them up 100 times.
export function refreshMessage(id, { render: doRender = true, force = false, dirty = false, ctx = getContext(), names = null, size = null } = {}) {
    const n = Number(id);
    const message = ctx.chat?.[n];
    if (!message) return false;
    const hasElement = !!textElement(n);
    const canRender = doRender && hasElement && !isBeingEdited(n);
    const ours = isOurs(message);
    if (!ours && message.extra?.display_text != null) {
        // Someone else's (Translate). Still re-render if the saved text changed under it.
        if (dirty && canRender) render(ctx, n, message);
        return false;
    }

    const rewrite = rewriteActive();
    let source = null;
    let cleaned = null;
    if (getSettings()?.enabled && isAiMessage(message)) {
        source = originalText(message);
        if (rewrite) {
            if (message.mes !== source) cleaned = message.mes;
        } else {
            const out = cleanText(source, "display", names ?? chatNames(), lastUserBefore(ctx.chat, n), historyBefore(ctx.chat, n, size ?? budgetWindow()), speakerOf(message, ctx));
            // A reply cleaned down to nothing is shown as written.
            if (out.changed && out.text.trim()) cleaned = out.text;
        }
    }
    const original = showAllOriginals;
    // The original with changes marked (plain original if the diff gives up: a near-total
    // rewrite); else the cleaned text, which in rewrite mode is `mes` itself (no display_text).
    const want = cleaned === null ? null : original ? markChanges(source, cleaned) : rewrite ? null : cleaned;
    const current = ours ? message.extra.display_text : null;
    const changed = want !== current;
    if (changed) {
        if (want === null) clearDisplayText(message);
        else setDisplayText(message, want);
    }
    if (!hasElement) {
        if (changed || dirty) firstRenderPending.add(message);
        return changed;
    }
    if (canRender) {
        if (firstRenderPending.has(message) && !changed && !dirty) {
            // ST's first render already showed it.
            firstRenderPending.delete(message);
            noteRendered(n, message);
            if (original && want !== null) decorate(n);
        } else if (changed || dirty || (force && want !== null && !showsOurRender(n, message))) {
            firstRenderPending.delete(message);
            render(ctx, n, message);
        } else if (original && want !== null) {
            // ST may have rendered the markers itself ("load more").
            decorate(n);
        }
    }
    return changed;
}

// Only the messages ST has on screen are cleaned for display (it shows the last ~100 of a long
// chat), so opening a 1000-message chat stays quick. Older ones are cleaned when "load more"
// shows them. Desloper's text on a message that isn't on screen is dropped: it may be stale, and
// it's recomputed when the message shows up again. In rewrite mode the whole chat's saved text is
// brought in line first (st/rewrite.js syncChat), since other extensions read all of it.
let run = 0;
export async function refreshAll() {
    const my = ++run;
    const ctx = getContext();
    const chatId = ctx.getCurrentChatId?.();
    const started = performance.now();
    const dirty = (await syncChat()) ?? new Set();
    if (my !== run) return;
    const chat = ctx.chat || [];
    const ids = [...document.querySelectorAll("#chat .mes[mesid]")].map(el => Number(el.getAttribute("mesid")));
    const onScreen = new Set(ids);
    for (let i = 0; i < chat.length; i++) if (!onScreen.has(i) && written.has(chat[i])) clearDisplayText(chat[i]);
    // Newest first: the bottom of the chat is what the user is looking at.
    ids.sort((a, b) => b - a);
    const names = chatNames();
    const size = budgetWindow();
    let changed = 0;
    let slice = performance.now();
    for (const i of ids) {
        try {
            if (refreshMessage(i, { ctx, names, size, dirty: dirty.has(i) })) changed++;
        } catch (e) {
            console.error(`[ST Desloper] message ${i} failed:`, e);
        }
        if (performance.now() - slice > 12) {
            await new Promise(r => setTimeout(r, 0));
            // A newer refresh or another chat took over.
            if (my !== run || getContext().getCurrentChatId?.() !== chatId) return;
            slice = performance.now();
        }
    }
    logDebug(`display: ${changed} of ${onScreen.size} messages on screen changed (${Math.round(performance.now() - started)} ms)`);
}

function refreshAllSafely() {
    refreshAll().catch(e => console.error("[ST Desloper] refresh failed:", e));
}

let timer = null;
export function scheduleRefreshAll(delay = 300) {
    clearTimeout(timer);
    timer = setTimeout(refreshAllSafely, delay);
}

// One message, rewrite mode first (so the saved text is clean before anything renders or reads it).
function refreshOne(id, opts = {}) {
    const n = Number(id);
    const ctx = getContext();
    let dirty = false;
    if (rewriteActive()) {
        const r = rewriteMessage(ctx.chat, n);
        dirty = r.mes;
        if (r.data) saveSoon();
    }
    return refreshMessage(n, { ...opts, ctx, dirty });
}

// `on` is index.js's try/catch-wrapped event helper; `first` puts a handler ahead of other
// extensions' (ST's makeFirst), so in rewrite mode they see the cleaned reply.
export function initDisplay(on) {
    const { eventTypes: E } = getContext();
    // A reply's cleaning can depend on the user's message before it (echo trim), so editing
    // a user's message also refreshes the reply after it.
    // Budgets over many replies: a changed reply changes what the replies after it may keep.
    const one = opts => id => {
        const n = Number(id);
        if (!Number.isFinite(n)) return;
        refreshOne(n, opts);
        const chat = getContext().chat || [];
        if (chat[n]?.is_user) refreshOne(n + 1, { force: true });
        if (budgetWindow() > 1 && n < chat.length - 1) scheduleRefreshAll();
    };
    if (E.MESSAGE_DELETED) on(E.MESSAGE_DELETED, "message deleted", () => scheduleRefreshAll());
    // Fires before the first render (or right after streaming ends), so new replies show clean.
    on(E.MESSAGE_RECEIVED, "message received", one({}), { first: true });
    on(E.CHARACTER_MESSAGE_RENDERED, "message rendered", one({ force: true }));
    // After an edit ST renders `mes` itself between these two; the second puts the clean text back.
    on(E.MESSAGE_EDITED, "message edited", one({ render: false }), { first: true });
    on(E.MESSAGE_UPDATED, "message updated", one({ force: true }));
    // display_text belongs to the message, not the swipe; swipes copy `extra` without it.
    on(E.MESSAGE_SWIPED, "message swiped", one({ force: true }), { first: true });
    on(E.CHAT_CHANGED, "chat changed", () => refreshAll());
    on(E.MORE_MESSAGES_LOADED, "more messages loaded", () => refreshAll());
}
