/*
  This bridge file is intended for future full imperative API parity where the
  browser engine mounts the Excalidraw React component and exposes methods over
  window for Playwright-driven calls.
*/

export function bootHostBridge(): void {
  const bridge = {
    status: "ready"
  };

  (globalThis as unknown as { __excalidrawHostBridge?: unknown }).__excalidrawHostBridge = bridge;
}
