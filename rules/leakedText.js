// Leaked thinking and chat tokens (docs/PLAN.md section 7, item 23). PURE: no SillyTavern imports.
//
// What a model leaves in its reply that was never meant to be shown, each its own switch:
//   thinking   ST's reasoning parser already takes out a clean <think>…</think>; reasoning that
//              reaches the reply means a tag was broken or missing. So: everything from the start
//              through the last piece of a thinking tag goes, whole or broken:
//              "plan… </think>\n\nShe smiles."   -> "She smiles."   (opener missing)
//              "oh yeah\n<think\n\nSo well"       -> "So well"       (">" missing)
//              "plan… think> She smiles."        -> "She smiles."   ("<" missing)
//              also [/THINK], ◁/think▷ and gpt-oss's "<|channel|>final<|message|>"
//   tokens     "She smiles.<|im_end|>\n<|im_start|>user …"  -> "She smiles."   (from the first
//              chat-template token on, the model was writing past its turn); a role header at the
//              very start ("<|im_start|>assistant\n") just goes
//   name       "Seraphina: She smiles." -> "She smiles."   (only a chat name, only at the start)
// Never touched: a thinking tag that opens and never closes (the whole reply may be thinking:
// cut off by the token limit; showing it beats showing nothing), and anything that would leave
// the reply empty. Scope "raw": it runs on the text as written, before tags are hidden.

const DEFAULT_TAGS = ["think", "thinking", "reasoning", "reflection", "scratchpad", "analysis", "planning"];

// Chat-template tokens no reply should contain.
const TOKEN_RE =
    /<\|(?:im_start|im_end|eot_id|end_of_text|endoftext|end|start|start_header_id|end_header_id|user|assistant|system|return|channel|message)\|>|<(?:end|start)_of_turn>|<\/s>|\[\/?INST\]|<｜(?:end▁of▁sentence|User|Assistant)｜>/;
// A role header at the start: the token, the role word and its line break.
const LEAD_HEADER_RE =
    /^\s*(?:<\|im_start\|>|<\|start_header_id\|>|<start_of_turn>|<\|start\|>|<\|assistant\|>|<｜Assistant｜>)(?:assistant|model|char)?(?:<\|end_header_id\|>)?[ \t]*\n?/i;

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWords = s => /\p{L}/u.test(s);

function tagNames(list) {
    const clean = (Array.isArray(list) ? list : [])
        .map(t => String(t ?? "").trim().replace(/^<\/?|>$/g, ""))
        .filter(t => /^[\w:-]+$/.test(t));
    return clean.length ? clean : DEFAULT_TAGS;
}

function short(s) {
    const t = s.trim().replace(/\s+/g, " ");
    return t.length > 90 ? `${t.slice(0, 90)}…` : t;
}

// Any piece of a thinking tag, whole or broken: <think>, </think>, "<think" with no ">",
// "think>" with no "<", "</ thinking >", [THINK], [/THINK], ◁think▷, and gpt-oss's
// "<|channel|>final<|message|>". A clean <think>…</think> at the start never gets here (ST's
// reasoning parser takes it out first); what reaches the reply is the broken kind.
// Prose can mention a tag ("the <think> tag"), so: a closing tag counts anywhere, an opening tag
// only at a line's start or end, and a broken piece only when it ends its line.
function fragmentRe(tags) {
    const alt = `(?:${tags.map(escapeRe).join("|")})(?![\\w-])`;
    const eol = `(?=[ \\t]*(?:\\n|$))`;
    const bol = `(?<=(?:^|\\n)[ \\t]*)`;
    return new RegExp(
        [
            `<\\s*\\/\\s*${alt}[^<>\\n]*>`, // </think>
            `\\[\\s*\\/\\s*${alt}\\s*\\]`, // [/THINK]
            `◁\\/${alt}▷`,
            `${bol}<\\s*${alt}[^<>\\n]*>|<\\s*${alt}[^<>\\n]*>${eol}`, // <think> at a line edge
            `${bol}\\[\\s*${alt}\\s*\\]|\\[\\s*${alt}\\s*\\]${eol}|${bol}◁${alt}▷|◁${alt}▷${eol}`,
            `<\\s*\\/?\\s*${alt}${eol}`, // <think   (">" missing)
            `(?<![\\w<\\/])\\/?${alt}\\s*>${eol}`, // think>, /think>   ("<" missing)
            `<\\|channel\\|>\\s*final\\s*(?:<\\|constrain\\|>[^<]*)?<\\|message\\|>`,
        ].join("|"),
        "gi",
    );
}

// The reply comes after the LAST piece of a thinking tag: everything from the start through it
// goes ("plan… </think> She smiles.", "oh yeah\n<think\n\nSo well", "<think>plan</thinking>…").
// Left alone: one piece at the very start with nothing before it (an opener whose thinking never
// ended: where the reply starts can't be told), and a cut that would leave nothing.
function stripThinking(text, tags) {
    const found = [...text.matchAll(fragmentRe(tags))];
    if (!found.length) return { text, removed: [] };
    const last = found[found.length - 1];
    const end = last.index + last[0].length;
    const before = text.slice(0, last.index);
    const rest = text.slice(end);
    if (found.length === 1 && !hasWords(before)) return { text, removed: [] };
    if (!hasWords(rest)) return { text, removed: [] };
    return { text: rest.replace(/^\s+/, ""), removed: [text.slice(0, end)] };
}

function stripTokens(text) {
    let t = text;
    const removed = [];
    const head = LEAD_HEADER_RE.exec(t);
    if (head && head[0].trim()) {
        removed.push(head[0]);
        t = t.slice(head[0].length);
    }
    const m = TOKEN_RE.exec(t);
    if (m) {
        const keep = t.slice(0, m.index);
        const after = t.slice(m.index + m[0].length);
        if (hasWords(keep)) {
            removed.push(t.slice(m.index));
            t = keep.replace(/\s+$/, "");
        } else if (hasWords(after)) {
            // The token comes first: drop just the token, the rest may be the reply.
            removed.push(keep + m[0]);
            t = after.replace(/^\s+/, "");
        }
    }
    if (!removed.length || !hasWords(t)) return { text, removed: [] };
    return { text: t, removed };
}

function stripName(text, names) {
    const list = (names || []).filter(n => typeof n === "string" && n.trim()).map(n => escapeRe(n.trim()));
    if (!list.length) return { text, removed: [] };
    const m = new RegExp(`^(\\s*)(\\*\\*)?(?:${list.join("|")})(?:\\2)?:(?:\\2)?[ \\t]+(?=\\S)`).exec(text);
    if (!m || !hasWords(text.slice(m[0].length))) return { text, removed: [] };
    return { text: m[1] + text.slice(m[0].length), removed: [m[0]] };
}

export default {
    id: "leaked-text",
    name: "Leaked thinking and chat tokens",
    description: "Reasoning that slipped past ST's parser because a tag broke: everything before the last piece of a thinking tag goes. plan… think> She smiles. → She smiles. Also chat tokens (<|im_end|> and what follows) and a \"Name:\" before the reply.",
    scope: "raw",
    order: 1,
    defaults: { enabled: true, thinking: true, tokens: true, name: true, tags: DEFAULT_TAGS },
    options: [
        { key: "thinking", type: "checkbox", label: "Remove leaked thinking: everything before the last piece of a thinking tag, broken ones too (<think, think>, </think>)" },
        { key: "tokens", type: "checkbox", label: "Cut at a chat token (<|im_end|>, </s>, [INST]…): the rest is the model writing past its turn" },
        { key: "name", type: "checkbox", label: "Drop \"Name:\" at the start of the reply (chat names only)" },
        { key: "tags", type: "list", label: "Thinking tag names (without < >)" },
    ],

    apply(text, ctx) {
        const s = ctx.settings || {};
        let out = text;
        const hits = [];
        const add = (kind, label, removed) => {
            for (const r of removed) hits.push({ kind, label, before: short(r), after: "" });
        };
        if (s.thinking !== false && /[<>\[▷]/.test(out)) {
            const r = stripThinking(out, tagNames(s.tags));
            out = r.text;
            add("thinking", "thinking", r.removed);
        }
        if (s.tokens !== false && /<[|｜/]|<(?:end|start)_of_turn>|\[\/?INST\]/.test(out)) {
            const r = stripTokens(out);
            out = r.text;
            add("token", "chat token", r.removed);
        }
        if (s.name !== false && out.includes(":")) {
            const r = stripName(out, ctx.names);
            out = r.text;
            add("name", "name prefix", r.removed);
        }
        if (out === text) return text;
        if (!hasWords(out)) {
            ctx.log?.("would leave the reply empty; left as written");
            return text;
        }
        return { text: out, hits };
    },
};
