# Tabs

Cradle tab type definitions and central registry.
Each `.tab.tsx` file defines a tab route using the migration `defineTab()` helper from `@cradle/tabs-next`.
The registry exports the store instance consumed by the rest of the app.

## Files

- **registry.ts**: Central registry mapping type strings to tab definitions; exports `useCradleTabStore` with main-window persistence by default and session-scoped persistence for Electron tear-off windows.
- **route-preload.ts**: Route-level tab preload registry; maps tab type strings to feature-owned preload functions so navigation intent can warm deferred route chunks without eager importing page implementations.
- **use-cradle-navigation.ts**: App navigation wrapper; ordinary `openTab()` navigates inside the current tab with tab-local history, while `openNewTab()` keeps explicit fresh-tab behavior and both paths preload the target route chunk before navigation.
- **tearoff-tabs.ts**: Main-window tear-off lifecycle helpers; detach a chat tab from the main tab bar after the Electron tear-off opens, and restore it when the tear-off window reports closed.
- **tearoff-tabs.test.ts**: Unit coverage for detaching torn-off chat tabs, restoring them on close, and keeping the main tab bar non-empty.
- **reconcile-persisted-tabs.ts**: 启动时清理 dangling chat/workspace tabs 的纯函数，防止 localStorage 里的旧 session/workspace 引用继续污染 UI
- **reconcile-persisted-tabs.test.ts**: 验证无效 chat/workspace tabs 会被剔除并修复 active tab
- **home.tab.tsx**: Home/dashboard tab (pinned, no params)
- **chat.tab.tsx**: Chat session tab（params: `sessionId`），使用通用 fallback label，在会话标题加载后替换为真实标题，并为非 CLI-TUI workspace-backed chat 注册默认激活/持久化的 bottom terminal panel；CLI-TUI chat route 显式不注册 bottom shell，避免双 PTY 争用
- **chat.tab.test.tsx**: 覆盖 chat tab 标题 fallback 清理与 session title 同步的回归测试
- **new-chat.tab.tsx**: New chat creation tab (no params)
- **approvals.tab.tsx**: Pending approval inbox tab opened by Desktop tray actions.
- **awaits.tab.tsx**: Pending external-await overview tab opened by Desktop tray actions.
- **automation.tab.tsx**: Automation dashboard tab opened by Desktop tray actions.
- **plugin-panel.tab.tsx**: Plugin panel tab，按 owner-scoped panel id 渲染 web plugin 注册的 panel，并兼容旧 local id 的单匹配恢复；同时提供 panel id hash serialize/deserialize 契约与 plugin panel first-render performance gate。
- **kanban-board.tab.tsx**: Kanban board tab (params: `boardId`, optional `issue`)
- **kanban-board-tab-content-loader.ts**: Kanban board tab wrapper 的共享 lazy loader 与 route preload 入口。
- **kanban-board-tab-content.tsx**: Wrapper component resolving board → workspace and managing issue panel
- **workspace-detail.tab.tsx**: Workspace detail tab (params: `workspaceId`), syncs the runtime tab label to the loaded workspace name and registers the workspace-scoped bottom terminal panel
- **workspace-detail.tab.test.tsx**: Regression test covering workspace-detail runtime tab label updates
- **usage.tab.tsx**: Usage/cost dashboard tab (no params)
