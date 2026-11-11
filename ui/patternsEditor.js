// "Your patterns" in the fixes popup: add / edit / delete, import ST Regex scripts or a Desloper
// export, export to a file. The logic is in rules/patternRules.js. Cards fold like the built-in
// fixes; the drawer shows a one-line summary.

import { getSettings, settingsChanged } from "../settings/settingsManager.js";
import { blankPattern, compileFind, importPatterns, exportPatterns } from "../rules/patternRules.js";
import { selectOf, whereControl, switchInput } from "./settingsPanel.js";
import { notify } from "../core/debug.js";
import { ensurePatterns, dropIfEmpty, setOverride } from "../core/characters.js";
import { getTarget, targetKey, targetEntry } from "./characterTarget.js";

const SCOPE_CHOICES = [
    ["all", "Speech and narration"],
    ["dialogue", "Speech only"],
    ["narration", "Narration only"],
];
const CHECKS = [
    ["lineEnd", "Only at the end of a line"],
    ["otherWords", "Only if the line has other words"],
    ["skipQuestions", "Skip questions"],
];

// Where the list renders: set by the fixes popup while it's open, null otherwise.
let $scope = null;
const openCards = new Set();

export function setPatternsScope($root) {
    $scope = $root?.length ? $root : null;
}

function globalPatterns() {
    const s = getSettings();
    if (!Array.isArray(s.patterns)) s.patterns = [];
    return s.patterns;
}

// The list being edited: the global one, or the picked character's (ui/characterTarget.js).
// Reading never creates a character entry; adding does (writablePatterns).
function patterns() {
    if (!targetKey()) return globalPatterns();
    const list = targetEntry()?.patterns;
    return Array.isArray(list) ? list : [];
}

function writablePatterns() {
    return targetKey() ? ensurePatterns(getSettings(), targetKey(), getTarget()?.name) : globalPatterns();
}

function findError(find) {
    if (!String(find || "").trim()) return "";
    const { error } = compileFind(find);
    return error ? `Not a valid pattern: ${error}` : "";
}

const titleOf = p => p.name?.trim() || p.find?.trim() || "New pattern";

function patternCard(p) {
    p.checks ??= {};
    const $card = $('<div class="sd_card sd_pattern">').attr("data-id", p.id);
    const save = () => settingsChanged();

    const $enabled = switchInput()
        .attr("title", "On / off")
        .prop("checked", p.enabled !== false)
        .on("change", () => {
            p.enabled = $enabled.prop("checked");
            $card.toggleClass("sd_off", !p.enabled);
            save();
        });
    const $title = $('<b class="sd_card_name">').text(titleOf(p));
    const $sub = $('<div class="sd_card_desc sd_mono">').text(p.name?.trim() ? p.find || "" : "");
    const refreshTitle = () => {
        $title.text(titleOf(p));
        $sub.text(p.name?.trim() ? p.find || "" : "");
    };
    // The icon is a child: the button's own font reset would override Font Awesome's font.
    const $delete = $('<button type="button" class="sd_icon_button" title="Delete this pattern"><i class="fa-solid fa-trash-can"></i></button>').on("click", e => {
        e.stopPropagation();
        if (p.find && !confirm(`Delete the pattern "${p.name || p.find}"?`)) return;
        const list = patterns();
        const i = list.findIndex(x => x.id === p.id);
        if (i >= 0) list.splice(i, 1);
        if (targetKey()) dropIfEmpty(getSettings(), targetKey());
        openCards.delete(p.id);
        save();
        renderPatterns();
    });
    const $chevron = $('<i class="fa-solid fa-chevron-down sd_chevron">');
    const $head = $('<div class="sd_card_head">').append(
        $enabled,
        $('<div class="sd_card_title">').append($title, $sub),
        whereControl(p.where || "both", v => {
            p.where = v;
            save();
        }),
        $delete,
        $chevron,
    );
    $head.on("click", e => {
        if ($(e.target).closest(".sd_segmented, input, button").length) return;
        const open = !$card.hasClass("sd_open");
        $card.toggleClass("sd_open", open);
        if (open) openCards.add(p.id);
        else openCards.delete(p.id);
    });

    const $name = $('<input type="text" class="text_pole" placeholder="Name (optional)">')
        .val(p.name || "")
        .on("input", () => {
            p.name = String($name.val());
            refreshTitle();
            save();
        });
    const $error = $('<div class="sd_error">');
    const showError = () => $error.text(findError(p.find)).toggle(!!findError(p.find));
    const $find = $('<input type="text" class="text_pole sd_mono sd_pattern_find" placeholder="plain text, or /regex/flags">')
        .val(p.find || "")
        .on("input", () => {
            p.find = String($find.val());
            showError();
            refreshTitle();
            save();
        });
    const $replace = $('<textarea class="text_pole sd_textarea sd_mono" rows="2" placeholder="empty = delete; several lines = one picked per message; {{match}}, $1 work">')
        .val(p.replace || "")
        .on("input", () => {
            p.replace = String($replace.val());
            save();
        });
    const $scopeSel = selectOf(SCOPE_CHOICES, p.scope || "all").on("change", () => {
        p.scope = $scopeSel.val();
        save();
    });
    const $checks = $('<div class="sd_checks">');
    for (const [key, label] of CHECKS) {
        const $cb = switchInput()
            .prop("checked", !!p.checks[key])
            .on("change", () => {
                p.checks[key] = $cb.prop("checked");
                save();
            });
        $checks.append($('<label class="sd_switch_label">').append($cb, $("<span>").text(label)));
    }

    const field = (label, $control) => $('<label class="sd_field sd_field_stack">').append($('<span class="sd_field_label">').append($("<span>").text(label)), $control);
    $card.append(
        $head,
        $('<div class="sd_card_body">').append(
            $('<div class="sd_fields">').append(
                field("Name", $name),
                field("Applies to", $scopeSel),
                field("Find", $find).addClass("sd_field_wide").append($error),
                field("Replace with", $replace).addClass("sd_field_wide"),
                $checks.addClass("sd_field_wide"),
            ),
        ),
    );
    $card.toggleClass("sd_off", p.enabled === false).toggleClass("sd_open", openCards.has(p.id));
    showError();
    return $card;
}

const countOf = list => ({ total: list.length, on: list.filter(p => p.enabled !== false).length });

// The drawer's summary: always the global list.
export function patternsSummary() {
    return countOf(globalPatterns());
}

// With a character picked: the global patterns, each with a switch for this character only.
// Saved as an override of the pattern's rule ("pattern:<id>"), like the built-in fixes.
function globalPatternRow(p) {
    const ruleId = `pattern:${p.id}`;
    const globalOn = p.enabled !== false;
    const own = targetEntry()?.rules?.[ruleId]?.enabled;
    const $sw = switchInput()
        .prop("checked", own ?? globalOn)
        .on("change", () => {
            const on = $sw.prop("checked");
            setOverride(getSettings(), targetKey(), getTarget()?.name, ruleId, "enabled", on, globalOn);
            $row.toggleClass("sd_off", !on).toggleClass("sd_custom", on !== globalOn);
            settingsChanged();
        });
    const $row = $('<label class="sd_switch_label sd_global_pattern">')
        .attr("title", globalOn ? "On for everyone" : "Off for everyone")
        .append($sw, $('<span class="sd_card_name">').text(titleOf(p)), $('<span class="sd_card_desc sd_mono">').text(p.name?.trim() ? p.find || "" : ""))
        .toggleClass("sd_off", !(own ?? globalOn))
        .toggleClass("sd_custom", own !== undefined && own !== globalOn);
    return $row;
}

export function renderPatterns() {
    if (!$scope) return;
    const $list = $scope.find(".sd_pattern_list").empty();
    const list = patterns();
    const who = getTarget()?.name;
    if (!list.length) {
        $list.append(
            $('<div class="sd_empty">').append(
                $('<i class="fa-solid fa-magnifying-glass">'),
                $("<div>").text(
                    who
                        ? `No patterns just for ${who} yet. They run only on ${who}'s replies, after the global ones.`
                        : "No patterns yet. Add one, import ST Regex scripts, or make one from a reused phrase in the stats.",
                ),
            ),
        );
    }
    for (const p of list) $list.append(patternCard(p));
    const $globals = $scope.find(".sd_pattern_globals").empty();
    const globals = targetKey() ? globalPatterns() : [];
    $globals.prop("hidden", !globals.length);
    if (globals.length) {
        $globals.append($('<div class="sd_section_head">').append($('<span class="sd_section_title">').text(`Global patterns for ${who}`)));
        for (const p of globals) $globals.append(globalPatternRow(p));
    }
    const { total, on } = countOf(list);
    $scope.find(".sd_tab_count_patterns").text(total ? `${on}/${total}` : "");
}

function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Wires the popup's toolbar buttons ($root = the popup content).
export function initPatternsEditor($root) {
    setPatternsScope($root);
    renderPatterns();
    $root.find(".sd_pattern_add").on("click", () => {
        const p = blankPattern();
        writablePatterns().push(p);
        openCards.add(p.id);
        settingsChanged();
        renderPatterns();
        $root.find(".sd_pattern").last().find(".sd_pattern_find").trigger("focus");
    });
    $root.find(".sd_pattern_export").on("click", () => {
        if (!patterns().length) return notify("No patterns to export.", "info");
        download("desloper-patterns.json", exportPatterns(patterns()));
    });
    const $file = $root.find(".sd_pattern_file");
    $root.find(".sd_pattern_import").on("click", () => $file.trigger("click"));
    $file.on("change", async () => {
        const file = $file[0].files?.[0];
        $file.val("");
        if (!file) return;
        // Pattern files are a few KB; anything this big isn't one.
        if (file.size > 2 * 1024 * 1024) return notify("That file is too big to be a patterns file.", "error");
        try {
            const { patterns: added, skipped } = importPatterns(JSON.parse(await file.text()));
            if (added.length) writablePatterns().push(...added);
            settingsChanged();
            renderPatterns();
            notify(`Imported ${added.length} pattern(s)${skipped ? `, skipped ${skipped} (not for AI replies, or empty)` : ""}.`, added.length ? "success" : "warning");
        } catch (e) {
            notify(`Couldn't import that file: ${e.message}`, "error");
        }
    });
}
