<!-- Input: AGENTS.md, frontend architecture ExecPlan, apps/web shell/navigation source files -->
<!-- Output: Shell and navigation architecture review handoff -->
<!-- Position: Multi-work frontend architecture review artifact for ExplorationA -->

# Shell Navigation ExplorationA

## Scope

本次审查聚焦 Cradle web 前端的 application shell 与 navigation 集成边界：

- `apps/web/src/app.tsx` 中的 provider、`TabRenderer`、settings overlay、URL sync 初始化。
- `apps/web/src/components/layout/` 中 header、sidebar、main layout、layout slot、right aside 的 ownership 与状态边界。
- `apps/web/src/tabs/` 中 registry、tab definitions、navigation wrapper 与 shell 的耦合方式。

本次没有修改业务代码，只写入此 handoff 文件。审查基于当前 working tree；其中 `apps/web/src/components/layout/app-header.tsx` 已存在未提交改动，未回滚也未覆盖。

## Files Inspected

- `AGENTS.md`
- `docs/exec-plans/20260518-05-frontend-architecture-review.md`
- `apps/web/src/app.tsx`
- `apps/web/src/components/layout/app-layout.tsx`
- `apps/web/src/components/layout/app-header.tsx`
- `apps/web/src/components/layout/app-sidebar.tsx`
- `apps/web/src/components/layout/app-footer.tsx`
- `apps/web/src/components/layout/layout-slots-context.tsx`
- `apps/web/src/components/layout/use-layout-slots.ts`
- `apps/web/src/components/layout/right-aside.tsx`
- `apps/web/src/components/layout/README.md`
- `apps/web/src/tabs/registry.ts`
- `apps/web/src/tabs/use-cradle-navigation.ts`
- `apps/web/src/tabs/chat.tab.tsx`
- `apps/web/src/tabs/home.tab.tsx`
- `apps/web/src/tabs/new-chat.tab.tsx`
- `apps/web/src/tabs/workspace-detail.tab.tsx`
- `apps/web/src/tabs/kanban-board.tab.tsx`
- `apps/web/src/tabs/plugin-panel.tab.tsx`
- `apps/web/src/tabs/README.md`
- `packages/tabs-next/src/url-sync.ts`
- `packages/tabs-next/src/hooks/use-tab-navigation.ts`
- `packages/tabs-next/src/components/tab-renderer.tsx`
- `packages/tabs-next/src/components/tab-bar.tsx`
- `packages/tabs-next/src/store.ts`

## Findings

### High: `LayoutSlotsProvider` 会在非 chat tab 上保留上一个 chat 的 panel slot

证据：

- `apps/web/src/app.tsx:63-67` 只在 active tab 是 `chat` 时把 `activeSlotId` 设为 `sessionId`，否则传 `null`。
- `apps/web/src/components/layout/layout-slots-context.tsx:38-41` 仅当 `activeSlotId` truthy 且已注册时才更新 `activeId`，没有在 `activeSlotId === null` 或目标 slot 未注册时清空 `activeId`。
- `apps/web/src/components/layout/layout-slots-context.tsx:82` 使用 `state.activeId` 直接返回 slots。
- `apps/web/src/tabs/chat.tab.tsx:54-57` chat tab 用 `sessionId` 注册 `hasPanel` 与 `panel`。
- `apps/web/src/components/layout/app-layout.tsx:68-69` 和 `apps/web/src/components/layout/app-layout.tsx:144-175` 会把当前 slots 解析成 bottom panel。
- `apps/web/src/components/layout/app-header.tsx:124-135` 根据 `hasPanel` 展示 bottom panel toggle。

影响：

切换路径类似 `chat with workspace -> open bottom panel -> home/new-chat/workspace-detail` 时，layout slot 可能仍来自上一个 chat session。结果是非 chat tab 仍显示 bottom panel toggle，甚至保留旧 session 的 `ShellView` panel。这是 shell 状态和 tab 内容生命周期之间的实际行为风险，不只是抽象边界问题。

建议：

- 将 `LayoutSlotsProvider` 的有效 slots 明确派生自当前 active tab，而不是内部 fallback 到最后注册的 slot。
- 当 `activeSlotId` 为 `null`、未注册、或对应 tab 不再 active 时返回 `{}`。
- 更稳妥的 key 是 tab id，而不是 `sessionId`。如果未来允许同一 session 多 tab 或 tab-local history 改变 route，`sessionId` 不能表达 tab context owner。
- 为该行为补一个 regression test 或 E2E：打开有 workspace 的 chat bottom panel，切换到 `home` 或 `new-chat`，断言 `data-testid="app-header-panel-toggle"` 与 `data-testid="app-layout-bottom-panel"` 不存在。

### High: Shell 多处直接解释 tab store 与 tab type，ownership 边界过宽

证据：

- `apps/web/src/app.tsx:63-69` 直接从 `useCradleTabStore` 推导 active chat session 与 settings visibility。
- `apps/web/src/app.tsx:71-87` 在 app root 中修复 home tab 数量，并直接 `setState` 删除重复 home tabs。
- `apps/web/src/app.tsx:89-94` 在 app root 初始化 `createUrlSync`。
- `apps/web/src/components/layout/app-layout.tsx:70-73` 直接读取 active tab 并判断 `activeTab?.type === 'chat'`。
- `apps/web/src/components/layout/app-header.tsx:29-41` 直接读取 tab store、判断 chat tab、创建 `new-chat` tab。
- `apps/web/src/components/layout/app-sidebar.tsx:36-54` 直接绑定 settings overlay 到 active tab id。

影响：

`AppRuntime`、`AppLayout`、`AppHeader`、`AppSidebar` 都在重复理解 tab semantics。shell 组件因此不再只是 layout/chrome owner，而是部分拥有 tabs namespace、settings overlay namespace、chat session capability。后续新增 tab type、tab-local route、settings route 或 plugin panel 时，很容易继续在 shell 里增加 `tab.type` 判断，形成中心化条件分支。

建议：

- 在 `apps/web/src/tabs/` 或 shell adapter 层提取一个明确的 app-owned navigation facade，例如 `useActiveShellRoute()`、`useActiveLayoutCapabilities()`、`openPrimaryCreationTab()`。
- 让 tab definitions 暴露 shell capability metadata，例如 `layout: { rightAside: ..., bottomPanel: ... }` 或 `getLayoutSlots(params)`，由 shell 消费 capability，而不是消费具体 `tab.type`。
- app root 可以保留 provider wiring，但 home tab reconciliation、URL sync、cold start recovery 应收敛到 tabs owner 模块，避免 `AppRuntime` 直接改 tabs store internals。

### Medium: Settings overlay 绑定 tab id，但没有 tab lifecycle cleanup

证据：

- `apps/web/src/features/settings/settings-overlay-store.ts:7-21` 只保存 `settingsTabId` 与 section，没有校验 tab 是否仍存在。
- `apps/web/src/app.tsx:68-69` 只在 `settingsTabId === activeTabId` 时显示 overlay。
- `apps/web/src/components/layout/app-sidebar.tsx:44-54` 用当前 active tab id 打开 settings。
- `packages/tabs-next/src/store.ts:270-285` closing tab 会删除 tab 与 context，但 settings store 不会同步清理。

影响：

如果 settings 绑定到一个可关闭 tab，关闭该 tab 后 `settingsTabId` 会悬空。短期 UI 可能只是 overlay 消失；长期风险是 sidebar/header/settings presentation 的状态判断依赖过期 tab id。`app-header.tsx:54-65` 还会为已不存在的 `settingsTabId` 构造 `tabPresentation`，虽然 `TabBar` 当前不会渲染该 id，但状态语义已经不一致。

建议：

- settings overlay owner 应订阅 tab close 或 active tab change，关闭不存在的 `settingsTabId`。
- 更好的模型是把 settings 作为 explicit tab route，或作为 shell mode route，并定义清晰的 URL/history 策略。
- 如果继续使用 overlay 模型，增加一个 selector，例如 `useIsSettingsActiveForExistingTab()`，统一处理 existence check。

### Medium: `LayoutSlots` 接口承诺 aside，但实际 aside 由 `AppLayout` 硬编码为 chat session

证据：

- `apps/web/src/components/layout/layout-slots-context.tsx:9-14` 暴露 `aside` 与 `hasAside`。
- `apps/web/src/components/layout/README.md:18` 也说明 layout slots 支持 `aside`。
- `apps/web/src/components/layout/app-layout.tsx:68-69` 只解析 `panel` 与 `hasPanel`。
- `apps/web/src/components/layout/app-layout.tsx:178-214` right aside 由 `activeTab?.type === 'chat'` 派生的 `activeSessionId` 固定渲染 `RightAside`。

影响：

接口与实现不一致。调用方会以为任意 tab 可以注入 aside，但当前 shell 只支持 chat session aside。Kanban、workspace detail、plugin panel 如果需要右侧上下文面板，只能继续改 `AppLayout` 或绕开 slot system，增加 shell 和 domain feature 的双向耦合。

建议：

- 二选一收敛：要么删除/暂不公开 `aside` slot 字段，只保留当前实际支持的 `panel`；要么让 `AppLayout` 真正消费 active slot 的 `aside` 与 `hasAside`。
- 如果 `RightAside` 是 chat-owned，应移动 capability 到 `chat.tab.tsx` 或 chat feature 的 shell adapter，让 layout 只渲染 supplied aside node。
- README 应同步为真实 contract，避免后续 agent 按文档扩展出错误用法。

### Medium: `useCradleNavigation` 作为 app navigation wrapper 仍是 stringly typed

证据：

- `apps/web/src/tabs/use-cradle-navigation.ts:14-20` 的 `type` 参数是 `string`，`params` 是 `Record<string, string | undefined>`。
- `apps/web/src/tabs/registry.ts:15-23` 已经有 `cradleRegistry` 的 literal type 信息。
- `packages/tabs-next/src/hooks/use-tab-navigation.ts:26-44` 底层同样接收 string route id。

影响：

feature 代码通过 wrapper 导航时，无法在编译期校验 route id 与 params shape。shell/navigation 重构后，这会成为长期维护风险：拼写错误、缺参、错误 param key 会延后到运行时或 URL parse 阶段暴露。

建议：

- 在 `apps/web/src/tabs/` 增加 app-level typed route map，例如从 `typeof cradleRegistry` 推导 `CradleTabType` 与对应 params。
- `useCradleNavigation()` 暴露 typed overload 或 typed commands，例如 `openChatTab(sessionId)`、`openWorkspaceTab(workspaceId)`、`openKanbanBoardTab(boardId, issue?)`。
- 底层 package 可以保持泛型 API；app wrapper 负责把 Cradle 的 navigation contract 类型化。

### Low: Layout/tabs README 与源码职责有漂移

证据：

- `apps/web/src/components/layout/README.md:12` 提到 `AppHeader` 有 workspace/title/git breadcrumb slot rendering，但当前 `apps/web/src/components/layout/app-header.tsx:76-149` 主要是 sidebar toggle、`TabBar`、resources popover、panel toggles。
- `apps/web/src/components/layout/README.md:13` 描述 `AppLayout` 为 pure three-column layout shell，但源码 `apps/web/src/components/layout/app-layout.tsx:70-87` 直接读取 active tab、settings store、Jarvis UI store，并在 `apps/web/src/components/layout/app-layout.tsx:112-140` 管理 Electron browser panel。
- `apps/web/src/tabs/README.md:13-14` 描述 `reconcile-persisted-tabs.ts` 是启动清理，但 `rg` 没有发现生产代码引用 `reconcilePersistedTabs`。

影响：

文档会误导后续拆分 owner：layout 是否 pure、slot 是否支持 aside、persist reconciliation 是否实际运行都不清楚。对于多 agent 并行改造，这类漂移会放大重复实现或错误迁移的概率。

建议：

- 在修复行为问题后同步更新 `components/layout/README.md` 与 `tabs/README.md`。
- 如果 `reconcilePersistedTabs` 确实应在启动执行，把调用接入 tabs startup owner；如果只是计划遗留，应在 README 标明未接入或删除未使用入口。

## Recommended Changes

优先级建议：

1. 先修 `LayoutSlotsProvider` 的 stale slot 行为。该问题有明确用户可见风险，改动范围小，验证路径清晰。
2. 建立 shell 与 tabs 的 app-level adapter。短期可先集中 selectors 与 commands，不必一次性重写 tab package。
3. 收敛 settings overlay 生命周期。至少在 active tab 不存在时清理 `settingsTabId`；中期再决定 settings 是 tab route 还是 shell mode。
4. 明确 right aside 的 owner。若未来只有 chat 使用，则不要在 `LayoutSlots` 暴露 `aside`；若希望多 tab 共享，则让 tab capability 注入 aside content。
5. 给 `useCradleNavigation` 加 app-level 类型。优先覆盖高频 commands，逐步替换 raw string navigation。
6. 更新 README，使文档反映真实 contract 与启动流程。

## Risks

- 修复 stale slot 时，如果简单在 `activeSlotId === null` 时清空 slots，隐藏 tab 中仍 mounted 的 chat slot 不应被 unregister；需要区分 registered map 与 active slot projection。
- 把 settings 改成真实 tab route 会影响 URL/history/back 行为，需先定产品语义。轻量 cleanup 比直接迁移风险低。
- 让 `AppLayout` 消费 arbitrary `aside` slot 会改变 right aside mount lifecycle，可能影响 `FileTree`、`GitPanel`、`AwaitPanel`、`PackCodebaseDialog` 的缓存与 query 生命周期。
- navigation wrapper 类型化可能暴露现有调用点的 param shape 不一致，需要分阶段落地。
- 本 review 基于当前 working tree，不保证覆盖其他并行 agent 正在改动后的最终状态。

## Validation

建议验证命令：

- `pnpm --filter @cradle/web exec tsc --noEmit`
- `pnpm --filter @cradle/web build`
- `pnpm --filter @cradle/web test -- apps/web/src/tabs/reconcile-persisted-tabs.test.ts apps/web/src/tabs/workspace-detail.tab.test.tsx`
- 如果添加 layout slot 测试，建议覆盖 `LayoutSlotsProvider` 在 `activeSlotId` 为 `null`、未注册 id、切换已注册 id 时的 slots projection。

建议人工检查：

- 打开一个有 workspace 的 chat，打开 bottom panel，切到 `home`、`new-chat`、`workspace-detail`，确认 bottom panel toggle 和 panel 不泄漏。
- 在 chat tab 打开 settings，切换 tab，确认 settings 只在绑定 tab active 时可见；关闭绑定 tab 后确认 settings state 被清理。
- Electron 环境下检查 chat browser panel toggle 仍只在 chat tab 出现，settings overlay 不暴露 browser/right aside/bottom panel。
- 使用 browser back/forward 检查 `createUrlSync` 的 tab switch 与 tab-local navigation 仍符合 `packages/tabs-next/src/url-sync.ts` 的设计注释。

## Uncertainties

- 没有运行 app 或测试，行为判断来自源码路径与 state flow 推断。
- settings overlay 是否刻意不进入 URL/history 未在当前材料中看到明确产品决策。
- `LayoutSlots.aside` 是否是未完成设计还是历史遗留不确定，需要与 tabs package review 和 chat rendering review 结果合并判断。
- `reconcilePersistedTabs` 未被生产代码引用可能是计划中的后续接入，也可能已有其他启动路径未被本次 scope 覆盖。
