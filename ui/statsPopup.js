// The stats page: a popup over the open chat. Pass 1 (stats/measures.js analyze) runs once when it
// opens; changing the window or the baseline only re-runs pass 2, which is instant.

import { getContext } from "../../../../extensions.js";
import { analyze, buildReport, GROUPS, clip } from "../stats/measures.js";
import { getLexicon, setLexicon, getPin, setPin, saveSummary, getSummaries } from "../stats/statsStore.js";
import { STOCK_PHRASES } from "../stats/lexicon.js";
import { runPipeline, activeRules } from "../core/pipeline.js";
import { allRules, BUILTIN_RULES } from "../rules/index.js";
import { getSettings, settingsChanged } from "../settings/settingsManager.js";
import { motifPattern, hasMotifPattern, previewMotif } from "../stats/motifRule.js";
import { renderPatterns } from "./patternsEditor.js";
import { chatNames, isAiMessage, budgetWindow, originalText } from "../st/cleaner.js";
import { LOG_PREFIX } from "../core/constants.js";
import { logDebug } from "../core/debug.js";

const WINDOWS = [
    ["50", "Last 50 replies"],
    ["200", "Last 200 replies"],
    ["all", "Whole chat"],
];
const BASELINES = [
    ["before", "The replies before the window"],
    ["pinned", "Messages I pick"],
    ["none", "Nothing"],
];
const STATUS_WORDS = { worse: "worse", better: "better", moved: "moved", steady: "", new: "" };
// Two views of the same chat: the replies as the model wrote them (what the prompt-cleaning is
// meant to improve over time), and the replies as Deslopper shows them (what the user reads).
const MODES = {
    written: {
        tab: "As written",
        icon: "fa-pen-nib",
        hint: "The replies exactly as the model wrote them, before Deslopper touches them",
        line: "Measured on the replies as the model wrote them, before Deslopper. Deslopper's fixes show what it would change.",
        textHeader: "Measured on: the replies as the model wrote them (before Deslopper)",
    },
    after: {
        tab: "After Deslopper",
        icon: "fa-wand-magic-sparkles",
        hint: "The replies as Deslopper shows them in the chat: what you read",
        line: "Measured on the replies as Deslopper shows them in the chat (only the rules set to clean the display). This is what you read.",
        textHeader: "Measured on: the replies as Deslopper shows them in the chat (after Deslopper, display rules only)",
    },
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function fmt(unit, v) {
    if (v === null || v === undefined) return "–";
    switch (unit) {
        case "share":
            return v > 0 && v < 0.1 ? `${(v * 100).toFixed(1)}%` : `${Math.round(v * 100)}%`;
        case "per1k":
        case "avg":
            return v.toFixed(1);
        case "count":
        case "points":
            return String(Math.round(v));
        default:
            return v.toFixed(2);
    }
}

function sparkline(values) {
    if (!values || values.length < 2) return "";
    const w = 80;
    const h = 18;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(hi === lo ? h / 2 : h - 2 - ((v - lo) / (hi - lo)) * (h - 4)).toFixed(1)}`);
    return `<svg class="sd_spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts.join(" ")}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

const jumpLink = (index, text) => `<a class="sd_jump" data-index="${index}" title="Go to message #${index}">#${index}</a> ${esc(text)}`;

function exampleHtml(e) {
    if (e.before !== undefined) {
        return `<li>${jumpLink(e.index, "")}<span class="sd_hit_before">${esc(clip(e.before, 120))}</span> → ${esc(e.after?.trim() ? clip(e.after, 120) : "(removed)")}</li>`;
    }
    return `<li>${jumpLink(e.index, clip(e.quote, 220))}${e.note ? ` <i>(${esc(e.note)})</i>` : ""}${e.score !== undefined ? ` <b>${e.score}</b>` : ""}</li>`;
}

function detailHtml(m) {
    const parts = [];
    const d = m.detail;
    if (Array.isArray(d) && d.length && typeof d[0] === "object" && "phrase" in d[0]) {
        parts.push(`<div class="sd_detail_line">${d.map(x => `"${esc(x.phrase)}" ${x.count}${x.share !== undefined ? ` (${fmt("share", x.share)})` : ""}`).join("; ")}</div>`);
    } else if (Array.isArray(d) && d.length && typeof d[0] === "string") {
        parts.push(`<div class="sd_detail_line">Mostly ${esc(d.join(" and "))}.</div>`);
    } else if (d && typeof d === "object" && "share" in d) {
        parts.push(`<div class="sd_detail_line">In ${fmt("share", d.share)} of replies, ${m.hits} in all.</div>`);
    }
    if (m.examples?.length) parts.push(`<ul class="sd_examples">${m.examples.map(exampleHtml).join("")}</ul>`);
    return parts.join("") || `<div class="sd_detail_line">Nothing to show.</div>`;
}

// "Variety of first words (1 = never the same twice)" → the label, and the bracket as a hint.
function labelHtml(label) {
    const m = /^(.*\S)\s+\(([^()]{3,})\)$/.exec(String(label || ""));
    return m ? `${esc(m[1])}<span class="sd_hint">${esc(m[2])}</span>` : esc(label);
}

const GROUP_ICONS = {
    fixes: "fa-wand-magic-sparkles",
    repetition: "fa-repeat",
    llmisms: "fa-robot",
    speech: "fa-comment-dots",
    shape: "fa-ruler-horizontal",
    voice: "fa-microphone-lines",
};

function metricRows(metrics) {
    return metrics
        .map(m => {
            const word = STATUS_WORDS[m.status] || "";
            // Fix rows are labelled with the rule's name: "Deal? (tag questions)" is a name, not a hint.
            const label = m.group === "fixes" ? esc(m.label) : labelHtml(m.label);
            return `<tr class="sd_metric" data-id="${esc(m.id)}" title="Click for examples">
                <td class="sd_metric_label"><i class="fa-solid fa-chevron-right sd_row_chevron"></i>${label}</td>
                <td class="sd_metric_spark">${sparkline(m.spark)}</td>
                <td class="sd_metric_base">${m.base === null ? "" : `was ${fmt(m.unit, m.base)}`}</td>
                <td class="sd_metric_status">${word ? `<span class="sd_status sd_status_${m.status}">${word}</span>` : ""}</td>
                <td class="sd_metric_value">${fmt(m.unit, m.value)}</td>
            </tr>
            <tr class="sd_metric_detail" data-for="${esc(m.id)}" hidden><td colspan="5">${detailHtml(m)}</td></tr>`;
        })
        .join("");
}

// A titled glass card. Wide ones (long quotes) span both columns of the stats grid.
const card = (icon, title, body, wide = false) => `<section class="sd_card sd_stats_card${wide ? " sd_span" : ""}">
    <div class="sd_section_head"><span class="sd_section_title"><i class="fa-solid ${icon}"></i>${esc(title)}</span></div>
    ${body}
</section>`;

function tile(label, value, hint = "") {
    return `<div class="sd_tile"${hint ? ` title="${esc(hint)}"` : ""}><div class="sd_tile_value">${value}</div><div class="sd_tile_label">${esc(label)}</div></div>`;
}

function heroHtml(rep, ctx, score) {
    const value = Math.max(0, Math.min(100, Number(rep.score) || 0));
    const base = score?.base;
    const hasBase = base !== null && base !== undefined;
    const delta = hasBase ? Math.round(rep.score - base) : null;
    const deltaHtml =
        delta === null
            ? "–"
            : `<span class="${delta > 0 ? "sd_delta_up" : delta < 0 ? "sd_delta_down" : ""}">${delta > 0 ? "+" : ""}${delta}</span>`;
    const lines = [];
    if (ctx.modeNote) lines.push(esc(ctx.modeNote));
    if (!rep.hasBaseline && ctx.baselineNote) lines.push(`No comparison: ${esc(ctx.baselineNote)}.`);
    if (rep.moves.length) lines.push(`The voice moved most toward ${esc(rep.moves.join(" and "))}.`);
    return `<div class="sd_hero">
        <div class="sd_ring" style="--sd-p:${value}" title="Slop score: 0 clean, 100 all slop">
            <div class="sd_ring_inner"><div class="sd_ring_num">${fmt("points", rep.score)}</div><div class="sd_ring_label">slop score</div></div>
        </div>
        <div class="sd_hero_side">
            <div class="sd_hero_title">${esc(ctx.title)}</div>
            <div class="sd_tiles">
                ${tile("replies measured", String(rep.n))}
                ${rep.hasBaseline ? tile("compared with", String(rep.baseN), "Replies in the baseline") : ""}
                ${hasBase ? tile("baseline score", fmt("points", base)) : ""}
                ${hasBase ? tile("change", deltaHtml, "Score now minus the baseline's: lower is better") : ""}
            </div>
            ${lines.map(l => `<div class="sd_hero_line">${l}</div>`).join("")}
        </div>
    </div>`;
}

function reportHtml(rep, ctx) {
    const parts = [];
    const score = rep.metrics.find(m => m.id === "slop_score");
    parts.push(heroHtml(rep, ctx, score));

    if (!rep.n) {
        parts.push(`<div class="sd_empty"><i class="fa-solid fa-comment-slash"></i><div>No AI replies in this window.</div></div>`);
        return parts.join("");
    }

    for (const [group, title] of Object.entries(GROUPS)) {
        const rows = rep.metrics.filter(m => m.group === group && m.id !== "slop_score");
        if (group === "overview") {
            if (score?.detail?.length) parts.push(card("fa-triangle-exclamation", "Worst replies", `<ul class="sd_examples sd_examples_cards">${score.detail.map(exampleHtml).join("")}</ul>`, true));
            continue;
        }
        if (!rows.length) continue;
        parts.push(card(GROUP_ICONS[group] || "fa-chart-simple", title, `<table class="sd_metrics">${metricRows(rows)}</table>`));
    }

    if (rep.motifs.length) {
        const patterns = getSettings()?.patterns;
        parts.push(
            card(
                "fa-clone",
                "Phrases the model keeps reusing",
                `<div class="sd_note">"Make a rule" turns one into a pattern in Your patterns: swap it for other wordings, or delete it. It also cleans what's sent to the model, so the model stops copying its own phrase.</div>
                <ul class="sd_motifs">${rep.motifs
                    .map(m => {
                        const action = hasMotifPattern(patterns, m.phrase)
                            ? `<span class="sd_motif_done"><i class="fa-solid fa-check"></i> already a rule</span>`
                            : `<button type="button" class="sd_pill_button sd_motif_make"><i class="fa-solid fa-plus"></i> Make a rule</button>`;
                        return `<li class="sd_motif" data-phrase="${esc(m.phrase)}">
                            <div class="sd_motif_row">
                                <span class="sd_motif_phrase">"${esc(m.phrase)}"</span>
                                <span class="sd_motif_stats">${m.count} replies · ${fmt("share", m.share)}${m.base === null ? "" : `, was ${fmt("share", m.base)}`}</span>
                                <span class="sd_motif_links">${m.examples.map(e => jumpLink(e.index, "")).join(" ")}</span>
                                ${action}
                            </div>
                        </li>`;
                    })
                    .join("")}</ul>`,
                true,
            ),
        );
    }
    if (rep.leftovers.length) {
        parts.push(
            card(
                "fa-ban",
                "Negated actions Deslopper left alone",
                `<div class="sd_note">The most common ones are worth a line in Fixes → Negated actions → Flips (or the delete list).</div>
                <ul class="sd_examples">${rep.leftovers
                    .map(l => `<li><b>"doesn't ${esc(l.phrase)}"</b> <span class="sd_badge">×${l.count}</span><ul class="sd_examples">${l.examples.map(exampleHtml).join("")}</ul></li>`)
                    .join("")}</ul>`,
                true,
            ),
        );
    }
    parts.push(`<div class="sd_note sd_stats_foot">${esc(MODES[ctx.mode]?.line || "")} Click a row for examples; click #number to go to the message.</div>`);
    return parts.join("");
}

// The same report as plain text, for "Copy report". Unlike the page it includes every row's
// breakdown and examples (hidden behind a click there), so one paste carries everything.
function reportText(rep, ctx) {
    const lines = [];
    const exampleLine = e =>
        e.before !== undefined
            ? `    #${e.index} ${clip(e.before, 160)} → ${e.after?.trim() ? clip(e.after, 160) : "(removed)"}`
            : `    #${e.index} ${clip(e.quote, 220)}${e.note ? ` (${e.note})` : ""}${e.score !== undefined ? ` [${e.score}]` : ""}`;
    lines.push(`Deslopper stats: ${ctx.title}`);
    lines.push(MODES[ctx.mode]?.textHeader || "");
    if (ctx.modeNote) lines.push(ctx.modeNote);
    lines.push(`${ctx.windowLabel}; ${rep.n} replies measured${rep.hasBaseline ? `, compared with ${rep.baseN} replies` : ""}.`);
    lines.push(`Slop score: ${fmt("points", rep.score)}`);
    if (rep.moves.length) lines.push(`The voice moved most toward ${rep.moves.join(" and ")}.`);
    const score = rep.metrics.find(m => m.id === "slop_score");
    for (const [group, title] of Object.entries(GROUPS)) {
        if (group === "overview") {
            if (score?.detail?.length) {
                lines.push("", "Worst replies");
                for (const e of score.detail) lines.push(exampleLine(e));
            }
            continue;
        }
        const rows = rep.metrics.filter(m => m.group === group && m.id !== "slop_score");
        if (!rows.length) continue;
        lines.push("", title);
        for (const m of rows) {
            const word = STATUS_WORDS[m.status] || "";
            lines.push(`  ${m.label}: ${fmt(m.unit, m.value)}${m.base === null ? "" : ` (was ${fmt(m.unit, m.base)})`}${word ? ` ${word}` : ""}`);
            const d = m.detail;
            if (Array.isArray(d) && d.length && typeof d[0] === "object" && "phrase" in d[0]) {
                lines.push(`    ${d.map(x => `"${x.phrase}" ${x.count}${x.share !== undefined ? ` (${fmt("share", x.share)})` : ""}`).join("; ")}`);
            } else if (Array.isArray(d) && d.length && typeof d[0] === "string") {
                lines.push(`    Mostly ${d.join(" and ")}.`);
            }
            for (const e of m.examples || []) lines.push(exampleLine(e));
        }
    }
    if (rep.motifs.length) {
        lines.push("", "Phrases the model keeps reusing");
        for (const m of rep.motifs) {
            lines.push(`  "${m.phrase}" in ${m.count} replies (${fmt("share", m.share)}${m.base === null ? "" : `, was ${fmt("share", m.base)}`})`);
            for (const e of m.examples) lines.push(exampleLine(e));
        }
    }
    if (rep.leftovers.length) {
        lines.push("", "Negated actions Deslopper left alone");
        for (const l of rep.leftovers) {
            lines.push(`  "doesn't ${l.phrase}" ×${l.count}`);
            for (const e of l.examples) lines.push(exampleLine(e));
        }
    }
    return lines.join("\n");
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // No clipboard permission (or not a secure page): the old way.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    }
}

// The "Make a rule" form under a reused phrase. The draft pattern keeps one id from the first
// preview to the save, so the wording the preview picks for each reply is the one that shows.
function motifForm($li, phrase, replies, names) {
    let draft = motifPattern(phrase);
    const $form = $(`<div class="sd_motif_form">
        <div class="sd_note">Replace it with: one wording per line (one is picked per message, the same one every time). Leave it empty to delete the phrase, but check below that the sentences still read right.</div>
        <textarea class="text_pole sd_textarea sd_motif_replace" rows="3"></textarea>
        <label class="sd_switch_label"><input type="checkbox" class="sd_switch sd_motif_dialogue"><span>Also inside dialogue <span class="sd_hint">off: narration only; a phrase in speech may be the character's way of talking</span></span></label>
        <div class="sd_motif_preview"></div>
        <div class="sd_buttons"><div class="menu_button sd_button_main sd_motif_add"><i class="fa-solid fa-plus"></i><span>Add to Your patterns</span></div><div class="menu_button sd_motif_cancel">Cancel</div></div>
    </div>`);
    $li.append($form);

    const update = () => {
        draft = { ...draft, ...motifPattern(phrase, { replace: String($form.find(".sd_motif_replace").val()), inDialogue: $form.find(".sd_motif_dialogue").prop("checked") }), id: draft.id };
        const p = previewMotif(draft, replies, { names });
        const $out = $form.find(".sd_motif_preview");
        if (p.error) return $out.html(`<div class="sd_error">${esc(p.error)}</div>`);
        if (!p.changed) return $out.html(`<div class="sd_detail_line">It wouldn't change any reply here (the phrase may only show in dialogue, or cross a sentence end).</div>`);
        $out.html(`<div class="sd_detail_line">Changes ${p.changed} ${p.changed === 1 ? "reply" : "replies"}. The latest:</div><ul class="sd_examples">${p.examples.map(exampleHtml).join("")}</ul>`);
    };
    let timer = null;
    $form.on("input change", ".sd_motif_replace, .sd_motif_dialogue", () => {
        clearTimeout(timer);
        timer = setTimeout(update, 250);
    });
    $form.on("click", ".sd_motif_cancel", () => {
        $form.remove();
        $li.find(".sd_motif_make").show();
    });
    $form.on("click", ".sd_motif_add", () => {
        try {
            update();
            const s = getSettings();
            if (!Array.isArray(s.patterns)) s.patterns = [];
            if (!hasMotifPattern(s.patterns, phrase)) s.patterns.push(draft);
            settingsChanged();
            renderPatterns();
            $form.remove();
            $li.find(".sd_motif_make").replaceWith(`<i class="sd_motif_done">added to Your patterns</i>`);
        } catch (e) {
            console.error(`${LOG_PREFIX} adding the pattern failed:`, e);
        }
    });
    update();
    $form.find(".sd_motif_replace").trigger("focus");
}

function summariesHtml(currentId) {
    const list = getSummaries().filter(x => x.chatId !== currentId);
    if (!list.length) return "";
    return `<details class="sd_card sd_fold sd_all_chats"><summary><i class="fa-solid fa-chevron-right sd_summary_chevron"></i><span class="sd_section_title"><i class="fa-solid fa-layer-group"></i>Other chats</span><span class="sd_badge">${list.length}</span><span class="sd_hint">scores from the last time their stats were opened</span></summary>
        <table class="sd_metrics sd_chats_table">${list
            .map(x => `<tr><td>${esc(x.title)}</td><td class="sd_metric_base">${new Date(x.ts).toLocaleDateString()}</td><td class="sd_metric_base">${x.n} replies</td><td class="sd_metric_value">${x.score}</td></tr>`)
            .join("")}</table></details>`;
}

// The stock-phrase list the stats count: shown as the built-in one until the user changes it;
// an empty box or the built-in list again goes back to following the built-in one (so updates
// reach it).
function lexiconHtml() {
    const own = getLexicon();
    return `<details class="sd_card sd_fold sd_lexicon"><summary><i class="fa-solid fa-chevron-right sd_summary_chevron"></i><span class="sd_section_title"><i class="fa-solid fa-list"></i>Stock phrases counted</span><span class="sd_badge sd_lexicon_count">${(own || STOCK_PHRASES).length}${own ? " · yours" : " · built-in"}</span></summary>
        <div class="sd_note">One per line; {x} = any one word; empty = the built-in list. The chat is measured again when you leave the box.</div>
        <textarea class="text_pole sd_textarea sd_mono sd_lexicon_box" rows="8"></textarea>
    </details>`;
}

// The chat's AI replies and user messages, with their message numbers.
function collectMessages(chat) {
    const out = [];
    chat.forEach((m, index) => {
        // originalText: in "rewrite saved messages" mode `mes` is already cleaned.
        if (isAiMessage(m)) out.push({ index, text: originalText(m), isUser: false });
        else if (m?.is_user && typeof m.mes === "string") out.push({ index, text: m.mes, isUser: true });
    });
    return out;
}

function positions(records, windowKey, baselineKey, pin) {
    const len = records.length;
    const start = windowKey === "all" ? 0 : Math.max(0, len - Number(windowKey));
    const window = [start, len];
    let baseline = null;
    let note = "";
    if (baselineKey === "before") {
        baseline = [0, start];
        if (start < 15) note = start ? `only ${start} earlier replies, too few to compare` : "nothing earlier to compare with";
    } else if (baselineKey === "pinned" && pin) {
        const from = records.findIndex(r => r.index >= pin.from);
        let to = records.findIndex(r => r.index > pin.to);
        if (to < 0) to = len;
        baseline = from < 0 ? null : [from, to];
        const n = baseline ? to - from : 0;
        if (n < 15) note = `messages #${pin.from} to #${pin.to} hold ${n} replies, too few to compare`;
    } else if (baselineKey === "pinned") {
        note = "pick the messages to compare with";
    }
    return { window, baseline, note };
}

export async function openStats() {
    const ctx = getContext();
    const chat = ctx.chat || [];
    if (!chat.length) {
        toastr.info("Open a chat first.", "Deslopper stats");
        return;
    }
    const chatId = ctx.getCurrentChatId?.() || null;
    const title = ctx.groupId ? ctx.groups?.find(g => g.id == ctx.groupId)?.name || "Group chat" : ctx.name2 || "Chat";

    const root = $(`<div class="sd_popup sd_stats st-deslopper-settings">
        <div class="sd_popup_title">
            <span class="sd_popup_name">📊 Deslopper stats</span>
        </div>
        <div class="sd_tabs sd_stats_tabs" role="tablist">${Object.entries(MODES)
            .map(([k, m]) => `<button type="button" class="sd_tab${k === "written" ? " sd_active" : ""}" data-mode="${k}" title="${esc(m.hint)}"><i class="fa-solid ${m.icon}"></i><span>${esc(m.tab)}</span></button>`)
            .join("")}</div>
        <div class="sd_toolbar sd_stats_controls">
            <label class="sd_control"><span class="sd_control_label">Window</span><select class="text_pole sd_select sd_win">${WINDOWS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
            <label class="sd_control"><span class="sd_control_label">Compare with</span><select class="text_pole sd_select sd_base">${BASELINES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
            <span class="sd_control sd_pin" hidden><span class="sd_control_label">Messages</span><span class="sd_pin_inputs">#<input type="number" min="0" class="text_pole sd_number sd_pin_from"> to #<input type="number" min="0" class="text_pole sd_number sd_pin_to"></span></span>
            <span class="sd_toolbar_end">
                <div class="menu_button sd_copy_report" title="Copy the whole report as text, examples included"><i class="fa-solid fa-copy"></i><span>Copy report</span></div>
            </span>
        </div>
        <div class="sd_stats_body"><div class="sd_empty"><i class="fa-solid fa-spinner fa-spin"></i><div>Measuring…</div></div></div>
        ${lexiconHtml()}
        ${summariesHtml(chatId)}
    </div>`);

    const popup = new ctx.Popup(root[0], ctx.POPUP_TYPE?.TEXT ?? 1, "", { wide: true, large: true, allowVerticalScrolling: true, leftAlign: true, okButton: "Close" });
    popup.dlg?.classList.add("sd_popup_dialog");
    const shown = popup.show();

    // Let the popup paint "Measuring…" before the slow pass.
    await new Promise(r => setTimeout(r, 30));
    // records: one per mode. "after" is measured the first time its tab opens.
    const records = { written: null, after: null };
    let mode = "written";
    const names = chatNames();
    const messages = collectMessages(chat);
    // The AI replies with the user's message before each, for the "Make a rule" preview.
    const replies = [];
    let lastUser = "";
    for (const m of messages) {
        if (m.isUser) lastUser = m.text;
        else replies.push({ index: m.index, text: m.text, lastUser });
    }
    // Pass 1, the slow one: again only when the stock-phrase list changes.
    const measure = () => {
        const started = performance.now();
        const s = getSettings();
        const rules = allRules(s);
        // No target: every enabled rule counts, whatever its "where" setting.
        // analyze() cleans the replies in chat order, so the ones seen so far are the history
        // the budgets count over (as in the chat itself).
        const size = budgetWindow();
        const seen = [];
        // The text the chat shows for each reply (st/display.js refreshMessage), collected in the
        // same pass so the "After Deslopper" tab never cleans the chat a second time. When every
        // enabled rule also cleans the display (the usual case), it's this pass's own result;
        // only rules set to "outgoing only" make a second, display-only run needed.
        const on = !!s?.enabled;
        const allActive = activeRules(rules, { settings: s?.rules }).length;
        const sameAsDisplay = activeRules(rules, { settings: s?.rules, target: "display" }).length === allActive;
        shownText = new Map();
        const clean = (text, lastUser = "", index) => {
            const history = size > 1 ? seen.slice(-size * 3) : [];
            seen.push(text);
            const pctx = { names, settings: s?.rules, lastUser, window: { size, history } };
            const out = runPipeline(text, rules, pctx);
            if (on && index !== undefined) {
                const disp = sameAsDisplay ? out : runPipeline(text, rules, { ...pctx, target: "display" });
                // A reply cleaned down to nothing is shown as written.
                if (disp.changed && disp.text.trim()) shownText.set(index, disp.text);
            }
            return out;
        };
        records.written = analyze(messages, { clean, ...analyzeOpts() });
        records.after = null;
        logDebug(`stats: ${records.written.length} replies measured (${Math.round(performance.now() - started)} ms)`);
    };
    let shownText = new Map();
    const analyzeOpts = () => ({ userNames: ctx.name1 ? [ctx.name1] : [], charNames: names.filter(n => n !== ctx.name1), lexicon: getLexicon() });
    // The replies as the chat shows them. No clean step: the fixes are already in, so what's
    // counted is the slop Deslopper left.
    const measureAfter = () => {
        const started = performance.now();
        const shown = messages.map(m => (!m.isUser && shownText.has(m.index) ? { ...m, text: shownText.get(m.index) } : m));
        records.after = analyze(shown, analyzeOpts());
        logDebug(`stats (after Deslopper): ${records.after.length} replies measured (${Math.round(performance.now() - started)} ms)`);
    };
    try {
        measure();
    } catch (e) {
        console.error(`${LOG_PREFIX} stats failed:`, e);
        root.find(".sd_stats_body").html(`<div class="sd_empty"><i class="fa-solid fa-bug"></i><div>Something went wrong measuring this chat (details in the browser console).</div></div>`);
        return shown;
    }

    const s = getSettings();
    const ruleIds = BUILTIN_RULES.filter(r => (s?.rules?.[r.id]?.enabled ?? r.defaults.enabled) !== false).map(r => r.id);
    const ruleNames = Object.fromEntries(allRules(s).map(r => [r.id, r.name]));
    const pin = getPin(chatId);
    if (pin) {
        root.find(".sd_base").val("pinned");
        root.find(".sd_pin_from").val(pin.from);
        root.find(".sd_pin_to").val(pin.to);
    }

    let saved = false;
    let lastText = "";
    const render = () => {
        try {
            if (mode === "after" && !records.after) measureAfter();
            const recs = records[mode];
            const baseKey = String(root.find(".sd_base").val());
            root.find(".sd_pin").prop("hidden", baseKey !== "pinned");
            const winKey = String(root.find(".sd_win").val());
            const p = positions(recs, winKey, baseKey, getPin(chatId));
            const rep = buildReport(recs, { window: p.window, baseline: p.baseline, ruleIds: mode === "after" ? [] : ruleIds, ruleNames });
            const modeNote = mode === "after" && !getSettings()?.enabled ? "Deslopper is switched off, so the chat shows the replies as written." : "";
            root.find(".sd_stats_body").html(reportHtml(rep, { title, baselineNote: p.note, mode, modeNote }));
            lastText = reportText(rep, { title, mode, modeNote, windowLabel: WINDOWS.find(([v]) => v === winKey)?.[1] || winKey });
            // The all-chats list keeps each chat's whole-chat score as written, so the numbers compare.
            if (!saved) {
                saved = true;
                const whole = buildReport(records.written, { ruleIds, ruleNames });
                saveSummary({ chatId, title, n: whole.n, score: whole.score });
            }
        } catch (e) {
            console.error(`${LOG_PREFIX} stats render failed:`, e);
        }
    };

    root.on("change", ".sd_win, .sd_base", render);
    root.on("click", ".sd_stats_tabs .sd_tab", function () {
        const next = this.dataset.mode;
        if (!MODES[next] || next === mode) return;
        mode = next;
        // Braces on purpose: jQuery's each() stops at a callback that returns false (toggle's "removed").
        root.find(".sd_stats_tabs .sd_tab").each((_, el) => {
            el.classList.toggle("sd_active", el.dataset.mode === mode);
        });
        if (records[mode]) return render();
        // First visit to the tab: paint a spinner before measuring, so the click never just freezes.
        root.find(".sd_stats_body").html(`<div class="sd_empty"><i class="fa-solid fa-spinner fa-spin"></i><div>Measuring…</div></div>`);
        setTimeout(render, 30);
    });
    root.on("change", ".sd_pin_from, .sd_pin_to", () => {
        const from = Number(root.find(".sd_pin_from").val());
        const to = Number(root.find(".sd_pin_to").val());
        if (root.find(".sd_pin_from").val() !== "" && root.find(".sd_pin_to").val() !== "" && from <= to) setPin(chatId, { from, to });
        else setPin(chatId, null);
        render();
    });
    root.on("click", ".sd_copy_report", async () => {
        try {
            if (!lastText) return;
            if (await copyText(lastText)) toastr.success("Report copied.", "Deslopper stats");
            else toastr.warning("Couldn't reach the clipboard.", "Deslopper stats");
        } catch (err) {
            console.error(`${LOG_PREFIX} copy failed:`, err);
        }
    });
    root.on("click", ".sd_metric", function () {
        const $detail = root.find(`.sd_metric_detail[data-for="${this.dataset.id}"]`);
        const open = !!$detail.prop("hidden");
        $detail.prop("hidden", !open);
        $(this).toggleClass("sd_open", open);
    });
    const $lex = root.find(".sd_lexicon_box").val((getLexicon() || STOCK_PHRASES).join("\n"));
    $lex.on("change", () => {
        try {
            const list = String($lex.val()).split("\n").map(x => x.trim()).filter(Boolean);
            const same = list.length === STOCK_PHRASES.length && list.every((x, i) => x === STOCK_PHRASES[i]);
            setLexicon(list.length && !same ? list : null);
            if (!list.length) $lex.val(STOCK_PHRASES.join("\n"));
            const own = getLexicon();
            root.find(".sd_lexicon_count").text(`${(own || STOCK_PHRASES).length}${own ? " · yours" : " · built-in"}`);
            measure();
            render();
        } catch (err) {
            console.error(`${LOG_PREFIX} stock phrases update failed:`, err);
        }
    });
    root.on("click", ".sd_motif_make", function (e) {
        e.preventDefault();
        const $li = $(this).closest(".sd_motif");
        $(this).hide();
        try {
            motifForm($li, String($li.attr("data-phrase")), replies, names);
        } catch (err) {
            console.error(`${LOG_PREFIX} rule form failed:`, err);
        }
    });
    root.on("click", ".sd_jump", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const index = Number(this.dataset.index);
        try {
            await popup.completeAffirmative();
            await ctx.executeSlashCommandsWithOptions(`/chat-jump ${index}`);
        } catch (err) {
            console.error(`${LOG_PREFIX} jump failed:`, err);
        }
    });
    render();
    return shown;
}
