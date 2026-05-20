<!-- Once this directory changes, update this README.md -->

# features/workspace

Workspace management UI — sidebar listing, directory picker, session grouping.
Connects to main-process IPC for workspace CRUD, session listing, and native open actions.
Also owns the sidebar interaction contract between workspace groups and the launcher route.

## Files

- **index.ts**: Barrel re-exports for the workspace feature
- **file-tree.tsx**: Right-aside workspace file tree using `@pierre/trees`, with persistent model-backed search, Git status annotations, context actions, Pack handoff, and workspace file drag payloads for chat/TUI drops.
- **workspace-sidebar.test.tsx**: Regression tests locking workspace header navigation, folder-only collapse behavior, accessible session menu triggers, long-title sidebar truncation classes, and shared session actions across button/context menus
- **use-workspace-files.ts**: Hook for listing workspace files for composer mentions
- **use-workspace.ts**: Hooks for listing, adding (via native directory picker), and deleting workspaces
- **use-session.ts**: Hook for listing sessions under a workspace
- **use-cli-agents.ts**: Transitional hook for listing CLI-TUI Agent Profiles from the unified Agent Runtime
- **workspace-sidebar.tsx**: Sidebar component whose workspace name opens the detail tab for that workspace while the folder icon controls collapse state; workspace/session menus handle rename, pin, Markdown copy, and delete actions; session row context menus reuse the same workspace-owned action definitions as the visible menu trigger; session rows keep a complete `min-w-0` shrink chain so long titles truncate inside the app sidebar; key navigation entries expose stable `data-testid` anchors for E2E regression; session menu triggers remain keyboard-discoverable; unread read-only display is driven by the app-shell session-activity owner
