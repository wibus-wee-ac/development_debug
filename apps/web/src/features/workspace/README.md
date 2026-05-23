<!-- Once this directory changes, update this README.md -->

# features/workspace

Workspace management UI — sidebar listing, directory picker, session grouping.
Connects to main-process IPC for workspace CRUD, session listing, and native open actions.
Also owns the sidebar interaction contract between workspace groups and the launcher route.

## Files

- **index.ts**: Barrel re-exports for the workspace feature
- **file-tree-loader.ts**: Workspace file tree 的共享 lazy loader 与 intent preload 入口，供 right aside Files tab 使用
- **file-tree.tsx**: Right-aside workspace file tree using `@pierre/trees`, with persistent model-backed search, Git status annotations sourced from the shared Git status hook, active refresh for external file changes, context actions, Pack handoff, workspace file drag payloads for chat/TUI drops, and a first-render performance completion mark once workspace files and Git status are ready.
- **workspace-file-preview.tsx**: Embedded workspace file preview content for BrowserPanel tabs; reads text through the workspace file content API, renders Markdown with Streamdown, renders code previews with Shiki, and supports Enter/double-click editor opening.
- **workspace-file-editor.tsx**: Monaco-backed workspace file editor content for workspace-relative files, with language mapping, line numbers, folding, and read-only text loading feedback.
- **workspace-file-language.ts**: Shared workspace file language helpers mapping file names/extensions to Monaco and Shiki language ids.
- **use-workspace-file-content.ts**: Hook for reading one workspace file as text through the workspace-owned file content API.
- **workspace-sidebar.test.tsx**: Regression tests locking workspace header navigation, folder-only collapse behavior, accessible session menu triggers, long-title sidebar truncation classes, and shared session actions across button/context menus
- **use-workspace-files.ts**: Hook for listing workspace files for composer mentions, using the shared active query refresh policy.
- **use-workspace.ts**: Hooks for listing, adding (via native directory picker), and deleting workspaces; exposes list readiness for interaction-level performance gates that depend on workspace names.
- **use-session.ts**: Hook for listing sessions under a workspace
- **use-cli-agents.ts**: Transitional hook for listing CLI-TUI Agent Profiles from the unified Agent Runtime
- **workspace-sidebar.tsx**: Sidebar component whose workspace name opens the detail tab for that workspace while the folder icon controls collapse state; workspace/session menus handle rename, pin, Markdown copy, delete, and Pack Codebase dialog launch actions; the Pack Codebase launch records the dialog first-render performance start mark; the deferred Kanban sidebar records its own boards-query-backed first-render gate; session row context menus reuse the same workspace-owned action definitions as the visible menu trigger; session rows keep a complete `min-w-0` shrink chain so long titles truncate inside the app sidebar; workspace session groups expand/collapse without height animation; key navigation entries, including Search, expose stable `data-testid` anchors for E2E regression; session menu triggers remain keyboard-discoverable; unread read-only display is driven by the app-shell session-activity owner
