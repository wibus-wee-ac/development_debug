# Browser React Doctor Review - ReviewA

## Scope

本 handoff 审查当前 Browser React Doctor 相关改动，未修改业务代码。读取输入包括：

- `docs/exec-plans/20260606-02-react-doctor-health.md`
- `docs/multi-work/react-doctor-health/20260606-hooks-data-flow-ExplorationA.md`
- `docs/multi-work/react-doctor-health/20260606-compiler-purity-ExplorationB.md`
- `docs/multi-work/react-doctor-health/20260606-scan-scope-ExplorationC.md`
- `apps/web/src/features/browser/browser-panel.tsx`
- `apps/web/src/features/browser/browser-annotation-overlay.tsx`
- 辅助证据：`apps/web/src/store/browser-panel.ts`、`apps/desktop/src/main/browser-manager.ts`、`apps/web/src/env.d.ts`

重点覆盖 React 19 data flow、render-phase state adjustments、external-system sync effects、stale async request guards、native bounds preview、annotation session lifecycle，以及最近的 `Too many re-renders` 事故风险。

## Executive Summary

当前 Browser 改动里有一个必须修的真实回归：`BrowserPanel` render body 仍在直接调用 `setAnnotationSession` / `setAnnotationSubmitting`。这类 render-phase adjustment 虽然在极窄条件下可能有限收敛，但它正好落在 React 19 / React Compiler 最敏感路径，也和最近 `Too many re-renders` 事故同类，应从 render path 移出。

其余 async/external sync 代码整体比 baseline 更有防护：local server discovery、native bounds preview、annotation design preview 都有 request id guard。但 annotation lifecycle 仍有几个数据流风险：旧 element adjustment session 在选择 region/point 后不会清理、overlay unmount cleanup 会无条件清全局 adjustment session、start annotation 的截图/扫描请求没有 stale guard。

## Findings

### 1. True bug: annotation session is reset during render

证据：

- `apps/web/src/features/browser/browser-panel.tsx:823` 在 render body 判断 `annotationSession !== null && annotationSession.tabId !== activeBrowserTabId`。
- `apps/web/src/features/browser/browser-panel.tsx:824` 直接调用 `setAnnotationSession(null)`。
- `apps/web/src/features/browser/browser-panel.tsx:825-827` 在同一个 render pass 内可能继续调用 `setAnnotationSubmitting(false)`。
- `apps/web/src/features/browser/browser-panel.tsx:829-832` 随后再用 `annotationSession?.tabId === activeBrowserTabId` 派生 `activeAnnotationSession`。

分类：true bug / regression risk。

为什么是真问题：

- 这是 render-phase state adjustment，不是事件处理，也不是 effect 中同步外部系统。
- 条件通常会在下一次 render 收敛，但它仍会在 React render path 触发更新；最近的 `Too many re-renders` 事故说明这里不应继续保留这种模式。
- 这里实际需要的是“按 active tab 派生当前可见 session”，而不是在 render 期间清理 state。

建议：

- render body 只派生 `activeAnnotationSession`，不要调用 setter。
- 把跨 tab cleanup 放到 `useEffect`，并让 effect 同时 invalidate annotation async request、清 runtime draft、清 submitting。
- 更稳的结构是把 `annotationSession` keyed by `tabId` 或把 `activeBrowserTabId` 写入 session request token，避免靠 render 自修复。

验证：

- 切换 browser tab 时不应出现 `Too many re-renders`。
- 在 annotation overlay 打开时切换到非 browser tab、workspace tab、blank tab，都不应触发 render-phase setter。

### 2. True bug: old adjustment session survives after selecting a region or point

证据：

- `apps/web/src/features/browser/browser-annotation-overlay.tsx:296-300` 选择有效 region 时只执行 `setAnchor(region)` 和 `setEditorOverride(null)`，没有清理 `annotationAdjustmentSession`。
- `apps/web/src/features/browser/browser-annotation-overlay.tsx:301-320` 小区域点击时，只有命中 element 才调用 `setAnnotationAdjustmentSession(...)`；未命中 element 的 point 分支没有清理旧 session。
- `apps/web/src/features/browser/browser-panel.tsx:1155-1213` parent effect 只看全局 `annotationAdjustmentSession.selectedElement`，只要 session 还存在就会继续 `applyAnnotationDesign` / `selectAnnotationElement` 并刷新 screenshot。
- `apps/web/src/features/browser/browser-annotation-overlay.tsx:231-239` overlay 的 `activeDesignChange` 会因当前 `selectedElement` 为空而变成 `null`，但这不会阻止 parent effect 对旧 selected element 工作。

分类：true bug。

影响：

- 用户先选 element 并调整样式，再改选 region/point，旧 element adjustment session 仍可能继续驱动 native runtime preview。
- 保存 region/point 时 `designChange` 会是 `null`，但截图可能已经被旧 element preview 污染。

建议：

- 在 region anchor 和 point anchor 分支显式 `setAnnotationAdjustmentSession(null)`。
- 如果新 element 与旧 element selector 不同，保留当前 set 新 session 行为。
- parent design-preview effect 最好再额外校验 active annotation anchor 仍是同一个 element；不要只信全局 adjustment session。

验证：

- 选 element 调整样式后，再拖 region 保存，保存的 screenshot 不应包含旧 element preview。
- 选 element 后点击空白 point，adjustment aside/session 应退出或变为空。

### 3. Risk: overlay unmount cleanup clears a global adjustment session unconditionally

证据：

- `apps/web/src/features/browser/browser-annotation-overlay.tsx:425-430` unmount cleanup 无条件调用 `setAnnotationAdjustmentSession(null)`。
- `apps/web/src/store/browser-panel.ts:265-270` `BrowserAnnotationAdjustmentSession` 是全局单值，带 `ownerId` / `tabId` 字段但 store 本身不是 per-owner map。
- `apps/web/src/store/browser-panel.ts:1005-1007` `setAnnotationAdjustmentSession` 直接覆盖全局 session，没有 compare-and-clear 语义。
- `apps/web/src/features/browser/browser-panel.tsx:1711-1736` 编辑已保存 annotation 时会先设置 adjustment session，再设置 `annotationSession`；overlay key 变化可能导致旧 overlay cleanup 清掉新 session。

分类：risk。

影响：

- 在 annotation overlay key 切换、owner 切换、快速 edit saved annotation 时，旧 overlay 的 cleanup 可能清掉刚写入的新 adjustment session。
- 这类 bug 通常表现为 adjustment aside 打开但设计变更不再同步，或者 element selection preview 突然丢失。

建议：

- cleanup 应只清理自己拥有的 session：读取 store 当前 session，匹配 `ownerId`、`tabId`，必要时匹配 `initialAnnotation?.id ?? null` 后再清。
- 更好的 store API 是 `clearAnnotationAdjustmentSession(input)`，由 store 负责 compare-and-clear，避免 UI 组件直接写全局 null。

验证：

- 打开新 annotation 后切到编辑已保存 element annotation，adjustment panel 应保留目标 element 和已有 design changes。
- 多 owner/browser panel 场景下，一个 overlay unmount 不应清掉另一个 owner 的 session。

### 4. Risk: start-annotation screenshot/scan request has no stale guard

证据：

- `apps/web/src/features/browser/browser-panel.tsx:1499-1544` `handleStartAnnotation` 捕获 `activeBrowserTabId` / `activeBrowserTabUrl` 后发起 async work。
- `apps/web/src/features/browser/browser-panel.tsx:1519-1530` 并行执行 screenshot capture 和 element scan。
- `apps/web/src/features/browser/browser-panel.tsx:1532-1543` await 后直接隐藏 native bounds 并 `setAnnotationSession({ tabId: activeBrowserTabId, ... })`。
- 对比已有 guard：`localServerDiscoveryRequestRef` 在 `apps/web/src/features/browser/browser-panel.tsx:860-895` 使用 request id；`nativeBoundsPreviewRequestRef` 在 `apps/web/src/features/browser/browser-panel.tsx:1111-1141` 使用 request id；`annotationDesignPreviewRequestRef` 在 `apps/web/src/features/browser/browser-panel.tsx:1170-1213` 使用 request id。

分类：risk。

影响：

- 用户点击 Comment 后立刻切 tab/关闭 tab，旧请求完成后仍会执行 `bridge.setBounds(... null ...)`，可能隐藏当前 tab native surface。
- 旧请求完成后设置的 session 会被当前 render-phase reset 清掉，但这又依赖 Finding 1 的不良模式。

建议：

- 新增 annotation capture request id，start/cancel/tab-change/unmount 都 invalidate。
- await 后先检查 request id、active owner、active tab 仍匹配，再写 session 或操作 native bounds。
- 修 Finding 1 后，这个 guard 更重要，因为不能再靠 render-phase reset 兜底。

验证：

- 点击 Comment 后立即切换 tab，旧 tab截图完成时不应影响当前 tab native bounds。
- 点击 Comment 后立即关闭 BrowserPanel，不应出现后续 setState warning 或 native surface 被旧请求隐藏。

### 5. Risk: native bounds preview can show stale same-tab screenshot while a new capture is pending

证据：

- `apps/web/src/features/browser/browser-panel.tsx:794-796` `nativeBoundsPreview` 存了 `tabId`、`url`、`imageDataUrl`。
- `apps/web/src/features/browser/browser-panel.tsx:1111-1127` paused preview request 成功后写入 `{ tabId, url, imageDataUrl }`。
- `apps/web/src/features/browser/browser-panel.tsx:1089-1093` 退出 paused 时只 invalidate request 并 schedule bounds sync，没有清空 preview。
- `apps/web/src/features/browser/browser-panel.tsx:1096-1108` paused 但条件不满足时也只 invalidate/hide native surface，没有清空 preview。
- `apps/web/src/features/browser/browser-panel.tsx:2065-2074` 渲染 preview 时只检查 `nativeBoundsPreview?.tabId === activeBrowserTabId`，没有检查 `url`。

分类：risk。

影响：

- 同一个 tab 导航到新 URL 后，如果 `nativeBoundsPaused` 为 true，旧 preview 可能在新截图完成前短暂显示。
- `url` 已经被存入 state 但未参与 render guard，是数据流未闭合的证据。

建议：

- 在开始新 preview request 时先清空或标记 loading。
- render guard 同时匹配 `tabId` 和 `url`，或者移除 `url` 字段并明确接受 stale preview。
- 条件不满足和退出 paused 时恢复 `setNativeBoundsPreview(null)`，除非有明确 UX 需要保留最后一帧。

验证：

- paused preview 下同 tab 导航，截图刷新前不应展示旧页面截图。
- 从 nonblank 切到 blank tab 再切回，不应闪现旧 preview。

### 6. Acceptable tradeoff: external-system sync effects are mostly valid React effects

证据：

- `apps/web/src/features/browser/browser-panel.tsx:912-939` 订阅 Electron browser state，cleanup unsubscribe/hide native browser；这是 effect 同步外部 IPC 系统。
- `apps/web/src/features/browser/browser-panel.tsx:1057-1087` `useLayoutEffect` 绑定 `ResizeObserver`、`MutationObserver`、window resize/scroll，并在 cleanup 隐藏 native surface；这是 DOM/native bounds synchronization。
- `apps/web/src/features/browser/browser-panel.tsx:1089-1153` native bounds paused preview 同步 Electron screenshot/native surface，已有 request id stale guard。
- `apps/web/src/features/browser/browser-panel.tsx:1155-1220` annotation design preview 同步 native browser runtime，已有 request id stale guard。
- `apps/desktop/src/main/browser-manager.ts:1466-1508` `scanAnnotationElements`、`selectAnnotationElement`、`applyAnnotationDesign`、`clearAnnotationDesign` 都是 native WebContents runtime side effects。

分类：acceptable tradeoff。

说明：

- React Doctor 的 `set-state-in-effect` / `no-effect-chain` baseline 会点到 BrowserPanel，但这些 effects 不是纯派生 state；它们在同步 Electron/DOM/native browser runtime。
- 不建议为了分数把这些 external sync 全部挪进 render 或事件 handler。
- 真正需要修的是 stale guard、cleanup ownership 和 render-phase setter，而不是取消这些 effects。

### 7. Doctor false positive / defer: manual memoization and inline event-handler warnings are not Browser health blockers

证据：

- baseline `react-doctor--react-compiler-no-manual-memoization.txt` 对 `browser-panel.tsx` 和 `browser-annotation-overlay.tsx` 报了大量 `useCallback` / `useMemo`。
- baseline `react-doctor--prefer-use-effect-event.txt` 报 `apps/web/src/features/browser/browser-annotation-overlay.tsx:658` 附近，但当前对应的是 user interaction path，不是 effect-only callback。
- baseline `react-doctor--rerender-state-only-in-handlers.txt` 报 `browser-annotation-overlay.tsx:451`，当前对应 `onPointerCancel={() => setDrag(null)}`，这是事件处理中的本地 drag cleanup。

分类：doctor false positive / acceptable defer。

建议：

- 不要为了 React Doctor 分数删除 Browser 的 `useCallback` / `useMemo`。这里有 Electron IPC、DOM listener、large child props、pointer drag paths，手动 memoization 仍有实际边界价值。
- 不要把普通 UI event handlers 改成 `useEffectEvent`。Effect Event 只适合 effect 内部读取最新值，不适合传给 JSX event 或第三方 callback。
- 可在高风险问题修完后，再单独做组件拆分和 memoization 策略，不应混入本次 regression fix。

## Recommended Fix Order

1. 移除 `BrowserPanel` render-phase `setAnnotationSession` / `setAnnotationSubmitting`，改为 guarded effect 或 owner/tab keyed state。
2. 在 `BrowserAnnotationOverlay` 选择 region/point 时清理 adjustment session，并让 parent preview effect 校验当前 anchor 仍匹配 selected element。
3. 把 overlay unmount cleanup 改成 compare-and-clear，避免清掉新 owner/tab/session。
4. 给 start-annotation capture/scan 增加 request id guard。
5. 收紧 native bounds preview：clear stale preview 或用 `tabId + url` guard。

## Suggested Validation

- `npx -y react-doctor@latest apps/web --verbose --diff`
- 手工路径：打开 BrowserPanel，进入 annotation，选择 element 调整样式，再改选 region/point 保存。
- 手工路径：点击 Comment 后立即切 tab/关 tab，确认无 render loop、无 stale overlay、native browser surface 正常恢复。
- 手工路径：启用 `nativeBoundsPaused`，同 tab 导航，确认 preview 不闪旧截图。

如果 `npx` 因网络或 sandbox 失败，需要按仓库执行策略申请权限后重跑。当前 ReviewA 未运行验证命令，也未修改业务源码。
