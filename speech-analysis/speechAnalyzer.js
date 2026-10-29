
/* =========================================================================
   speechAnalyzer.js - words per minute and filler words for one answer
 
   A plain JavaScript module. It does not open the microphone or the camera,
   it does not call the backend, and it stores nothing. It only counts words in
   text that the page already has.
 
   Usage:
     import { analyzeSpeech } from "./speech-analysis/speechAnalyzer.js";
     const metrics = analyzeSpeech({ transcript: "um so I built...", durationSeconds: 42 });
 
   The result is a measurement, not a score. The page shows it as information only.
   ========================================================================= */
 
/** Fillers that are a single word. Matching is on whole words, never inside a word. */
export const FILLER_WORDS = ["um", "uh", "er", "erm", "hmm", "like", "basically", "actually"];
 
/** Fillers made of several words. */
export const FILLER_PHRASES = ["you know", "i mean", "kind of", "sort of"];
 
/** Pace is only reported when there is enough speech to measure. */
export const MIN_SECONDS_FOR_PACE = 5;
export const MIN_WORDS_FOR_PACE = 15;
 
export const NOTE =
  "Filler word matching is approximate. Words per minute is only shown when there is enough speech to measure.";
 
// "like" is a filler in "it was, like, good" but not in "I like Python" or "would like to".
const WORDS_BEFORE_REAL_LIKE = new Set([
  "i", "you", "we", "they", "he", "she", "would", "d", "to", "do", "does", "did", "dont", "didnt",
  "doesnt", "might", "will", "also", "really", "just", "people", "who",
]);
// "kind of" / "sort of" are not fillers in "what kind of project" or "a kind of tool".
const WORDS_BEFORE_REAL_KIND = new Set([
  "what", "this", "that", "which", "any", "some", "every", "same", "a", "an", "the", "another",
  "each", "one", "different", "of", "all", "no",
]);
 
/** Lower-case words. An apostrophe inside a word is removed, so "don't" becomes "dont". */
export function tokenize(text) {
  const raw = String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  return raw.map((word) => word.replace(/['’]/g, ""));
}
 
function isFiller(tokens, i) {
  const word = tokens[i];
  if (word === "like") {
    return !WORDS_BEFORE_REAL_LIKE.has(tokens[i - 1]) && tokens[i + 1] !== "to";
  }
  return FILLER_WORDS.includes(word);
}
 
/** Counts fillers. Returns an object like { um: 2, "you know": 1 } with only the ones that were found. */
export function countFillers(tokens) {
  const found = {};
  const add = (name) => { found[name] = (found[name] || 0) + 1; };
  let i = 0;
  while (i < tokens.length) {
    const pair = `${tokens[i]} ${tokens[i + 1]}`;
    if (FILLER_PHRASES.includes(pair)) {
      const real = (pair === "kind of" || pair === "sort of") && WORDS_BEFORE_REAL_KIND.has(tokens[i - 1]);
      if (!real) add(pair);
      i += 2;
      continue;
    }
    if (isFiller(tokens, i)) add(tokens[i]);
    i += 1;
  }
  return found;
}
 
/**
 * @param {{ transcript: string, durationSeconds?: number }} input
 *   durationSeconds is how long the person was speaking. Use 0 for a typed answer.
 * @returns {{ wordCount: number, wordsPerMinute: number|null, fillerWords: Object<string, number>,
 *             fillerTotal: number, fillerPerMinute: number|null, note: string }}
 */
export function analyzeSpeech({ transcript, durationSeconds } = {}) {
  const tokens = tokenize(transcript);
  const wordCount = tokens.length;
  const fillerWords = countFillers(tokens);
  const fillerTotal = Object.values(fillerWords).reduce((sum, n) => sum + n, 0);
 
  const seconds = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const enoughSpeech = seconds >= MIN_SECONDS_FOR_PACE && wordCount >= MIN_WORDS_FOR_PACE;
  const minutes = seconds / 60;
 
  return {
    wordCount,
    wordsPerMinute: enoughSpeech ? Math.round(wordCount / minutes) : null,
    fillerWords,
    fillerTotal,
    fillerPerMinute: enoughSpeech ? Math.round((fillerTotal / minutes) * 10) / 10 : null,
    note: NOTE,
  };
}
 