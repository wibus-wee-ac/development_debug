<!-- Once this directory changes, update this README.md -->

# features/workspace

Workspace management UI — sidebar listing, directory picker, session grouping.
Connects to main-process IPC for workspace CRUD and native dialog.
Used in the index route sidebar area.

## Files

- **index.ts**: Barrel re-exports for the workspace feature
- **use-workspace.ts**: Hooks for listing, adding (via native directory picker), and deleting workspaces
- **use-session.ts**: Hook for listing sessions under a workspace
- **workspace-sidebar.tsx**: Sidebar component with collapsible workspace groups and nested session items
