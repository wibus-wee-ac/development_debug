<!--
Input: Alma thread archiver evidence and Cradle session/workspace audit.
Output: Spec for thread archiving and session retention.
Position: docs/specs/alma-inspired/thread-archiver.md
-->

# Thread Archiver

## Goal

Cradle should define retention and archive semantics for sessions and workspace-linked conversation artifacts before adding backup or cleanup features.

## Alma Evidence

Alma has a thread archiver that writes archive state under workspace paths and migrates or records existing threads.

## Cradle Current State

Cradle has session CRUD, markdown export, workspace-linked sessions, and DB-backed messages. It does not expose a dedicated session archive lifecycle.

## Target Ownership

`session` owns session archive state. `workspace` may expose workspace-scoped session views but must not own message lifecycle.

## Target Behavior

- Users can archive and unarchive sessions.
- Archived sessions disappear from default active lists but remain searchable/exportable according to policy.
- Workspace deletion defines whether linked archived sessions are retained, detached, or deleted.
- Archive operations are reversible unless a separate destructive delete is requested.

## API Sketch

- `POST /sessions/:id/archive`
- `POST /sessions/:id/unarchive`
- `GET /sessions?archived=true`
- `POST /sessions/archive/bulk`

## Data Model

Add archive timestamp, actor, reason, and optional retention policy to session-owned records.

## Acceptance

- Archiving a session does not delete messages.
- Archived sessions can be exported to Markdown.
- Search can include or exclude archived sessions explicitly.
