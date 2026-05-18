# State and Data Flow Architecture Review

## Scope

本 handoff 聚焦 `apps/web` 前端状态与数据流架构，审查范围包括：

- `apps/web/src/store/` 下全局 Zustand store 的 ownership、持久化、selector 与 server state 边界。
- 代表性的 `apps/web/src/features/*/use-*.ts` hooks，重点看 TanStack Query、mutation invalidation、feature-local state 和直接 `fetch`。
- `apps/web/src/api-gen/` 的 generated TanStack Query helper 使用方式，只在判断 query key 与 API ownership 时抽样查看。
- TanStack Query 与 Zustand 的交界处，尤其是 chat streaming snapshot、workspace/session/cache invalidation、feature-local persistence。

未修改业务代码。本次唯一写入文件是当前 handoff。

## Files Inspected

- `AGENTS.md`
- `docs/exec-plans/20260518-05-frontend-architecture-review.md`
- `apps/web/src/store/README.md`
- `apps/web/src/store/chat.ts`
- `apps/web/src/store/layout.ts`
- `apps/web/src/store/new-chat.ts`
- `apps/web/src/store/theme.ts`
- `apps/web/src/store/streamdown.ts`
- `apps/web/src/store/browser-panel.ts`
- `apps/web/src/store/session-activity.ts`
- `apps/web/src/store/persist-storage.ts`
- `apps/web/src/features/chat/use-chat-session.ts`
- `apps/web/src/features/chat/use-session-await.ts`
- `apps/web/src/features/composer-toolbar/use-composer-state.ts`
- `apps/web/src/features/agent-runtime/use-agent-models.ts`
- `apps/web/src/features/agent-runtime/use-agent-profiles.ts`
- `apps/web/src/features/agent-runtime/use-agents.ts`
- `apps/web/src/features/workspace/use-workspace.ts`
- `apps/web/src/features/workspace/use-session.ts`
- `apps/web/src/features/workspace/use-workspace-files.ts`
- `apps/web/src/features/workspace/file-tree.tsx`
- `apps/web/src/features/workspace-detail/use-workspace-file.ts`
- `apps/web/src/features/workspace-detail/workspace-detail-page.tsx`
- `apps/web/src/features/git/use-git.ts`
- `apps/web/src/features/kanban/use-kanban.ts`
- `apps/web/src/features/kanban/use-view-config.ts`
- `apps/web/src/features/search/use-thread-search.ts`
- `apps/web/src/features/skills/use-skills.ts`
- `apps/web/src/features/system-agent/use-jarvis-preferences.ts`
- `apps/web/src/features/system-agent/use-context-snapshot.ts`
- `apps/web/src/features/approval/use-approval.ts`
- `apps/web/src/features/devtool/observability/use-observability-events.ts`
- `apps/web/src/features/devtool/plugins/use-plugin-data.ts`
- `apps/web/src/features/devtool/tabs/use-tabs-debug-store.ts`
- `apps/web/src/lib/client.config.ts`
- `apps/web/src/lib/electron.ts`
- `apps/web/src/lib/plugin-store.ts`
- `apps/web/src/lib/plugin-host.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/tabs/chat.tab.tsx`
- `apps/web/src/tabs/workspace-detail.tab.tsx`
- `apps/web/src/components/layout/right-aside.tsx`
- `apps/web/src/api-gen/@tanstack/react-query.gen.ts`
- `apps/web/src/api-gen/client.gen.ts`
- `apps/web/src/api-gen/sdk.gen.ts`

## Findings

### High - Query key ownership is split between generated keys and hand-written string keys

前端同时使用 generated query key 和手写 string tuple key。`apps/web/src/api-gen/@tanstack/react-query.gen.ts:17` 生成的 key 形态是单元素 object tuple，包含 `_id`、`baseUrl`、`path`、`query` 等字段；但很多 feature 仍然手写 `['workspaces']`、`['workspace', id]`、`['workspace-detail', id]`、`['workspace-files', id]`、`['skills', ...]`、`['kanban', ...]`。

证据：

- `apps/web/src/features/git/use-git.ts:7` 到 `apps/web/src/features/git/use-git.ts:21` 使用 generated `getWorkspacesByIdGitStatusQueryKey` 等，并 re-export 给调用侧，边界较清晰。
- `apps/web/src/features/workspace/use-workspace.ts:12` 定义 `WORKSPACES_QUERY_KEY = ['workspaces']`，而 generated `getWorkspacesQueryKey` 已存在于 `apps/web/src/api-gen/@tanstack/react-query.gen.ts:140`。
- `apps/web/src/tabs/workspace-detail.tab.tsx:18` 使用 `['workspace', params.workspaceId]`，`apps/web/src/components/layout/right-aside.tsx:59` 和 `apps/web/src/tabs/chat.tab.tsx:126` 使用 `['workspace-detail', workspaceId]`，三者都读取同一个 workspace 详情 API，但 cache namespace 不同。
- `apps/web/src/features/workspace/use-workspace-files.ts:13` 与 `apps/web/src/features/workspace/file-tree.tsx:40` 都使用 `['workspace-files', workspaceId]`，但没有集中 key builder；如果参数形态扩展，容易分叉。
- `apps/web/src/features/skills/use-skills.ts:32` 到 `apps/web/src/features/skills/use-skills.ts:35` 自建 skills key，mutation 多处用 `queryClient.invalidateQueries({ queryKey: ['skills'] })` 做前缀失效。

影响：

- 同一 server resource 在多个 cache namespace 中重复存在，导致 stale data、重复请求和 invalidation 漏洞。
- mutation 无法稳定推断需要失效哪些 cache。比如 workspace rename 后，`['workspace', id]`、`['workspace-detail', id]`、generated `getWorkspacesByIdQueryKey` 可能不会一起更新。
- generated key object 包含 `baseUrl`，手写 key 不包含；如果未来支持多 server/window context，缓存隔离语义会不一致。

### High - `useChatSession` duplicates server snapshot into Zustand and owns streaming state in the same hook

`apps/web/src/features/chat/use-chat-session.ts` 是当前最大的数据流复杂点：TanStack Query 负责 server snapshot rows，Zustand `useChatStore` 负责 messages、subagent messages、generation state、error map、passive status；同一个 hook 同时执行 hydration、SSE passive observer、optimistic append、本地 streaming handler、query invalidation。

证据：

- `apps/web/src/features/chat/use-chat-session.ts:161` 到 `apps/web/src/features/chat/use-chat-session.ts:180` 通过 generated options 查询 snapshot rows。
- `apps/web/src/features/chat/use-chat-session.ts:202` 到 `apps/web/src/features/chat/use-chat-session.ts:227` 在 effect 中把 query data 写入 `useChatStore`。
- `apps/web/src/features/chat/use-chat-session.ts:245` 到 `apps/web/src/features/chat/use-chat-session.ts:277` 订阅 run event，并根据 `locallyDriving` 决定是否写入 passive status。
- `apps/web/src/features/chat/use-chat-session.ts:282` 到 `apps/web/src/features/chat/use-chat-session.ts:355` 负责 optimistic user message、stream reader pump、handler finish/fail、server snapshot refresh。
- `apps/web/src/store/chat.ts:187` 到 `apps/web/src/store/chat.ts:195` 的 `stopGeneration` 在 store action 中直接调用 generated API `postChatSessionsBySessionIdCancel`，使 store 从纯 client state owner 变成 API orchestration owner。

影响：

- Query cache 与 Zustand store 存在双写源。`snapshotRowsQuery.data` 更新、SSE 事件、本地 stream delta 可能以不同顺序到达，靠 `locallyDriving` 和 debounce 协调，推理成本高。
- `ChatState` 同时保存 server-derived messages 和 transient UI/abort state，长期看会让更多 server state 被塞进 Zustand。
- store action 直接调用 API 让测试和 ownership 模糊：取消 generation 是 chat command 语义，不是单纯 state mutation。

### Medium - Feature data hooks inconsistently wrap generated API

代码库已经有 generated `queryOptions`、`queryKey`、mutation helpers，但使用策略不一致。有些 feature 直接使用 generated options，有些只用 SDK function，有些绕过 `api-gen` 用 raw `fetch`。

证据：

- `apps/web/src/features/git/use-git.ts:25` 到 `apps/web/src/features/git/use-git.ts:53` 是较好的模式：feature hook 封装 generated options，并 re-export query key builder。
- `apps/web/src/features/system-agent/use-jarvis-preferences.ts:15` 到 `apps/web/src/features/system-agent/use-jarvis-preferences.ts:19` 使用 generated options；但 mutation 自己调用 `putPreferencesJarvis` 并手动 `setQueryData`。
- `apps/web/src/features/agent-runtime/use-agent-profiles.ts:18` 到 `apps/web/src/features/agent-runtime/use-agent-profiles.ts:24`、`apps/web/src/features/workspace/use-workspace.ts:14` 到 `apps/web/src/features/workspace/use-workspace.ts:23` 使用 SDK function + handwritten key。
- `apps/web/src/features/devtool/observability/use-observability-events.ts:56` 到 `apps/web/src/features/devtool/observability/use-observability-events.ts:80` 用 Zustand action + raw `fetch` 加载 server state。
- `apps/web/src/features/devtool/plugins/use-plugin-data.ts:24` 到 `apps/web/src/features/devtool/plugins/use-plugin-data.ts:45` 用 local React state + raw `fetch`，无法利用 TanStack Query dedupe、retry、cache 和 visibility refetch 策略。
- `apps/web/src/lib/plugin-host.ts:54` 到 `apps/web/src/lib/plugin-host.ts:99` 在 React render 前加载 plugin，使用 raw `fetch` 有合理性，但和 `usePluginData` 重复了 `/api/plugins` 数据获取路径。

影响：

- 同类 GET server state 的 loading/error/cache 行为不一致。
- 调用侧需要记住每个 feature 的 query key 细节，增加 invalidation 出错概率。
- raw `fetch` 路径没有统一 `createClientConfig`、`throwOnError`、request validation 和 future auth/header 注入。

### Medium - Persisted client state lacks a single versioned storage policy across feature-owned stores

`apps/web/src/store` 下的 persisted stores 基本使用 `persistStorage` 和 `cradle:*:v1` key，方向正确；但 feature-local persisted state 仍有不同策略。

证据：

- `apps/web/src/store/layout.ts:61` 到 `apps/web/src/store/layout.ts:74` 使用 `name: 'cradle:layout:v1'`、`version: 1`、`partialize` 和 `persistStorage`。
- `apps/web/src/store/new-chat.ts:69` 到 `apps/web/src/store/new-chat.ts:73` 使用 `cradle:new-chat:v1`。
- `apps/web/src/store/theme.ts:23` 到 `apps/web/src/store/theme.ts:27` 使用 `cradle:theme:v1`。
- `apps/web/src/features/system-agent/jarvis-ui-store.ts:31` 到 `apps/web/src/features/system-agent/jarvis-ui-store.ts:59` 使用 `persist`，但 key 是 `jarvis-ui`，没有 `version`，也没有使用 `persistStorage`。
- `apps/web/src/features/kanban/use-view-config.ts:59` 到 `apps/web/src/features/kanban/use-view-config.ts:83` 直接读写 `localStorage`，key 为 `kanban-view-config-${workspaceId}` 和 `kanban-view-filter-${workspaceId}`，没有 version、schema reconcile 或 restricted environment fallback。
- `apps/web/src/lib/plugin-host.ts:12` 到 `apps/web/src/lib/plugin-host.ts:24` 暴露 plugin localStorage namespace `cradle-plugin:${pluginName}:`，符合隔离方向，但没有 quota/error handling。

影响：

- 未来迁移持久化格式时，global store 和 feature store 的升级路径不一致。
- 测试、非浏览器环境或 restricted storage 下，feature-local localStorage 可能抛错。
- key 命名不统一，削弱 Cradle namespace ownership 的可观察性。

### Medium - Cross-feature invalidation is encoded ad hoc in mutations

一些 mutation 知道并直接失效其他 feature 的 query key。这在小规模下可接受，但随着 feature 变多，会形成隐式数据依赖图。

证据：

- `apps/web/src/features/kanban/use-kanban.ts:54` 导入 `sessionsQueryKey`，`apps/web/src/features/kanban/use-kanban.ts:561` 到 `apps/web/src/features/kanban/use-kanban.ts:565` 在 agent session rerun 后失效 workspace session list。
- `apps/web/src/features/workspace-detail/workspace-detail-page.tsx:433` 到 `apps/web/src/features/workspace-detail/workspace-detail-page.tsx:434` 同时失效 workspace detail 和 workspace list。
- `apps/web/src/features/new-chat/new-chat-page.tsx` 失效 `sessionsQueryKey(effectiveWorkspaceId)`，但 session detail key、chat snapshot key 是否也应更新需要调用者自己判断。
- `apps/web/src/features/workspace/workspace-sidebar.tsx` 同时失效 session list 与 generated session detail key，说明局部已经感知到 key 分裂问题。

影响：

- mutation 的 domain owner 不清晰：Kanban feature 需要知道 Workspace session cache；Workspace detail 需要知道 Workspace list cache；Chat 创建后需要知道 session/sidebar cache。
- 当 query key 迁移到 generated key 或 feature key factory 后，调用侧容易漏改。

### Low - Some Zustand selectors subscribe to broad objects

多数 store 已经使用 selector，但仍有组件直接订阅整个 store 或返回新数组的 selector。

证据：

- `apps/web/src/components/layout/app-header.tsx` 使用 `const { bottomPanelOpen, asideOpen, ... } = useLayoutStore()`，会订阅 layout store 全量 state。
- `apps/web/src/features/browser/browser-panel.tsx` 使用 `const { tabs, activeTabId, createTab, closeTab, setActiveTab, updateTab, navigateTo } = useBrowserPanelStore()`，会在任意 browser panel state/action identity 变化时重渲染。
- `apps/web/src/store/chat.ts:281` 到 `apps/web/src/store/chat.ts:282` 的 `messageIds` selector 每次运行都会 `map` 出新数组；如果直接订阅该 selector，需要配合 shallow equality 或改成 stable derived data。

影响：

- 当前不是阻塞问题，但在 chat streaming、browser panel、layout resize 等高频路径上，容易形成不必要渲染。

### Positive - Global store ownership has started moving in the right direction

`apps/web/src/store/README.md` 明确 store 命名和用途；`layout.ts` 只保留 shell layout state，settings overlay 和 Jarvis UI 已迁回 feature-owned store；persisted global stores 使用 `cradle:*:v1` key 和 safe storage wrapper。

这与仓库的 ownership/namespace 原则一致，建议作为后续迁移基线，而不是推翻重写。

## Recommended Changes

### 1. Establish a query key ownership policy

建议定义一个轻量规则：

- 对 generated API 能覆盖的 GET：feature hook 默认使用 `~/api-gen/@tanstack/react-query.gen` 的 `getXOptions` 和 `getXQueryKey`。
- 如果 feature 需要更友好的 domain API，就像 `features/git/use-git.ts` 一样封装 generated options，并 re-export feature-owned key builder。
- 禁止组件直接发明同一 resource 的新 key。组件应调用 feature hook 或 imported key builder。
- 对确实不是 generated API 的资源，例如 plugin bootstrap，可以显式标注为 bootstrap-only path，避免和 React Query server state 混用。

优先迁移目标：

- Workspace: 合并 `['workspaces']`、`['workspace', id]`、`['workspace-detail', id]` 到 `useWorkspaceQueries` 或 generated `getWorkspaces*QueryKey`。
- Sessions: 评估 `sessionsQueryKey(workspaceId)` 是否改用 generated `getSessionsQueryKey({ query: { workspaceId } })`。
- Skills: 保留 feature-specific context key 也可以，但应集中导出 `skillsKeys`，不要在 mutation 中散落 `['skills']`。
- Kanban: 保留 `kanbanKeys`，但 mutation invalidation 应只调用 `kanbanKeys.*` helper，不再手写 `['kanban', 'issues']`。

### 2. Split chat store into server snapshot projection and transient stream state

不建议一次重写 chat。更稳的演进路径：

- 第一步：把 `useChatSession` 中的 server snapshot hydration 提取成纯函数或小 hook，例如 `useChatSnapshotBridge(sessionId, snapshotRowsQuery)`，只负责 `projectMainMessagesFromSnapshotRows`、subagent bucket、passive status。
- 第二步：把 `stopGeneration` 的 API call 从 `apps/web/src/store/chat.ts` 移回 chat command/hook 层，store action 只做 abort controller cleanup 和 state transition。
- 第三步：明确 `useChatStore` 的 owner 是 transient chat view state，包括 optimistic local turn、streaming message parts、abort controllers、visible status overlay；TanStack Query 仍是 canonical server snapshot owner。
- 第四步：为 locally-driving 与 passive observer 的竞态写专门测试，覆盖 local stream 期间 server snapshot 到达、remote run failed、abort 后 snapshot refresh 等场景。

### 3. Use TanStack Query for devtool/plugin server state where lifecycle allows

- `useObservabilityDevtoolStore` 可以拆成 `useObservabilityEntriesQuery`，用 `useQuery` + `Promise.all` 获取 events/incidents；selected row 继续留在 Zustand 或 local state。
- `usePluginData` 可以使用 `useQuery({ queryKey: ['plugins'], queryFn })`，visibility refresh 改成 `refetchOnWindowFocus` 或显式 `refetch`。
- `plugin-host` 的 startup loading 可以保留 raw `fetch`，但应共享同一个 `fetchPluginList` function，避免 `/api/plugins` 解析逻辑分叉。

### 4. Normalize persisted client state

- 为 feature-local persisted Zustand store 使用 `persistStorage`、`version` 和 `cradle:<feature>:<name>:vN` key，例如 `cradle:jarvis-ui:v1`。
- 为 direct localStorage hooks 提供小型 adapter，例如 `readVersionedJson` / `writeVersionedJson`，包含 try/catch、schema default、future migration hook。
- `useViewConfig` 的 `workspaceId` 变化时，目前 lazy initializer 不会重新从新 workspace key 读取初始值；如果该 hook 会在同一 mounted component 中切换 workspace，需要增加 `workspaceId` effect 来 reload config/filter。

### 5. Create mutation-side invalidation helpers

为跨 feature invalidation 建议集中成 domain helper，而不是在 mutation 内散写：

- `invalidateWorkspace(workspaceId)`
- `invalidateWorkspaceList()`
- `invalidateWorkspaceSessions(workspaceId)`
- `invalidateChatSession(sessionId)`
- `invalidateKanbanIssue(issueId)`

这些 helper 可以只包一层 `queryClient.invalidateQueries`，但能把依赖图显式化，也方便后续迁移 query key。

### 6. Tighten Zustand selector usage on hot paths

- 对 layout/browser panel 这类全局 store，组件侧改成多个 primitive selectors 或使用 shallow selector。
- 对 `chatSelectors.messageIds` 这种返回新数组的 selector，要么用 `useShallow`，要么把稳定 ids 缓存在 store update 阶段，避免 streaming 时产生额外 renders。

## Risks

- Query key 迁移风险在于旧 cache namespace 和新 namespace 短期并存。建议按 feature 分阶段迁移，并在 mutation invalidation 中临时兼容旧 key，完成后删除。
- Chat 状态拆分风险较高。它涉及 streaming、SSE passive observer、server snapshot reconciliation、abort/cancel。必须用现有测试先锁住行为，再做小步提取。
- 统一 `localStorage` policy 可能改变用户已有偏好 key。应提供 migrate 或 soft fallback，不能直接丢弃旧 key。
- Raw `fetch` 改为 generated API 时，要确认对应 endpoint 是否存在于 OpenAPI；例如 `/api/plugins` 当前似乎不是 generated route，不能强行迁入 `api-gen`。

## Validation

推荐验证命令：

```bash
pnpm --filter @cradle/web exec tsc --noEmit
pnpm --filter @cradle/web test -- --run apps/web/src/store/chat.test.ts apps/web/src/features/chat/use-chat-session.test.ts apps/web/src/features/chat/use-chat-session-binding.test.tsx
pnpm --filter @cradle/web test -- --run apps/web/src/store/new-chat.test.ts apps/web/src/store/session-activity.test.ts
pnpm --filter @cradle/web build
```

建议新增或强化的测试点：

- Workspace detail rename 后，tab label、right aside、workspace detail page、workspace list 都读取同一 cache 或都被正确 invalidated。
- Chat locally-driving stream 期间，server snapshot refetch 不覆盖本地 streaming message；stream finish 后 server canonical message IDs 能同步回来。
- Passive chat run failed/completed 事件在非 active tab、reload 后和多窗口情况下能正确更新 visible status。
- `useViewConfig` 在 mounted component 中切换 `workspaceId` 时，能加载新 workspace 的 view/filter config。
- Persisted store 在 `localStorage` 不可用时不会抛错。

## Uncertainties

- 本 review 基于 2026-05-18 工作区当前状态；`git status` 显示 `apps/web/src/features/chat/*`、`apps/web/src/features/devtool/*`、`apps/web/src/features/new-chat/new-chat-page.tsx` 等已有未提交改动，部分问题可能正处于重构中。
- 未运行测试或构建；结论来自代码阅读与静态证据。
- 未完整审查所有组件级 `useQuery` 调用，只抽样了与 state/data flow 边界相关的代表路径。
- 未确认 `/api/plugins`、`/observability/*` 等 raw `fetch` endpoint 是否计划纳入 OpenAPI；若它们故意不进入 generated client，应在代码中记录该 ownership 决策。
