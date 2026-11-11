// The fixes popup: the built-in fixes with their options, Your patterns, and the tester. On a
// wide screen the tester sits in a column beside the list, so changing an option shows its effect
// right away; on a narrow one it's a third tab.

import { getContext } from "../../../../extensions.js";
import { BUILTIN_RULES } from "../rules/index.js";
import { renderRules, setAllCardsOpen, isRuleOn } from "./settingsPanel.js";
import { initPatternsEditor, setPatternsScope } from "./patternsEditor.js";
import { initTester } from "./tester.js";
import { LOG_PREFIX } from "../core/constants.js";
import { getSettings, settingsChanged } from "../settings/settingsManager.js";
import { budgetWindow } from "../st/cleaner.js";

let openPopup = null;

const TEMPLATE = `
<div class="sd_popup sd_fx st-desloper-settings">
    <div class="sd_popup_title">
        <span class="sd_popup_name">🧽 Desloper fixes</span>
        <span class="sd_note">Changes save as you go and apply to every chat.</span>
    </div>
    <div class="sd_tabs" role="tablist">
        <button type="button" class="sd_tab" data-tab="fixes"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Fixes</span><span class="sd_tab_count sd_tab_count_fixes"></span></button>
        <button type="button" class="sd_tab" data-tab="patterns"><i class="fa-solid fa-code"></i><span>Your patterns</span><span class="sd_tab_count sd_tab_count_patterns"></span></button>
        <button type="button" class="sd_tab sd_tab_tester" data-tab="tester"><i class="fa-solid fa-flask"></i><span>Tester</span></button>
    </div>
    <div class="sd_fx_body">
        <div class="sd_fx_main">
            <section class="sd_pane" data-pane="fixes">
                <div class="sd_toolbar">
                    <span class="sd_note">Click a fix for its options. <b>Both / Screen / Model</b>: where it applies.</span>
                    <span class="sd_toolbar_end">
                        <button type="button" class="sd_link sd_expand_all">Open all</button>
                        <button type="button" class="sd_link sd_collapse_all">Close all</button>
                    </span>
                </div>
                <div class="sd_toolbar sd_budget_row">
                    <label class="sd_control" title="Stutter, gesture, one-line paragraph, blush and pet-name budgets count over this many replies. 1 = each reply has its own budget.">
                        <span class="sd_control_label">Budgets count over the last</span>
                        <input type="number" min="1" max="200" class="text_pole sd_number sd_budget_window">
                        <span>replies</span>
                    </label>
                    <span class="sd_note">A budget of 3 then means 3 in any 10 replies, not 3 in every reply. The tester has no history: there it's per reply.</span>
                </div>
                <div class="sd_card_list sd_rule_list"></div>
            </section>
            <section class="sd_pane" data-pane="patterns">
                <div class="sd_toolbar">
                    <span class="sd_note">Find text and replace or delete it: plain text, or /regex/flags like ST's Regex extension. Every change still goes through Desloper's repair step (punctuation, capitals, emptied quotes).</span>
                </div>
                <div class="sd_buttons">
                    <div class="menu_button sd_button_main sd_pattern_add" title="Add an empty pattern"><i class="fa-solid fa-plus"></i><span>Add pattern</span></div>
                    <div class="menu_button sd_pattern_import" title="Import ST Regex scripts (.json) or a Desloper export"><i class="fa-solid fa-file-import"></i><span>Import</span></div>
                    <div class="menu_button sd_pattern_export" title="Save your patterns to a .json file"><i class="fa-solid fa-file-export"></i><span>Export</span></div>
                    <input class="sd_pattern_file" type="file" accept=".json,application/json" hidden />
                </div>
                <div class="sd_card_list sd_pattern_list"></div>
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

// tab: "fixes" | "patterns" | "tester".
export async function openFixes(tab = "fixes") {
    if (openPopup) return;
    const ctx = getContext();
    const $root = $(TEMPLATE);
    const $rules = $root.find(".sd_rule_list");
    try {
        renderRules($rules);
        initPatternsEditor($root);
        initTester($root);
    } catch (e) {
        console.error(`${LOG_PREFIX} fixes popup failed:`, e);
    }
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
