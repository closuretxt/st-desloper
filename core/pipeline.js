// The pipeline: text + rules + ctx -> { text, hits, changed }. PURE: no SillyTavern imports.
// Same pipeline for what's displayed and what's sent to the model (docs/PLAN.md section 3).
//
//   0. Rules with scope "raw" run on the message exactly as written, tags and code included
//      (leaked thinking: its <think> tags are what it looks for). No repair step.
//   1. Protect the untouchable parts (code, tags, macros, links) behind placeholders.
//   2. For each rule, lowest `order` first: split into dialogue / narration, run the rule on
//      the segments its `scope` covers, then the shared repair step. If repair can't make the
//      result read right, that rule's change is dropped for this message. Scope "message" runs
//      on the whole message at once (protected parts still hidden) with no repair step: for
//      mechanical fixes like curly quotes, which must change before the split into dialogue.
//   3. Put the protected parts back.
//
// ctx: { names: [], settings: { [ruleId]: {...} }, target: 'display' | 'outgoing', lang, log,
//        lastUser: the user's message this reply answers ('' when there is none),
//        window: { size, history } for budgets over many replies (core/speech.js windowLeft) }

import { protect, unprotect, splitSegments, placeholdersIntact } from "./segments.js";
import { MARK, markDiff } from "./marks.js";
import { repair } from "./repair.js";
import { seedFor, makeRng } from "./seed.js";
import { mergeNames } from "./names.js";

function inScope(scope, type) {
    if (scope === "all") return type === "dialogue" || type === "narration";
    return scope === type;
}

// Rule settings = its defaults, overridden by what the user saved.
export function settingsFor(rule, allSettings) {
    return { ...(rule.defaults || {}), ...(allSettings?.[rule.id] || {}) };
}

// The rules that run for this target, in order.
export function activeRules(rules, ctx = {}) {
    return (rules || [])
        .filter(rule => {
            if (!rule || typeof rule.apply !== "function" || !rule.id) return false;
            const s = settingsFor(rule, ctx.settings);
            if (s.enabled === false) return false;
            const where = s.where || "both";
            return !ctx.target || where === "both" || where === ctx.target;
        })
        .sort((a, b) => (a.order ?? 500) - (b.order ?? 500) || a.id.localeCompare(b.id));
}

// A rule's apply never throws by contract; this makes sure of it anyway.
function safeApply(rule, text, rctx, log) {
    try {
        const r = rule.apply(text, rctx);
        if (typeof r === "string") return { text: r, hits: [] };
        if (r && typeof r.text === "string") return { text: r.text, hits: Array.isArray(r.hits) ? r.hits : [] };
        log(`${rule.id}: apply returned nothing usable; left as written`);
    } catch (e) {
        log(`${rule.id}: apply threw (${e?.message}); left as written`);
    }
    return { text, hits: [] };
}

// A rule that sees the whole message at once ("raw" or "message" scope).
function wholeContext(rule, ctx, names, original, log) {
    const seed = seedFor(original, rule.id);
    return {
        names,
        settings: settingsFor(rule, ctx.settings),
        seed,
        rng: makeRng(seed),
        lang: ctx.lang || "en",
        lastUser: typeof ctx.lastUser === "string" ? ctx.lastUser : "",
        window: ctx.window || null,
        log: msg => log(`${rule.id}: ${msg}`),
        segment: null,
    };
}

function hitsOf(rule, res, before) {
    const list = res.hits.length ? res.hits : [{ before, after: res.text }];
    return list.map(h => ({ rule: rule.id, where: "message", ...h }));
}

export function runPipeline(text, rules, ctx = {}) {
    const original = String(text ?? "");
    const log = typeof ctx.log === "function" ? ctx.log : () => {};
    const none = { text: original, hits: [], changed: false };
    const active = activeRules(rules, ctx);
    const hits = [];

    // 0. Raw rules: the text as written. Names come from ST only here (the reply may still hold
    // the model's thinking, whose capitalized words aren't names).
    let raw = original;
    const rawNames = Array.isArray(ctx.names) ? ctx.names : [];
    for (const rule of active.filter(r => r.scope === "raw")) {
        const res = safeApply(rule, raw, wholeContext(rule, ctx, rawNames, original, log), log);
        if (res.text === raw) continue;
        hits.push(...hitsOf(rule, res, raw));
        raw = res.text;
    }

    const prot = protect(raw);
    if (!prot) {
        log("message has reserved characters or too many protected parts; left as written");
        return raw === original ? none : { text: raw, hits, changed: true };
    }
    // The chat's names plus names the reply itself shows (core/names.js): a card that plays many
    // characters names people ST knows nothing about.
    const names = ctx.findNames === false ? rawNames : mergeNames(ctx.names, prot.text);
    let masked = prot.text;

    for (const rule of active) {
        if (rule.scope === "raw") continue;
        if (rule.scope === "message") {
            const res = safeApply(rule, masked, wholeContext(rule, ctx, names, original, log), log);
            if (res.text === masked) continue;
            if (!placeholdersIntact(masked, res.text) || res.text.includes(MARK)) {
                log(`${rule.id}: touched a protected part; left as written`);
                continue;
            }
            hits.push(...hitsOf(rule, res, masked));
            masked = res.text;
            continue;
        }
        const settings = settingsFor(rule, ctx.settings);
        const seed = seedFor(original, rule.id);
        const rng = makeRng(seed);
        const before = splitSegments(masked);
        const segs = before.map(s => ({ ...s }));
        const ruleHits = [];
        let changed = false;
        let offset = 0;

        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            const start = offset + s.open.length;
            offset += s.open.length + s.text.length + s.close.length;
            if (!inScope(rule.scope, s.type)) continue;
            const rctx = {
                names,
                settings,
                seed,
                rng,
                lang: ctx.lang || "en",
                lastUser: typeof ctx.lastUser === "string" ? ctx.lastUser : "",
                window: ctx.window || null,
                log: msg => log(`${rule.id}: ${msg}`),
                // Read-only view of where this text sits: its index, type, offset in the
                // message (before this rule ran) and all segments.
                segment: { index: i, type: s.type, start, segments: before },
            };
            const res = safeApply(rule, s.text, rctx, log);
            if (res.text === s.text) continue;
            if (!placeholdersIntact(s.text, res.text)) {
                log(`${rule.id}: touched a protected part; left as written`);
                continue;
            }
            segs[i] = { ...s, text: markDiff(s.text, res.text) };
            changed = true;
            const segHits = res.hits.length ? res.hits : [{ before: s.text, after: res.text.split(MARK).join("") }];
            for (const h of segHits) ruleHits.push({ rule: rule.id, where: s.type, ...h });
        }
        if (!changed) continue;

        const r = repair(segs, before, { names });
        if (!r.ok) {
            log(`${rule.id}: ${r.reason}; left as written`);
            continue;
        }
        masked = r.text;
        hits.push(...ruleHits);
    }

    const out = unprotect(masked, prot.parts);
    return { text: out, hits, changed: out !== original };
}
