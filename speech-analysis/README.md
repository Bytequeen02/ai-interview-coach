# speech-analysis

Counts words per minute and filler words for one answer. A plain JavaScript module: no microphone, no camera, no backend calls, nothing is stored.

```js
import { analyzeSpeech } from "./speech-analysis/speechAnalyzer.js";

analyzeSpeech({ transcript: "um so I built a small project...", durationSeconds: 42 });
// { wordCount, wordsPerMinute, fillerWords: { um: 1 }, fillerTotal, fillerPerMinute, note }
```

- `durationSeconds` is how long the person was speaking. Use `0` for a typed answer.
- `wordsPerMinute` and `fillerPerMinute` are `null` when there is less than 5 seconds or fewer than 15 words.
- The result is a measurement, not a score.

## Limits
- Filler matching is approximate. `like` and `kind of` are skipped in common real uses ("I like Python", "what kind of project"), but some mistakes are still possible.
- The filler list is in `FILLER_WORDS` and `FILLER_PHRASES` at the top of `speechAnalyzer.js`.
- Pace depends on the speaking time the page gives it. It is not measured for typed answers.

## Test
```bash
node speech-analysis/test-speech.mjs
```