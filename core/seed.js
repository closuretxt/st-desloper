// Stable randomness. PURE: no SillyTavern imports.
//
// A rule that picks between replacements must pick the same one every time it sees the same
// message, or the display flickers between renders and the prompt changes every turn (which
// also breaks prompt caching). So every pick is seeded from the message text + the rule id.

// FNV-1a, 32-bit. Small and fast; collisions don't matter here (it only picks a variant).
export function hashString(str) {
    let h = 0x811c9dc5;
    const s = String(str ?? "");
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

export function seedFor(text, ruleId) {
    return hashString(`${ruleId}\u0000${text}`);
}

// mulberry32: a tiny seeded generator. Returns a function giving numbers in [0, 1).
export function makeRng(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function pick(rng, list) {
    if (!Array.isArray(list) || !list.length) return undefined;
    return list[Math.floor(rng() * list.length)];
}

// Varied picks (docs/PLAN.md 1b point 5: a replacement always varies, or it becomes the next
// stock phrase). Each message shuffles each pool with its own seed and deals from it in order,
// so repeats in one reply get different words and the same message always deals the same way.
// The deal count lives on the segment list the pipeline shares across one rule's pass over a
// message (a fresh list per pass); a rule called on its own falls back to its ctx object.
const dealt = new WeakMap();
function shuffled(list, seed) {
    const rng = makeRng(seed);
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
export function dealFrom(ctx, key, list) {
    if (!Array.isArray(list) || !list.length) return undefined;
    if (list.length === 1) return list[0];
    const segs = ctx?.segment?.segments;
    const owner = segs && typeof segs === "object" ? segs : ctx && typeof ctx === "object" ? ctx : null;
    let counts = owner ? dealt.get(owner) : null;
    if (!counts) {
        counts = new Map();
        if (owner) dealt.set(owner, counts);
    }
    const n = counts.get(key) || 0;
    counts.set(key, n + 1);
    const deck = shuffled(list, hashString(`${ctx?.seed ?? 0}|${key}|${list.join("|")}`));
    return deck[n % deck.length];
}

// "low | soft | hushed" or ["low", "soft"] -> a clean list; empty when there's nothing usable.
export function choiceList(value) {
    const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split("|") : [];
    return raw.map(x => String(x ?? "").trim()).filter(Boolean);
}
