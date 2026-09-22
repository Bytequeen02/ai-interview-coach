/* ============================================================
   speech.js — Voice interaction utilities (Phase 1: Voice Foundation)

   Two independent, reusable utilities exposed on `window.VoiceUtils`:
     1. Text-to-Speech  — speak(), stopSpeaking(), replayQuestion()
     2. Speech-to-Text  — startListening(), stopListening()

   NOT wired into the existing interview flow yet — that happens in
   Phase 2 (question voice) and Phase 3/4 (answer voice input).

   Design note: every function here is called with plain arguments and
   callback objects ({ onStart, onEnd, onError, ... }), not tied to
   any specific provider. Later, speak()/startListening() can be
   reimplemented internally to call a cloud TTS/STT API instead of the
   browser's built-in ones, without changing how the rest of the app
   calls them.
   ============================================================ */

const VoiceUtils = (() => {
  /* ------------------------- Text-to-Speech ------------------------- */

  const ttsState = {
    supported: "speechSynthesis" in window,
    speaking: false,
    lastText: "",
  };

  function isTTSSupported() {
    return ttsState.supported;
  }

  function isSpeaking() {
    return ttsState.speaking;
  }

  /**
   * Speak `text` aloud.
   * callbacks: { onStart, onEnd, onError }
   */
  function speak(text, { onStart, onEnd, onError } = {}) {
    if (!ttsState.supported) {
      if (onError) onError(new Error("Text-to-speech is not supported in this browser."));
      return;
    }
    if (!text || !text.trim()) {
      if (onError) onError(new Error("Nothing to speak — empty text."));
      return;
    }

    // Avoid overlapping speech: cancel anything already speaking/queued first.
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.lang = "en-US";

    utterance.onstart = () => {
      ttsState.speaking = true;
      if (onStart) onStart();
    };
    utterance.onend = () => {
      ttsState.speaking = false;
      if (onEnd) onEnd();
    };
    utterance.onerror = (event) => {
      ttsState.speaking = false;
      if (onError) onError(event);
    };

    ttsState.lastText = text;
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (ttsState.supported) {
      window.speechSynthesis.cancel();
    }
    ttsState.speaking = false;
  }

  /** Re-speak whatever was last passed to speak(). */
  function replayQuestion(callbacks) {
    if (ttsState.lastText) {
      speak(ttsState.lastText, callbacks);
    }
  }

  /* ------------------------- Speech-to-Text ------------------------- */

  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

  const sttState = {
    supported: !!SpeechRecognitionClass,
    listening: false,
    recognition: null,
    finalTranscript: "",
  };

  function isSTTSupported() {
    return sttState.supported;
  }

  function isListening() {
    return sttState.listening;
  }

  function getTranscript() {
    return sttState.finalTranscript.trim();
  }

  /**
   * Start listening for speech.
   * callbacks: { onStart, onInterim(text), onFinal(text), onEnd(fullTranscript), onError }
   */
  function startListening({ onStart, onInterim, onFinal, onEnd, onError } = {}) {
    if (!sttState.supported) {
      if (onError) {
        onError(new Error("Voice input is not supported in this browser. Please use Chrome/Edge or type your answer manually."));
      }
      return;
    }
    if (sttState.listening) return; // already listening — ignore duplicate start

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    sttState.finalTranscript = "";

    recognition.onstart = () => {
      sttState.listening = true;
      if (onStart) onStart();
    };

    recognition.onresult = (event) => {
      let interim = "";
      let final = sttState.finalTranscript;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += piece + " ";
        } else {
          interim += piece;
        }
      }
      sttState.finalTranscript = final;
      if (onInterim) onInterim(interim);
      if (onFinal) onFinal(final.trim());
    };

    recognition.onerror = (event) => {
      sttState.listening = false;
      // "no-speech" fires often on silence — treat it as a soft error, not a hard failure.
      if (onError) onError(event);
    };

    recognition.onend = () => {
      sttState.listening = false;
      if (onEnd) onEnd(sttState.finalTranscript.trim());
    };

    sttState.recognition = recognition;

    try {
      recognition.start();
    } catch (err) {
      // start() throws if called while already running, or on some permission edge cases.
      sttState.listening = false;
      if (onError) onError(err);
    }
  }

  function stopListening() {
    if (sttState.recognition && sttState.listening) {
      sttState.recognition.stop();
    }
  }

  /* ------------------------- Public API ------------------------- */

  return {
    // Text-to-Speech
    isTTSSupported,
    isSpeaking,
    speak,
    stopSpeaking,
    replayQuestion,
    // Speech-to-Text
    isSTTSupported,
    isListening,
    getTranscript,
    startListening,
    stopListening,
  };
})();

// Loaded as a plain <script> (no bundler/modules), so expose globally
// for app.js and voice-test.html to use.
window.VoiceUtils = VoiceUtils;
