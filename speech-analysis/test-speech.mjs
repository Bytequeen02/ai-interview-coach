// Tests for speechAnalyzer.js. No browser, microphone or network is needed.
// Run from the project root:  node speech-analysis/test-speech.mjs
import assert from "node:assert/strict";
import { analyzeSpeech, countFillers, tokenize, NOTE } from "./speechAnalyzer.js";

const words = (n) => Array(n).fill("word").join(" ");

// ---- tokenizing
assert.deepEqual(tokenize("Hello, World! It's 2026."), ["hello", "world", "its", "2026"]);
assert.deepEqual(tokenize(""), []);
assert.deepEqual(tokenize(null), []);
assert.deepEqual(tokenize(undefined), []);

// ---- empty and odd input never crash
for (const input of [undefined, {}, { transcript: "" }, { transcript: null }, { transcript: 42 }]) {
  const r = analyzeSpeech(input);
  assert.equal(r.fillerTotal, 0);
  assert.equal(r.wordsPerMinute, null);
  assert.equal(r.fillerPerMinute, null);
  assert.equal(r.note, NOTE);
}
assert.equal(analyzeSpeech({ transcript: "" }).wordCount, 0);

// ---- words per minute
let r = analyzeSpeech({ transcript: words(100), durationSeconds: 60 });
assert.equal(r.wordCount, 100);
assert.equal(r.wordsPerMinute, 100);
r = analyzeSpeech({ transcript: words(30), durationSeconds: 20 });
assert.equal(r.wordsPerMinute, 90);

// ---- not enough speech: pace is null, words are still counted
r = analyzeSpeech({ transcript: words(40), durationSeconds: 3 });
assert.equal(r.wordsPerMinute, null);                 // under 5 seconds
r = analyzeSpeech({ transcript: words(10), durationSeconds: 30 });
assert.equal(r.wordsPerMinute, null);                 // under 15 words
assert.equal(r.wordCount, 10);
for (const duration of [0, -5, NaN, undefined, "30"]) {
  assert.equal(analyzeSpeech({ transcript: words(40), durationSeconds: duration }).wordsPerMinute, null);
}

// ---- fillers: single words, case-insensitive
r = analyzeSpeech({ transcript: "Um, I built it. UM, and uh, basically it works. Actually, hmm." });
assert.deepEqual(r.fillerWords, { um: 2, uh: 1, basically: 1, actually: 1, hmm: 1 });
assert.equal(r.fillerTotal, 6);

// ---- fillers are whole words only
r = analyzeSpeech({ transcript: "The umbrella, the humming, a hummus plate, and the serum were fine." });
assert.equal(r.fillerTotal, 0);

// ---- phrases
r = analyzeSpeech({ transcript: "So, you know, I mean, it was kind of hard, sort of." });
assert.deepEqual(r.fillerWords, { "you know": 1, "i mean": 1, "kind of": 1, "sort of": 1 });

// ---- real uses of 'like' and 'kind of' are not counted
r = analyzeSpeech({ transcript: "I like Python and I would like to learn more. What kind of project is it? A kind of tool." });
assert.equal(r.fillerTotal, 0);
// ...but a filler 'like' is
r = analyzeSpeech({ transcript: "It was, like, really fast and, like, simple." });
assert.deepEqual(r.fillerWords, { like: 2 });

// ---- only fillers
r = analyzeSpeech({ transcript: "um uh um er", durationSeconds: 10 });
assert.deepEqual(r.fillerWords, { um: 2, uh: 1, er: 1 });
assert.equal(r.wordsPerMinute, null);                 // 4 words is too little to measure pace

// ---- filler rate
r = analyzeSpeech({ transcript: "um " + words(59), durationSeconds: 60 });
assert.equal(r.wordCount, 60);
assert.equal(r.fillerTotal, 1);
assert.equal(r.fillerPerMinute, 1);

// ---- typed answers (duration 0): words and fillers yes, pace no
r = analyzeSpeech({ transcript: "Um, " + words(50), durationSeconds: 0 });
assert.equal(r.wordsPerMinute, null);
assert.equal(r.fillerTotal, 1);

// ---- the result has exactly the documented fields, and only found fillers are listed
r = analyzeSpeech({ transcript: "hello there", durationSeconds: 60 });
assert.deepEqual(Object.keys(r).sort(), ["fillerPerMinute", "fillerTotal", "fillerWords", "note", "wordCount", "wordsPerMinute"]);
assert.deepEqual(r.fillerWords, {});

// ---- countFillers works on tokens directly
assert.deepEqual(countFillers(["um", "um"]), { um: 2 });

console.log("speech analyzer tests passed");
