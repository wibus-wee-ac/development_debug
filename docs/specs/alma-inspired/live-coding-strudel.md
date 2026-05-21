<!--
Input: Alma livecoding/Strudel renderer evidence and Cradle TUI/editor audit.
Output: Spec for live coding and audio coding surface.
Position: docs/specs/alma-inspired/live-coding-strudel.md
-->

# Live Coding And Strudel

## Goal

Cradle should treat live coding and Strudel-style audio coding as a distinct creative tool surface, not as a terminal replacement.

## Alma Evidence

Alma includes `livecoding.html`, `LiveCodingEditor`, `LiveCodingVisualization`, `LiveCodingHelp`, `LiveCodingConsole`, CodeMirror, `@strudel/web`, and `tone`.

## Cradle Current State

Cradle has PTY/TUI, workspace editor, chat code rendering, and diff review. It has no live coding/audio runtime.

## Target Ownership

A future `live-coding` Web feature owns editor and visualization UI. Any audio engine resources must be explicit and sandboxed. Chat runtime may generate code, but it does not own execution.

## Target Behavior

- Users can open a live coding surface from a chat artifact or workspace file.
- Code runs in a sandboxed browser/audio context.
- Users can send code back to chat or save it to workspace.
- Audio autoplay and permissions follow browser/desktop policy.

## API / UI Sketch

- Web route: `/live-coding?artifactId=...`
- Optional `POST /live-coding/sessions`
- Chat action: open selected code in live coding window.

## Data Model

Persist sessions only if users save them. Unsaved live code remains local draft state.

## Acceptance

- Running generated Strudel code cannot execute arbitrary Node or shell code.
- Closing the live coding window asks before discarding unsaved code.
- Audio output can be muted and stopped reliably.
