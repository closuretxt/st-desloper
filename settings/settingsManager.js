import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName } from "../core/constants.js";
import { logDebug } from "../core/debug.js";

export const defaultSettings = {
    enabled: true,
    debug_mode: false,
    // Write the cleaning into the saved messages, original kept to put back (st/rewrite.js).
    rewriteSaved: false,
    // Clean the finished lines of a reply while it streams in (st/stream.js).
    streamClean: true,
    // Per-rule settings, keyed by rule id. Only what the user changed is stored; the rest comes
    // from each rule's `defaults` (core/pipeline.js settingsFor), so new defaults reach old installs.
    rules: {},
    // Budgets (stutter, gestures, lone lines, blushes, pet names) count over this many replies;
    // 1 = per reply (core/speech.js windowLeft).
    budgetWindow: 10,
    // "Your patterns" (rules/patternRules.js).
    patterns: [],
    // Per-character fixes, keyed by avatar file (core/characters.js): only what differs from the above.
    characters: {},
    // The stats' small store (stats/statsStore.js): stock-phrase list, pinned baselines, per-chat summaries.
    stats: { lexicon: null, pins: {}, summaries: [] },
};

// Checkbox wiring: setting key -> element id in index.html. Load, save and listeners all
// iterate this table, so a new toggle is one line here.
const CHECKBOXES = {
    enabled: "st_desloper_setting_enabled",
    debug_mode: "st_desloper_setting_debug_mode",
    rewriteSaved: "st_desloper_setting_rewrite_saved",
    streamClean: "st_desloper_setting_stream_clean",
};

// Called after a save so display and prompt can recompute (wired in later steps).
const changeListeners = [];
export function onSettingsChanged(fn) {
    changeListeners.push(fn);
}

export function getSettings() {
    return extension_settings[extensionName];
}

export function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];

    // Backfill missing keys (also covers new settings in updates).
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (s[key] === undefined) {
            s[key] = typeof value === "object" ? structuredClone(value) : value;
        }
    }

    for (const [key, id] of Object.entries(CHECKBOXES)) {
        $(`#${id}`).prop("checked", !!s[key]);
    }
}

export function saveSettings() {
    const s = extension_settings[extensionName];
    for (const [key, id] of Object.entries(CHECKBOXES)) {
        s[key] = $(`#${id}`).prop("checked");
    }
    settingsChanged();
}

// Saves (debounced) and tells the listeners. The rule and pattern editors write into the
// settings object directly, then call this.
export function settingsChanged() {
    const s = extension_settings[extensionName];
    saveSettingsDebounced();
    logDebug("settings saved", s);
    for (const fn of changeListeners) {
        // One broken listener must not stop the others.
        try {
            fn(s);
        } catch (e) {
            console.error("[ST Desloper] settings listener failed:", e);
        }
    }
}

export function initSettingsListeners() {
    const ids = Object.values(CHECKBOXES);
    $(ids.map(id => `#${id}`).join(", ")).off("change.st_desloper").on("change.st_desloper", saveSettings);
}
