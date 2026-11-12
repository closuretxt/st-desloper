// Word data. DATA only, no logic, no imports. A miss in a fixture = one line here.

export const SUBJECT_PRONOUNS = ["she", "he", "they", "it", "i", "you", "we"];
export const POSSESSIVE_OF = { she: "her", he: "his", they: "their", it: "its", i: "my", you: "your", we: "our" };
export const POSSESSIVES = ["her", "his", "their", "its", "my", "your", "our"];
export const DETERMINERS = ["the", "a", "an", "this", "that", "these", "those"];

// Verbs that only mean "said". When the quote they introduce is removed, they go with it
// ("Tsk," she mutters. -> removed). Sound and face verbs (sigh, laugh, scoff, sneer, hum...) are
// NOT here on purpose: they carry meaning of their own, so "Tsk," she sighs. -> She sighs.
export const SPEECH_VERBS = [
    "say", "ask", "mutter", "murmur", "whisper", "mumble", "reply", "add", "answer", "respond",
    "continue", "remark", "note", "state", "declare", "announce", "explain", "tell", "speak",
    "call", "shout", "yell", "exclaim", "snap", "retort", "counter", "insist", "demand", "protest",
    "quip", "drawl", "tease", "offer", "admit", "suggest", "agree", "concede", "warn", "joke",
    "interrupt", "repeat", "finish", "begin", "prompt", "urge", "plead", "beg", "blurt", "stammer",
    "stutter", "rasp", "croak", "coax", "chide", "scold", "mock", "taunt", "muse", "whine", "cry",
    "breathe", "inquire", "query", "instruct", "order", "command", "assure", "promise", "confirm",
    "echo", "parrot",
];

export const IRREGULAR_PAST = {
    arise: "arose", awake: "awoke", bear: "bore", beat: "beat", become: "became", begin: "began",
    bend: "bent", bet: "bet", bind: "bound", bite: "bit", bleed: "bled", blow: "blew", break: "broke",
    breed: "bred", bring: "brought", build: "built", burst: "burst", buy: "bought", cast: "cast",
    catch: "caught", choose: "chose", cling: "clung", come: "came", cost: "cost", creep: "crept",
    cut: "cut", deal: "dealt", dig: "dug", do: "did", draw: "drew", drink: "drank", drive: "drove",
    eat: "ate", fall: "fell", feed: "fed", feel: "felt", fight: "fought", find: "found", flee: "fled",
    fling: "flung", fly: "flew", forbid: "forbade", forget: "forgot", forgive: "forgave",
    freeze: "froze", get: "got", give: "gave", go: "went", grind: "ground", grow: "grew",
    hang: "hung", have: "had", hear: "heard", hide: "hid", hit: "hit", hold: "held", hurt: "hurt",
    keep: "kept", kneel: "knelt", know: "knew", lay: "laid", lead: "led", leave: "left", lend: "lent",
    let: "let", lie: "lay", light: "lit", lose: "lost", make: "made", mean: "meant", meet: "met",
    overcome: "overcame", pay: "paid", put: "put", quit: "quit", read: "read", ride: "rode",
    ring: "rang", rise: "rose", run: "ran", say: "said", see: "saw", seek: "sought", sell: "sold",
    send: "sent", set: "set", shake: "shook", shine: "shone", shoot: "shot", shrink: "shrank",
    shut: "shut", sing: "sang", sink: "sank", sit: "sat", sleep: "slept", slide: "slid",
    sling: "slung", slink: "slunk", speak: "spoke", spend: "spent", spin: "spun", spit: "spat",
    split: "split", spread: "spread", spring: "sprang", stand: "stood", steal: "stole",
    stick: "stuck", sting: "stung", stride: "strode", strike: "struck", string: "strung",
    strive: "strove", swear: "swore", sweep: "swept", swim: "swam", swing: "swung", take: "took",
    teach: "taught", tear: "tore", tell: "told", think: "thought", throw: "threw", thrust: "thrust",
    tread: "trod", understand: "understood", undo: "undid", upset: "upset", wake: "woke",
    wear: "wore", weave: "wove", weep: "wept", win: "won", wind: "wound", withdraw: "withdrew",
    withhold: "withheld", wring: "wrung", write: "wrote",
};

// Verbs that double their last consonant in the past even though they have two syllables.
export const DOUBLE_ON_PAST = new Set([
    "admit", "commit", "omit", "permit", "submit", "emit", "transmit", "regret", "refer", "prefer",
    "confer", "defer", "infer", "deter", "occur", "recur", "incur", "concur", "compel", "control",
    "patrol", "rebel", "propel", "expel", "repel", "dispel", "excel", "equip", "forbid", "abhor",
    "acquit", "allot", "extol",
]);

// -ing words whose base the spelling rules in lang/conjugate.js get wrong.
export const ING_TO_BASE = {
    breathing: "breathe", soothing: "soothe", seething: "seethe", bathing: "bathe",
    loathing: "loathe", writhing: "writhe", sheathing: "sheathe", unsheathing: "unsheathe",
    teething: "teethe",
    lying: "lie", dying: "die", tying: "tie", untying: "untie", vying: "vie", eyeing: "eye",
    eying: "eye", being: "be", owing: "owe",
    adding: "add", purring: "purr", erring: "err", ebbing: "ebb", egging: "egg",
    travelling: "travel", controlling: "control", patrolling: "patrol", compelling: "compel",
    propelling: "propel", expelling: "expel", repelling: "repel", dispelling: "dispel",
    rebelling: "rebel", excelling: "excel", cancelling: "cancel", labelling: "label",
    modelling: "model", levelling: "level", signalling: "signal", fuelling: "fuel",
    quarrelling: "quarrel", marvelling: "marvel", channelling: "channel", tunnelling: "tunnel",
    shovelling: "shovel", swivelling: "swivel", unravelling: "unravel", totalling: "total",
    counselling: "counsel", pummelling: "pummel", yodelling: "yodel",
    panicking: "panic", mimicking: "mimic", picnicking: "picnic", trafficking: "traffic",
    frolicking: "frolic",
    changing: "change", exchanging: "exchange", plunging: "plunge", lunging: "lunge",
    arranging: "arrange", challenging: "challenge", cringing: "cringe", ranging: "range",
    sponging: "sponge", lounging: "lounge", scrounging: "scrounge", avenging: "avenge",
    hinging: "hinge", binging: "binge", impinging: "impinge", infringing: "infringe",
    singeing: "singe", scavenging: "scavenge",
    tasting: "taste", wasting: "waste", pasting: "paste", basting: "baste",
    becoming: "become", welcoming: "welcome", overcoming: "overcome",
    escaping: "escape", deciding: "decide", provoking: "provoke", completing: "complete",
    exciting: "excite", inviting: "invite", ignoring: "ignore", exploring: "explore",
    adoring: "adore", restoring: "restore", admiring: "admire", inhaling: "inhale",
    exhaling: "exhale", erasing: "erase", behaving: "behave", retiring: "retire",
    inquiring: "inquire", requiring: "require", aspiring: "aspire", inspiring: "inspire",
    conspiring: "conspire", desiring: "desire", acquiring: "acquire", expiring: "expire",
    refusing: "refuse", confusing: "confuse", amusing: "amuse", accusing: "accuse",
    composing: "compose", proposing: "propose", opposing: "oppose", supposing: "suppose",
    exposing: "expose", describing: "describe", conjuring: "conjure", assuring: "assure",
    ensuring: "ensure", enduring: "endure", securing: "secure", maturing: "mature",
    procuring: "procure", obscuring: "obscure", alluring: "allure", including: "include",
    concluding: "conclude", excluding: "exclude", deluding: "delude", colliding: "collide",
    residing: "reside", presiding: "preside", confiding: "confide", providing: "provide",
    dividing: "divide", abiding: "abide", subsiding: "subside", invading: "invade",
    persuading: "persuade", evading: "evade", cascading: "cascade", parading: "parade",
    consoling: "console", cajoling: "cajole", compiling: "compile", beguiling: "beguile",
    reconciling: "reconcile", revoking: "revoke", invoking: "invoke", evoking: "evoke",
    polluting: "pollute", saluting: "salute", disputing: "dispute", computing: "compute",
    refuting: "refute", diluting: "dilute", executing: "execute", reciting: "recite",
    igniting: "ignite", uniting: "unite", convening: "convene", intervening: "intervene",
    competing: "compete", deleting: "delete", depleting: "deplete", conceding: "concede",
    preceding: "precede", receding: "recede", impeding: "impede", declining: "decline",
    reclining: "recline", combining: "combine", defining: "define", refining: "refine",
    confining: "confine", entwining: "entwine", intertwining: "intertwine",
    undermining: "undermine", determining: "determine", examining: "examine",
    imagining: "imagine", awaking: "awake", arising: "arise", surprising: "surprise",
    despising: "despise", advising: "advise", revising: "revise", devising: "devise",
    improvising: "improvise", chastising: "chastise", amazing: "amaze", resuming: "resume",
    assuming: "assume", consuming: "consume", presuming: "presume", engaging: "engage",
    obliging: "oblige", managing: "manage", damaging: "damage", ravaging: "ravage",
    encouraging: "encourage", discouraging: "discourage", foraging: "forage",
    salvaging: "salvage", massaging: "massage", exploding: "explode", eroding: "erode",
};

// ---- Negated actions (rules/negationFlip.js, docs/PLAN.md section 5) ----------------------

// "She doesn't know what to say" is a thought, not the tic: never rewritten.
export const COGNITIVE_VERBS = new Set([
    "know", "understand", "notice", "realize", "realise", "remember", "mind", "care", "need", "want",
    "think", "believe", "expect", "seem", "like", "recognize", "recognise", "bother", "have", "mean",
    "matter", "dare", "wish", "intend",
    // "It doesn't register" / "doesn't process what he said": a thought, not an action.
    "register", "process", "comprehend", "grasp",
]);

// Lone negations flipped into what actually happens, only when the phrase is the whole sentence.
// "negated = flipped", the flipped side in the base form (its first word gets the tense);
// {pos} = her / his / their... from the subject. Each entry must read right in present and past.
// Each flip has 3+ choices separated by | (PLAN 1b point 5: one fixed flip becomes the next tic).
export const FLIP_TABLE = [
    "let go = hold on | keep hold | hold tight",
    "move = stay still | keep still | stay put",
    "look away = keep looking | hold {pos} gaze | keep watching",
    "pull away = stay close | stay put | stay near",
    "stop = keep going | carry on | press on",
    "flinch = hold steady | stay steady | keep still",
    "step back = hold {pos} ground | stand firm | stay put",
    "answer = stay quiet | stay silent | say nothing",
    "reply = stay quiet | stay silent | say nothing",
];

// Other wordings of a flip-table phrase, so one table line covers the family instead of a line
// per variant: "She doesn't move away." is "She doesn't pull away.". Looked up after the
// lone-negation phrase loses its "try to" and "from him" (rules/negationFlip.js `loneKey`).
export const LONE_SAME = {
    "move away": "pull away", "back away": "pull away", "draw away": "pull away", "draw back": "pull away",
    "pull back": "pull away", "shift away": "pull away", "step away": "pull away", "lean away": "pull away",
    "shrink away": "pull away", "shrink back": "pull away", "jerk away": "pull away", "jerk back": "pull away",
    "edge away": "pull away", "inch away": "pull away", "recoil": "pull away", "withdraw": "pull away",
    "flinch away": "flinch", "flinch back": "flinch",
    "budge": "move", "stir": "move", "move an inch": "move", "move a muscle": "move",
    "break eye contact": "look away", "glance away": "look away", "turn away": "look away", "avert {pos} eyes": "look away", "avert {pos} gaze": "look away",
    "release {obj}": "let go", "let {obj} go": "let go", "loosen {pos} grip": "let go",
    "back down": "step back", "retreat": "step back",
    "fight it": "resist", "fight {obj}": "resist", "push {obj} away": "resist", "struggle": "resist",
    "argue": "protest","pull {pos} hand away": "pull away", "pull {pos} hand back": "pull away",
};

// Verbs that carry no meaning on their own when negated alone ("She doesn't hesitate."): the
// sentence is deleted.
export const DELETE_VERBS = ["hesitate", "protest", "object", "resist", "shy away"];

// Words ending in -ing that aren't verbs (or are base verbs, like "bring").
export const NOT_PARTICIPLES = new Set([
    "thing", "nothing", "something", "anything", "everything", "morning", "evening", "ceiling",
    "sibling", "darling", "king", "ring", "wing", "sing", "sting", "swing", "spring", "string",
    "bring", "cling", "fling", "sling", "wring", "during", "offspring", "pudding", "wedding",
    "earring", "lightning", "inkling", "duckling", "seedling", "starling", "sterling", "shilling",
    "viking", "awning", "herring", "stocking", "dumpling", "ping", "ding", "clothing", "building",
]);
