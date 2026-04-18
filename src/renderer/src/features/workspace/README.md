<!-- Once this directory changes, update this README.md -->

# features/workspace

Workspace management UI — sidebar listing, directory picker, session grouping.
Connects to main-process IPC for workspace CRUD and native dialog.
Used in the index route sidebar area.

## Files

- **index.ts**: Barrel re-exports for the workspace feature
- **new-chat-home.tsx**: Home route composer that boots a probe ACP session so agent/model/thinking selectors are available before the first message
- **use-acp-agents.ts**: Hook for listing installed ACP agents in renderer UI
- **use-acp-session-state.ts**: Hook and helpers for reading/updating live ACP session model and config state
- **use-workspace-files.ts**: Hook for listing workspace files for composer mentions
- **use-workspace.ts**: Hooks for listing, adding (via native directory picker), and deleting workspaces
- **use-session.ts**: Hook for listing sessions under a workspace
- **workspace-sidebar.tsx**: Sidebar component with collapsible workspace groups and nested session items
