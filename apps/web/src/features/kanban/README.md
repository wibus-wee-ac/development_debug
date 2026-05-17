<!--
Output: Kanban feature inventory and ownership notes.
Input: Issue board, list, detail, and agent delegation UI components.
Position: apps/web/src/features/kanban feature guide.
-->

# Kanban

Kanban owns issue board/list/detail UI, issue metadata editing, and issue-agent delegation controls.

## Files

- **create-issue-dialog.tsx**: Floating create-issue panel with status and priority metadata controls.
- **index.tsx**: Kanban feature entrypoint and page composition; board view owns status move wiring while list view remains read/select/create focused.
- **issue-aside-panel.tsx**: Side panel shell for issue detail surfaces.
- **issue-detail/**: Issue detail subviews, including properties, activity, relations, sub-issues, and agent session controls.
- **kanban-board.tsx**: Board layout and drag/drop composition.
- **kanban-card.tsx**: Board card rendering for individual issues.
- **kanban-column.tsx**: Board column rendering and drop targets.
- **kanban-group-header.tsx**: Group header rendering for board/list views.
- **kanban-list.tsx**: List-view composition for issues.
- **kanban-list-row.tsx**: Compact list row for individual issues.
- **kanban-sidebar.tsx**: Workspace/status navigation for the Kanban feature, using app-level current-tab navigation for board entries.
- **kanban-toolbar.tsx**: View and filtering controls.
- **shared/**: Shared visual and metadata helpers such as priority labels, label parsing, icons, and avatars.
- **status-manager.tsx**: Status management UI.
- **use-kanban.ts**: TanStack Query hooks for issue, status, milestone, relation, comment, and delegation operations.
- **use-view-config.ts**: Local view configuration state for board/list display options.
