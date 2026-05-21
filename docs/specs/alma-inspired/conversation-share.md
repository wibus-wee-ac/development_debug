<!--
Input: Alma share renderer evidence and Cradle session export audit.
Output: Spec for visual conversation sharing.
Position: docs/specs/alma-inspired/conversation-share.md
-->

# Conversation Share

## Goal

Cradle should let users turn selected conversation messages into a polished visual artifact for sharing, review, or archival.

## Alma Evidence

Alma has `share.html`, receives `share-data`, supports message selection, preview, header/timestamp toggles, zoom/pan preview, `modern-screenshot`, save PNG, and clipboard copy.

## Cradle Current State

Cradle can export session Markdown and copy message text, but lacks a visual share/export surface.

## Target Ownership

`session` owns message snapshots. `apps/web/src/features/share` owns rendering and export UI. Desktop owns save dialog and clipboard bridges where browser APIs are insufficient.

## Target Behavior

- Users can select messages from a session and generate a visual preview.
- Users can include title, timestamps, workspace/session metadata, and theme.
- Export supports PNG first; SVG/PDF can be deferred.

## API / IPC Sketch

- `GET /sessions/:id/messages`
- `desktop.saveImage(dataUrl, suggestedName)`
- `desktop.clipboard.writeImage(dataUrl)`

## Data Model

No new required persistent model. Optional share presets can live in preferences.

## Acceptance

- Exported image matches selected messages and excludes unselected messages.
- Copy and save paths report actionable errors.
- Share preview works without mutating the source session.
