# Kanban

Kanban renders board/list/detail views over Issue-owned workspace data. Issue metadata, comments, relations, statuses, milestones, and delegation controls call the Issue and Issue Agent capabilities rather than making Kanban the data owner.

## Files

- **create-issue-dialog.tsx**: Floating create-issue panel with status and priority metadata controls.
- **index.tsx**: Kanban feature entrypoint and page composition; board view owns status move wiring while list view remains read/select/create focused.
- **issue-aside-panel.tsx**: Right-aside linked issue panel for chat sessions, including linked issue summary, unlink/open actions, and a searchable combobox picker with status icons and issue badges; records the right-aside Issue first-render mark after linked issue state, workspace list, statuses, board list, comments, and picker issues are ready.
- **issue-aside-panel-loader.ts**: Issue aside panel 的共享 lazy loader 与 intent preload 入口，供 right aside Issue tab 使用
- **issue-aside-panel.test.tsx**: Regression tests for linked issue rendering, Kanban navigation, unlink actions, and combobox-based issue linking.
- **issue-context-menu.tsx**: Shared right-click issue actions for board cards and list rows.
- **issue-detail/**: Issue detail subviews, including properties, activity, relations, sub-issues, and agent session controls; activity/comment/agent/header/properties panes participate in render budget with memoized rows/panes and stable action handlers.
- **kanban-board.tsx**: Board layout and drag/drop composition.
- **kanban-card.tsx**: Board card rendering for individual issues; issue cards use native named buttons for opening detail views while preserving drag wiring, and keep a memo boundary with stable `onOpenIssue(id)` callbacks for board render budget.
- **kanban-column.tsx**: Board column rendering and drop targets; inline create mounts without height animation so board layout work stays immediate, and issue maps forward stable open/hover handlers instead of creating per-card open closures.
- **kanban-group-header.tsx**: Group header rendering for board/list views with named create controls and expanded state.
- **kanban-group-header.test.tsx**: Regression tests for group header expanded state, decorative icons, keyboard-visible create control, and callbacks.
- **kanban-list.tsx**: List-view composition for issues; group collapse uses instant layout changes instead of height/auto motion animation.
- **kanban-item-actions.test.tsx**: Regression tests for native issue card/list row button semantics.
- **kanban-list-row.tsx**: Compact list row for individual issues; rows use native named buttons for opening detail views and keep a memo boundary with stable `onOpenIssue(id)` callbacks for list render budget.
- **kanban-selection.ts**: Pure helper functions for visible-order multi-selection, toggle, and range semantics.
- **kanban-selection.test.ts**: Regression tests for Linear-style issue selection ranges and toggles.
- **kanban-selection-bar.tsx**: Floating bulk action bar for selected issues, currently supporting status and priority updates.
- **kanban-sidebar-loader.ts**: Kanban sidebar 的共享 lazy loader 与 intent preload 入口，避免 workspace shell eager import Kanban 实现，并记录 sidebar lazy surface first-render start mark
- **kanban-sidebar.tsx**: Workspace/status navigation for the Kanban feature, using app-level current-tab navigation for board entries; records the Kanban sidebar first-render gate after the boards query succeeds, and exposes stable create-board dialog anchors for e2e flows.
- **kanban-toolbar.tsx**: View and filtering controls with named icon-only toolbar actions.
- **kanban-toolbar.test.tsx**: Regression tests for toolbar action accessible names, decorative icons, pressed layout state, and key callbacks.
- **shared/**: Shared visual and metadata helpers such as priority labels, label parsing, icons, and avatars.
- **status-manager.tsx**: Status management UI with accessible inline rename, delete, and reorder controls.
- **use-kanban.ts**: TanStack Query hooks for Kanban boards plus Issue-owned status, milestone, relation, comment, and delegation operations.
- **use-view-config.ts**: Local view configuration state for board/list display options.
