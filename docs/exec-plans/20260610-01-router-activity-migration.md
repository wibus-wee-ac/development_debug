# 用 TanStack Router 和明确 Activity Surfaces 替换 tabs-next

本 ExecPlan 是 living document。`Progress`、`Surprises & Discoveries`、`Decision Log` 和 `Outcomes & Retrospective` 必须随着工作推进持续更新。

本计划遵循 `/Users/wibus/.agents/skills/execplan/references/PLANS.md`。它必须保持自包含：后续执行者只读取这个文件和当前工作区，也应该能理解为什么要迁移、迁移哪些边界、哪些债务禁止保留、应该修改哪些文件、以及如何验证迁移完成。详细 surface ownership table 已保存为 `docs/router-activity-migration/surface-ownership-table.md`，本 ExecPlan 将它作为权威 ref，并在下文重复最关键的硬约束，避免实现时只读计划而漏掉前面讨论过的决定。

## Purpose / Big Picture

Cradle Web 现在用自研 `@cradle/tabs-next` 同时承担 route runtime、tab list、URL 同步、保留 frame 渲染、local view-state cache、resource lifecycle bridge 等职责。这个边界过大，导致 URL、页面身份、缓存、释放策略和 UI tab 行为混在一起，后续很难判断谁拥有状态、谁应该释放资源、谁可以保留 DOM。

迁移完成后，TanStack Router 拥有 URL 解析、route params、search params、loader、pending state 和 error boundary。Cradle Web 只保留产品层的 opened surface list：哪些 surface 打开、排序如何、哪个 surface active、关闭 surface 时释放哪些资源。用户可见结果是：Home、New Chat、Chat Session、Workspace Detail、Kanban、Settings、Awaits、Automation、Usage、Plugin Panel 和 tear-off chat 都通过 TanStack Router route 工作；顶部 surface bar 仍能激活、关闭和排序；空闲隐藏页面默认释放；流式 Chat 和 native Browser Panel 按明确策略保留；运行源码搜索时不再有 `@cradle/tabs-next` runtime import。

## Non-Negotiable Cautions / 务必注意

这次迁移是一次性架构替换，不是兼容迁移。禁止留下 `tabs-next` adapter、alias、shim package、compat wrapper，也不要把旧的 `type + params` navigation helper 换个名字放到新目录里。目标不是复刻 `@cradle/tabs-next`，而是让 route ownership 和 surface ownership 分离。

旧性能优化不能默认保留。每一个 retained frame、preload、local cache、scroll cache、global event listener、hidden `Activity` boundary 都必须重新论证是否仍然需要。如果一个隐藏 surface 能从 TanStack Router、TanStack Query、feature-owned cache 或 server state 恢复，默认策略是释放，而不是保留。

旧 localStorage key `cradle:tabs-next:v1` 不迁移。这个仓库当前允许破坏性清理，继续读取旧 tab persistence 会把旧框架边界带进新架构。可以忽略或清理旧 key，但禁止向旧 `tabs-next` namespace 写新数据。

tab-local history 不保留。浏览器 history 和 TanStack Router route history 是目标设计中唯一的导航历史。除非 Wibus 后续明确提出一个新的、独立拥有的 feature，否则不要实现 per-surface history stack。

generic view-state storage 不保留。scroll position、editor draft、chat transcript recovery、browser panel state、terminal state 必须由对应 feature 自己拥有。`tabs-next` 的任意 `viewState` map 必须消失。

Profile tab 直接删除。迁移前代码里有旧的 `openTab('profile')` 入口，但 `apps/web/src/tabs/registry.ts` 没有注册 `profile`。迁移时删除入口，不新增 `/profile` route，也不做 profile placeholder。

React `Activity` 不是新 tab retention framework。它只允许用于权威 table 中明确认可的场景：active 或 streaming Chat Session、Browser Panel native ownership，以及未来由 plugin capability 明确声明的 retention。普通 singleton route、Kanban、Settings、Awaits、Automation、Usage、Workspace Detail 默认不使用 `Activity`。

不要为了这次前端迁移随手加组件测试或 browser automation。若 navigation identity、release selection 等纯逻辑需要保护，可以加小范围 pure tests。浏览器自动化只在 Wibus 明确要求时做。

## Internal Reference / Surface Table Guard

`docs/router-activity-migration/surface-ownership-table.md` 是本迁移的内部权威 ref，不是背景材料。每个涉及 route、surface identity、Activity retention、local cache 或 resource release 的实现步骤，都必须先用这张 table 对照目标 ownership，再修改代码。

如果实现和 table 冲突，默认修正实现。如果执行过程中发现 table 本身与现有架构事实冲突，先在本 ExecPlan 的 `Decision Log` 记录新决定，再同步更新 table 和本计划。不能在代码里悄悄引入 table 没有认可的新 retained surface、新 generic cache、新 profile route 或新 tab-local history。

验收时必须反向用 table 做 audit：table 中每个 surface 都应该能在 route、identity、cache、Activity 和 release policy 上找到对应实现或明确的删除结果；table 外的 surface 不允许隐式继承旧 `tabs-next` 行为。

## Progress

- [x] (2026-06-10 02:10 +0800) 读取 `/Users/wibus/.agents/skills/execplan/references/PLANS.md`，确认 ExecPlan 必须自包含、living、面向新手、包含可执行验证。
- [x] (2026-06-10 02:10 +0800) 确认当天没有已有 `docs/exec-plans/20260610-*`，因此使用 `20260610-01-router-activity-migration.md`。
- [x] (2026-06-10 02:10 +0800) 先创建权威 surface ownership table：`docs/router-activity-migration/surface-ownership-table.md`。
- [x] (2026-06-10 02:10 +0800) 记录 Wibus 的硬性方向：一次性完整迁移、无兼容债务、旧性能优化全部重新论证、Profile tab 直接丢掉。
- [x] (2026-06-10 02:14 +0800) 将本 ExecPlan 修订为中文正文，并把权威 table ref 和“务必注意”硬约束提升到独立段落。
- [x] (2026-06-10 08:52 +0800) 增加 `Internal Reference / Surface Table Guard`，明确 table 是实现和验收输入，不能被当作普通附录跳过。
- [x] (2026-06-10 09:06 +0800) 添加 `@tanstack/react-router`、`@tanstack/router-plugin`，在 `apps/web/vite.config.ts` 配置 TanStack Router Vite plugin，并生成 `apps/web/src/routeTree.gen.ts`。`apps/web/src/router.tsx` 使用 `createHashHistory()` 替代旧 `createUrlSync()`。
- [x] (2026-06-10 09:07 +0800) 将旧 `apps/web/src/tabs/*` surface 定义迁移为 `apps/web/src/routes/*` 和 route-owned feature entry。关键文件包括 `apps/web/src/routes/index.tsx`、`apps/web/src/routes/chat/new.tsx`、`apps/web/src/routes/chat/$sessionId.tsx`、`apps/web/src/routes/workspaces/$workspaceId.tsx`、`apps/web/src/routes/kanban/$boardId.tsx`、`apps/web/src/routes/plugins/$routeSegment/$localId.tsx`、`apps/web/src/routes/settings/$section.tsx`。
- [x] (2026-06-10 09:08 +0800) 新增 app-owned navigation/surface ownership area：`apps/web/src/navigation/surface-identity.ts`、`surface-store.ts`、`navigation-commands.ts`、`surface-bar.tsx`、`surface-activity-context.tsx`、`surface-resource-lifecycle.ts`、`screen-coordinates.ts` 和 `tearoff-sessions.ts`。
- [x] (2026-06-10 09:09 +0800) 将 Settings 改成 first-class `/settings/$section` route。`apps/web/src/store/settings-overlay.ts` 只保留 focus/section state，不再保存 `settingsTabId`。Profile tab/action 已删除，没有新增 `/profile` route。
- [x] (2026-06-10 09:11 +0800) 重建 Activity retention、local cache 和 timely release 策略。普通 route surface 默认卸载；Chat 只保留 active 或 streaming session；Browser Panel 仍在 layout boundary 由 native owner state 保留；Bottom Terminal 通过 surface lifecycle 释放 owner。
- [x] (2026-06-10 09:13 +0800) 更新 tear-off、devtool、desktop tray、global search、global shortcuts、System Agent context、Browser Panel 和 Bottom Terminal 集成点。System Agent ambient context 已从 `activeTab/openTabs` 破坏性重命名为 `activeSurface/openSurfaces`。
- [x] (2026-06-10 09:15 +0800) 移除所有 `@cradle/tabs-next` runtime import、package dependency、workspace package、`apps/web/src/tabs` route definitions 和 tabs-next devtool diagnostic。`packages/tabs-next` 已删除。
- [x] (2026-06-10 09:20 +0800) 修正迁移收口 audit 中发现的两个问题：hidden streaming Chat frame 现在继续运行 Chat driver；`apps/web/src/styles.css` 不再把已删除的 `packages/tabs-next` 加入 Tailwind source。
- [x] (2026-06-10 09:24 +0800) 运行最终验证命令并记录结果：web TypeScript check 通过，web build 通过，desktop node TypeScript check 通过，旧 tabs-next/Profile/context/settings audit 搜索通过。

## Surprises & Discoveries

- Observation: `apps/web` 当前没有 TanStack Router runtime integration。
  Evidence: 对 `@tanstack/react-router`、`createRouter`、`createFileRoute`、`RouterProvider` 和 `routeTree` 的搜索没有发现 web app runtime 用法。`apps/web/package.json` 有 `@tanstack/react-query` 和 `@tanstack/react-table`，但没有 `@tanstack/react-router`。

- Observation: `@cradle/tabs-next` 不是单纯的视觉 tab bar，而是同时拥有 tab identity、per-tab history、URL projection、localStorage persistence、cross-window sync、route loading、retained frames、scroll capture 和 view-state slots。
  Evidence: `packages/tabs-next/src/store.ts` 定义 `tabs`、`contexts`、`activeTabId`、`openTab`、`createTab`、`closeTab`、`setActiveTab`、`navigateTab`、`replaceTabLocation`、`updateTabLabel`、`updateTabViewState`、`restoreTabs`、`restoreTabHistoryIndex`、`goBack` 和 `goForward`。`packages/tabs-next/src/components/tab-renderer.tsx` 把所有 tab 渲染成 overlay frame，并把 scroll positions 写入 `viewState`。

- Observation: Chat 已经有 domain-owned cache 和 release policy，迁移时应保留这个所有权思路，但不要照搬旧 idle retention。
  Evidence: `apps/web/src/features/chat/session/stable-message-cache.ts` 用 IndexedDB 保存 stable message rows。`apps/web/src/features/chat/session/chat-session-frame-host.tsx` 当前保留 active、streaming 和最多六个 idle chat frames，然后在 session 不再 mounted 且不 streaming 时释放 chat store state。目标设计保留 stable cache 与 streaming retention，移除固定 idle-frame retention 默认值。

- Observation: 旧代码里存在已经坏掉的 Profile navigation entry。
  Evidence: `apps/web/src/features/search/global-search-dialog.tsx` 调用 `openTab('profile', {})`，但 `apps/web/src/tabs/registry.ts` 的 `cradleRegistry` 没有 `profile`。本迁移删除入口，不新增 route。

- Observation: 当前 worktree 有大量无关未提交改动。
  Evidence: `git status --short` 显示 server modules、web features、generated API files、database migrations、plugin docs 和 desktop preload 都有改动。本计划和后续实现不得 revert 或 normalize 这些无关改动。

- Observation: `/` route 在迁移中一度指向 New Chat，这会把 Home singleton surface 语义破坏掉。
  Evidence: 反向 audit 时发现 `apps/web/src/routes/index.tsx` 应该渲染 `HomeDashboard`，而 `/chat/new` 才渲染 `NewChatPage`。最终实现已修正为 `/` owns Home，`/chat/new` owns New Chat。

- Observation: route-local Chat Session host 在离开 `/chat/$sessionId` route 时会卸载，因此只在 route content 内保留 streaming frame 不足以覆盖“切到非 chat route 后继续 streaming”的场景。
  Evidence: 最终实现增加 `apps/web/src/features/chat/session/streaming-chat-retention-host.tsx`，并在 `apps/web/src/app-shell.tsx` 的 main runtime 中作为 `AppLayout` sibling 挂载。它只为仍在 streaming 且不是 active chat route 的 session 挂隐藏 frame。

- Observation: hidden streaming frame 不能只保留 UI subtree，还必须继续运行 Chat driver。
  Evidence: `useChatSessionDriver(sessionId, active)` 在 `active=false` 时会关闭 passive stream。最终 `apps/web/src/features/chat/session/chat-session-frame-host.tsx` 将 driver active 条件改为 active visible session 或 streaming session，确保 hidden streaming frame 继续订阅 stream，而 idle hidden frame 仍然释放。

- Observation: 旧 package 删除后仍可能有非 import 的构建配置残留。
  Evidence: 路径级搜索发现 `apps/web/src/styles.css` 仍有 `@source "../../../packages/tabs-next/src/**/*.tsx";`。最终已删除该 source entry，路径级搜索只剩允许的 legacy localStorage cleanup key。

- Observation: `System Agent` ambient context 仍沿用了旧 `activeTab/openTabs` 命名，虽然它不是 `@cradle/tabs-next` import。
  Evidence: context tests 和 format tests 仍覆盖旧字段。最终 `ContextEnvelope` 和 `ContextProviderInput` 改为 `activeSurfaceId`、`activeSurfaceType`、`activeSurfaceParams`、`activeSurfaceSearch`，并同步 Chat/Kanban providers 与 fixtures。

- Observation: 当前安装的 `@tanstack/router-plugin` Vite API 使用 `tanstackRouter` named export。
  Evidence: `apps/web/vite.config.ts` 最终导入 `import { tanstackRouter } from '@tanstack/router-plugin/vite'`，并在 plugins 中放在 `viteReact()` 之前调用 `tanstackRouter({ target: 'react', autoCodeSplitting: true })`。

## Decision Log

- Decision: 使用 route-first singleton surfaces 作为目标架构。
  Rationale: TanStack Router 成为 route semantics 的 owner，Cradle 只保留产品层 opened surface list。这样可以避免在新目录里重建一个任意 multi-context tab framework。
  Date/Author: 2026-06-10 / Codex

- Decision: 在一个迁移里删除 `@cradle/tabs-next`，不留下 compatibility adapter。
  Rationale: Wibus 明确要求一次性完整迁移且禁止债务；仓库尚未发布，项目约定也支持破坏性架构清理。
  Date/Author: 2026-06-10 / Codex

- Decision: 将 `docs/router-activity-migration/surface-ownership-table.md` 作为权威 surface table。
  Rationale: 这张 table 集中记录 route、identity、cache、Activity 和 release policy，避免实现时把 ownership 决策散落在代码注释里。本 ExecPlan 会重复关键硬约束，但详细 surface 行为以 table 为准。
  Date/Author: 2026-06-10 / Codex

- Decision: 删除 Profile navigation，而不是补一个 Profile route。
  Rationale: 当前 Profile 入口已经不匹配 registry。Wibus 已明确同意直接丢掉 Profile Tab。
  Date/Author: 2026-06-10 / Codex

- Decision: hidden surfaces 默认 unmount/release。
  Rationale: 旧 retained frame 是 `tabs-next` 内部性能方案，不应成为新架构默认值。新模型要求每个 retention boundary 都有 domain 理由。Chat streaming 和 native Browser Panel 有理由保留；普通页面应从 route、query 或 feature-owned state 恢复。
  Date/Author: 2026-06-10 / Codex

- Decision: 不迁移旧 `cradle:tabs-next:v1` persisted state。
  Rationale: 旧 tab state reader 会延续旧框架边界，形成长期债务。当前代码库允许破坏性清理。
  Date/Author: 2026-06-10 / Codex

- Decision: 把 surface ownership table 作为实现 guard 和验收 audit 输入。
  Rationale: Wibus 要求 ExecPlan 内部 ref 这张 table，并把前面讨论的重要约束变成务必注意项。把 table 作为 guard 可以防止执行者只完成 route 迁移，却悄悄保留旧 retained frame、generic cache、Profile 入口或 tab-local history。
  Date/Author: 2026-06-10 / Codex

- Decision: TanStack Router 初始实现优先使用 hash history，除非实现时确认 Electron normal window、tear-off window 和 devtool window 都可以安全使用 browser history。
  Rationale: 当前 `createUrlSync` 使用 hash URL，同步迁移到 hash history 可以降低 Electron 窗口加载和 deep-link 行为的不确定性，同时不影响 route ownership 的核心目标。
  Date/Author: 2026-06-10 / Codex

- Decision: 使用当前安装版本提供的 `tanstackRouter` Vite plugin API。
  Rationale: 计划草稿中的 `TanStackRouterVite` import 是不同版本文档里常见的形态；本仓库安装版本以 `tanstackRouter` 为准。记录实际 API 可以避免后续执行者按旧 import 修回错误形态。
  Date/Author: 2026-06-10 / Codex

- Decision: `/` 继续由 Home surface 拥有，New Chat 使用 `/chat/new`。
  Rationale: Home 是 table 中明确的 singleton surface。把 `/` 指向 New Chat 会让 Home surface 和 startup semantics 混乱，也会让 surface store 的 non-closable Home fallback 失去对应 route。
  Date/Author: 2026-06-10 / Codex

- Decision: 在 shell-level 增加 Chat-only streaming retention host，同时让 hidden streaming frame 继续运行 Chat driver。
  Rationale: TanStack Router 会在离开 chat route 时卸载 route subtree。为了满足 active 或 streaming Chat Session 可以保留的约束，需要一个明确属于 Chat domain 的 hidden host；但 driver 只允许 active 或 streaming session 运行，不能恢复旧 idle-frame retention。
  Date/Author: 2026-06-10 / Codex

- Decision: 将 System Agent ambient context 字段从 tab 命名破坏性重命名为 surface 命名。
  Rationale: 继续暴露 `activeTab/openTabs` 会把旧框架概念留在 agent context contract 中。新字段表达同样用户语义，但 source of truth 是 app-owned surface list 和 TanStack Router route state。
  Date/Author: 2026-06-10 / Codex

- Decision: `surface-store.ts` 使用新的 `cradle:surfaces:v1` key，并只对 `cradle:tabs-next:v1` 做 idempotent cleanup。
  Rationale: 本迁移拒绝旧 persisted tabs migration。新 namespace 由 Cradle Web surface store 拥有；旧 namespace 只允许删除，不允许读取迁移或写入。
  Date/Author: 2026-06-10 / Codex

- Decision: 删除 `apps/web/src/styles.css` 中指向 `packages/tabs-next` 的 Tailwind `@source`。
  Rationale: 旧 package 已删除，构建配置继续扫描旧路径会形成 package 影子引用。插件 source 保留，tabs-next source 必须移除。
  Date/Author: 2026-06-10 / Codex

## Outcomes & Retrospective

迁移已完成。web app 由 `apps/web/src/app.tsx` 渲染 `RouterProvider` 启动，`apps/web/src/router.tsx` 使用 TanStack Router hash history，route tree 由 `apps/web/src/routeTree.gen.ts` 生成。原有产品 surface 已迁移到 `apps/web/src/routes/*` 和 route-owned feature entry；surface list、排序、active surface 和 close release policy 由 `apps/web/src/navigation/*` 拥有。

`@cradle/tabs-next` runtime import、package dependency、workspace package、旧 app tab definitions 和 tabs-next devtool diagnostic 已移除。Profile tab/action 已删除，没有新增 `/profile` route。Settings 是 `/settings/$section` first-class route。Idle hidden route surfaces 默认释放；Chat 只保留 active 或 streaming session；Browser Panel 由 layout boundary 的 native owner state 保留；Terminal 和 Browser Panel owner cleanup 由 `releaseSurfaceResources(previousSurfaces, nextSurfaces)` 驱动。

最终验证通过：`pnpm --filter @cradle/web exec tsc --noEmit` 成功；`pnpm --filter @cradle/web build` 成功；`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json` 成功。Vite build 仍输出既有 chunk size 和 plugin timing warnings，但没有迁移相关失败。未运行 browser automation，因为本计划和 Wibus 的约束明确不要为此前端迁移随手加 browser tests。

## Context and Orientation

当前 app entry 是 `apps/web/src/main.tsx`。它创建 React root，包裹现有 environment providers，并渲染 `apps/web/src/app.tsx` 的 `App`。迁移完成后的 `App` 只在 `AppEnvironmentProviders` 内渲染 TanStack Router 的 `RouterProvider`，router 定义在 `apps/web/src/router.tsx`，route tree 由 `apps/web/src/routeTree.gen.ts` 生成。

当前 root route 位于 `apps/web/src/routes/__root.tsx`，它渲染 `apps/web/src/app-shell.tsx` 的 `AppRouteRoot`。`AppRouteRoot` 负责 onboarding gate、tear-off runtime 分支、surface sync、layout runtime、global search host、desktop tray bridge 和 shell-level streaming chat retention host。普通主窗口 runtime 在 `MainAppRuntime` 中渲染 `AppLayout` 和 route `Outlet`；tear-off runtime 在 `TearoffAppRuntime` 中直接导航到 `/chat/$sessionId`。

迁移前的 tab definitions 位于 `apps/web/src/tabs/`，这些文件用 `defineTab()` 描述类似 route 的 surface，例如 `chat.tab.tsx`、`workspace-detail.tab.tsx`、`kanban-board.tab.tsx`、`plugin-panel.tab.tsx`、`new-chat.tab.tsx`、`awaits.tab.tsx`、`automation.tab.tsx` 和 `usage.tab.tsx`。迁移完成后这些旧 definitions 已删除；对应目标位于 `apps/web/src/routes/*` 或 route-owned feature entry，例如 `apps/web/src/features/chat/session/chat-session-route-content.tsx`、`apps/web/src/features/workspace-detail/workspace-detail-route-content.tsx`、`apps/web/src/features/kanban/kanban-board-route-content.tsx` 和 `apps/web/src/features/plugins/plugin-panel-route-content.tsx`。

TanStack Router 是目标 routing library。route 是 URL 到 React component tree 的映射；route param 是路径中的参数，例如 `/chat/$sessionId` 里的 `$sessionId`；search param 是 query string，例如 `/kanban/$boardId?issue=...` 里的 `issue`。

React `Activity` 是 React 19 的组件，可以隐藏 subtree 并保留 DOM 和 React state。本计划中，`Activity` 不是通用 tab retention 机制。它只允许在 table 认可的 surface 场景使用：active 或 streaming Chat Session、Browser Panel visibility、以及未来 plugin 通过 capability 明确声明 retention 的 panel。Chat 内部 tool rendering 也可能使用 feature-owned `Activity`，但那不是 app surface retention。

surface 是顶部 surface bar 中显示的产品级打开页面。它不是 route 本身，也不是隐藏 React state 的拷贝。新的 surface store 位于 `apps/web/src/navigation/surface-store.ts`，只知道打开了哪些 route surface、顺序如何、哪个 active、是否 closable；它不拥有 business data、loader data、serialized React state、generic view state 或 per-surface history。surface identity 由 `apps/web/src/navigation/surface-identity.ts` 从 route 和关键 params 派生：`chat:${sessionId}`、`workspace:${workspaceId}`、`kanban:${boardId}`、`plugin:${routeSegment}:${localId}`，以及 `home`、`new-chat`、`settings`、`awaits`、`automation`、`usage` 等 singleton id。

Settings 当前是 `/settings/$section` first-class route。`apps/web/src/store/settings-overlay.ts` 只保留 settings-specific focus target 和 section state，不再保存 `settingsTabId`，也不再把 settings visibility 绑定到 app tab id。

tear-off chat window 当前使用同一个 TanStack Router 配置。`apps/web/src/tearoff-main.tsx` 仍是 tear-off renderer entry，但它不再导入 `TabRenderer`、`TabsProvider`、`cradleRegistry` 或旧 tab store。tear-off runtime 通过 `AppRouteRoot` 的 tear-off 分支导航到 `/chat/$sessionId`，并在 `sessionScoped` layout 下复用 Chat Session route content。

resource release 当前在 `apps/web/src/navigation/surface-resource-lifecycle.ts` 中。它订阅 surface list 的变化，从 surface id 和 route params 派生资源 owner，并在 owning surface 最终关闭时释放 Browser Panel owners 与 Bottom Terminal owners。Browser Panel state 仍属于 `apps/web/src/store/browser-panel.ts` 和 `apps/web/src/features/browser`；terminal cleanup 仍属于 `apps/web/src/features/tui/terminal-panel-cleanup.ts`。

## Plan of Work

第一步是给 `apps/web` 添加 TanStack Router 基础设施。添加 `@tanstack/react-router` 和 `@tanstack/router-plugin`，在 `apps/web/vite.config.ts` 配置 Vite plugin，并在 `apps/web/src/routes/` 下创建 route files。默认使用 hash history 来延续 Electron 现状；如果实现时确认 browser history 对 normal、tear-off 和 devtool window 都安全，必须先在 `Decision Log` 记录再切换。通过 TanStack Router plugin 或 CLI 生成 `apps/web/src/routeTree.gen.ts`。

第二步是在 `apps/web/src/navigation/` 下创建 app navigation ownership area。这里包含 route-specific navigation commands、surface identity helper、surface store、surface bar 和必要的 active-surface context。命令必须是 `openChatSession`、`openWorkspaceDetail`、`openKanbanBoard`、`openSettingsSection` 这类 route-specific API，禁止提供新的 `openTab(type, params)`。surface store 只保存 `id`、`kind`、`route`、`title`、`order`、`closable` 和 `activeSurfaceId`。

第三步替换视觉 tab bar。迁移前 `apps/web/src/components/layout/app-header.tsx` 导入 `@cradle/tabs-next` 的 `TabBar` 和 tab customization。替换成 app-owned `SurfaceBar`，并保留用户依赖的行为：激活 surface、关闭 closable surface、新建 chat surface、排序 surface、显示 route icon、显示 chat unread badge、保留仍然需要的 keyboard shortcuts。`SurfaceBar` 只能消费 surface store 和 route-specific commands。

第四步把旧 tab definitions 迁移到 route-owned entry。`home.tab.tsx` 迁移为 Home route；`new-chat.tab.tsx` 迁移为 `/chat/new`；`chat.tab.tsx` 迁移为 `/chat/$sessionId`，并保留 Chat-owned metadata loading、layout slot registration、runtime label updates、archived-session close behavior 和 Chat Session cache ownership；`workspace-detail.tab.tsx` 迁移为 `/workspaces/$workspaceId`；`kanban-board.tab.tsx` 迁移为 `/kanban/$boardId`，`issue` 和 `milestoneId` 是 search params；`plugin-panel.tab.tsx` 迁移为 `/plugins/$routeSegment/$localId`；`awaits.tab.tsx`、`automation.tab.tsx`、`usage.tab.tsx` 迁移为 singleton routes；`onboarding.tab.tsx` 迁移为 `/onboarding` 或 startup redirect route。

第五步重写 `apps/web/src/app.tsx`。它不再渲染 `TabsProvider` 或 `TabRenderer`，而是在现有 environment providers 内渲染 TanStack Router 的 `RouterProvider`。保留 onboarding startup gate、desktop badge sync、tray action bridge、global search host、layout slot scope、sidebar sheet behavior 和 `AppLayout`。active layout context 必须从 active route surface 派生，而不是从 `useCradleTabStore` 派生。

第六步移除旧 active frame 依赖。迁移前 `useTabFrameActive()` 出现在 `chat.tab.tsx`、`chat-view.tsx`、`new-chat-page.tsx`、`workspace-detail-page.tsx` 和 `plugin-panel.tab.tsx` 等位置。多数页面迁移后不需要 hidden active signal。Chat Session route host 应显式传入 `active`，让 `useChatSessionDriver(sessionId, active)` 继续暂停非 active hidden work。New Chat、Workspace Detail 和 Plugin Panel 只有在有明确产品理由时才保留 active signal。

第七步围绕权威 table 重建 `Activity` retention。Chat Session 只保留 active 和 streaming frames。移除固定 idle-frame retention limit，除非后续测量证明需要再设计。Browser Panel 在 owner surface 存在且 panel hidden 或 closing 时可以使用 `Activity`。Bottom Terminal 不是 route，应由 layout slot 和 terminal owner cleanup 管理，而不是靠 retained tab frame。普通 singleton routes 从 route 和 query state remount。

第八步将 Settings 改成 route。移除 `apps/web/src/store/settings-overlay.ts` 里的 `settingsTabId`，用 Router navigation 到 `/settings/$section` 表达 settings visibility。保留 settings focus targets，如果 Settings feature 仍然需要它们。所有旧的 `openSettings(activeTabId)` caller 改成 `openSettingsSection(section)` 或 route navigation。删除 `apps/web/src/app.tsx` 里的 settings overlay branch。

第九步更新所有 command surfaces。`apps/web/src/hooks/use-global-event-listeners.ts` 应让 `Cmd+W` 关闭 active surface、`Cmd+T` 打开 `/chat/new`、`Ctrl+Tab` 在 surface list 中切换。global search、desktop tray、workspace sidebar、workspace detail、Kanban issue links、plugin sidebar links 和 Home links 必须使用 route-specific navigation commands 或 TanStack Router `Link`。删除 Profile search action。

第十步更新 ambient context。迁移前 `apps/web/src/features/context/context-registry.ts`、`apps/web/src/features/system-agent/system-context-provider.ts`、`apps/web/src/features/system-agent/jarvis-popover.tsx` 和 `apps/web/src/features/system-agent/context-schema.ts` 读取 active tab id/type/params。改为读取 active surface id、route id、route params 和 route search。用户可见语义保持不变：System Agent 仍知道用户在看什么、打开了哪些 surface，但 source of truth 不再叫 tab。

第十一步更新 tear-off。`apps/web/src/tearoff-main.tsx` 不再导入 `TabRenderer`、`TabsProvider`、`cradleRegistry` 或 `cradleTabStore`。它应直接初始化 router 到 `/chat/$sessionId`，在 `sessionScoped` mode 下渲染 `AppLayout`，并复用同一 Chat Session route content。`apps/web/src/tabs/tearoff-tabs.ts` 删除或替换为 route/surface-owned helper，且不得依赖 `TabStoreState`。

最后移除旧 package 和 docs。所有 source import 清零后，从 `apps/web/package.json`、root `package.json` 和 workspace references 中移除 `@cradle/tabs-next`。删除 `packages/tabs-next/`。删除或重写 `apps/web/src/features/devtool/tabs/*`，因为 tabs-next diagnostic channel 不再存在。迁移必须在同一批工作内完成，不留下半迁移目录或 compatibility shim。

## Concrete Steps

所有命令从 `/Users/wibus/dev/Cradle` 执行。

先读取权威 table 和本计划：

    sed -n '1,220p' docs/router-activity-migration/surface-ownership-table.md
    sed -n '1,260p' docs/exec-plans/20260610-01-router-activity-migration.md

编辑前确认旧 tab runtime 使用范围：

    rg -n "@cradle/tabs-next|useCradleTabStore|cradleTabStore|cradleRegistry|useCradleNavigation|useTabFrameActive|TabRenderer|TabsProvider|createUrlSync|TabBar" apps/web/src packages package.json apps/web/package.json

初始预期是 `apps/web/src`、`apps/web/src/tabs` 和 `packages/tabs-next` 中有大量匹配。迁移完成后，这个命令不得再返回 runtime source 或 package manifest 匹配；只允许历史文档或本 ExecPlan 中的迁移说明。

添加 TanStack Router dependencies：

    pnpm --filter @cradle/web add @tanstack/react-router
    pnpm --filter @cradle/web add -D @tanstack/router-plugin

在 `apps/web/vite.config.ts` 中导入 TanStack Router Vite plugin，并放在 React plugin 之前。本仓库当前安装版本的实际 import shape 是：

    import { tanstackRouter } from '@tanstack/router-plugin/vite'

plugins array 应包含：

    tanstackRouter({ target: 'react', autoCodeSplitting: true })

如果后续升级后 API 不同，先检查 `node_modules/@tanstack/router-plugin`，再把准确 import 和 options 写回 `Decision Log`。

创建 route structure：

    apps/web/src/routes/__root.tsx
    apps/web/src/routes/index.tsx
    apps/web/src/routes/chat/new.tsx
    apps/web/src/routes/chat/$sessionId.tsx
    apps/web/src/routes/workspaces/$workspaceId.tsx
    apps/web/src/routes/kanban/$boardId.tsx
    apps/web/src/routes/plugins/$routeSegment/$localId.tsx
    apps/web/src/routes/awaits.tsx
    apps/web/src/routes/automation.tsx
    apps/web/src/routes/usage.tsx
    apps/web/src/routes/settings/$section.tsx
    apps/web/src/routes/onboarding.tsx
    apps/web/src/router.tsx

root route 应渲染 app layout 和 `Outlet`。router module 应创建 router，导出 TanStack Router module augmentation 所需 type，并按 `Decision Log` 记录的 Electron URL 策略使用 hash history 或 browser history。

创建 navigation ownership files：

    apps/web/src/navigation/surface-store.ts
    apps/web/src/navigation/surface-identity.ts
    apps/web/src/navigation/navigation-commands.ts
    apps/web/src/navigation/surface-bar.tsx
    apps/web/src/navigation/surface-activity-context.tsx
    apps/web/src/navigation/surface-resource-lifecycle.ts

保持这个目录小而清晰。`surface-store.ts` 可以使用 Zustand，因为仓库已有 Zustand UI state；但它不得保存 feature business data、loader data 或 serialized React state。

把旧 tab 文件中的内容迁出。对每个 `apps/web/src/tabs/*.tab.tsx`，要么移动到 feature-owned route entry，要么内联到新 route file。删除 `defineTab()` export。用户可见 title 和 icon 通过 route metadata 或 surface store derivation 保留。

重写 app entry：

    apps/web/src/app.tsx
    apps/web/src/main.tsx
    apps/web/src/tearoff-main.tsx

`main.tsx` 渲染 normal window 的 app router，并按现有 devtool window 判定处理 `/devtool` 或 dedicated devtool runtime。`app.tsx` 不得再 import 任何 `tabs-next` API。

替换 navigation callers。重点搜索并编辑：

    apps/web/src/hooks/use-global-event-listeners.ts
    apps/web/src/components/layout/app-header.tsx
    apps/web/src/components/layout/app-layout.tsx
    apps/web/src/components/layout/app-sidebar.tsx
    apps/web/src/components/layout/dev-bottom-bar.tsx
    apps/web/src/features/search/global-search-dialog.tsx
    apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.ts
    apps/web/src/features/workspace/workspace-sidebar.tsx
    apps/web/src/features/workspace/file-tree.tsx
    apps/web/src/features/workspace-detail/workspace-detail-page.tsx
    apps/web/src/features/new-chat/new-chat-page.tsx
    apps/web/src/features/kanban/kanban-sidebar.tsx
    apps/web/src/features/kanban/issue-aside-panel.tsx
    apps/web/src/features/kanban/issue-detail/issue-description.tsx
    apps/web/src/features/plugins/plugins-sidebar.tsx
    apps/web/src/features/home/home-dashboard.tsx
    apps/web/src/features/session-await/awaits-overview.tsx
    apps/web/src/features/chat/composer/draft-chat-composer.tsx

从 `apps/web/src/features/search/global-search-dialog.tsx` 删除 Profile action，不要替换成新 route。

把 resource lifecycle 从 tab lifecycle 迁移到 surface lifecycle。替换或删除：

    apps/web/src/tabs/tab-resource-lifecycle.ts
    apps/web/src/tabs/tearoff-tabs.ts
    apps/web/src/tabs/reconcile-persisted-tabs.ts

新的 lifecycle code 应在 final owning surface close 时释放 Browser Panel owners 和 Bottom Terminal owners。owner 必须从 surface identity 和 route params 派生，不得从 `tabs-next` tab id 派生。

删除旧 package 前先确认没有 source import：

    rg -n "@cradle/tabs-next" apps/web/src packages --glob '!packages/tabs-next/**'

如果仍有匹配，先修正匹配点。清零后移除 dependency 和 package：

    pnpm --filter @cradle/web remove @cradle/tabs-next
    pnpm remove -w @cradle/tabs-next
    rm -rf packages/tabs-next

运行项目正常 route generation 或 build 流程。如果 Vite plugin 在 dev/build 时生成 `routeTree.gen.ts`，可以启动一次 dev server：

    pnpm --filter @cradle/web exec vite --host 127.0.0.1 --port 5174

确认 `apps/web/src/routeTree.gen.ts` 存在后停止 dev server。如果安装版本提供 TanStack Router CLI generation command，优先用 CLI，并把实际命令记录回本计划。

运行 focused validation：

    pnpm --filter @cradle/web exec tsc --noEmit
    pnpm --filter @cradle/web build

如果添加了 pure navigation logic tests，只运行这部分：

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/navigation

不要添加或运行 Playwright/browser automation，除非 Wibus 在实现阶段明确要求。

tear-off 和 preload-facing code 属于迁移范围，因此还要运行 desktop type validation：

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json

把所有实际命令输出写回 `Progress`、`Surprises & Discoveries` 或 `Outcomes & Retrospective`。

本次最终执行结果如下：

    pnpm --filter @cradle/web exec tsc --noEmit
    # exit 0

    pnpm --filter @cradle/web build
    # exit 0
    # summary: vite v8.0.11 built 7965 modules and emitted dist assets.
    # warnings: existing chunk size and plugin timing warnings remain non-fatal.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json
    # exit 0

    rg -n "@cradle/tabs-next|useCradleTabStore|cradleRegistry|cradleTabStore|useCradleNavigation|useTabFrameActive|TabRenderer|TabsProvider|createUrlSync|TabBar" apps/web/src packages package.json apps/web/package.json pnpm-lock.yaml
    # exit 1, no matches

    rg -n "activeTab(Id|Type|Params)|readActiveTab|activeTab:|openTabs|active tabs|active tab|open tabs|no active tab" apps/web/src/features/context apps/web/src/features/system-agent apps/web/src/locales --glob '!api-gen/**'
    # exit 1, no matches

    rg -n "settingsTabId|settings overlay|tab overlay|tabs-next state|retained app tab|retained tab frame|tab content component|Per-tab" apps/web/src --glob '!api-gen/**' --glob '!routeTree.gen.ts'
    # exit 1, no matches

    rg -n "(from ['\"]~/(tabs|tabs/)|from ['\"]\\.\\.?/tabs|apps/web/src/tabs|packages/tabs-next|tabs-next)" apps/web/src packages package.json apps/web/package.json pnpm-lock.yaml --glob '!api-gen/**' --glob '!routeTree.gen.ts'
    # only match: apps/web/src/navigation/surface-store.ts contains LEGACY_TABS_STORAGE_KEY for localStorage.removeItem('cradle:tabs-next:v1')

    rg -n "openTab\\(|/profile|openProfile|Profile" apps/web/src/features/search apps/web/src/features/workspace apps/web/src/navigation apps/web/src/routes apps/web/src/components/layout --glob '!routeTree.gen.ts'
    # only match: apps/web/src/features/workspace/README.md mentions CLI-TUI Agent Profiles, not the deleted Profile tab/action

## Validation and Acceptance

源码级验收从搜索开始。这个命令必须找不到 runtime dependency：

    rg -n "@cradle/tabs-next|useCradleTabStore|cradleRegistry|cradleTabStore|useCradleNavigation|useTabFrameActive|TabRenderer|TabsProvider|createUrlSync|TabBar" apps/web/src packages package.json apps/web/package.json

最终预期是 runtime source 和 package manifests 没有匹配。只描述历史迁移结果的 docs 匹配可以接受，但不要让 active code 或 dependency 继续引用旧 package。

web app 必须通过 TypeScript 检查：

    pnpm --filter @cradle/web exec tsc --noEmit

预期是 TypeScript success。如果 dirty worktree 中存在无关既有错误，记录准确文件和错误摘要到 `Surprises & Discoveries`，然后运行能证明迁移文件类型正确的 focused checks。

web app 必须能 build：

    pnpm --filter @cradle/web build

预期是 Vite build 成功并输出 `dist` assets，route generation 不报错。

desktop TypeScript check 必须通过，或记录无关失败：

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json

如果 Wibus 要求人肉 smoke，启动 web app：

    pnpm --filter @cradle/web dev

通过 app UI 进入 Home、New Chat、Chat Session、Workspace Detail、Kanban Board、Kanban issue focus、Settings、Awaits、Automation、Usage，以及有条件时 Plugin Panel。观察 URL 是否变为 TanStack Router routes，surface bar 是否显示打开顺序，`Cmd+W` 是否关闭 active closable surface，`Cmd+T` 是否打开 New Chat，`Ctrl+Tab` 是否切换 surfaces。

Chat Session 验收：打开一个 session，切走再回来。idle session 可以 remount，但必须从 Chat-owned cache 和 React Query 恢复。streaming session 切走时不能丢失流式状态，返回时应显示 live 或 reconciled assistant response。这证明 retention 是 domain-specific，而不是 global retained tab renderer。

Settings 验收：打开 Settings 时 URL 应进入 `/settings/$section`，不再 overlay 到隐藏 tab id。关闭 Settings 后返回合理相邻 surface 或 Home，不应改变已保存 preferences，除非用户执行显式 settings action。

resource release 验收：关闭拥有 Browser Panel 或 Bottom Terminal 的 Chat Session 或 Workspace Detail surface。Browser owner state 应移除，native browser thread 应关闭，terminal panel owner 只在没有剩余 owning surface 时停止。

Profile 删除验收：global search 和 tray actions 中不再出现 Profile action，也不存在为了替代旧 broken `openTab('profile')` 而新增的 `/profile` route。

## Idempotence and Recovery

迁移对 `@cradle/tabs-next` 是有意破坏性的，但每一步应该可重复执行。pnpm dependency command 可以重复运行；route generation 可以重复运行；surface store 和 route files 可以增量编辑；删除旧文件前必须先用 `rg` 验证 import 已清零。

不要用 `git reset --hard`、`git checkout --` 或任何 history rewrite 来恢复错误。当前 worktree 已经有无关脏改动。若某个文件里有与本任务无关的用户改动，读取当前内容并基于现状迁移，不要 revert。

只有在以下命令没有 runtime match 后才能删除 `packages/tabs-next`：

    rg -n "@cradle/tabs-next" apps/web/src packages --glob '!packages/tabs-next/**'

如果过早删除导致需要恢复，只恢复 `packages/tabs-next` 目录本身，不触碰无关文件，然后继续替换 imports。

清理 `cradle:tabs-next:v1` 是安全的，因为本计划明确拒绝旧 persisted tab migration。如果 app 需要 startup cleanup helper，应写在 Cradle Web-owned namespace 中，并通过 guarded `localStorage.removeItem('cradle:tabs-next:v1')` 做成 idempotent 行为。

如果 router 启动失败是因为缺少 route generation，运行 TanStack Router generator 或启动一次 Vite 生成 `apps/web/src/routeTree.gen.ts`，然后重新 typecheck。把实际生成命令记录到本计划。

如果 Kanban 或 Plugin Panel 的 route loader/search parser 失败，优先使用 typed TanStack Router params/search validation，不要重建旧 `serialize`/`deserialize` 通用框架。旧函数只能作为迁移参考，不应作为新 framework 留下。

## Artifacts and Notes

权威 surface ownership table 是：

    docs/router-activity-migration/surface-ownership-table.md

来自 table 的核心规则是：

    Delete @cradle/tabs-next.
    Delete the Profile tab.
    Do not migrate cradle:tabs-next:v1 persistence.
    Replace tab-local history with browser history and TanStack Router history.
    Remove generic viewState storage.
    Release hidden surfaces by default.
    Allow Activity retention only for active or streaming Chat Session and native Browser Panel ownership, unless a future plugin capability explicitly declares retention.

迁移前的高信号源码文件包括：

    apps/web/src/app.tsx
    apps/web/src/main.tsx
    apps/web/src/tearoff-main.tsx
    apps/web/src/tabs/registry.ts
    apps/web/src/tabs/chat.tab.tsx
    apps/web/src/tabs/workspace-detail.tab.tsx
    apps/web/src/tabs/kanban-board.tab.tsx
    apps/web/src/tabs/plugin-panel.tab.tsx
    apps/web/src/tabs/tab-resource-lifecycle.ts
    apps/web/src/tabs/tearoff-tabs.ts
    packages/tabs-next/src/store.ts
    packages/tabs-next/src/components/tab-renderer.tsx
    packages/tabs-next/src/url-sync.ts

迁移后的高信号源码文件应包括：

    apps/web/src/router.tsx
    apps/web/src/app-shell.tsx
    apps/web/src/routes/__root.tsx
    apps/web/src/routes/index.tsx
    apps/web/src/routes/chat/new.tsx
    apps/web/src/routes/chat/$sessionId.tsx
    apps/web/src/routes/workspaces/$workspaceId.tsx
    apps/web/src/routes/kanban/$boardId.tsx
    apps/web/src/routes/plugins/$routeSegment/$localId.tsx
    apps/web/src/routes/settings/$section.tsx
    apps/web/src/navigation/surface-store.ts
    apps/web/src/navigation/navigation-commands.ts
    apps/web/src/navigation/surface-bar.tsx
    apps/web/src/navigation/surface-activity-context.tsx
    apps/web/src/navigation/surface-resource-lifecycle.ts
    apps/web/src/features/chat/session/chat-session-route-content.tsx
    apps/web/src/features/chat/session/chat-session-frame-host.tsx
    apps/web/src/features/chat/session/streaming-chat-retention-host.tsx
    apps/web/src/features/workspace-detail/workspace-detail-route-content.tsx
    apps/web/src/features/kanban/kanban-board-route-content.tsx
    apps/web/src/features/plugins/plugin-panel-route-content.tsx

## Interfaces and Dependencies

使用 `@tanstack/react-router` 定义 route、route params、search params、loader、pending state 和 error boundary。使用 `@tanstack/router-plugin` 在 Vite 中生成 `apps/web/src/routeTree.gen.ts`。不要引入第二个 routing library。

继续使用已有 `@tanstack/react-query` 管理 server state。route loaders 可以在有价值时 prefetch 或读取现有 `QueryClient`，但 business data 必须留在 feature hooks 和 server APIs 中。不要把 Chat、Kanban、Workspace、Settings、Plugin、Browser Panel 或 Terminal 数据搬进 surface store。

Zustand 只用于 app surface list 和已有 UI stores。最终 surface store 的核心 shape 是 `id + kind + route + title + order + closable`，它不保存 loader data、business state、generic view state 或 serialized React state：

    export interface AppSurface {
      id: string
      kind: SurfaceKind
      title: string
      route: SurfaceRoute
      order: number
      closable: boolean
    }

    export interface SurfaceState {
      surfaces: AppSurface[]
      activeSurfaceId: string | null
      syncSurface: (surface: SurfaceDraft) => void
      setActiveSurfaceId: (surfaceId: string) => void
      closeSurface: (surfaceId: string) => void
      reorderSurfaces: (orderedIds: string[]) => void
      updateSurfaceTitle: (surfaceId: string, title: string) => void
      resetSurfaces: () => void
    }

`SurfaceRoute` 是 TanStack Router route target 的小型 projection，例如 `{ to: '/chat/$sessionId', params: { sessionId } }` 或 `{ to: '/kanban/$boardId', params: { boardId }, search: { issue, milestoneId } }`。这个 projection 只服务 surface activation 和 resource owner derivation，不是 route-local history 或 generic cache。

navigation commands 必须是 route-specific，并在内部调用 TanStack Router navigation。command module 应暴露类似接口：

    openHome()
    openNewChat()
    openChatSession(sessionId: string)
    openWorkspaceDetail(workspaceId: string)
    openKanbanBoard(input: { boardId: string; issueId?: string; milestoneId?: string })
    openPluginPanel(input: { routeSegment: string; localId: string })
    openSettingsSection(section: string)
    openAwaits()
    openAutomation()
    openUsage()

禁止暴露 `openTab(type, params)` 或 `navigateInTab(type, params)`。

active-surface context 只给确实需要知道 route frame active/hidden 的组件使用。优先由 route host 显式传入 `active` prop。如果必须提供 context，把它限制在 navigation code 中，不要塞入 feature business fields。

resource release 应暴露 app-surface lifecycle function，而不是包装 navigation store methods。可接受的形状是：

    releaseSurfaceResources(previousSurfaces: AppSurface[], nextSurfaces: AppSurface[]): void

实现必须从 `docs/router-activity-migration/surface-ownership-table.md` 描述的 surface identity 推导 Browser Panel owners 和 Terminal owners。

Revision note, 2026-06-10 02:10 +0800: 初始 ExecPlan 在 Wibus 确认 route-first singleton surface table 后创建，并记录 table ref、一次性迁移和无兼容债务要求。

Revision note, 2026-06-10 02:14 +0800: 将 ExecPlan 正文改为中文，新增明确的“务必注意”段落，并把 `docs/router-activity-migration/surface-ownership-table.md` 提升为本计划的权威 ref。

Revision note, 2026-06-10 08:52 +0800: 按 Wibus 要求补强 ExecPlan 内部 ref，把 surface ownership table 明确为实现 guard 和验收 audit 输入，并记录对应 decision。

Revision note, 2026-06-10 09:24 +0800: 完成迁移实现后的计划收口，记录 TanStack Router route migration、app-owned surface store/bar、Settings first-class route、Profile 删除、Chat streaming retention driver 修正、旧 Tailwind source 清理、最终验证命令和验收结果。
