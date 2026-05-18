# Chat Loading State 问题 — Exploration Report

## 数据加载管道

```
用户点击侧栏 SessionItem
├─ Link.onClick → navigateInTab() → store.navigateTab()
│   └─ 修改 tab.params = { sessionId }
└─ tab-renderer 检测到 params 变化
    ├─ RouteLoaderBoundary:
    │   └─ setState({ status: 'loading' })
    │   └─ 显示 loaderFallback (全屏 spinner)    ← ★ 用户看到的 loading
    │   └─ loader(): fetch('/chat/sessions/{id}/messages')  ← ★ 绕过 RQ 缓存
    │   └─ setState({ status: 'success', data })
    └─ 挂载 ChatTabContent(loaderData=rows)
        └─ useChatSession(sessionId, { initialSnapshotRows: loaderData })
            └─ useQuery({ initialData: loaderData })  ← RQ 缓存此时才写入
```

## 根因

### 1. Tab loader 阻塞式 + 绕过 React Query 缓存
- `RouteLoaderBoundary` 在 `status=loading` 时直接渲染 spinner，完全阻塞组件挂载
- chat tab 的 `loader` 使用原生 `fetch()` 直接请求 API，**不通过 React Query**
- 每次切换都全量网络请求 → 显示 spinner

### 2. Zustand store 无持久化
- `messagesMap` 纯内存 Map，数据在但 RouteLoaderBoundary 的 LoaderState 会重置

### 3. 无 prefetch 机制
- `Link` 组件无 `onMouseEnter` prefetch
- 侧栏 `SessionItem` 无 hover 预取
- 没有调用 `queryClient.prefetchQuery()`

### 4. 双通道不对齐
- Tab loader: `fetch()` → loaderData（每次重新请求）
- useChatSession: React Query useQuery（有 30s staleTime）
- loader 数据仅作为 React Query 的 `initialData`，但 loader 本身每次都要 fetch

## 修复方案（按可行性排序）

### P0：移除 tab loader 的阻塞式 fetch（最高优先）
- 删除 chat tab 的 `loader` + `loaderFallback`
- 让 ChatTabContent 直接挂载，依赖 useChatSession 的 React Query 获取数据
- 如果 Zustand store 已有消息 → `isReady` 立即 true → 零 loading
- 如果 RQ cache 有且未 stale → 同步返回 → 零 loading
- 首次进入（无缓存）→ ChatView 内部轻量 skeleton

### P1：侧栏 hover prefetch（互补）
- `SessionItem` onMouseEnter → `queryClient.prefetchQuery(getMessagesOptions(sessionId))`
- ~10 行代码，用户悬停 200ms 后数据已在缓存

### P2：保留 loader 但走 RQ 缓存
- 改 loader 为 `queryClient.ensureQueryData()` 走 RQ 缓存
- 已访问的 session 在 30s 内零 loading

### 不需要 SSR
问题的根源是 tab loader 的阻塞式设计 + 绕过缓存，不是 SSR/离线问题。解决 P0 后，RQ 30s staleTime + Zustand 内存缓存已足够实现近即时渲染。
