<!-- Once this directory changes, update this README.md -->

# Features/Kanban

Linear-style issue board with drag-and-drop, inline issue detail panel, and explicit agent control.
Built on @dnd-kit, TanStack Query, motion/react, and coss UI primitives.
All IPC calls go through `use-kanban.ts` → `ipc.kanban.*`.
Kanban UI files should track the current coss primitive API names such as `*Content` instead of legacy popup aliases.

## Files

- **use-kanban.ts**: TanStack Query hooks + mutations for all kanban IPC calls (boards, statuses, issues, comments, relations, delegation, session↔issue linking), including board-level issue search queries
- **kanban-board-view.tsx**: Main board view — columns + integrated right-slide issue detail panel (no route navigation), DnD context, status manager popover, and workspace-scoped issue search backed by `kanban.searchIssues`
- **kanban-column.tsx**: Single status column with droppable zone, sortable cards, and stable column / dropzone identifiers for E2E assertions
- **kanban-sidebar.tsx**: Left sidebar — board list, board creation / deletion actions, milestones, back button, and stable E2E anchors for board menus
- **issue-card.tsx**: Minimal issue card — priority, title, labels, animated agent presence indicator
- **issue-detail.tsx**: Sheet-style issue detail panel — inline title / description / priority editing, delete action, agent workspace, relations, context refs, unified activity timeline, and stable E2E anchors for edit / delete flows
- **issue-panel.tsx**: (Legacy) Old full-page issue detail, no longer actively used
- **create-issue-dialog.tsx**: Issue creation dialog with property chips (status, priority, milestone)
- **status-manager.tsx**: Workspace-level status management UI with create / rename / delete / drag-to-reorder flows and stable row anchors for E2E assertions
- **priority-icon.tsx**: Colored priority icon atom (none/low/medium/high/urgent)
- **status-icon.tsx**: Colored circle status indicator atom
- **priority-constants.ts**: Priority label map and sort order constants
- **issue-aside-panel.tsx**: Issue info panel for chat RightAside — shows linked issue details, status, priority, "Open in Kanban" action, and "Link issue" picker for manual association
