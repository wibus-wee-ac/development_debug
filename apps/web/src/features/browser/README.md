<!-- Once this directory changes, update this README.md -->

# Features/browser

Electron-only embedded browser panel. This feature owns renderer-side browser tabs, accessible tab and navigation controls, webview event synchronization, and explicit script injection actions used by the browser panel.

## Files

- **browser-panel.tsx**: Embedded browser UI with accessible tab and navigation controls, Electron `<webview>` mounting, webview event listeners, and script injection controls.
- **index.ts**: Browser feature barrel export.
