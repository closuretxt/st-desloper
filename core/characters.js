// Per-character fixes: a character can turn fixes on or off, change their options, and have its
// own patterns, on top of the global settings. PURE: no SillyTavern imports.
//
// Stored in settings.characters, keyed by the character's avatar file (stable where names repeat;
// index.js follows renames and deletes):
//   characters[avatar] = { name, rules: { [ruleId]: { key: value } }, patterns: [...] }
// `rules` holds only what differs from the global value at the time it was set, so everything a
// character hasn't touched follows the global settings. `name` is just for the picker when the
// character isn't loaded. Budgets' window and the master switches stay global.

import { patternRules } from "../rules/patternRules.js";

// Character patterns run after the global ones (900 + their count), so they get the last word.
export const CHARACTER_PATTERN_ORDER = 2000;

export function characterEntry(settings, key) {
    if (!key || typeof key !== "string") return null;
    const e = settings?.characters?.[key];
    return e && typeof e === "object" ? e : null;
}

// Global per-rule settings with the character's overrides on top: same shape as settings.rules,
// so the pipeline's settingsFor (defaults <- this) works unchanged.
export function mergedRuleSettings(globalRules, entry) {
    const own = entry?.rules;
    if (!own || typeof own !== "object" || !Object.keys(own).length) return globalRules || {};
    const out = { ...(globalRules || {}) };
    for (const [id, values] of Object.entries(own)) {
        if (values && typeof values === "object") out[id] = { ...(out[id] || {}), ...values };
    }
    return out;
}

// The character's own patterns as rules ("charpattern:<id>").
export function characterPatternRules(entry) {
    return patternRules(entry?.patterns, { prefix: "charpattern", base: CHARACTER_PATTERN_ORDER });
}

export function hasOverrides(entry, ruleId) {
    const own = entry?.rules?.[ruleId];
    return !!own && typeof own === "object" && Object.keys(own).length > 0;
}

export function isEmptyEntry(entry) {
    if (!entry) return true;
    const rules = entry.rules && typeof entry.rules === "object" ? Object.keys(entry.rules).length : 0;
    const patterns = Array.isArray(entry.patterns) ? entry.patterns.length : 0;
    return !rules && !patterns;
}

// Sets one override. `globalValue` is what the character gets without it: setting that value
// removes the override instead of storing a copy, so it follows the global setting again. An
// emptied entry is dropped. -> true when something changed.
export function setOverride(settings, key, name, ruleId, optKey, value, globalValue) {
    if (!settings || !key || !ruleId || !optKey) return false;
    settings.characters ??= {};
    const same = JSON.stringify(value) === JSON.stringify(globalValue);
    let entry = characterEntry(settings, key);
    if (!entry) {
        if (same) return false;
        entry = settings.characters[key] = { name: name || "", rules: {}, patterns: [] };
    }
    if (name) entry.name = name;
    entry.rules ??= {};
    const own = (entry.rules[ruleId] ??= {});
    if (same) delete own[optKey];
    else own[optKey] = value;
    if (!Object.keys(own).length) delete entry.rules[ruleId];
    dropIfEmpty(settings, key);
    return true;
}

// Removes every override of one rule (the card's "use global" button).
export function clearOverrides(settings, key, ruleId) {
    const entry = characterEntry(settings, key);
    if (!entry?.rules?.[ruleId]) return false;
    delete entry.rules[ruleId];
    dropIfEmpty(settings, key);
    return true;
}

// The character's pattern list, made (empty) if needed: the patterns editor writes into it.
export function ensurePatterns(settings, key, name) {
    settings.characters ??= {};
    const entry = (settings.characters[key] = characterEntry(settings, key) || { name: name || "", rules: {}, patterns: [] });
    if (name) entry.name = name;
    if (!Array.isArray(entry.patterns)) entry.patterns = [];
    return entry.patterns;
}

export function dropIfEmpty(settings, key) {
    if (settings?.characters && isEmptyEntry(characterEntry(settings, key))) delete settings.characters[key];
}

// A character's avatar file changed (ST renames it with the character). -> true when moved.
export function renameEntry(settings, oldKey, newKey, newName) {
    const entry = characterEntry(settings, oldKey);
    if (!entry || !newKey || oldKey === newKey) return false;
    // An entry already under the new file name loses: it belonged to a character that's gone.
    settings.characters[newKey] = entry;
    delete settings.characters[oldKey];
    if (newName) entry.name = newName;
    return true;
}

// The character was deleted: its file name may be reused by a new character, which must not
// inherit these settings.
export function deleteEntry(settings, key) {
    if (!characterEntry(settings, key)) return false;
    delete settings.characters[key];
    return true;
}
