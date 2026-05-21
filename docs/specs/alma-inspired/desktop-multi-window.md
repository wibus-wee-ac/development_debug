<!--
Input: Alma renderer entrypoints and Cradle desktop shell audit.
Output: Spec for desktop multi-window product surfaces.
Position: docs/specs/alma-inspired/desktop-multi-window.md
-->

# Desktop Multi-Window Surfaces

## Goal

Cradle should support intentional, owner-scoped desktop windows for product surfaces that do not fit naturally inside the main tab shell: notifications, quick chat, media lightbox, prompt app runner, share preview, tray popover, devtool, and detached sessions.

## Alma Evidence

Alma packages separate renderer entries for `index.html`, `settings.html`, `notifications.html`, `lightbox.html`, `prompt-app-runner.html`, `livecoding.html`, `gallery.html`, and `share.html`. Its preload exposes window-specific bridges such as `settingsWindow`, `promptAppRunner`, `galleryWindow`, `lightboxWindow`, `liveCodingWindow`, and `quickChatWindow`.

## Cradle Current State

Cradle Desktop has one main renderer, a tray popover, a devtool window, and detached session windows. It does not have dedicated media, share, prompt runner, live coding, or quick chat renderer entries.

## Target Ownership

`apps/desktop` owns BrowserWindow lifecycle, routing, display placement, focus policy, and preload boundaries. Each product feature owns its own UI and state under `apps/web/src/features/*`. Desktop must not own feature semantics.

## Target Behavior

- A desktop window registry defines stable window kinds and their feature-owned routes.
- Each window kind declares focus, transparency, resizable, always-on-top, click-through, and display placement policy.
- Feature state flows through server APIs or typed IPC, not through global mutable renderer state.
- Detached windows can navigate back to the canonical session, workspace, or asset in the main shell.

## API / IPC Sketch

- `desktop.windows.open(kind, payload)`
- `desktop.windows.close(kind, id)`
- `desktop.windows.focus(kind, id)`
- `desktop.windows.list()`

## Data Model

Persist only user preferences such as bounds, last display, and last-used window mode. Product data remains in the feature owner namespace.

## Acceptance

- Opening a lightbox or prompt runner does not duplicate canonical session state.
- Closing a secondary window never destroys session, workspace, or asset data.
- Window bounds recover across restarts and stay visible after display changes.
