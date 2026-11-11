// Whose settings the fixes popup is editing: everyone's (null, the default every time the popup
// opens) or one character's (core/characters.js). The cards, the patterns tab and the tester all
// read it, so switching the picker shows and tries out that character's version.

import { getContext } from "../../../../extensions.js";
import { getSettings } from "../settings/settingsManager.js";
import { characterEntry } from "../core/characters.js";

let target = null; // { key, name }

export const getTarget = () => target;
export const targetKey = () => target?.key || null;
export const targetEntry = () => characterEntry(getSettings(), targetKey());

export function setTarget(key, name = "") {
    target = key ? { key, name: name || nameOf(key) } : null;
}

export function nameOf(key) {
    return getContext().characters?.find(c => c.avatar === key)?.name || getSettings()?.characters?.[key]?.name || key;
}

// The picker's list: only the open chat's characters (the character, or every group member).
// No chat open: none, so only the global settings can be edited. Listing every character made
// the picker unusable with hundreds of them (user). -> [{ key, name, custom }].
export function characterChoices() {
    const ctx = getContext();
    const s = getSettings();
    const keys = [];
    if (ctx.groupId) {
        const group = ctx.groups?.find(g => g.id == ctx.groupId);
        for (const avatar of group?.members || []) if (avatar && !keys.includes(avatar)) keys.push(avatar);
    } else if (ctx.characterId !== undefined && ctx.characterId !== null) {
        const avatar = ctx.characters?.[ctx.characterId]?.avatar;
        if (avatar) keys.push(avatar);
    }
    return keys.map(key => ({ key, name: nameOf(key), custom: !!characterEntry(s, key) }));
}
