// Wiring only: settings, events, UI. All text work lives in the pure modules (core/, lang/, rules/).
import { extension_settings, getContext } from "../../../extensions.js";
import { extensionName, extensionFolderPath, LOG_PREFIX } from "./core/constants.js";
import { logDebug } from "./core/debug.js";
import { loadSettings, initSettingsListeners, onSettingsChanged, getSettings, settingsChanged } from "./settings/settingsManager.js";
import { renameEntry, deleteEntry } from "./core/characters.js";
import { initInterceptor } from "./st/interceptor.js";
import { initDisplay, refreshAll, scheduleRefreshAll, setShowAllOriginals } from "./st/display.js";
import { initStream } from "./st/stream.js";
import { invalidate } from "./st/cleaner.js";
import { renderQuickRules } from "./ui/settingsPanel.js";
import { patternsSummary } from "./ui/patternsEditor.js";
import { runTester } from "./ui/tester.js";
import { openFixes } from "./ui/fixesPopup.js";
import { openStats } from "./ui/statsPopup.js";
import { getSummaries } from "./stats/statsStore.js";

function openStatsSafely() {
    openStats()
        .catch(e => console.error(`${LOG_PREFIX} stats failed:`, e))
        .finally(refreshStatsBadge);
}

function openFixesSafely(tab) {
    openFixes(tab).catch(e => console.error(`${LOG_PREFIX} fixes popup failed:`, e));
}

// The drawer's one-line patterns summary; a click opens the popup on that tab.
function refreshPatternsSummary() {
    const { total, on } = patternsSummary();
    const $el = $("#st_desloper_patterns_summary").empty();
    $el.append($('<i class="fa-solid fa-code">'), $("<span>").text("Your patterns"));
    $el.append($('<span class="sd_badge">').text(total ? `${on} of ${total} on` : "none yet"));
    $el.append($('<i class="fa-solid fa-chevron-right sd_quick_patterns_go">'));
}

// The open chat's score from the last time its stats were opened, if any.
function refreshStatsBadge() {
    try {
        const id = getContext().getCurrentChatId?.();
        const last = id ? getSummaries().find(x => x.chatId === id) : null;
        $("#st_desloper_stats_last")
            .prop("hidden", !last)
            .text(last ? `this chat: ${last.score}` : "")
            .attr("title", last ? `Slop score when the stats were last opened (${new Date(last.ts).toLocaleDateString()}), 0 clean, 100 all slop` : "");
    } catch (e) {
        console.error(`${LOG_PREFIX} stats badge failed:`, e);
    }
}

function initDrawer() {
    renderQuickRules();
    refreshPatternsSummary();
    refreshStatsBadge();
    $("#st_desloper_fixes_open").on("click", () => openFixesSafely("fixes"));
    $("#st_desloper_tester_open").on("click", () => openFixesSafely("tester"));
    $("#st_desloper_patterns_summary").on("click", () => openFixesSafely("patterns"));
}

// Three ways in: the drawer button, the wand menu, and /desloper-stats.
function initStatsEntry() {
    $("#st_desloper_stats_open").on("click", openStatsSafely);

    if (!$("#st_desloper_stats_menu").length) {
        const item = $(`<div id="st_desloper_stats_menu" class="list-group-item flex-container flexGap5" title="Desloper stats for the open chat">
            <div class="fa-solid fa-chart-simple extensionsMenuExtensionButton"></div>Desloper stats</div>`);
        item.on("click", openStatsSafely);
        $("#extensionsMenu").append(item);
    }

    const ctx = getContext();
    if (ctx.SlashCommandParser && ctx.SlashCommand) {
        ctx.SlashCommandParser.addCommandObject(
            ctx.SlashCommand.fromProps({
                name: "desloper-stats",
                helpString: "Opens Desloper's stats for the open chat.",
                callback: async () => {
                    openStatsSafely();
                    return "";
                },
            }),
        );
    }
}

// Every handler is wrapped: a Desloper bug must never break the chat.
// first: run ahead of other extensions' handlers (ST's makeFirst, when this ST has it).
export function on(eventName, label, handler, { first = false } = {}) {
    if (!eventName) {
        console.warn(`${LOG_PREFIX} no such event for "${label}" in this SillyTavern version`);
        return;
    }
    const source = getContext().eventSource;
    const wrapped = async (...args) => {
        try {
            await handler(...args);
        } catch (e) {
            console.error(`${LOG_PREFIX} ${label} handler failed:`, e);
        }
    };
    if (first && typeof source.makeFirst === "function") source.makeFirst(eventName, wrapped);
    else source.on(eventName, wrapped);
}

function refreshAllSafely() {
    refreshAll().catch(e => console.error(`${LOG_PREFIX} refresh failed:`, e));
}

jQuery(async () => {
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/index.html`);
        const tempDiv = $("<div>").html(settingsHtml);
        $("#extensions_settings").append(tempDiv.find("#st_desloper_settings_block"));

        loadSettings();
        initSettingsListeners();
        initDrawer();
        initStatsEntry();
        initInterceptor();
        initDisplay(on);
        initStream(on);

        // Not a saved setting (st/display.js says why), so it isn't in settingsManager's table.
        $("#st_desloper_show_originals")
            .prop("checked", false)
            .on("change", function () {
                try {
                    setShowAllOriginals(this.checked);
                } catch (e) {
                    console.error(`${LOG_PREFIX} show originals failed:`, e);
                }
            });

        // Any setting change: results cached under the old settings are stale.
        onSettingsChanged(() => {
            invalidate();
            scheduleRefreshAll();
            runTester();
            renderQuickRules();
            refreshPatternsSummary();
        });
        // Per-character fixes are keyed by avatar file: follow a rename (ST renames the file with
        // the character), drop a deleted character's (a new one may get the same file name).
        const E = getContext().eventTypes;
        on(E?.CHARACTER_RENAMED, "character renamed", (oldAvatar, newAvatar) => {
            const name = getContext().characters?.find(c => c.avatar === newAvatar)?.name;
            if (renameEntry(getSettings(), oldAvatar, newAvatar, name)) settingsChanged();
        });
        on(E?.CHARACTER_DELETED, "character deleted", data => {
            if (deleteEntry(getSettings(), data?.character?.avatar)) settingsChanged();
        });
        // The stats badge is per chat.
        on(getContext().eventTypes?.CHAT_CHANGED, "stats badge", refreshStatsBadge);
        // A chat may already be open when the extension loads.
        refreshAllSafely();

        logDebug("initialized", extension_settings[extensionName]);
    } catch (e) {
        console.error(`${LOG_PREFIX} failed to initialize:`, e);
    }
});
