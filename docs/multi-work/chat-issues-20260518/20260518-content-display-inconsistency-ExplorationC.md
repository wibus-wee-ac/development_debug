# Chat Content Display Inconsistency — Exploration Report

## 现象
- 打开 chat A → 正常
- 切到 chat B → 显示 A 的内容
- 切到 chat C → 正常
- 刷新 URL 恢复正常
- 偶发性

## 数据层排除

每条数据路径均按 `sessionId` 隔离：
- Zustand: `messagesMap.get(sessionId)` 
- React Query: queryKey 含 sessionId
- Loader: fetch `/chat/sessions/${sessionId}/messages`
- Streaming: `ChatStreamingHandler` 绑定 `this.sessionId`

**数据层不可能交叉污染。问题在渲染层。**

## 根因：React 19 Activity + RouteLoaderBoundary 竞态

### 机制

React 19 的 `<Activity>` 管理 tab 的 hidden/visible。关键行为：
- Hidden → visible: effects cleanup 在 hide 时已执行，setup 在 show 时重新执行
- DOM: `display: none !important` 在 hidden 时应用，visible 时移除

切换 Tab B 从 hidden → visible 的时序：

```
1. React 移除 display:none → Tab B 的 last-committed DOM 立即可见
2. Effects 重新执行
3. RouteLoaderBoundary useEffect: setState({ status: 'loading' })  ← 异步
4. 步骤1和3之间：浏览器显示 Tab B 的 last-committed DOM（可能是旧的）
5. React 处理批量更新：status=loading → spinner → ChatTabContent 卸载
6. Loader 完成 → ChatTabContent 重新挂载（正确数据）
```

**Bug 窗口在步骤1和5之间**：用户看到 Tab B 的 last-committed DOM。

### 为什么显示错误内容

Tab B hidden 期间 Zustand 订阅被 cleanup，store 更新不会触发 re-render。DOM 停留在 hide 前的状态。如果 hide 前恰好存在某种渲染异常（virtualizer measurements 过期、viewport ref 为 null），DOM 就可能显示非预期内容。

### 为什么偶发

需要同时满足：
1. Tab 在 Activity pool 中（hidden 而非 evicted）
2. Effects 在 Activity 转换时重新运行
3. RouteLoaderBoundary loader 有网络延迟
4. last-committed DOM 与期望不同

## 修复方案

### Fix 1（主修）：RouteLoaderBoundary 跳过重复 fetch
已有相同 paramsKey 且 status=success 时，不重置为 loading：

```tsx
useEffect(() => {
  if (!loader) return
  if (state.paramsKey === currentParamsKey && state.status === 'success') return
  // ... 原有 fetch 逻辑
}, [currentParamsKey, loader, tab.params])
```

### Fix 2（安全网）：Activity 重激活时强制 re-render
```tsx
const [, forceRender] = useReducer(x => x + 1, 0)
useLayoutEffect(() => { forceRender() }, [])
```

### Fix 3（virtualizer 兜底）：viewport ref 赋值容错
延迟 querySelector，Activity display:none 解除后再赋值。
