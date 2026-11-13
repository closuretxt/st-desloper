// The tester, in the fixes popup: paste a reply, see the cleaned text and what each rule did. It
// runs the pipeline directly (not the cache in st/cleaner.js) so trying things out never fills
// the chat's cache, and collects the pipeline's notes, which say when a rule's change was dropped
// and why. What was typed is kept (in memory only) for the next time the popup opens.

import { runPipeline } from "../core/pipeline.js";
import { allRules } from "../rules/index.js";
import { getSettings } from "../settings/settingsManager.js";
import { chatNames } from "../st/cleaner.js";
import { mergedRuleSettings } from "../core/characters.js";
import { getTarget, targetEntry } from "./characterTarget.js";

const MAX_HIT = 160;
const kept = { input: "", user: "", target: "display" };
let $scope = null;

function clip(text) {
    const t = String(text ?? "").trim();
    return t.length > MAX_HIT ? `${t.slice(0, MAX_HIT)}…` : t;
}

export function runTester() {
    if (!$scope) return;
    const text = String($scope.find(".sd_tester_input").val() ?? "");
    const output = $scope.find(".sd_tester_output");
    const list = $scope.find(".sd_tester_hits").empty();
    const notesEl = $scope.find(".sd_tester_notes").empty();
    const count = $scope.find(".sd_tester_count").text("");
    if (!text.trim()) {
        output.empty();
        return;
    }

    const s = getSettings();
    const names = chatNames();
    // The character picked in the popup: its overrides and own patterns.
    const entry = targetEntry();
    const rules = allRules(s, entry);
    const notes = [];
    const target = String($scope.find(".sd_tester_target .sd_active").attr("data-value") || "display");
    const lastUser = String($scope.find(".sd_tester_user").val() ?? "");
    // The master switch is ignored here: the tester shows what the rules would do.
    const out = runPipeline(text, rules, { names, settings: mergedRuleSettings(s?.rules, entry), target, lastUser, log: msg => notes.push(msg) });

    output.text(out.text);
    count.text(out.hits.length ? `${out.hits.length} ${out.hits.length === 1 ? "change" : "changes"}` : "no changes");
    const nameOf = id => rules.find(r => r.id === id)?.name || id;
    for (const h of out.hits) {
        const li = $("<li>");
        li.append($("<div class='sd_hit_rule'>").text(`${nameOf(h.rule)}${h.label ? ` · ${h.label}` : ""}`));
        const line = $("<div class='sd_hit_line'>");
        line.append($("<span class='sd_hit_before'>").text(clip(h.before)));
        line.append($("<span class='sd_arrow'>").text(" → "));
        line.append($("<span class='sd_hit_after'>").text(h.after?.trim() ? clip(h.after) : "(removed)"));
        list.append(li.append(line));
    }

    const lines = [];
    if (getTarget()) lines.push(`Settings for: ${getTarget().name}`);
    if (names.length) lines.push(`Names: ${names.join(", ")}`);
    lines.push(...notes);
    notesEl.text(lines.join("\n"));
}

function safeRun() {
    try {
        runTester();
    } catch (e) {
        console.error("[ST Deslopper] tester failed:", e);
    }
}

// $root = the popup content; null when it closes.
export function initTester($root) {
    $scope = $root?.length ? $root : null;
    if (!$scope) return;
    let timer = null;
    const $input = $scope.find(".sd_tester_input").val(kept.input);
    const $user = $scope.find(".sd_tester_user").val(kept.user);
    $scope.find(`.sd_tester_target .sd_seg[data-value="${kept.target}"]`).addClass("sd_active");
    $input.add($user).on("input", () => {
        kept.input = String($input.val());
        kept.user = String($user.val());
        clearTimeout(timer);
        timer = setTimeout(safeRun, 250);
    });
    $scope.find(".sd_tester_target").on("click", ".sd_seg", function () {
        $scope.find(".sd_tester_target .sd_seg").removeClass("sd_active");
        $(this).addClass("sd_active");
        kept.target = this.dataset.value;
        safeRun();
    });
    safeRun();
}
