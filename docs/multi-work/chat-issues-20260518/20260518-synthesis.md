# Chat 问题综合分析 — Synthesis Report

## 核心发现：三个问题共享同一根因

4个问题表面独立，但深层都指向 **`RouteLoaderBoundary` 阻塞式设计** 这一共同根因：

| 问题 | 直接原因 | 根本原因 |
|------|---------|---------|
| 1. 不滚到底部 | session-change effect 竞态 + viewportRef 时序 | loader 延迟 + 异步 hydration |
| 2. 偶发内容错乱 | Activity 重激活时 last-committed DOM + loader 重 fetch | loader 重置 status=loading 触发卸载/重挂载 |
| 3. Right Aside 闪烁 | useEffect 异步注册 slot + loader 阻塞组件 | loader 阶段 slot 不存在 |
| 4. Loading 态 | loader 绕过 RQ 缓存直接 fetch | 阻塞式 loader 设计 |

**如果解决 RouteLoaderBoundary 的阻塞式 loader 问题，4个问题中的3个（2/3/4）会大幅缓解或彻底解决。**

## 统一修复策略

### Phase 1：消除阻塞式 loader（解决问题 2/3/4）

**核心变更：`RouteLoaderBoundary` 支持 stale-while-revalidate**

不是删掉 loader，而是让 loader 不再阻塞渲染：
- 如果已有 `loaderData`（params 未变 + status=success）→ 直接渲染组件，后台 revalidate
- 首次进入（无数据）→ 仍显示 skeleton（但由业务组件控制，不是外部 loaderFallback）

这样：
- 问题 2：Activity 重激活不触发 unmount/remount → 无 stale DOM 闪烁
- 问题 3：ChatTabContent 始终挂载 → slot 始终注册 → aside 不消失
- 问题 4：已访问 session 切换零 loading

### Phase 2：修复滚动竞态（解决问题 1）

独立于 Phase 1。用 `hasScrolledForSessionRef` 替代 `prevSessionIdRef` 守卫，等 messages 实际到达后再 scrollToIndex。

辅助：将 `viewportRef` 直接传给 ScrollArea 组件。

### Phase 3：Right Aside 架构加固（可选，可扩展性）

**方案 B：声明式 Slot Registry**

Tab 定义层声明 `slots: { hasAside: true }`：
- LayoutSlotsProvider 用 tab 类型声明决定 aside 框架显隐
- aside 内容由组件 useEffect 填充
- AppLayout aside DOM 始终挂载，用 width/opacity 控制

这是长期方案，提供真正的可扩展性（新 tab 类型自动受益）。

### Phase 4：Prefetch（互补）

侧栏 SessionItem hover 时 `queryClient.prefetchQuery()`。~10 行代码。

## 优先级

```
Phase 1 (RouteLoaderBoundary SWR)  ← 影响最大，解决 3/4 个问题
  ↓
Phase 2 (Scroll fix)              ← 独立，简单
  ↓
Phase 3 (Slot registry)           ← 架构改进，非紧急
  ↓
Phase 4 (Prefetch)                ← 锦上添花
```

## 不需要 SSR

所有问题均源于客户端数据流设计（阻塞 loader + 异步注册 + 竞态），不涉及 SSR。React Query 30s staleTime + Zustand 内存 + 非阻塞 loader = 近即时渲染。
