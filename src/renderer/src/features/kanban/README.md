<!-- Once this directory changes, update this README.md -->

# Features/Kanban

Full GitHub-Projects-style Kanban system scoped to workspaces.
Boards are filtered views; columns represent issue statuses defined per-workspace.
Uses @dnd-kit for drag-and-drop and TanStack Query for all data access.

## Files

- **use-kanban.ts**: All TanStack Query hooks and mutations for boards, statuses, milestones, issues, comments, and relations
- **kanban-sidebar.tsx**: Left sidebar listing boards grouped by workspace with create/delete; used in all /kanban/* routes
- **board-list.tsx**: (Legacy) standalone board list page — superseded by kanban-sidebar
- **kanban-board-view.tsx**: Main board layout with DnD context, status columns, and issue panel overlay
- **kanban-column.tsx**: Single status column with droppable zone, issue cards, and inline add-issue form
- **issue-card.tsx**: Draggable issue card with priority badge, labels, and milestone
- **issue-panel.tsx**: Sliding right-side detail panel: edit title, status, priority, milestone, labels, sub-issues, comments, relations
- **status-manager.tsx**: Workspace-level status management UI (add/rename/reorder/delete); embedded as sidebar in board view
