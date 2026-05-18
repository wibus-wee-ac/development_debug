# Chat Scroll-to-Bottom Bug — Exploration Report

## 定位结果

| 文件 | 行号 | 内容摘要 |
|------|------|---------|
| chat-view.tsx | L312-L320 | `viewportRef` 通过 `useEffect` + DOM querySelector 异步设置 |
| chat-view.tsx | L349-L354 | `scrollToBottom()` 回调：`vp.scrollTop = vp.scrollHeight` |
| chat-view.tsx | L358-L376 | Session-change scroll effect — 含 `prevSessionIdRef` 守卫 + `scrollToIndex` |
| chat-view.tsx | L379-L383 | Auto-scroll fallback — 依赖 `isAtBottomRef` + `scrollToBottom()` |
| chat-view.tsx | L97-L98 | `ScrollArea` 未传递 `viewportRef` 属性 |
| use-chat-session.ts | L215-L233 | Hydration effect：异步将 snapshot rows 写入 Zustand store |
| chat.tab.tsx | L175 | `ChatView` 使用 `key={sessionId}`，每次 session 切换完全重新挂载 |

## 根因

Session-change scroll effect 使用 `prevSessionIdRef` 作为守卫，只允许 sessionId 变化时执行 `scrollToIndex`。但由于 messages 通过 Zustand store 异步加载（从 react-query initialData → useEffect hydration → store update → re-render），首次执行时 messages 为空，而 messages 到达时守卫已阻止再次执行。

### 时序链

```
Render 1: messages = [] (store 为空)
├─ session-change effect: prevSessionIdRef !== sessionId → 进入
│  ├─ messages.length === 0 → 跳过 scrollToIndex ← ❌ 关键遗漏
│  └─ 设置 prevSessionIdRef = sessionId
├─ auto-scroll: isAtBottomRef=true → scrollToBottom() → 无内容可滚

Render 2: messages = [...hydrated]
├─ session-change effect: prevSessionIdRef === sessionId → early return ← ❌ 
├─ auto-scroll: scrollToBottom() → 对虚拟列表不可靠
```

## 修复方案

用 `hasScrolledForSessionRef` 替代 `prevSessionIdRef` 守卫：

```tsx
const hasScrolledForSessionRef = useRef(false)
useEffect(() => {
  if (prevSessionIdRef.current !== sessionId) {
    prevSessionIdRef.current = sessionId
    hasScrolledForSessionRef.current = false
  }
  if (hasScrolledForSessionRef.current || messages.length === 0) return
  hasScrolledForSessionRef.current = true
  virtualizerRef.current?.scrollToIndex(messages.length - 1, { align: 'end' })
  requestAnimationFrame(() => {
    const vp = viewportRef.current
    if (vp) vp.scrollTop = vp.scrollHeight
  })
}, [messages.length, sessionId])
```

辅助：将 `viewportRef` 直接传给 `ScrollArea` 组件（它已接受该 prop），移除 DOM querySelector effect。
