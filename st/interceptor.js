// Cleans AI messages in the outgoing prompt only. SillyTavern calls this before every generation
// (manifest.json "generate_interceptor"). `chat` holds fresh copies built from the saved chat
// (docs/PLAN.md section 2), so changing `chat[i].mes` here never reaches the saved message.
// All of history, every generation: old tics never reach the model, so it has less to copy.

import { getSettings } from "../settings/settingsManager.js";
import { getContext } from "../../../../extensions.js";
import { cleanText, isAiMessage, chatNames, lastUserBefore, historyBefore, originalText, budgetWindow, speakerOf } from "./cleaner.js";
import { logDebug } from "../core/debug.js";

export function initInterceptor() {
    globalThis.st_deslopper_intercept = async function (chat, _contextSize, _abort, type) {
        try {
            if (!getSettings()?.enabled || !Array.isArray(chat)) return;
            const started = performance.now();
            const names = chatNames();
            const stCtx = getContext();
            // On "continue" the model writes on from the end of the last reply, and the result
            // is glued onto the saved text: that reply must reach the model exactly as saved.
            let skip = -1;
            if (type === "continue") {
                for (let i = chat.length - 1; i >= 0; i--) {
                    if (isAiMessage(chat[i])) {
                        skip = i;
                        break;
                    }
                }
            }
            let changed = 0;
            let hits = 0;
            // Read the user's messages before any reply is changed (only replies are changed,
            // but this keeps it obvious).
            // Budgets count over the replies as written, so read those first too.
            const lastUsers = chat.map((_, i) => (isAiMessage(chat[i]) ? lastUserBefore(chat, i) : ""));
            const size = budgetWindow();
            const histories = chat.map((_, i) => (isAiMessage(chat[i]) ? historyBefore(chat, i, size) : []));
            for (let i = 0; i < chat.length; i++) {
                const m = chat[i];
                if (i === skip || !isAiMessage(m)) continue;
                // In "rewrite saved messages" mode `mes` holds the display cleaning; the prompt
                // is cleaned from the original with the prompt's own settings, so both modes send
                // the model the same thing. (A continued reply above goes as saved either way.)
                const source = originalText(m);
                const out = cleanText(source, "outgoing", names, lastUsers[i], histories[i], speakerOf(m, stCtx));
                if (!out.changed || !out.text.trim()) {
                    m.mes = source;
                    continue;
                }
                m.mes = out.text;
                changed++;
                hits += out.hits.length;
            }
            logDebug(`prompt (${type || "normal"}): cleaned ${changed} of ${chat.length} messages, ${hits} fixes (${Math.round(performance.now() - started)} ms)`);
        } catch (e) {
            // A Deslopper bug must never block a generation.
            console.error("[ST Deslopper] interceptor failed:", e);
        }
    };
}
