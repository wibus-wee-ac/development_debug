<!--
Input: Alma quick chat IPC evidence and Cradle tray/chat audit.
Output: Spec for Quick Chat overlay.
Position: docs/specs/alma-inspired/quick-chat-overlay.md
-->

# Quick Chat Overlay

## Goal

Cradle should offer a low-friction global chat overlay that can use current desktop context without forcing the user into the main application window.

## Alma Evidence

Alma preload exposes `quickChatWindow` with toggle, hide, expand, shortcut update, click-through, front app context, app icon, cached context, recapture context, and traverse app.

## Cradle Current State

Cradle has New Chat, tray actions, and Chronicle screen capture. It lacks a global overlay, click-through mode, and foreground app context traversal.

## Target Ownership

`apps/desktop` owns overlay window behavior and native context capture. `chat-runtime` owns message execution. A future `desktop-context` server module owns sanitized context snapshots.

## Target Behavior

- Global shortcut toggles a compact chat overlay.
- Overlay can send to a new or existing Cradle session.
- Optional context capture includes active app/window title, selected text where available, screenshot/OCR summary, and source permissions.
- Click-through mode is explicit and reversible.

## API / IPC Sketch

- `desktop.quickChat.toggle()`
- `GET /desktop/context/current`
- `POST /chat/sessions/:id/response`

## Data Model

Context snapshots should be ephemeral by default. Persist only if attached to a chat message or Chronicle memory with user-visible provenance.

## Acceptance

- Sending from quick chat creates a normal Cradle session message.
- Disabling context capture prevents foreground app traversal.
- Overlay hide/show does not lose unsent draft text.
