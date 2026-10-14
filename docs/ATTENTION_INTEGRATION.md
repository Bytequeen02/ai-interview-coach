# Attention-monitoring integration contract

Ankita's computer-vision module must consume the existing camera stream; it must not call `getUserMedia()` itself.

Register an adapter once the module is ready:

```js
AttentionBridge.register({
  async start(stream, onEvent) {
    // Initialize the detector with this stream.
    // Call onEvent({ type: "face_detected" }) when appropriate.
  },
  stop() {
    // Stop detector timers/workers and release detector resources.
  }
});
```

Supported event types are `face_detected`, `face_not_detected`, `looking_away`, and `multiple_faces`. An event may also include a human-readable `message`. The UI treats unknown event types safely. The proposed event format needs agreement from Ankita before final integration.
