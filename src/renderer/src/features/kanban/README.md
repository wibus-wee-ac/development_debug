<!-- Once this directory changes, update this README.md -->

# Features/Kanban

Linear-style issue board with drag-and-drop, inline creation, and a side-panel detail view.
Built on @dnd-kit, TanStack Query, and coss UI primitives.
All IPC calls go through `use-kanban.ts` → `ipc.kanban.*`.

## Files

- **use-kanban.ts**: TanStack Query hooks + mutations for all kanban IPC calls (boards, statuses, issues, comments, relations, delegation)
- **kanban-board-view.tsx**: Main board view — horizontally-scrollable columns grouped by status, DnD context, navigates to issue detail route on click
- **kanban-column.tsx**: Single status column with droppable zone, sortable cards, inline issue creation
- **kanban-sidebar.tsx**: Left sidebar — board list, milestones, board creation, back button
- **issue-card.tsx**: Minimal borderless issue card — priority icon, identifier, title, labels, delegate badge
- **issue-panel.tsx**: Issue detail page content (IssuePanel) + properties aside (IssueProperties) — used by kanban.$boardId.$issueId route
- **priority-icon.tsx**: Colored priority icon atom (none/low/medium/high/urgent)
- **status-icon.tsx**: Colored circle status indicator atom
