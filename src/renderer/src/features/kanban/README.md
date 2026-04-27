<!-- Once this directory changes, update this README.md -->

# Features/Kanban

Linear-style issue board with drag-and-drop, inline issue detail panel, and explicit agent control.
Built on @dnd-kit, TanStack Query, motion/react, and coss UI primitives.
All IPC calls go through `use-kanban.ts` → `ipc.kanban.*`.

## Files

- **use-kanban.ts**: TanStack Query hooks + mutations for all kanban IPC calls (boards, statuses, issues, comments, relations, delegation)
- **kanban-board-view.tsx**: Main board view — columns + integrated right-slide issue detail panel (no route navigation), DnD context, status manager popover
- **kanban-column.tsx**: Single status column with droppable zone, sortable cards, selected-issue highlight
- **kanban-sidebar.tsx**: Left sidebar — board list, milestones, board creation, back button
- **issue-card.tsx**: Minimal issue card — priority, title, labels, animated agent presence indicator
- **issue-detail.tsx**: Sheet-style issue detail panel — inline properties, description, sub-issues, agent workspace, relations, context refs, unified activity timeline
- **issue-panel.tsx**: (Legacy) Old full-page issue detail, no longer actively used
- **create-issue-dialog.tsx**: Issue creation dialog with property chips (status, priority, milestone)
- **status-manager.tsx**: Workspace-level status management UI with drag-to-reorder
- **priority-icon.tsx**: Colored priority icon atom (none/low/medium/high/urgent)
- **status-icon.tsx**: Colored circle status indicator atom
- **priority-constants.ts**: Priority label map and sort order constants
