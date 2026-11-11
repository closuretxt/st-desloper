// Runs the pipeline for SillyTavern: picks the rules and settings, knows the chat's character
// names, and caches results (the same message text gives the same result until a setting
// changes), so re-renders and every generation's prompt stay cheap.

import { getContext } from "../../../../extensions.js";
import { runPipeline } from "../core/pipeline.js";
import { allRules } from "../rules/index.js";
import { getSettings } from "../settings/settingsManager.js";
import { logDebug } from "../core/debug.js";
import { originalText, hasRecord } from "../core/saved.js";

const MAX_CACHE = 2000;
const cache = new Map();
let rules = null;

// Call after any settings change.
export function invalidate() {
    cache.clear();
    rules = null;
}

// "Rewrite saved messages" mode (st/rewrite.js): only while the master switch is on too.
export function rewriteActive() {
    const s = getSettings();
    return !!(s?.enabled && s?.rewriteSaved);
}

// Character names for the grammar checks ("Seraphina says, turning away."): the character (or
// every group member) and the user's persona.
export function chatNames() {
    const ctx = getContext();
    const names = new Set();
    if (ctx.name2) names.add(ctx.name2);
    if (ctx.name1) names.add(ctx.name1);
    if (ctx.groupId) {
        const group = ctx.groups?.find(g => g.id == ctx.groupId);
        for (const avatar of group?.members || []) {
            const name = ctx.characters?.find(c => c.avatar === avatar)?.name;
            if (name) names.add(name);
        }
    }
    return [...names];
}

// A short fingerprint of the earlier replies, for the cache key (FNV-1a). Each reply's own hash
// is remembered: a refresh of 100 messages with a 10-reply window would otherwise hash the same
// 30 replies over and over (3,000 full-text passes per refresh).
const textHashes = new Map();
function hashText(s) {
    let h = textHashes.get(s);
    if (h !== undefined) return h;
    h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    h >>>= 0;
    if (textHashes.size >= MAX_CACHE) textHashes.delete(textHashes.keys().next().value);
    textHashes.set(s, h);
    return h;
}
function fingerprint(list) {
    let h = 0x811c9dc5;
    for (const t of list) h = Math.imul(h ^ hashText(String(t ?? "")), 0x01000193);
    return `${list.length}:${(h >>> 0).toString(36)}`;
}

export function budgetWindow() {
    const n = Math.floor(Number(getSettings()?.budgetWindow));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 200) : 10;
}

// The AI replies before `index`, as written, oldest first: what the budgets count over. Three
// windows back at most (core/speech.js windowLeft looks no further); [] when budgets are per reply.
// Hidden replies are left out: the model never sees them (ST drops them from the prompt), so
// they shouldn't use up what the visible replies may keep. Same count on screen and in the prompt.
export function historyBefore(chat, index, size = budgetWindow()) {
    if (size <= 1) return [];
    const out = [];
    for (let i = index - 1; i >= 0 && out.length < size * 3; i--) {
        const m = chat?.[i];
        if (isAiMessage(m) && !m.is_system) out.push(originalText(m));
    }
    return out.reverse();
}

// The reply as the model wrote it: `mes`, or in "rewrite saved messages" mode the original kept
// beside it (core/saved.js).
export { originalText };

// -> { text, hits, changed }. target: 'display' | 'outgoing' (each rule's "where" setting).
// lastUser: the user's message the reply answers (echo trim compares against it).
// history: the AI replies before this one (historyBefore), for budgets over many replies.
export function cleanText(text, target, names = chatNames(), lastUser = "", history = []) {
    const s = getSettings();
    const size = budgetWindow();
    const hist = size > 1 && Array.isArray(history) ? history : [];
    const key = `${target}\u0001${names.join("\u0002")}\u0001${lastUser}\u0001${size}\u0001${fingerprint(hist)}\u0001${text}`;
    const cached = cache.get(key);
    if (cached) return cached;
    rules ??= allRules(s);
    const out = runPipeline(text, rules, { names, settings: s?.rules, target, lastUser, window: { size, history: hist }, log: msg => logDebug(msg) });
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
}

// ST's own messages, never touched: narrator (/sys) and comment messages (extra.type), the help /
// welcome notes (the "SillyTavern System" name and avatar), compact notes, tool-call records.
const SYSTEM_NAME = "SillyTavern System";
const SYSTEM_AVATAR = "img/five.png";
export function isSystemNote(message) {
    if (!message) return false;
    const x = message.extra;
    return !!(x?.type || x?.isSmallSys || (Array.isArray(x?.tool_invocations) && x.tool_invocations.length) || message.name === SYSTEM_NAME || message.force_avatar === SYSTEM_AVATAR);
}

// Ghost messages: hidden (`is_system`) from the moment they were made, by a script or another
// extension, never a reply the model wrote and the user hid later. ST keeps no record of which is
// which, so: a message seen visible this session, one the model generated (`gen_started`), or one
// "rewrite saved messages" wrote (it was visible then) is a hidden reply; anything else hidden is
// a ghost and is left alone completely (user, 2026-11-09).
const seenVisible = new WeakSet();
export function isGhost(message) {
    if (!message || message.is_user) return false;
    if (!message.is_system) {
        seenVisible.add(message);
        return false;
    }
    return !seenVisible.has(message) && !message.gen_started && !hasRecord(message);
}

// AI replies only: not the user's, not ST's own notes, not ghosts. A reply hidden later (what
// /hide sets) still counts: it's on screen, so it's cleaned there; it just doesn't count toward
// other replies' budgets (historyBefore).
export function isAiMessage(message) {
    return !!message && typeof message.mes === "string" && !message.is_user && !isSystemNote(message) && !isGhost(message);
}

// The user's message that the reply at `index` answers: the message right before it, skipping
// ST's notes and hidden messages (the model doesn't see those either). '' when that's another
// reply (a second reply in a row answers nothing new; the stats count echoes the same way).
export function lastUserBefore(chat, index) {
    for (let i = index - 1; i >= 0; i--) {
        const m = chat?.[i];
        if (!m || m.is_system || isSystemNote(m)) continue;
        return m.is_user && typeof m.mes === "string" ? m.mes : "";
    }
    return "";
}
