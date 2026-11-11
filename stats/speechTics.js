// Speech and gesture tics for the stats (docs/PLAN.md section 7, round 4). PURE: no SillyTavern imports.
//
// Counted on the reply as written, whether or not the matching fix is on, so the user can see a
// tic growing before deciding to cut it (the user: stammers are fine until the model doubles down).
// Where a fix finds the thing, the fix's own finder counts it, so the stats and the fix agree.

import { runPipeline } from "../core/pipeline.js";
import { protect, splitSegments } from "../core/segments.js";
import { mergeNames } from "../core/names.js";
import stockLines from "../rules/stockLines.js";
import hurryClosers from "../rules/hurryClosers.js";
import tsundere, { blushes } from "../rules/tsundere.js";
import bossGirl, { petNames } from "../rules/bossGirl.js";
import { stammers } from "../rules/stutterBudget.js";
import { gestures } from "../rules/gestureBudget.js";
import { loneLines } from "../rules/loneLines.js";
import { flatQuestions } from "../rules/flatQuestions.js";

// In a scene these are content, not slop: counted, never cut.
const BOSS_LINES = /\b(?:(?:such|what) a )?good (?:girl|boy)\b|\bdid i (?:say|tell you) you could\b|\beyes on me\b|\byou(?:'re| are) (?:so )?cute when you\b/gi;

function hitsOf(raw, rule, settings, names) {
    try {
        return runPipeline(raw, [rule], { names, settings: { [rule.id]: { enabled: true, ...settings } }, findNames: true }).hits;
    } catch {
        return [];
    }
}

// raw reply -> { counts, examples } (examples: the words of the first hit of each kind).
export function speechTics(raw, known = []) {
    // The chat's names plus the ones the reply shows (as the pipeline does for the fixes).
    const names = mergeNames(known, String(raw ?? ""));
    const counts = { most: 0, firsts: 0, protest: 0, hurry: 0, stutter: 0, gestures: 0, tsundere: 0, smug: 0, lone: 0, flat: 0, endsQuestion: 0 };
    const examples = {};
    const note = (key, n, text) => {
        counts[key] += n;
        if (n && text && !examples[key]) examples[key] = String(text);
    };

    for (const h of hitsOf(raw, stockLines, { off: [] }, names)) {
        const key = { "most-people": "most", firsts: "firsts", protest: "protest" }[h.kind];
        if (key) note(key, 1, h.before);
    }
    for (const h of hitsOf(raw, hurryClosers, { off: [] }, names)) note("hurry", 1, h.before);
    for (const h of hitsOf(raw, tsundere, { off: ["blush"] }, names)) note("tsundere", 1, h.before);
    for (const h of hitsOf(raw, bossGirl, { off: ["pet"] }, names)) note("smug", 1, h.before);

    const prot = protect(raw);
    const segs = prot ? splitSegments(prot.text) : [];
    segs.forEach((s, i) => {
        const t = String(s.text ?? "");
        if (s.type === "dialogue") {
            const st = stammers(t);
            note("stutter", st.length, st[0] && t.slice(st[0].start, st[0].end) + st[0].next);
            const pets = petNames(t);
            note("smug", pets.length, pets[0] && t.slice(pets[0].start, pets[0].end));
            const fq = flatQuestions(t);
            note("flat", fq.length, fq[0]?.before);
            BOSS_LINES.lastIndex = 0;
            const boss = t.match(BOSS_LINES) || [];
            note("smug", boss.length, boss[0]);
        } else {
            const g = gestures(t, names);
            note("gestures", g.length, g[0] && t.slice(g[0].start, g[0].end));
            const b = blushes(t, names);
            note("tsundere", b.length, b[0] && t.slice(b[0].start, b[0].end));
            const lone = loneLines(t, { first: i === 0, last: i === segs.length - 1 });
            note("lone", lone.length, lone[0]?.line);
        }
    });

    // The reply's last sentence is a question (closing quotes, asterisks and tags ignored).
    const end = String(raw).replace(/<[^>]*>/g, "").replace(/[\s"”’»」』*_)\]]+$/, "");
    if (/\?[!?]*$/.test(end)) note("endsQuestion", 1, end.slice(-120).split(/(?<=[.!?…])\s+/).pop());
    return { counts, examples };
}
