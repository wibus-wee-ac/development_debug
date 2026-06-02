<!-- Once this directory changes, update this README.md -->

# Features/browser

Electron-only right-side panel. This feature owns renderer-side panel tabs, browser webview tab controls, workspace file tab composition, webview event synchronization, and UserScript-like script presets used by browser tabs.

## Files

- **browser-panel-loader.ts**: Shared lazy loader and preload hook for the Electron browser panel, used by layout/header intent paths so the webview panel stays out of the startup graph.
- **browser-panel.tsx**: Embedded right-side panel UI with lightweight browser/workspace-file/workspace-diff tabs scoped to the owning Cradle tab id, selector-scoped store subscriptions, accessible tab controls, Electron `<webview>` mounting, React Activity-backed tab visibility, Chrome-like popup routing through Browser Panel tabs, workspace file preview/editor/diff rendering, webview event listeners, `window.codex.sendPrompt(...)` host message ingestion into chat prompt ingress, active-session tab source markers for browser tabs created from other chat sessions, final-inner-tab close handoff to the app shell so the whole BrowserPanel collapses, and preset/custom script controls that sync into the desktop script injection service before first navigation.
- **browser-panel.test.tsx**: Regression tests for BrowserPanel shell render boundaries around workspace diff scroll commands, cross-session browser tab source markers, stable webview refs, owner-scoped rendering, initial navigation idempotence, and `window.codex.sendPrompt(...)` forwarding into chat ingress.
- **browser-tab-scripts.ts**: Browser-owned script preset catalog for React Scan, React Grab, and Eruda, including insertion timing metadata used by the BrowserPanel toolbar and desktop IPC payloads.
- **index.ts**: Browser feature barrel export.
- **workspace-diff-viewer.tsx**: Workspace Git diff rendering surface backed by Pierre's diff viewer and worker pool; consumes owner-scoped scroll-to-file commands without making the BrowserPanel tab shell subscribe to those transient events.
