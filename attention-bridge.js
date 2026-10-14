/* Integration contract for Ankita's attention-monitoring module.
   Attach a detector to this shared stream; do not call getUserMedia again. */
window.AttentionBridge = (() => {
  let adapter = null;
  function register(moduleAdapter) {
    if (!moduleAdapter || typeof moduleAdapter.start !== "function") throw new Error("Attention adapter must expose start(stream, onEvent).");
    adapter = moduleAdapter;
  }
  async function start(stream, onEvent) {
    if (!adapter) return false;
    await adapter.start(stream, event => {
      if (event && typeof event.type === "string") onEvent(event);
    });
    return true;
  }
  function stop() { if (adapter && typeof adapter.stop === "function") adapter.stop(); }
  return { register, start, stop };
})();
