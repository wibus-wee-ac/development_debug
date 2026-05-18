# Scope

本次审查覆盖 `packages/tabs-next` 的架构边界与运行时语义，重点包括 store、provider、renderer、URL sync、hooks、components、tests、package API 和 README。按任务约束，本次未修改业务代码；唯一写入是本文档。

审查时也抽样读取了 `apps/web` 的接入点，用来判断 `@cradle/tabs-next` 的公开 API 是否已经形成实际外部依赖。结论基于当前 working tree，不假设 main branch 状态。

# Files Inspected

`packages/tabs-next`:

- `packages/tabs-next/README.md`
- `packages/tabs-next/package.json`
- `packages/tabs-next/tsconfig.json`
- `packages/tabs-next/src/index.ts`
- `packages/tabs-next/src/types.ts`
- `packages/tabs-next/src/store.ts`
- `packages/tabs-next/src/provider.tsx`
- `packages/tabs-next/src/context.ts`
- `packages/tabs-next/src/url-sync.ts`
- `packages/tabs-next/src/route-definition.ts`
- `packages/tabs-next/src/hooks/use-tab-navigation.ts`
- `packages/tabs-next/src/components/tab-renderer.tsx`
- `packages/tabs-next/src/components/tab-bar.tsx`
- `packages/tabs-next/src/components/tab-link.tsx`
- `packages/tabs-next/src/components/screen-coordinates.ts`
- `packages/tabs-next/src/debug.ts`
- `packages/tabs-next/src/cn.ts`
- `packages/tabs-next/src/__tests__/store.test.ts`
- `packages/tabs-next/src/__tests__/renderer-policy.test.ts`
- `packages/tabs-next/src/__tests__/use-tab-navigation.test.tsx`

App-side usage sampled:

- `apps/web/src/app.tsx`
- `apps/web/src/tabs/registry.ts`
- `apps/web/src/tabs/README.md`
- `apps/web/src/components/layout/app-header.tsx`
- `apps/web/src/tabs/chat.tab.tsx`
- `apps/web/src/tabs/workspace-detail.tab.tsx`

# Findings

## High - `url-sync` 是复杂状态机，但没有测试覆盖

`packages/tabs-next/src/url-sync.ts:108` 到 `packages/tabs-next/src/url-sync.ts:335` 同时处理 cold URL parse、store subscription、`popstate`、`pushState` / `replaceState` 选择、closed tab repair 和 hash serialization。这个文件顶部已经记录了多条设计权衡，说明行为并非显然正确。当前测试只覆盖 `store`、`chooseMountedTabIds` 和 `useTabNavigation`；`rg` 未发现 `createUrlSync`、`parseHash`、`popstate` 的测试。

风险是后续任何 tab lifecycle 或 routing 改动都可能无意破坏浏览器 Back/Forward、Electron hash deep link 或 persisted restore reconciliation。这里属于用户可见导航正确性问题，不应只靠手工验证。

## High - `popstate` 恢复 tab location 时没有同步 `label`

`url-sync` 的 `onPopstate` 在恢复历史位置时直接 `store.setState` 更新 `contexts` 和 `tabs`，但只写入 `type` 与 `params`，没有更新 `label`：见 `packages/tabs-next/src/url-sync.ts:243` 到 `packages/tabs-next/src/url-sync.ts:252`。相比之下，store 内部的 `navigateTab()` 会根据 route title 更新 `label`，见 `packages/tabs-next/src/store.ts:306` 到 `packages/tabs-next/src/store.ts:319`。

结果是浏览器 Back/Forward 可以让 tab 内容切回旧 route，但 tab bar title 仍停留在上一个 location 的 title，尤其影响 `chat`、`workspace-detail` 这类 label 依赖 params 或异步数据的 tab。这个问题来自 URL sync 直接写 store，绕过了 store action 的不变量。

## Medium - persisted `contexts.history` 校验不足，可能恢复到已删除 route 的空白页

`sanitizeTabs()` 会丢弃 unknown `tab.type`，见 `packages/tabs-next/src/store.ts:110` 到 `packages/tabs-next/src/store.ts:120`。但 `sanitizeContexts()` 只校验 history entry 存在且 `location.routeId` 是 string，未校验 route 是否仍在 `registry`，见 `packages/tabs-next/src/store.ts:145` 到 `packages/tabs-next/src/store.ts:151`。如果某个 valid tab 的 tab-local history 当前 index 指向已删除 route，`TabRenderer` 会因为 `registry[location.routeId]` 不存在而返回 `null`，见 `packages/tabs-next/src/components/tab-renderer.tsx:123` 到 `packages/tabs-next/src/components/tab-renderer.tsx:129`。

这和 README 中的 restore hygiene ownership 不完全一致。包声明自己拥有 restore hygiene，但目前只清理 tab identity，不完整清理 tab-local history。

## Medium - package API 暴露了 raw store/context，route owner 正在跨边界写 tab runtime

`packages/tabs-next/src/index.ts:11`、`packages/tabs-next/src/index.ts:17`、`packages/tabs-next/src/index.ts:18` 导出了 `TabsContext`、`useTabsContext`、`TabStoreState`、`createTabStore`。app 侧 tab content 直接通过 `useTabsContext().store` 修改 runtime label，例如 `apps/web/src/tabs/chat.tab.tsx:64` 到 `apps/web/src/tabs/chat.tab.tsx:121`，以及 `apps/web/src/tabs/workspace-detail.tab.tsx:16` 到 `apps/web/src/tabs/workspace-detail.tab.tsx:40`。

这种耦合短期方便迁移，但长期会让 route owner 依赖 tabs package 的内部 store shape，也让 tabs package 很难收紧不变量。按照仓库 ownership 原则，route owner 可以提供 metadata/capabilities，但不应直接写 tab runtime namespace 的低层结构。

## Medium - persisted `viewState` 是 unbounded `unknown`，localStorage budget 和 ownership 不清晰

`TabContextState.viewState` 是 `Record<string, unknown>`，见 `packages/tabs-next/src/types.ts:72` 到 `packages/tabs-next/src/types.ts:80`。`partialize` 会持久化整个 `contexts`，包括 `viewState`，见 `packages/tabs-next/src/store.ts:428` 到 `packages/tabs-next/src/store.ts:433`。`TabRenderer` 会把滚动位置写进 `viewState`，见 `packages/tabs-next/src/components/tab-renderer.tsx:101` 到 `packages/tabs-next/src/components/tab-renderer.tsx:103` 和 `packages/tabs-next/src/components/tab-renderer.tsx:200` 到 `packages/tabs-next/src/components/tab-renderer.tsx:208`。

当前 scroll positions 有 `MAX_SCROLL_POSITIONS = 64` 的数量上限，但没有 per-entry size、schema version、route namespace、TTL 或 serialization contract。随着更多 route owner 使用 `updateTabViewState()`，这个字段可能把业务状态写入 tabs namespace，并持续膨胀 localStorage。Vercel React best practices 中的 `client-localstorage-schema` 也建议对 localStorage 数据做版本化和最小化。

## Medium - `TabRenderer` 自带 `route.loader` 数据层，与 app 的 TanStack Query ownership 可能冲突

`TabRouteDefinition.loader` 定义在 `packages/tabs-next/src/types.ts:64`，`TabRenderer` 的 `RouteLoaderBoundary` 用 `useEffect` 自行执行 Promise 并管理 `loading/success/error`，见 `packages/tabs-next/src/components/tab-renderer.tsx:331` 到 `packages/tabs-next/src/components/tab-renderer.tsx:394`。但 app 当前主要使用 TanStack Query 在 route content 内部取数，例如 `apps/web/src/tabs/chat.tab.tsx:67` 到 `apps/web/src/tabs/chat.tab.tsx:91`。

如果保留 `route.loader`，tabs package 就开始拥有数据加载、缓存、重试、错误边界与取消语义；这和 README 中“package does not own business data”的边界有冲突。若只是迁移占位，它应该被标记为 experimental 或移到 app adapter。

## Medium - `TabBar` 拖拽全局 listener 缺少 unmount cleanup

`TabBar` 在 `handleDragStart` 中向 `window` 添加 capture 阶段的 `pointermove` listener，见 `packages/tabs-next/src/components/tab-bar.tsx:165` 到 `packages/tabs-next/src/components/tab-bar.tsx:174`。清理只发生在 `checkTearOff()`，由 drag end/cancel 调用，见 `packages/tabs-next/src/components/tab-bar.tsx:176` 到 `packages/tabs-next/src/components/tab-bar.tsx:222`。

如果 `TabBar` 在拖拽过程中因 route/layout 切换或 HMR 卸载，listener 可能残留。虽然这是低频路径，但它位于 app shell 顶层，属于交互基础设施，应把 listener lifecycle 绑定到 React unmount。

## Low - Activity pool 的 `maxMountedTabs` 不是硬上限，README 未说明

`chooseMountedTabIds()` 会先加入 active tab，再加入所有 pinned 或 `keepAlive === 'always'` 的 tab，随后才检查 `maxMountedTabs`，见 `packages/tabs-next/src/components/tab-renderer.tsx:50` 到 `packages/tabs-next/src/components/tab-renderer.tsx:81`。因此 pinned/always tab 数量超过上限时，实际 mounted 数量会超过 `maxMountedTabs`。

这可能是合理策略，但现在 README 只说 `activity-pool` 会保留 active tab plus recent retained tabs，见 `packages/tabs-next/README.md:12` 到 `packages/tabs-next/README.md:15`，没有说明 pinned/always 是 soft-limit escape hatch。对性能调优而言，这个语义需要显式化。

## Low - README 文件清单已落后于实际 package surface

`packages/tabs-next/README.md:30` 到 `packages/tabs-next/README.md:43` 没有列出 `src/url-sync.ts`、`src/components/tab-link.tsx`、`src/debug.ts`、`src/cn.ts`、`src/__tests__/use-tab-navigation.test.tsx`。但这些文件已经通过 `src/index.ts` 进入公开或半公开 surface，例如 `Link`、`createUrlSync`、debug constants。

这不影响运行时，但会降低 package ownership 和 review 可读性。仓库规则也要求目录变化时更新 README。

# Recommended Changes

1. 为 `url-sync` 建立 jsdom 测试基线，然后再修行为。
   覆盖 `buildHash()` / `parseHash()`、cold URL opens existing/new tab、tab switch uses `pushState`、replace navigation uses `replaceState`、`popstate` restores tab + history index + label、closed tab history entry repair、`destroy()` removes listeners。

2. 把 URL-to-store 更新收口到 store action。
   避免 `url-sync` 手写 `store.setState` 拼装 partial state。可以新增专用 action，例如 `restoreTabHistoryIndex(tabId, historyIndex)`，由 store 内部统一更新 `contexts`、`tabs.type`、`tabs.params`、`tabs.label` 和 `lastActiveAt`。

3. 加强 persisted context schema。
   `sanitizeContexts()` 应校验每个 `history.location.routeId` 是否存在于 `registry`，并处理 current entry invalid 的情况。策略可以是 prune invalid entries 后 clamp index；若 history 为空则基于 tab 当前 `type + params` 重建 context。

4. 收窄 app-facing API。
   保留 `createTabStore` 作为 app registry 的 composition point，但逐步减少 route content 使用 `useTabsContext().store`。建议新增更窄的 hook/action，例如 `useCurrentTab()`, `useTabActions()`, `useTabMetadataUpdater()`，让 route owner 只提交 metadata intent，而不是直接读写 store shape。

5. 给 `viewState` 定义持久化 contract。
   至少需要 route-scoped key、version、size budget 和 sanitizer。滚动位置可以继续由 package 管理，但任意 `unknown` 不宜默认持久化。更稳妥的方向是 `viewState` 默认 runtime-only，只有 package-owned snapshot 或 route 显式声明的 serializable snapshot 才进入 persisted state。

6. 明确 `route.loader` 的归属。
   如果 tabs package 不拥有业务数据加载，应移除或标记 experimental，并推荐 route component 使用 TanStack Query。如果要保留，则需要 loader cache/dedupe/retry/error boundary/abort semantics，并和 app 的 QueryClient 策略对齐。

7. 为 `TabBar` 增加 unmount cleanup。
   用 `useEffect` cleanup 调用 `dragCleanupRef.current?.()` 并清空 refs；同时增加一个拖拽中 unmount 的单测或组件测试。

8. 更新 `packages/tabs-next/README.md`。
   补齐文件清单、公开 API、URL sync 行为、debug API、Activity pool soft-limit 语义，以及迁移期 raw store API 的边界说明。

# Risks

- URL sync 修复会触碰浏览器历史语义，容易改变用户对 Back/Forward 的感觉。应先测试锁定当前有意行为，再做最小改动。
- 收窄 raw store API 会影响 `apps/web/src/tabs/*.tab.tsx` 和 devtool 的现有用法，建议分阶段提供新 hook，再迁移 call sites，最后才隐藏低层导出。
- 改 persisted schema 需要兼容已有 `cradle:tabs-next:v1` localStorage 数据。不能直接假设旧数据干净，应保留 repair path。
- 调整 `viewState` 持久化可能影响滚动恢复体验。需要在性能、localStorage budget 和 UX 之间明确取舍。

# Validation

建议新增或运行的验证命令：

```bash
pnpm vitest run packages/tabs-next/src/__tests__
pnpm exec tsc --noEmit -p packages/tabs-next/tsconfig.json
pnpm --filter @cradle/web exec tsc --noEmit
pnpm --filter @cradle/web build
```

建议新增测试点：

- `url-sync` jsdom tests: `pushState` / `replaceState` spy、`PopStateEvent` restore、unknown hash ignored、closed tab repair。
- Store restore tests: persisted context history 包含 removed route、current index invalid、history prune 后 active tab 仍可渲染。
- Renderer tests: `maxMountedTabs` soft-limit 文档化后覆盖 pinned/always 超限行为。
- Component test: `TabBar` drag start 后 unmount 会移除 global `pointermove` listener。

人工验证：

- 打开多个 `chat` / `workspace-detail` tab，使用 app 内导航和浏览器 Back/Forward，确认内容与 tab label 同步。
- 在 Electron hash mode 下冷启动 deep link，确认能复用 existing tab 或新建 tab，并且不会破坏 home pinned tab。
- 打开 devtool tabs panel，确认 debug stream 在 tab 切换、close、renderer retention 下仍能工作。

# Uncertainties

- 未运行测试；本文件是架构审查 handoff，不是修复 PR。
- 未完整审查所有 `apps/web/src/tabs/*.tab.tsx` 的 route capability 使用，只抽样检查了 `chat` 和 `workspace-detail`。
- `React <Activity>` 的当前运行时稳定性与项目 React 版本相关，本审查只检查 package-level policy，不评价 React canary/stable API 风险。
- 不确定 `route.loader` 是否有近期迁移计划；如果它只是临时 prototype surface，建议在 README 标明生命周期。
