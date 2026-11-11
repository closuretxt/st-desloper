// Staged questions (docs/PLAN.md section 7, item 28). PURE: no SillyTavern imports.
//
// The narrator asks a question only to answer it in the next sentence, for a drum roll:
//   The worst part? He was right.   -> The worst part was that he was right.
//                                   or Worst of all, he was right.  or  He was right.
//   The catch? The bridge was out.  -> The catch was that the bridge was out.  or  The bridge was out.
//   Worse? She knew.                -> Worse, she knew.
// Which form is stable per message and varies across a reply (core/seed.js dealFrom), so the
// fix doesn't become the next stock shape. "…was that" needs the answer's tense (was / is);
// when the answer shows none, that form is skipped.
// Only narration: a character saying "The worst part? I liked it." is how people talk. Only when
// the answer is a whole clause that starts like one ("He was right.", "The bridge was out."):
// "The best part? Nothing." stays, dropping the question would lose what it answers.

import { MARK } from "../core/marks.js";
import { dealFrom } from "../core/seed.js";
import { sentencesAt } from "../core/speech.js";

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SUP = String.raw`worst|best|strangest|weirdest|funniest|scariest|craziest|hardest|saddest|oddest|wildest|most\s+[a-z]+`;
const ADJ = String.raw`funny|crazy|weird|strange|sad|scary|odd|wild|ironic|annoying|real|only`;
const NOUN = String.raw`kicker|catch|problem|twist|truth|irony|result|reason|answer|trouble|punchline|real\s+kicker|real\s+problem`;
const COMP = String.raw`worse|better|stranger|weirder|scarier|crazier|funnier`;

// The question, as written (italic marks may wrap the line): lead, then one of the shapes.
const QUESTION = new RegExp(
    String.raw`^((?:(?:and|but|so)\s+)?)(?:` +
        String.raw`(?:the\s+)?(${SUP})\s+(part|thing)` + // 2, 3: "The worst part?"
        String.raw`|(?:the\s+)?(${ADJ})\s+(part|thing)` + // 4, 5: "The funny thing?"
        String.raw`|the\s+(${NOUN})` + // 6: "The catch?"
        String.raw`|((?:even\s+)?(?:${COMP})(?:\s+still)?|(?:${SUP})\s+of\s+all)` + // 7: "Worse?" / "Worst of all?"
        String.raw`)\?$`,
    "iu",
);

// Words a whole clause may start with; the answer must start with one of these or a name.
const OPENERS = "she|he|they|it|we|you|i|there|the|a|an|her|his|their|our|my|your|its|this|that|these|those|nobody|no one|no|everyone|everybody|someone|somebody|nothing|everything|something|none|all|both|neither";
const LOWER_OK = new Set(OPENERS.split("|").filter(w => w !== "i"));

function tenseOf(answer) {
    if (/\b(?:was|were|had|did|could|would|might)\b|\b[a-z]{3,}ed\b/i.test(answer)) return "was";
    if (/\b(?:is|are|has|does|can|will)\b|\b\w+['’]s\b|\b(?:she|he|it)\s+[a-z]+s\b/i.test(answer)) return "is";
    return null;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export default {
    id: "staged-questions",
    name: "Staged questions",
    description: "The worst part? He was right. → The worst part was that he was right. / Worst of all, he was right.  The catch? The bridge was out. → The bridge was out.",
    scope: "narration",
    order: 158,
    defaults: { enabled: true },
    options: [],

    apply(text, ctx) {
        const sents = sentencesAt(text);
        if (sents.length < 2) return text;
        const names = (ctx.names || []).filter(n => typeof n === "string" && n.trim()).map(n => esc(n.trim()));
        const opener = new RegExp(String.raw`^(?:${OPENERS}${names.length ? `|${names.join("|")}` : ""})(?![\p{L}'’-])`, "iu");
        const edits = [];
        for (let i = 0; i + 1 < sents.length; i++) {
            const q = sents[i];
            const a = sents[i + 1];
            const lead = /^[*_]*/.exec(q.text)[0];
            const qBody = q.text.slice(lead.length);
            const m = QUESTION.exec(qBody);
            if (!m) continue;
            // The answer: a whole clause, plain text start, no quote, ends as a statement.
            const ans = a.text;
            if (!/^\p{L}/u.test(ans) || /["“”]/.test(ans) || !/[.!…]["”’*_)\]]*$/.test(ans)) continue;
            if ((ans.match(/[\p{L}'’-]+/gu) || []).length < 2 || !opener.test(ans)) continue;
            const firstWord = /^[\p{L}'’]+/u.exec(ans)[0];
            const low = LOWER_OK.has(firstWord.toLowerCase()) ? firstWord.charAt(0).toLowerCase() : firstWord.charAt(0);
            const tense = tenseOf(ans);
            const head = qBody.slice(0, -1); // the question without "?"
            const lw = m[1];
            let forms;
            if (m[2]) forms = ["that", "of-all", "drop"];
            else if (m[4] || m[6]) forms = ["that", "drop"];
            else forms = ["comma", "drop"];
            if (!tense) forms = forms.filter(f => f !== "that");
            const form = dealFrom(ctx, `staged-questions|${forms.join(",")}`, forms);
            let rep;
            if (form === "that") rep = `${head} ${tense} that ${low}`;
            else if (form === "of-all") rep = `${lw}${lw ? m[2].toLowerCase() : cap(m[2].toLowerCase())} of all, ${low}`;
            else if (form === "comma") rep = `${head}, ${low}`;
            else {
                // Dropped: the question goes with the space before it, so the answer keeps its
                // own line when the two stood in separate paragraphs.
                const prev = sents[i - 1];
                const start = !lead && prev ? prev.end : q.start + lead.length;
                const end = !lead && prev ? q.end : a.start;
                edits.push({ start, end, text: "", before: `${qBody} ${ans}`, after: ans, form });
                i++;
                continue;
            }
            edits.push({ start: q.start + lead.length, end: a.start + 1, text: rep, before: `${qBody} ${ans}`, after: rep + ans.slice(1), form });
            i++; // the answer is used up
        }
        if (!edits.length) return text;
        let out = text;
        const hits = [];
        for (const e of [...edits].reverse()) {
            out = out.slice(0, e.start) + MARK + e.text + out.slice(e.end);
            hits.unshift({ kind: "staged-question", label: "staged question", form: e.form, before: e.before.trim(), after: e.after.trim() });
        }
        return { text: out, hits };
    },
};
