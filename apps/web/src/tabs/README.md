<!-- Once this directory changes, update this README.md -->

# Tabs

Cradle tab type definitions and central registry.
Each `.tab.tsx` file defines a tab route using the migration `defineTab()` helper from `@cradle/tabs-next`.
The registry exports the store instance consumed by the rest of the app.

## Files

- **registry.ts**: Central registry mapping type strings to tab definitions; exports `useCradleTabStore`
- **use-cradle-navigation.ts**: App navigation wrapper; ordinary `openTab()` navigates inside the current tab with tab-local history, while `openNewTab()` keeps explicit fresh-tab behavior.
- **reconcile-persisted-tabs.ts**: 启动时清理 dangling chat/workspace tabs 的纯函数，防止 localStorage 里的旧 session/workspace 引用继续污染 UI
- **reconcile-persisted-tabs.test.ts**: 验证无效 chat/workspace tabs 会被剔除并修复 active tab
- **home.tab.tsx**: Home/dashboard tab (pinned, no params)
- **chat.tab.tsx**: Chat session tab (params: `sessionId`)
- **new-chat.tab.tsx**: New chat creation tab (no params)
- **kanban-board.tab.tsx**: Kanban board tab (params: `boardId`, optional `issue`)
- **kanban-board-tab-content.tsx**: Wrapper component resolving board → workspace and managing issue panel
- **workspace-detail.tab.tsx**: Workspace detail tab (params: `workspaceId`), syncs the runtime tab label to the loaded workspace name
- **workspace-detail.tab.test.tsx**: Regression test covering workspace-detail runtime tab label updates
- **usage.tab.tsx**: Usage/cost dashboard tab (no params)
