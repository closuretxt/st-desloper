// Chatbot sign-offs (docs/PLAN.md section 7, item 30). PURE: no SillyTavern imports.
//
// The assistant wrapper some models leave around a roleplay reply:
//   …she closes the door.\n\nI hope this continues the scene well! Let me know if you'd like any changes.
//                                       -> …she closes the door.
//   Sure! Here's the next part:\n\nThe rain picks up… -> The rain picks up…
// Only whole lines at the reply's very end (a run of them) or its first line, and only when every
// sentence on the line is wrapper talk AND the line talks about the writing ("scene", "reply",
// "continue", "changes"…), so a first-person narrator's "I hope you like it." stays. Never a
// line with quotes in it, and a "---" line between the story and the wrapper goes with it.
// "(OOC: …)" lines at the end are a switch, off by default: some people use them on purpose.
// Scope "message": the whole reply at once, before the dialogue / narration split.

import { sentencesAt, plainOf, hasPlaceholder } from "../core/speech.js";

const FILLER = String.raw`^(?:(?:okay|ok|alright|so|anyway|well|also|and|oh)[,!.]?\s+)*`;
const re = s => new RegExp(s, "u");

const SIGN_OFF = [
    String.raw`i hope (?:this|that|it|you|the|my)\b`,
    String.raw`let me know (?:if|what|how|whether|when)\b`,
    String.raw`(?:would|do) you (?:like|want) me to\b`,
    String.raw`(?:please )?(?:feel free|don't hesitate|do not hesitate) to\b`,
    String.raw`(?:shall|should) i (?:continue|go on|keep going|proceed|write|add|expand|change|adjust|stop)\b`,
    String.raw`(?:want|wanna) me to\b`,
    String.raw`is there anything (?:else )?(?:you'd|you would|you want)\b`,
    String.raw`what would you like (?:to happen|me to|to see|to do)\b`,
    String.raw`how (?:was|is|does|did) (?:that|this)(?: (?:work|sound|look|feel))?(?: for you)?[?!.]*$`,
    String.raw`(?:any )?thoughts[?!.]*$`,
    String.raw`(?:i can|i could|i'd be happy to|i'm happy to|happy to|i'll gladly) (?:also )?(?:adjust|continue|change|rewrite|tweak|expand|revise|modify|write|keep going|make)\b`,
    String.raw`(?:thank you|thanks) for (?:the|this|reading|playing|roleplaying|writing)\b`,
    String.raw`(?:enjoy|have fun)(?: the (?:scene|story|rest))?[!.]*$`,
].map(p => re(FILLER + p));

const OPEN = [
    String.raw`(?:sure|certainly|of course|absolutely|okay|ok|alright|got it|great|understood|no problem|you got it|gladly)(?: thing)?[!.,]*$`,
    String.raw`here(?:'s| is| goes| you go)\b`,
    String.raw`(?:let's|let us) (?:continue|keep going|pick up|get (?:back|started))\b`,
    String.raw`continuing (?:the|from|where)\b`,
    String.raw`(?:great|good|excellent|interesting) (?:question|idea|choice|prompt|setup)[!.]*$`,
].map(p => re(FILLER + p));

// The line must talk about the writing itself.
const META = /\b(?:response|responses|reply|replies|scene|story|roleplay|role-play|rp|continuation|continue|continued|continuing|chapter|direction|adjust|adjustments?|changes?|tweaks?|rewrite|revise|revisions?|expand|helps|helpful|writing|narrative|plot)\b/;
// An opener may also say "part" / "next" / "post", but then it must end on ":" ("Here's the next
// part:") or follow a "Sure!": "Here is the next village." is a story line.
const OPEN_META = /\b(?:part|next|post|installment)\b/;
const RULE_LINE = /^\s*(?:[-*_=~]\s*){3,}$/;
const OOC_LINE = /^\s*[(\[]\s*ooc\s*:.*[)\]]\s*$/i;

// The words of a line as matchers read them: italics, wrapping brackets and "OOC:" out. Case is
// kept here because the sentence splitter needs it ("Sure! Here's…" is two sentences).
function cased(line) {
    return plainOf(line).replace(/^[\s([{]+|[\s)\]}]+$/g, "").replace(/^ooc\s*:\s*/i, "").trim();
}
const bare = line => cased(line).toLowerCase();

function allSentences(line, list) {
    const c = cased(line);
    if (!c || /["“”]/.test(line) || hasPlaceholder(line)) return null;
    const sents = sentencesAt(c).map(s => s.text.trim().toLowerCase());
    return sents.length > 0 && sents.every(s => list.some(r => r.test(s))) ? { b: c.toLowerCase(), sents } : null;
}
const isSignOff = line => !!allSentences(line, SIGN_OFF) && META.test(bare(line));
function isOpener(line) {
    const r = allSentences(line, OPEN);
    if (!r) return false;
    const framed = /:\s*[*_]*\s*$/.test(line) || (r.sents.length >= 2 && OPEN[0].test(r.sents[0]));
    return framed && (META.test(r.b) || OPEN_META.test(r.b));
}

const hasWords = s => /\p{L}/u.test(s);

export default {
    id: "chatbot-residue",
    name: "Chatbot sign-offs",
    description: "The assistant wrapper around a reply: \"Sure! Here's the next part:\" at the start and \"I hope this continues the scene well! Let me know if you'd like any changes.\" at the end are removed.",
    scope: "message",
    order: 8,
    // Off by default: most roleplay setups never get these; worth switching on for models that
    // still write like an assistant.
    defaults: { enabled: false, ooc: false },
    options: [{ key: "ooc", type: "checkbox", label: "Also remove (OOC: …) lines at the end of a reply" }],

    apply(text, ctx) {
        const lines = text.split("\n");
        const removed = [];
        const ooc = !!ctx.settings?.ooc;

        // The end: a run of wrapper lines, blank lines and "---" between them.
        let end = lines.length - 1;
        let cut = lines.length;
        for (let k = end; k >= 0; k--) {
            const l = lines[k];
            if (!l.trim()) continue;
            if (isSignOff(l) || (ooc && OOC_LINE.test(l))) {
                removed.push(l.trim());
                cut = k;
                continue;
            }
            if (cut < lines.length && RULE_LINE.test(l)) {
                cut = k;
                continue;
            }
            break;
        }
        let kept = lines.slice(0, cut);

        // The start: the first line, then a "---" after it.
        let from = 0;
        while (from < kept.length && !kept[from].trim()) from++;
        if (from < kept.length && isOpener(kept[from])) {
            removed.unshift(kept[from].trim());
            let k = from + 1;
            while (k < kept.length && (!kept[k].trim() || RULE_LINE.test(kept[k]))) k++;
            kept = kept.slice(k);
        }

        if (!removed.length) return text;
        const out = kept.join("\n").replace(/\s+$/, "");
        if (!hasWords(out)) {
            ctx.log?.("would leave the reply empty; left as written");
            return text;
        }
        return { text: out, hits: removed.map(r => ({ kind: "sign-off", label: "chatbot sign-off", before: r, after: "" })) };
    },
};
