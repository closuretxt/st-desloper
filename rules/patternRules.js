// "Your patterns": find/replace rules the user adds in settings (docs/PLAN.md section 6).
// PURE: no SillyTavern imports.
//
// Each pattern becomes its own rule, so its scope / where / on-off go through the pipeline like
// a built-in, and if the repair step can't fix what one pattern did, only that pattern's change
// is dropped. Still not a plain regex: every change goes through the shared repair step, plus
// optional checks (only at the end of a line, only if the line has other words, skip questions).
//
// pattern: { id, name, find, replace, scope, where, enabled, checks: { lineEnd, otherWords, skipQuestions } }
//   find:    "/regex/flags" (like ST's Regex extension) or plain text (matched as is, any case,
//            whole words). In plain text, {x} (any name) is a blank: 1 to 4 words, never across
//            punctuation, so "the way {x} did" catches "the way most people did". The same blank
//            twice must match the same words.
//   replace: one text, or several on separate lines (one is picked per match, the same one every
//            time for the same message). Empty = delete. A line that is just {{delete}} is a
//            "delete" option in the pool, so a pattern can reword some matches and remove others;
//            repeating a line makes it come up more often. {x} puts back a blank's words;
//            {{match}}, $&, $1, $<name> work like in ST's Regex extension.

import { MARK } from "../core/marks.js";
import { pick } from "../core/seed.js";

export const PATTERN_ORDER = 900;

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// {x}, {who}, {thing_2}: a blank in a plain-text find, or its words in a replacement.
const BLANK_RE = /\{([A-Za-z]\w*)\}/g;
// One to four words (apostrophes and hyphens inside a word are fine), never across punctuation,
// so a blank stays inside its own clause.
const WORD = "[\\p{L}\\p{N}'’\\-]+";
const BLANK_BODY = `${WORD}(?:\\s+${WORD}){0,3}`;

function plainBody(src) {
    const seen = new Set();
    let out = "";
    let last = 0;
    for (const m of src.matchAll(BLANK_RE)) {
        out += escapeRe(src.slice(last, m.index)).replace(/\s+/g, "\\s+");
        const name = m[1];
        // A name used twice must match the same words (and JS forbids duplicate group names).
        out += seen.has(name) ? `\\k<${name}>` : `(?<${name}>${BLANK_BODY})`;
        seen.add(name);
        last = m.index + m[0].length;
    }
    return out + escapeRe(src.slice(last)).replace(/\s+/g, "\\s+");
}

// A pool line that means "delete this match".
const DELETE_LINE = /^\s*\{\{delete\}\}\s*$/i;

const compiled = new Map();
// -> { re } or { error }. Always global; a sticky flag would make matches depend on position.
export function compileFind(find) {
    const src = typeof find === "string" ? find.trim() : "";
    if (!src) return { error: "empty" };
    if (compiled.has(src)) return compiled.get(src);
    let result;
    try {
        const m = /^\/([\s\S]+)\/([a-z]*)$/.exec(src);
        if (m) {
            const flags = [...new Set(m[2].replace(/[gy]/g, ""))].join("") + "g";
            result = { re: new RegExp(m[1], flags) };
        } else if (src.startsWith("/")) {
            // Most likely a regex still being typed; matching it as plain text would surprise.
            result = { error: "starts with / but doesn't end with /flags (like /text/i)" };
        } else if (!/[\p{L}\p{N}]/u.test(src.replace(BLANK_RE, ""))) {
            // Blanks alone would match any words anywhere.
            result = { error: "needs at least one real word next to the {blank}" };
        } else {
            // Blanks count as words for the whole-word edges ("{x} did" still needs a word start).
            const edges = src.replace(BLANK_RE, "w");
            const pre = /^[\p{L}\p{N}_]/u.test(edges) ? "(?<![\\p{L}\\p{N}_])" : "";
            const post = /[\p{L}\p{N}_]$/u.test(edges) ? "(?![\\p{L}\\p{N}_])" : "";
            result = { re: new RegExp(pre + plainBody(src) + post, "giu") };
        }
    } catch (e) {
        result = { error: e.message };
    }
    if (compiled.size > 200) compiled.clear();
    compiled.set(src, result);
    return result;
}

// {{match}} / $& -> the match, $1 -> group 1, $<name> / {name} -> named group, $$ -> "$".
// A {name} with no such group stays as typed (it may be real text in braces).
export function expandReplacement(template, m) {
    return String(template).replace(/\{\{match\}\}|\$\$|\$&|\$<([^>]+)>|\$(\d{1,2})|\{([A-Za-z]\w*)\}/gi, (tok, name, num, blank) => {
        if (tok === "$$") return "$";
        if (name !== undefined) return m.groups?.[name] ?? "";
        if (num !== undefined) return m[Number(num)] ?? "";
        if (blank !== undefined) return m.groups && blank in m.groups ? (m.groups[blank] ?? "") : tok;
        return m[0];
    });
}

// Replace lines -> the pool to pick from. A {{delete}} line becomes "" (a delete option);
// blank lines are ignored, and no lines at all means delete every time.
export function poolOf(replace) {
    const lines = String(replace ?? "").split("\n");
    const pool = lines
        .map(l => l.replace(/\r$/, ""))
        .filter(l => l.trim())
        .map(l => (DELETE_LINE.test(l) ? null : l));
    return pool.length ? pool : [null];
}

function lineAround(text, start, end) {
    const ls = text.lastIndexOf("\n", start - 1) + 1;
    let le = text.indexOf("\n", end);
    if (le === -1) le = text.length;
    return { ls, le };
}

function passesChecks(text, m, checks) {
    if (!checks) return true;
    const start = m.index;
    const end = start + m[0].length;
    const { ls, le } = lineAround(text, start, end);
    if (checks.lineEnd && !/^[\s\p{P}\p{S}]*$/u.test(text.slice(end, le))) return false;
    if (checks.otherWords && !/\p{L}/u.test(text.slice(ls, start) + text.slice(end, le))) return false;
    if (checks.skipQuestions) {
        // The sentence holding the match ends in "?" (or the match is the question itself).
        const tail = text.slice(end, le);
        const stop = /[.!?…~♡]+/.exec(tail);
        if (/\?/.test(m[0]) || (stop && stop[0].includes("?"))) return false;
    }
    return true;
}

// prefix / base: per-character patterns (core/characters.js) use their own ids and run later.
export function patternRule(p, index = 0, { prefix = "pattern", base = PATTERN_ORDER } = {}) {
    const scope = ["dialogue", "narration", "all"].includes(p.scope) ? p.scope : "all";
    const where = ["display", "outgoing", "both"].includes(p.where) ? p.where : "both";
    return {
        id: `${prefix}:${p.id}`,
        name: p.name || p.find,
        description: "",
        scope,
        order: base + index,
        defaults: { enabled: p.enabled !== false, where },
        apply(text, ctx) {
            const { re, error } = compileFind(p.find);
            if (error) {
                ctx.log?.(`pattern "${p.name || p.find}" can't be used: ${error}`);
                return text;
            }
            const pool = poolOf(p.replace);
            const hits = [];
            let out = "";
            let last = 0;
            re.lastIndex = 0;
            for (const m of text.matchAll(re)) {
                if (!m[0]) continue;
                if (!passesChecks(text, m, p.checks)) continue;
                const template = pool.length > 1 ? pick(ctx.rng, pool) : pool[0];
                const repl = template === null ? "" : expandReplacement(template, m);
                out += text.slice(last, m.index) + MARK + repl + MARK;
                last = m.index + m[0].length;
                hits.push({ before: m[0], after: repl, pattern: p.id });
            }
            return hits.length ? { text: out + text.slice(last), hits } : text;
        },
    };
}

export function patternRules(patterns, opts) {
    if (!Array.isArray(patterns)) return [];
    return patterns.filter(p => p && p.id && typeof p.find === "string" && p.find.trim()).map((p, i) => patternRule(p, i, opts));
}

export function newPatternId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function blankPattern() {
    return {
        id: newPatternId(),
        name: "",
        find: "",
        replace: "",
        scope: "all",
        where: "both",
        enabled: true,
        checks: { lineEnd: false, otherWords: false, skipQuestions: false },
    };
}

// Import: SillyTavern Regex extension scripts (one object or a list), or Desloper's own export.
// Only scripts that run on AI output (placement 2) are taken. -> { patterns, skipped }.
export function importPatterns(json) {
    const list = Array.isArray(json) ? json : Array.isArray(json?.patterns) ? json.patterns : [json];
    const patterns = [];
    let skipped = 0;
    for (const item of list) {
        if (!item || typeof item !== "object") {
            skipped++;
            continue;
        }
        if (typeof item.find === "string") {
            // Only the known fields, each checked: a shared file can't put anything else in settings.
            const p = blankPattern();
            const checks = item.checks && typeof item.checks === "object" ? item.checks : {};
            patterns.push({
                ...p,
                name: typeof item.name === "string" ? item.name : "",
                find: item.find,
                replace: typeof item.replace === "string" ? item.replace : "",
                scope: ["dialogue", "narration", "all"].includes(item.scope) ? item.scope : p.scope,
                where: ["display", "outgoing", "both"].includes(item.where) ? item.where : p.where,
                enabled: item.enabled !== false,
                checks: Object.fromEntries(Object.keys(p.checks).map(k => [k, checks[k] === true])),
            });
            continue;
        }
        if (typeof item.findRegex !== "string" || !item.findRegex.trim()) {
            skipped++;
            continue;
        }
        if (Array.isArray(item.placement) && item.placement.length && !item.placement.includes(2)) {
            skipped++;
            continue;
        }
        patterns.push({
            ...blankPattern(),
            name: item.scriptName || "",
            find: item.findRegex,
            replace: typeof item.replaceString === "string" ? item.replaceString : "",
            where: item.markdownOnly && !item.promptOnly ? "display" : item.promptOnly && !item.markdownOnly ? "outgoing" : "both",
            enabled: !item.disabled,
        });
    }
    return { patterns, skipped };
}

export function exportPatterns(patterns) {
    return {
        type: "st-desloper-patterns",
        version: 1,
        patterns: (patterns || []).map(({ name, find, replace, scope, where, enabled, checks }) => ({ name, find, replace, scope, where, enabled, checks })),
    };
}
