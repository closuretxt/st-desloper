// The fixes popup: the built-in fixes with their options, Your patterns, and the tester. On a
// wide screen the tester sits in a column beside the list, so changing an option shows its effect
// right away; on a narrow one it's a third tab. The picker in the title edits one character's
// overrides and patterns instead of the global ones (core/characters.js).

import { getContext } from "../../../../extensions.js";
import { BUILTIN_RULES } from "../rules/index.js";
import { renderRules, setAllCardsOpen, isRuleOn } from "./settingsPanel.js";
import { initPatternsEditor, setPatternsScope, renderPatterns } from "./patternsEditor.js";
import { initTester, runTester } from "./tester.js";
import { characterChoices, getTarget, setTarget, targetKey } from "./characterTarget.js";
import { LOG_PREFIX } from "../core/constants.js";
import { defaultSettings, getSettings, settingsChanged } from "../settings/settingsManager.js";
import { budgetWindow } from "../st/cleaner.js";
import { tagNamesOf } from "../core/segments.js";

let openPopup = null;

const TEMPLATE = `
<div class="sd_popup sd_fx st-deslopper-settings">
    <div class="sd_popup_title">
        <span class="sd_popup_name">🧽 Deslopper fixes</span>
        <label class="sd_char_pick_wrap" title="Edit the fixes for every character, or for one character's replies only">
            <i class="fa-solid fa-user"></i>
            <select class="text_pole sd_select sd_char_pick"></select>
        </label>
        <span class="sd_note sd_scope_note"></span>
    </div>
    <div class="sd_tabs" role="tablist">
        <button type="button" class="sd_tab" data-tab="fixes"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Fixes</span><span class="sd_tab_count sd_tab_count_fixes"></span></button>
        <button type="button" class="sd_tab" data-tab="patterns"><i class="fa-solid fa-code"></i><span>Your patterns</span><span class="sd_tab_count sd_tab_count_patterns"></span></button>
        <button type="button" class="sd_tab sd_tab_tester" data-tab="tester"><i class="fa-solid fa-flask"></i><span>Tester</span></button>
    </div>
    <div class="sd_fx_body">
        <div class="sd_fx_main">
            <section class="sd_pane" data-pane="fixes">
                <div class="sd_globals">
                    <div class="sd_global_row sd_budget_row">
                        <span class="sd_global_label">Budgets</span>
                        <div class="sd_global_body">
                            <label class="sd_global_inline" title="Stutter, gesture, one-line paragraph, blush and pet-name budgets count over this many replies. 1 = each reply has its own budget.">
                                <span>Count over the last</span>
                                <input type="number" min="1" max="200" class="text_pole sd_number sd_budget_window">
                                <span>replies</span>
                            </label>
                            <i class="fa-solid fa-circle-info sd_global_info" title="A budget of 3 then means 3 in any 10 replies, not 3 in every reply. The tester has no history: there it's per reply."></i>
                        </div>
                    </div>
                    <div class="sd_global_row sd_skip_row">
                        <span class="sd_global_label">Leave alone</span>
                        <div class="sd_global_body">
                            <label class="checkbox_label sd_skip_check" title="Square-bracket lines that start with a label and a colon: [Time: 12:24], [Status: tired], [OOC: …]">
                                <input type="checkbox" class="sd_skip_brackets"><span>[Label: …]</span>
                            </label>
                            <label class="checkbox_label sd_skip_check" title="Every &lt;tag&gt;…&lt;/tag&gt; block, except formatting tags like &lt;font&gt;, &lt;span&gt;, &lt;b&gt;, &lt;i&gt;, &lt;p&gt; that wrap the story itself">
                                <input type="checkbox" class="sd_skip_all_tags"><span>Every tag block</span>
                            </label>
                            <input type="text" class="text_pole sd_skip_tags" placeholder="or tags: time, status" title="Tag names, separated by commas. Their whole &lt;tag&gt;…&lt;/tag&gt; block is left alone.">
                            <i class="fa-solid fa-circle-info sd_global_info" title="Trackers and status blocks: no fix changes them and the stats leave them out."></i>
                        </div>
                    </div>
                </div>
                <div class="sd_list_head">
                    <span class="sd_note">Click a fix for its options. <b>Both / Screen / Model</b>: where it applies.</span>
                    <span class="sd_toolbar_end">
                        <button type="button" class="sd_link sd_expand_all">Open all</button>
                        <button type="button" class="sd_link sd_collapse_all">Close all</button>
                    </span>
                </div>
                <div class="sd_card_list sd_rule_list"></div>
            </section>
            <section class="sd_pane" data-pane="patterns">
                <div class="sd_toolbar">
                    <span class="sd_note">Find text and replace or delete it: plain text, or /regex/flags like ST's Regex extension. Every change still goes through Deslopper's repair step (punctuation, capitals, emptied quotes).</span>
                </div>
                <div class="sd_buttons">
                    <div class="menu_button sd_button_main sd_pattern_add" title="Add an empty pattern"><i class="fa-solid fa-plus"></i><span>Add pattern</span></div>
                    <div class="menu_button sd_pattern_import" title="Import ST Regex scripts (.json) or a Deslopper export"><i class="fa-solid fa-file-import"></i><span>Import</span></div>
                    <div class="menu_button sd_pattern_export" title="Save your patterns to a .json file"><i class="fa-solid fa-file-export"></i><span>Export</span></div>
                    <input class="sd_pattern_file" type="file" accept=".json,application/json" hidden />
                </div>
                <div class="sd_card_list sd_pattern_list"></div>
                <div class="sd_pattern_globals" hidden></div>
            </section>
        </div>
        <aside class="sd_pane sd_fx_tester" data-pane="tester">
            <div class="sd_section_head">
                <span class="sd_section_title"><i class="fa-solid fa-flask"></i>Tester</span>
                <span class="sd_badge sd_tester_count"></span>
            </div>
            <div class="sd_note">Paste a reply to see what the settings make of it. Nothing is saved or sent.</div>
            <textarea class="text_pole sd_textarea sd_tester_input" rows="6" placeholder='She doesn&apos;t pull away, pressing closer instead. "Tsk. Deal?"'></textarea>
            <textarea class="text_pole sd_textarea sd_tester_user" rows="2" placeholder="Optional: your message before it (for Echo trim)"></textarea>
            <div class="sd_tester_row">
                <span class="sd_field_label"><span>Clean as</span></span>
                <div class="sd_segmented sd_tester_target">
                    <button type="button" class="sd_seg" data-value="display" title="What the chat shows">Shown on screen</button>
                    <button type="button" class="sd_seg" data-value="outgoing" title="What the model gets">Sent to the model</button>
                </div>
            </div>
            <div class="sd_tester_output"></div>
            <ul class="sd_tester_hits"></ul>
            <div class="sd_tester_notes"></div>
        </aside>
    </div>
</div>`;

function fixesCount() {
    const on = BUILTIN_RULES.filter(isRuleOn).length;
    return `${on}/${BUILTIN_RULES.length}`;
}

function showTab($root, tab) {
    $root.attr("data-tab", tab);
    $root.find(".sd_tab").each(function () {
        $(this).toggleClass("sd_active", this.dataset.tab === tab).attr("aria-selected", this.dataset.tab === tab);
    });
}

// The character picker: everyone first (the default), then the open chat's characters only.
// "✱" marks a character that has its own settings. No chat open: just the global settings.
function fillPicker($sel) {
    const list = characterChoices();
    $sel.empty().append($("<option>").val("").text("All characters"));
    for (const c of list) $sel.append($("<option>").val(c.key).text(c.custom ? `${c.name} ✱` : c.name));
    $sel.val(targetKey() || "").prop("disabled", !list.length);
    $sel.closest(".sd_char_pick_wrap").attr("title", list.length ? "Edit the fixes for every character, or for one character in this chat" : "Open a chat to give its characters their own fixes");
}

function showScope($root) {
    const t = getTarget();
    $root.toggleClass("sd_char_mode", !!t);
    $root
        .find(".sd_scope_note")
        .text(t ? `Only ${t.name}'s replies. Untouched settings follow the global ones; ↺ on a fix puts it back.` : "Changes save as you go and apply to every chat.");
}

// "Leave alone": blocks no fix touches (core/segments.js setSkip). Global only, so the row hides
// while a character is picked. With "Every tag block" on, the tag list has nothing to add.
function initSkipRow($root) {
    const s = getSettings();
    s.skip = { ...defaultSettings.skip, ...(s.skip || {}) };
    const $br = $root.find(".sd_skip_brackets").prop("checked", !!s.skip.brackets);
    const $all = $root.find(".sd_skip_all_tags").prop("checked", !!s.skip.allTags);
    const $tags = $root.find(".sd_skip_tags").val(tagNamesOf(s.skip.tags).join(", "));
    const sync = () => $tags.prop("disabled", !!s.skip.allTags);
    sync();
    $br.on("change", () => {
        s.skip.brackets = $br.prop("checked");
        settingsChanged();
    });
    $all.on("change", () => {
        s.skip.allTags = $all.prop("checked");
        sync();
        settingsChanged();
    });
    $tags.on("change", () => {
        s.skip.tags = tagNamesOf($tags.val());
        $tags.val(s.skip.tags.join(", "));
        settingsChanged();
    });
}

// tab: "fixes" | "patterns" | "tester".
export async function openFixes(tab = "fixes") {
    if (openPopup) return;
    const ctx = getContext();
    const $root = $(TEMPLATE);
    const $rules = $root.find(".sd_rule_list");
    // Every opening starts on the global settings.
    setTarget(null);
    const $pick = $root.find(".sd_char_pick");
    try {
        fillPicker($pick);
        showScope($root);
        renderRules($rules);
        initPatternsEditor($root);
        initTester($root);
    } catch (e) {
        console.error(`${LOG_PREFIX} fixes popup failed:`, e);
    }
    $pick.on("change", () => {
        try {
            setTarget(String($pick.val() || ""));
            showScope($root);
            renderRules($rules);
            renderPatterns();
            runTester();
            $root.find(".sd_tab_count_fixes").text(fixesCount());
        } catch (e) {
            console.error(`${LOG_PREFIX} character picker failed:`, e);
        }
    });
    $root.find(".sd_tab_count_fixes").text(fixesCount());
    $root.on("change", ".sd_rule .sd_card_head .sd_switch", () => $root.find(".sd_tab_count_fixes").text(fixesCount()));
    $root.on("click", ".sd_tab", function () {
        showTab($root, this.dataset.tab);
    });
    const $win = $root.find(".sd_budget_window").val(budgetWindow());
    $win.on("change", () => {
        const n = Math.floor(Number($win.val()));
        if (!Number.isFinite(n) || n < 1) return $win.val(budgetWindow());
        getSettings().budgetWindow = Math.min(n, 200);
        $win.val(getSettings().budgetWindow);
        settingsChanged();
    });
    initSkipRow($root);
    $root.on("click", ".sd_expand_all", () => setAllCardsOpen($rules, true));
    $root.on("click", ".sd_collapse_all", () => setAllCardsOpen($rules, false));
    showTab($root, tab);

    openPopup = new ctx.Popup($root[0], ctx.POPUP_TYPE?.TEXT ?? 1, "", {
        wide: true,
        large: true,
        leftAlign: true,
        okButton: "Close",
        onClose: () => {
            // The editors must stop writing into a popup that's gone.
            setPatternsScope(null);
            initTester(null);
            renderRules(null);
            setTarget(null);
            openPopup = null;
        },
    });
    openPopup.dlg?.classList.add("sd_popup_dialog", "sd_fx_dialog");
    try {
        await openPopup.show();
    } finally {
        openPopup = null;
    }
}
