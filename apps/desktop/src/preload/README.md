# Desktop Preload

This directory owns the sandboxed Electron preload bridge exposed to renderer windows as `window.cradle`.

## Files

- `index.ts`: Exposes server URL/environment metadata, typed invoke/listener wrappers, window controls, desktop update events, desktop app badge updates, tray action events, desktop-owned chat stream IPC methods plus chunk/close/error event subscriptions, and the native BrowserPanel bridge backed by Electron `WebContentsView`.
- `browser-panel.ts`: Sandboxed guest-page preload for native BrowserPanel tabs. Exposes `window.codex.sendPrompt(...)` and forwards normalized prompt/attachment payloads to the desktop BrowserPanel runtime.
