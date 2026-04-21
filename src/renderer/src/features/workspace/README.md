<!-- Once this directory changes, update this README.md -->

# features/workspace

Workspace management UI — sidebar listing, directory picker, session grouping.
Connects to main-process IPC for workspace CRUD, session listing, and native open actions.
Also owns the sidebar interaction contract between workspace groups and the launcher route.

## Files

- **index.ts**: Barrel re-exports for the workspace feature
- **workspace-sidebar.test.tsx**: Regression tests locking workspace header navigation and folder-only collapse behavior
- **use-workspace-files.ts**: Hook for listing workspace files for composer mentions
- **use-workspace.ts**: Hooks for listing, adding (via native directory picker), and deleting workspaces
- **use-session.ts**: Hook for listing sessions under a workspace
- **use-cli-agents.ts**: Hook for listing configured CLI agents exposed from the main process
- **workspace-sidebar.tsx**: Sidebar component whose workspace name opens the launcher for that workspace while the folder icon controls collapse state
