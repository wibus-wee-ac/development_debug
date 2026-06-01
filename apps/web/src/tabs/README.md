# Tabs

Cradle tab type definitions and central registry.
Each `.tab.tsx` file defines a tab route using the migration `defineTab()` helper from `@cradle/tabs-next`.
The registry exports the store instance consumed by the rest of the app.

## Files

- **registry.ts**: Central registry mapping type strings to tab definitions; exports `useCradleTabStore` with main-window persistence by default and session-scoped persistence for Electron tear-off windows, exposes the live store on `window.__CRADLE_TAB_STORE__` in Vite dev for performance sampling, and installs Cradle-owned tab lifecycle bridges.
- **route-preload.ts**: 后台 route chunk preload 入口；App shell 渲染后预热常用 tab 页面代码，但不接管页面数据所有权。
- **use-cradle-navigation.ts**: App navigation wrapper; ordinary `openTab()` navigates inside the current tab with tab-local history, while `openNewTab()` keeps explicit fresh-tab behavior and both paths preload the target route chunk before navigation.
- **tearoff-tabs.ts**: Main-window tear-off lifecycle helpers; reserve one active tear-off per chat session across drag/menu entry points, detach a chat tab from the main tab bar after the Electron tear-off opens, release the reservation when the window reports closed, and restore the tab.
- **tearoff-tabs.test.ts**: Unit coverage for detaching torn-off chat tabs, restoring them on close, keeping the main tab bar non-empty, and session tear-off reservation release.
- **terminal-panel-tab-lifecycle.ts**: Tab lifecycle bridge that derives chat/workspace terminal owner ids from tab params and stops bottom-panel terminal owners after their final owning tab closes.
- **terminal-panel-tab-lifecycle.test.ts**: Regression coverage for owner derivation, final-owner close cleanup, and duplicate-tab preservation.
- **reconcile-persisted-tabs.ts**: 启动时清理 dangling chat/workspace tabs 的纯函数，防止 localStorage 里的旧 session/workspace 引用继续污染 UI
- **reconcile-persisted-tabs.test.ts**: 验证无效 chat/workspace tabs 会被剔除并修复 active tab
- **home.tab.tsx**: Home/dashboard tab (pinned, no params)
- **chat.tab.tsx**: Chat session tab（params: `sessionId`），使用通用 fallback label，在会话标题加载后替换为真实标题，并为 chat composer 注入 session workspace 的文件列表以支持 `@` mention；workspace-backed chat（包含 CLI-TUI）注册 bottom terminal panel、browser panel capability、right aside capability，具体 shell owner 由 session/workspace route identity 区分
- **chat.tab.test.tsx**: 覆盖 chat tab 标题 fallback 清理与 session title 同步的回归测试
- **new-chat.tab.tsx**: New chat creation tab (no params); page-owned workspace selection drives browser panel and right aside capability while the tab route remains parameterless.
- **awaits.tab.tsx**: Pending external-await overview tab opened by Desktop tray actions.
- **automation.tab.tsx**: Automation dashboard tab opened by Desktop tray actions.
- **plugin-panel.tab.tsx**: Plugin panel tab，按 `{routeSegment}/{localId}` URL key 渲染 web plugin 注册的 panel，并提供 hash serialize/deserialize 契约与 plugin panel first-render performance gate。
- **plugin-panel.tab.test.ts**: 覆盖 plugin panel 的 route segment / local id hash encode/decode 与 cold URL restore。
- **kanban-board.tab.tsx**: Kanban board tab (params: `boardId`, optional `issue`, optional `milestoneId` for focused milestone filters)
- **kanban-board-tab-content-loader.ts**: Kanban board tab wrapper 的共享 lazy loader 与 route preload 入口。
- **kanban-board-tab-content.tsx**: Wrapper component resolving board → workspace and managing issue panel plus optional milestone focus
- **workspace-detail.tab.tsx**: Workspace detail tab (params: `workspaceId`), syncs the runtime tab label to the loaded workspace name and registers workspace-scoped bottom terminal plus browser panel and right aside capability
- **workspace-detail.tab.test.tsx**: Regression test covering workspace-detail runtime tab label updates
- **usage.tab.tsx**: Usage/cost dashboard tab (no params)
