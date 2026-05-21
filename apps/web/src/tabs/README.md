# Tabs

Cradle tab type definitions and central registry.
Each `.tab.tsx` file defines a tab route using the migration `defineTab()` helper from `@cradle/tabs-next`.
The registry exports the store instance consumed by the rest of the app.

## Files

- **registry.ts**: Central registry mapping type strings to tab definitions; exports `useCradleTabStore`
- **use-cradle-navigation.ts**: App navigation wrapper; ordinary `openTab()` navigates inside the current tab with tab-local history, while `openNewTab()` keeps explicit fresh-tab behavior
- **reconcile-persisted-tabs.ts**: 启动时清理 dangling chat/workspace tabs 的纯函数，防止 localStorage 里的旧 session/workspace 引用继续污染 UI
- **reconcile-persisted-tabs.test.ts**: 验证无效 chat/workspace tabs 会被剔除并修复 active tab
- **home.tab.tsx**: Home/dashboard tab (pinned, no params)
- **chat.tab.tsx**: Chat session tab（params: `sessionId`），使用通用 fallback label，并在会话标题加载后替换为真实标题
- **chat.tab.test.tsx**: 覆盖 chat tab 标题 fallback 清理与 session title 同步的回归测试
- **new-chat.tab.tsx**: New chat creation tab (no params)
- **approvals.tab.tsx**: Pending approval inbox tab opened by Desktop tray actions.
- **awaits.tab.tsx**: Pending external-await overview tab opened by Desktop tray actions.
- **automation.tab.tsx**: Automation dashboard tab opened by Desktop tray actions.
- **plugin-panel.tab.tsx**: Plugin panel tab，按 owner-scoped panel id 渲染 web plugin 注册的 panel，并兼容旧 local id 的单匹配恢复
- **kanban-board.tab.tsx**: Kanban board tab (params: `boardId`, optional `issue`)
- **kanban-board-tab-content.tsx**: Wrapper component resolving board → workspace and managing issue panel
- **workspace-detail.tab.tsx**: Workspace detail tab (params: `workspaceId`), syncs the runtime tab label to the loaded workspace name
- **workspace-detail.tab.test.tsx**: Regression test covering workspace-detail runtime tab label updates
- **usage.tab.tsx**: Usage/cost dashboard tab (no params)
