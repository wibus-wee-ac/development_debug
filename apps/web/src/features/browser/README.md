<!-- Once this directory changes, update this README.md -->

# Features/browser

Electron-only right-side panel. This feature owns renderer-side panel tabs, browser webview tab controls, workspace file tab composition, webview event synchronization, and explicit script injection actions used by browser tabs.

## Files

- **browser-panel-loader.ts**: Shared lazy loader and preload hook for the Electron browser panel, used by layout/header intent paths so the webview panel stays out of the startup graph.
- **browser-panel.tsx**: Embedded right-side panel UI with lightweight browser/workspace-file tabs, accessible tab controls, Electron `<webview>` mounting, workspace file preview/editor rendering, webview event listeners, and script injection controls.
- **index.ts**: Browser feature barrel export.
