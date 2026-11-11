// The built-in fixes: the full cards in the fixes popup, built from each rule's `options` list
// (no HTML per rule), and the quick on/off grid in the settings drawer. Only values that differ
// from a rule's defaults are saved, so changed defaults in an update still reach the user.

import { BUILTIN_RULES } from "../rules/index.js";
import { getSettings, settingsChanged } from "../settings/settingsManager.js";

export const WHERE_CHOICES = [
    ["both", "Both", "Shown on screen and sent to the model"],
    ["display", "Screen", "Shown on screen only: the model still gets the reply as written"],
    ["outgoing", "Model", "Sent to the model only: the screen shows the reply as written"],
];
const WHERE_ICONS = { display: "fa-eye", outgoing: "fa-paper-plane" };

// Cards the user opened stay open when the list is rebuilt (a re-render must not fold them up).
const openCards = new Set();

function current(rule) {
    return { where: "both", ...(rule.defaults || {}), ...(getSettings().rules?.[rule.id] || {}) };
}

export const isRuleOn = rule => current(rule).enabled !== false;

function setValue(rule, key, value) {
    const s = getSettings();
    s.rules ??= {};
    const own = (s.rules[rule.id] ??= {});
    const fallback = key === "where" ? (rule.defaults?.where ?? "both") : rule.defaults?.[key];
    if (JSON.stringify(value) === JSON.stringify(fallback)) delete own[key];
    else own[key] = value;
    if (!Object.keys(own).length) delete s.rules[rule.id];
    settingsChanged();
}

export function selectOf(choices, value) {
    const $sel = $('<select class="text_pole sd_select">');
    for (const c of choices) {
        const [v, label] = Array.isArray(c) ? c : [c, c];
        $sel.append($("<option>").val(v).text(label));
    }
    return $sel.val(value);
}

// "Both | Screen | Model" as three small buttons: easier to read at a glance than a select.
export function whereControl(value, onChange) {
    const $seg = $('<div class="sd_segmented" role="radiogroup">').attr("title", "Where this applies");
    for (const [v, label, tip] of WHERE_CHOICES) {
        const $b = $('<button type="button" class="sd_seg">')
            .text(label)
            .attr({ title: tip, "data-value": v, role: "radio" })
            .toggleClass("sd_active", v === value)
            .on("click", e => {
                e.stopPropagation();
                if ($b.hasClass("sd_active")) return;
                $seg.find(".sd_seg").removeClass("sd_active");
                $b.addClass("sd_active");
                onChange(v);
            });
        $seg.append($b);
    }
    return $seg;
}

export const switchInput = () => $('<input type="checkbox" class="sd_switch">');

// "Dashes per 100 words (at least one per reply; 0 = none)" → a label and a smaller hint, so
// the label column stays one line. Very short brackets ("(%)") stay in the label.
function splitLabel(label) {
    const m = /^(.*\S)\s+\(([^()]{3,})\)$/.exec(String(label || ""));
    return m ? [m[1], m[2]] : [String(label || ""), ""];
}

function labelBlock(label) {
    const [main, hint] = splitLabel(label);
    const $l = $('<span class="sd_field_label">').append($("<span>").text(main));
    if (hint) $l.append($('<span class="sd_hint">').text(hint));
    return $l;
}

// A rule's list of phrases (rule.entries): a tick per phrase (saved as the ids turned off) and
// its replacement choices, "low | soft | hushed" (saved only where they differ from the built-in).
function phrasesControl(rule, opt, values) {
    const entries = rule.entries || [];
    const off = new Set(Array.isArray(values[opt.key]) ? values[opt.key] : []);
    const pools = values.pools && typeof values.pools === "object" ? values.pools : {};
    const [main, hint] = splitLabel(opt.label);
    const $box = $('<details class="sd_phrases sd_field_wide">').append(
        $("<summary>").append(
            $('<i class="fa-solid fa-chevron-right sd_summary_chevron">'),
            $("<span>").text(main),
            $('<span class="sd_badge">').text(`${entries.length - off.size} of ${entries.length} on`),
            hint ? $('<span class="sd_hint">').text(hint) : "",
        ),
    );
    const $list = $('<div class="sd_phrase_list">');
    for (const entry of entries) {
        const $tick = switchInput()
            .prop("checked", !off.has(entry.id))
            .on("change", () => {
                const now = new Set(Array.isArray(current(rule)[opt.key]) ? current(rule)[opt.key] : []);
                if ($tick.prop("checked")) now.delete(entry.id);
                else now.add(entry.id);
                setValue(rule, opt.key, entries.map(e => e.id).filter(id => now.has(id)));
                $box.find("summary .sd_badge").text(`${entries.length - now.size} of ${entries.length} on`);
            });
        const $row = $('<div class="sd_phrase">').append(
            $('<label class="sd_switch_label sd_phrase_head">').attr("title", entry.example || "").append($tick, $('<span class="sd_phrase_name">').text(entry.label)),
        );
        if (entry.example) $row.append($('<div class="sd_phrase_example">').text(entry.example));
        for (const [poolKey, pool] of Object.entries(entry.pools || {})) {
            const own = pools[entry.id]?.[poolKey];
            const $input = $('<input type="text" class="text_pole">')
                .attr("placeholder", pool.value.join(" | "))
                .val((Array.isArray(own) && own.length ? own : pool.value).join(" | "))
                .on("input", () => {
                    const list = String($input.val())
                        .split("|")
                        .map(x => x.trim())
                        .filter(Boolean);
                    const next = structuredClone(current(rule).pools || {});
                    next[entry.id] ??= {};
                    // Empty or the built-in list: nothing saved, the built-in list is used.
                    if (!list.length || JSON.stringify(list) === JSON.stringify(pool.value)) delete next[entry.id][poolKey];
                    else next[entry.id][poolKey] = list;
                    if (!Object.keys(next[entry.id]).length) delete next[entry.id];
                    setValue(rule, "pools", next);
                });
            $row.append($('<label class="sd_phrase_pool">').append($('<span class="sd_phrase_pool_label">').text(pool.label), $input));
        }
        $list.append($row);
    }
    return $box.append($list);
}

function optionControl(rule, opt, values) {
    if (opt.type === "phrases") return phrasesControl(rule, opt, values);
    const value = values[opt.key];
    if (opt.type === "checkbox") {
        const $input = switchInput()
            .prop("checked", !!value)
            .on("change", () => setValue(rule, opt.key, $input.prop("checked")));
        return $('<label class="sd_field sd_field_check sd_switch_label">').append($input, labelBlock(opt.label));
    }
    if (opt.type === "list") {
        const $input = $('<textarea class="text_pole sd_textarea" rows="3">')
            .attr("placeholder", opt.placeholder || "")
            .val(Array.isArray(value) ? value.join("\n") : String(value ?? ""))
            .on("input", () => {
                const lines = String($input.val())
                    .split("\n")
                    .map(l => l.trim())
                    .filter(Boolean);
                setValue(rule, opt.key, lines);
            });
        return $('<label class="sd_field sd_field_stack">').append(labelBlock(opt.label), $input);
    }
    let $input;
    if (opt.type === "select") {
        $input = selectOf(opt.choices, value).on("change", () => setValue(rule, opt.key, $input.val()));
    } else if (opt.type === "number") {
        $input = $('<input type="number" class="text_pole sd_number">')
            .attr({ min: opt.min, max: opt.max })
            .val(value)
            .on("change", () => {
                const n = Number($input.val());
                if (Number.isFinite(n)) setValue(rule, opt.key, n);
            });
    } else {
        $input = $('<input type="text" class="text_pole sd_text">')
            .attr("placeholder", opt.placeholder || "")
            .val(value ?? "")
            .on("input", () => setValue(rule, opt.key, String($input.val())));
    }
    return $(`<label class="sd_field sd_field_${opt.type === "number" ? "number" : "inline"}">`).append(labelBlock(opt.label), $input);
}

// "a → b" in a description: the arrow gets the accent colour so before / after read apart.
function descriptionHtml(text) {
    const esc = String(text || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    return esc.replace(/→/g, '<span class="sd_arrow">→</span>');
}

function ruleCard(rule) {
    const values = current(rule);
    const $card = $('<div class="sd_card sd_rule">').attr("data-rule", rule.id);
    const $enabled = switchInput()
        .attr("title", "On / off")
        .prop("checked", values.enabled !== false)
        .on("change", () => {
            setValue(rule, "enabled", $enabled.prop("checked"));
            $card.toggleClass("sd_off", !$enabled.prop("checked"));
        });
    const $chevron = $('<i class="fa-solid fa-chevron-down sd_chevron">');
    const $head = $('<div class="sd_card_head">').append(
        $enabled.on("click", e => e.stopPropagation()),
        $('<div class="sd_card_title">').append($('<b class="sd_card_name">').text(rule.name), $('<div class="sd_card_desc">').html(descriptionHtml(rule.description))),
        whereControl(values.where, v => setValue(rule, "where", v)),
        $chevron,
    );
    const toggle = () => {
        const open = !$card.hasClass("sd_open");
        $card.toggleClass("sd_open", open);
        if (open) openCards.add(rule.id);
        else openCards.delete(rule.id);
    };
    $head.on("click", e => {
        if ($(e.target).closest(".sd_segmented, input, select, textarea").length) return;
        toggle();
    });
    $card.append($head);
    // The head shows the description cut to one line; open, it reads in full as an example box.
    const $body = $('<div class="sd_card_body">');
    if (rule.description) $body.append($('<div class="sd_card_about">').html(descriptionHtml(rule.description)));
    if (rule.options?.length) {
        // Small controls first, then the word lists side by side, then the phrase table: mixing
        // them in one grid leaves a short select next to a tall list and gaps everywhere.
        const groups = [
            ["sd_fields", o => !["list", "phrases"].includes(o.type)],
            ["sd_fields sd_fields_lists", o => o.type === "list"],
            ["sd_fields", o => o.type === "phrases"],
        ];
        for (const [cls, test] of groups) {
            const opts = rule.options.filter(test);
            if (!opts.length) continue;
            const $opts = $(`<div class="${cls}">`);
            for (const opt of opts) $opts.append(optionControl(rule, opt, values));
            $body.append($opts);
        }
    } else {
        $body.append($('<div class="sd_note">').text("No options: on or off is all there is."));
    }
    $card.append($body);
    $card.toggleClass("sd_off", values.enabled === false).toggleClass("sd_open", openCards.has(rule.id));
    return $card;
}

// The full cards, inside the fixes popup ($box is its list container).
export function renderRules($box) {
    if (!$box?.length) return;
    $box.empty();
    for (const rule of BUILTIN_RULES) $box.append(ruleCard(rule));
}

export function setAllCardsOpen($box, open) {
    $box.find(".sd_rule").each(function () {
        $(this).toggleClass("sd_open", open);
        if (open) openCards.add(this.dataset.rule);
        else openCards.delete(this.dataset.rule);
    });
}

// The drawer's quick grid: one switch per fix, plus a small icon when a fix only works on one side.
export function renderQuickRules() {
    const $box = $("#st_desloper_quick");
    if (!$box.length) return;
    $box.empty();
    let on = 0;
    for (const rule of BUILTIN_RULES) {
        const values = current(rule);
        const enabled = values.enabled !== false;
        if (enabled) on++;
        const $input = switchInput()
            .prop("checked", enabled)
            .on("change", () => setValue(rule, "enabled", $input.prop("checked")));
        const $chip = $('<label class="sd_chip sd_switch_label">')
            .attr("title", rule.description || rule.name)
            .toggleClass("sd_off", !enabled)
            .append($input, $('<span class="sd_chip_name">').text(rule.name));
        const icon = WHERE_ICONS[values.where];
        if (icon) $chip.append($(`<i class="fa-solid ${icon} sd_chip_where">`).attr("title", WHERE_CHOICES.find(c => c[0] === values.where)?.[2] || ""));
        $box.append($chip);
    }
    $("#st_desloper_fix_count").text(`${on} of ${BUILTIN_RULES.length} on`);
}
