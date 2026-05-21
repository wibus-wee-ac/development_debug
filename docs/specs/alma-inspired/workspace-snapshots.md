<!--
Input: Alma snapshot preload evidence and Cradle workspace/git audit.
Output: Spec for workspace snapshots and rollback.
Position: docs/specs/alma-inspired/workspace-snapshots.md
-->

# Workspace Snapshots

## Goal

Cradle should provide Git-independent workspace snapshots for agent edits, temporary files, and recovery workflows.

## Alma Evidence

Alma preload exposes `snapshot.create`, `snapshotFile`, `list`, `get`, `diff`, `rollback`, `rollbackFile`, and `cleanup`.

## Cradle Current State

Cradle has Git status/diff and chat message snapshots. It does not have a workspace-owned snapshot/diff/rollback subsystem for arbitrary files.

## Target Ownership

A future `workspace-snapshots` module owns snapshot metadata and file copies. `workspace` owns path validation. `git` remains separate and should not be required.

## Target Behavior

- Users or agents can create snapshots before risky operations.
- Snapshots can cover a whole workspace or selected files.
- Users can view diffs and rollback all or selected files.
- Cleanup policy limits disk growth.

## API Sketch

- `POST /workspaces/:id/snapshots`
- `POST /workspaces/:id/snapshots/file`
- `GET /workspaces/:id/snapshots`
- `GET /workspaces/:id/snapshots/:snapshotId/diff`
- `POST /workspaces/:id/snapshots/:snapshotId/rollback`
- `POST /workspaces/:id/snapshots/cleanup`

## Data Model

Tables should include `workspace_snapshots`, `workspace_snapshot_files`, and cleanup audit rows. Snapshot file storage belongs under Cradle workspace data, not under the source project unless explicitly configured.

## Acceptance

- A rollback restores file bytes and reports conflicts if files changed since snapshot.
- Snapshot cleanup never removes the latest protected snapshot.
- Snapshot creation respects ignored paths and size limits.
