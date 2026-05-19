<!-- Once this directory changes, update this README.md -->

# features/workspace

Workspace management UI — sidebar listing, directory picker, session grouping.
Connects to main-process IPC for workspace CRUD, session listing, and native open actions.
Also owns the sidebar interaction contract between workspace groups and the launcher route.

## Files

- **index.ts**: Barrel re-exports for the workspace feature
- **workspace-sidebar.test.tsx**: Regression tests locking workspace header navigation, folder-only collapse behavior, and accessible session menu triggers
- **use-workspace-files.ts**: Hook for listing workspace files for composer mentions
- **use-workspace.ts**: Hooks for listing, adding (via native directory picker), and deleting workspaces
- **use-session.ts**: Hook for listing sessions under a workspace
- **use-cli-agents.ts**: Transitional hook for listing CLI-TUI Agent Profiles from the unified Agent Runtime
- **workspace-sidebar.tsx**: Sidebar component whose workspace name opens the detail tab for that workspace while the folder icon controls collapse state and the workspace / session menus handle重命名、pin、Markdown copy、删除等动作；会话行与关键导航入口（如 `nav-new-chat`、`nav-kanban`、`nav-usage`）暴露稳定的 `data-testid` 锚点供 E2E 回归使用，session menu triggers remain keyboard-discoverable, and unread 只读展示由 app-shell session-activity owner 驱动
