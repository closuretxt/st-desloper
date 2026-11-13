// The little the stats keep, all in extension_settings (nothing per chat file: every number is
// recomputed from the saved originals, which never change):
//   lexicon    the user's stock-phrase list, or null for the built-in one (stats/lexicon.js)
//   pins       chatId -> { from, to }: a pinned baseline ("before I installed Deslopper")
//   summaries  the latest numbers of each chat the stats were opened for (newest first, max 50)
// Saved with saveSettingsDebounced directly, not settingsChanged(): none of this changes what
// gets cleaned, so the display doesn't need to refresh.

import { saveSettingsDebounced } from "../../../../../script.js";
import { getSettings } from "../settings/settingsManager.js";

const MAX_SUMMARIES = 50;

function store() {
    const s = getSettings();
    if (!s.stats || typeof s.stats !== "object") s.stats = {};
    s.stats.pins ??= {};
    s.stats.summaries ??= [];
    if (s.stats.lexicon !== null && !Array.isArray(s.stats.lexicon)) s.stats.lexicon = null;
    return s.stats;
}

export function getLexicon() {
    return store().lexicon;
}

export function setLexicon(list) {
    store().lexicon = Array.isArray(list) ? list : null;
    saveSettingsDebounced();
}

export function getPin(chatId) {
    const p = chatId ? store().pins[chatId] : null;
    return p && Number.isFinite(p.from) && Number.isFinite(p.to) ? p : null;
}

export function setPin(chatId, pin) {
    if (!chatId) return;
    const pins = store().pins;
    if (pin) pins[chatId] = { from: pin.from, to: pin.to };
    else delete pins[chatId];
    saveSettingsDebounced();
}

export function saveSummary(summary) {
    if (!summary?.chatId) return;
    const st = store();
    st.summaries = [{ ...summary, ts: Date.now() }, ...st.summaries.filter(x => x.chatId !== summary.chatId)].slice(0, MAX_SUMMARIES);
    saveSettingsDebounced();
}

export function getSummaries() {
    return store().summaries;
}
