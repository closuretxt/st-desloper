// The rule registry: one import line per built-in rule. PURE: no SillyTavern imports.
// Adding a fix = one file in rules/, one line here, one fixture file in .tests/fixtures/.

import echoTrim from "./echoTrim.js";
import innerRepeat from "./innerRepeat.js";
import dashBudget from "./dashBudget.js";
import negationFlip from "./negationFlip.js";
import contrastFrame from "./contrastFrame.js";
import phraseLexicon from "./phraseLexicon.js";
import tagQuestions from "./tagQuestions.js";
import tsk from "./tsk.js";
import timeTails from "./timeTails.js";
import stockLines from "./stockLines.js";
import stagedQuestions from "./stagedQuestions.js";
import threeInARow from "./threeInARow.js";
import hurryClosers from "./hurryClosers.js";
import stockPunchlines from "./stockPunchlines.js";
import tsundere from "./tsundere.js";
import bossGirl from "./bossGirl.js";
import stutterBudget from "./stutterBudget.js";
import gestureBudget from "./gestureBudget.js";
import wornImages from "./wornImages.js";
import loneLines from "./loneLines.js";
import adverbFragments from "./adverbFragments.js";
import flatQuestions from "./flatQuestions.js";
import flippedEndings from "./flippedEndings.js";
import leakedText from "./leakedText.js";
import chatbotResidue from "./chatbotResidue.js";
import textFixes from "./textFixes.js";
import contractions from "./contractions.js";
import { patternRules } from "./patternRules.js";

// This order is the order of the drawer's chips and the fixes popup (not the run order: that's
// each rule's `order`). By priority: the fixes that catch the most slop first, then the
// character filters, the off-by-default budgets, and the mechanical clean-ups last.
export const BUILTIN_RULES = [
    negationFlip, contrastFrame, phraseLexicon, stockLines, stagedQuestions, threeInARow, echoTrim, innerRepeat,
    wornImages, hurryClosers, stockPunchlines, tagQuestions, tsk, timeTails, adverbFragments, dashBudget,
    tsundere, bossGirl,
    stutterBudget, gestureBudget, loneLines, flippedEndings, flatQuestions,
    textFixes, contractions, leakedText, chatbotResidue,
];

// Built-ins plus the user's own patterns, for one run of the pipeline.
export function allRules(settings) {
    return [...BUILTIN_RULES, ...patternRules(settings?.patterns)];
}
