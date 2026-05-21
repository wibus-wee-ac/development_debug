<!--
Input: Alma workspace renderer evidence and Cradle workspace/git/pty audit.
Output: Spec for workspace file, Git, terminal, and preview coverage.
Position: docs/specs/alma-inspired/workspace-files-git-terminal-preview.md
-->

# Workspace Files, Git, Terminal, And Preview

## Goal

Cradle should keep its workspace-first coding environment and close remaining gaps around preview servers and non-text file review.

## Alma Evidence

Alma renderer exposes workspace file tree, file content reading, binary previews, terminal sessions over WebSocket, preview server start/stop, workspace WebSocket refresh, Git operations, GitHub PR, and CI logs.

## Cradle Current State

Cradle has workspace CRUD, file tree, Git status/branch/graph/fetch, Pack Codebase, PTY WebSocket terminal sessions, TUI, and workspace detail editing. Preview server and broad binary preview are not equivalent.

## Target Ownership

`workspace` owns safe file listing and text read/write. `git` owns Git operations. `pty` owns terminal processes. A future preview owner should own preview server lifecycle. File preview belongs to `file-preview`.

## Target Behavior

- Workspace file operations stay path-safe and owner-scoped.
- Terminal sessions remain session/workspace scoped and replayable.
- Preview servers are started, stopped, and inspected through a server-owned lifecycle.
- Binary preview delegates to the file preview owner.

## API Sketch

- Existing workspace, git, and terminal APIs remain canonical.
- Future `POST /workspaces/:id/previews` starts a preview server.
- Future `GET /workspaces/:id/previews` lists active previews.

## Acceptance

- Starting a preview server records its workspace, command, port, status, and logs.
- Terminal resource cleanup runs on server shutdown.
- File preview never bypasses workspace path validation.
