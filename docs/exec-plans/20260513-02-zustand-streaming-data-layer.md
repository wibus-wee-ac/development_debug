# Exec Plan: Zustand 流式数据层（Lobe 架构模式）

> Historical note (2026-05-16): this plan reflects an older `useChat`/chunk-accumulator era. The current chat runtime now hydrates from `messages.messageJson` snapshots and applies sequenced SSE delta events, as described in `docs/exec-plans/20260516-03-message-snapshot-chat-runtime.md`.

> **Review Status: REVISED** — 已整合 review agent 反馈

## 目标

将 `apps/web` 的聊天消息管理从 `@ai-sdk/react` 的 `useChat` hook 迁移到 Zustand store，实现：
- Per-message streaming flag（每条消息独立的流式状态）
- Fine-grained selector subscription（组件精确订阅，避免整个列表重渲染）
- keepMounted 虚拟列表优化（streaming 消息不被回收）
- 优雅的 streaming → static 转换
- Passive observer 支持（多 tab/reload 后恢复）

## 现状

```
SSE Transport → useChat (@ai-sdk/react) → messages[] → ChatView → Virtualizer → MessageBubble
```

问题：
1. `useChat` 每次 delta 更新整个 `messages` 数组引用（即使有 throttle 50ms）
2. Virtualizer 会回收 streaming 的最后一条消息 → 重新 mount → 动画重启
3. 无法对单条消息精细控制 streaming 状态
4. `isStreaming` 是从全局 `status === 'streaming'` 推导的，不是 per-message

## 目标架构

```
SSE Transport
  │
  ▼ StreamingHandler (chunk accumulator)
  │   └── text-delta → append to message content
  │   └── tool events → update tool state
  │   └── reasoning → append reasoning
  ▼ useChatStore (Zustand)
  │   ├── messagesMap: Map<sessionId, UIMessage[]>
  │   ├── generatingMessageIds: Set<string>  ← per-message streaming flag
  │   ├── activeSessionId: string | null
  │   └── actions: sendMessage, stopGeneration, etc.
  │
  ▼ Selectors (fine-grained)
  │   ├── selectMessages(sessionId) → UIMessage[]
  │   ├── selectMessage(messageId) → UIMessage
  │   ├── selectIsGenerating(messageId) → boolean
  │   └── selectGlobalStreaming() → boolean
  │
  ▼ Components subscribe via selector
      └── MessageBubble: selectMessage(id) + selectIsGenerating(id)
      └── ChatView: selectMessages(sessionId) 的 length/ids only
      └── Composer: selectGlobalStreaming()
```

## 执行步骤

### Phase 0: keepMounted 止血（立即）

在 `chat-view.tsx` 的 `<Virtualizer>` 加 `keepMounted` prop，防止 streaming 的最后一条消息被回收：

```typescript
const keepMountedIndices = useMemo(() =>
  isStreaming ? [messages.length - 1] : undefined,
  [isStreaming, messages.length],
)

<Virtualizer keepMounted={keepMountedIndices} ...>
```

零依赖、零风险、5 行代码解决虚拟列表重新动画 bug。

### Phase 1: Store 基础架构

1. **创建 `apps/web/src/store/chat.ts`**

```typescript
import type { UIMessage, UIMessageChunk } from 'ai'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

interface ChatState {
  // --- Message Data (immutable updates — each mutation produces new object refs) ---
  messagesMap: Map<string, UIMessage[]>  // sessionId → messages

  // --- Streaming State ---
  generatingMessageIds: Set<string>
  activeStreamSessionId: string | null
  activeAbortControllers: Map<string, AbortController>  // messageId → controller

  // --- Error State ---
  errorMap: Map<string, { message: string, timestamp: number }>  // messageId|sessionId → error

  // --- Actions ---
  setMessages: (sessionId: string, messages: UIMessage[]) => void
  appendChunk: (sessionId: string, messageId: string, chunk: UIMessageChunk) => void
  startGeneration: (sessionId: string, messageId: string, controller: AbortController) => void
  finishGeneration: (messageId: string) => void
  failGeneration: (messageId: string, error: string) => void
  stopGeneration: (messageId: string) => void  // abort + server cancel + finishGeneration
  clearSession: (sessionId: string) => void

  // --- Passive Observer ---
  hydrateFromServer: (sessionId: string) => Promise<void>
}

// Selectors (pure functions, stable references)
export const chatSelectors = {
  messages: (sessionId: string) => (s: ChatState) => s.messagesMap.get(sessionId) ?? [],
  messageIds: (sessionId: string) => (s: ChatState) =>
    (s.messagesMap.get(sessionId) ?? []).map(m => m.id),
  message: (sessionId: string, messageId: string) => (s: ChatState) =>
    (s.messagesMap.get(sessionId) ?? []).find(m => m.id === messageId),
  isGenerating: (messageId: string) => (s: ChatState) =>
    s.generatingMessageIds.has(messageId),
  isAnyGenerating: (s: ChatState) => s.generatingMessageIds.size > 0,
  error: (messageId: string) => (s: ChatState) => s.errorMap.get(messageId),
}
```

**Immutability contract:** `appendChunk` MUST produce new `UIMessage` and parts objects (spread/clone pattern). This ensures selectors trigger re-renders correctly.

2. **创建 `apps/web/src/store/chat-streaming-handler.ts`**

独立的 chunk 处理器，不依赖 React。复用现有 `replayChunksToAssistantMessage` 的 chunk 类型状态机：

```typescript
export class ChatStreamingHandler {
  private content = ''
  private reasoning = ''
  private currentTextPart: { type: 'text', text: string } | null = null
  private currentReasoningPart: { ... } | null = null

  constructor(
    private sessionId: string,
    private messageId: string,
    private store: UseChatStore,
    private abortController: AbortController,
  ) {
    store.getState().startGeneration(sessionId, messageId, abortController)
  }

  handleChunk(chunk: UIMessageChunk) {
    // Full state machine matching replayChunksToAssistantMessage:
    // text-start/delta/end, reasoning-start/delta/end,
    // tool-input-start/available/error, tool-output-available
    // Each mutation creates new message/parts refs (immutable)
    switch (chunk.type) {
      case 'text-delta':
        this.content += chunk.delta
        this.store.getState().appendChunk(this.sessionId, this.messageId, chunk)
        break
      case 'tool-input-start':
      case 'tool-input-available':
      case 'tool-output-available':
        // Throttled at 300ms (leading + trailing)
        this.throttledToolUpdate(chunk)
        break
      // ... full state machine
    }
  }

  finish() {
    this.store.getState().finishGeneration(this.messageId)
  }

  fail(error: string) {
    this.store.getState().failGeneration(this.messageId, error)
  }
}
```

### Phase 2: Transport 适配

3. **修改 `sse-chat-transport.ts`**

保持 `buildChunkStreamFromResponse` 和 `emitRunEvent` as-is。只改消费端：

```typescript
// Before: return ReadableStream<UIMessageChunk> for AI SDK useChat to consume
// After: pipe chunks to ChatStreamingHandler → Zustand store

export function createStreamConsumer(sessionId: string, messageId: string, store: UseChatStore) {
  const controller = new AbortController()
  const handler = new ChatStreamingHandler(sessionId, messageId, store, controller)

  return {
    controller,
    async consume(stream: ReadableStream<UIMessageChunk>) {
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        handler.handleChunk(value)
      }
      handler.finish()
    },
  }
}
```

**Abort flow:**
- `store.stopGeneration(messageId)` → 
  - `controller.abort()` (cancels fetch)
  - `POST /chat/sessions/:id/cancel` (server cancel)
  - `finishGeneration(messageId)` (store cleanup)

### Phase 2.5: Passive Observer 迁移

4. **从 `use-chat-session.ts` 提取 passive observer 逻辑到 store**

这是最复杂的部分（当前 ~120 行逻辑）：

```typescript
// Store actions:
hydrateFromServer(sessionId) {
  // fetch GET /chat/sessions/:id/messages
  // replayChunksToAssistantMessage for each group
  // setMessages(sessionId, projected)
  // derive passive state (streaming/idle/error)
}

subscribeToRunEvents(sessionId) {
  // onChatRunEvent(sessionId, handler)
  // run.completed/aborted → finishGeneration + hydrateFromServer
  // run.failed → failGeneration(messageId, error)
  // Other events (when not locally driving) → mark as streaming + schedule sync
}
```

**关键状态：**
- `wasLocallyDriving: Map<string, boolean>` — 防止外部 SSE 事件覆盖本地状态
- `snapshotStatus: Map<string, PublicStatus>` — 被动观察的状态

### Phase 3: 虚拟列表优化

5. **ChatView: 精细化渲染**

```typescript
// Before: messages.map(m => <MessageBubble message={m} isStreaming={...} />)
// After: messageIds.map(id => <MessageBubbleContainer key={id} messageId={id} />)

function MessageBubbleContainer({ messageId }: { messageId: string }) {
  const message = useChatStore(chatSelectors.message(sessionId, messageId))
  const isGenerating = useChatStore(chatSelectors.isGenerating(messageId))
  if (!message) return null
  return <MessageBubble message={message} isStreaming={isGenerating} />
}
```

6. **keepMounted 计算**

```typescript
const generatingIds = useChatStore(s => s.generatingMessageIds)
const keepMountedIndices = useMemo(() => {
  return messageIds
    .map((id, i) => generatingIds.has(id) ? i : -1)
    .filter(i => i >= 0)
}, [messageIds, generatingIds])

<Virtualizer keepMounted={keepMountedIndices}>
```

### Phase 4: Streamdown 集成

7. **MessageBubble 直接消费 store**

```typescript
// streaming flag 来自 per-message store state
<Streamdown
  content={part.text}
  streaming={isGenerating}
  animationPreset={animationPreset}
  animateMode={animateMode}
  showCursor={showCursor && isGenerating}
/>
```

### Phase 5: 清理

8. **移除 `@ai-sdk/react` 的 `useChat` 依赖**
   - 不再使用 `useChat`，直接管理 transport + store
   - 保留 `ai` 包中的类型（`UIMessage`, `UIMessageChunk`, `ChatStatus`）

## 影响范围

| 文件 | 变更 |
|------|------|
| `apps/web/src/store/chat.ts` | **新建** — Zustand 消息 store |
| `apps/web/src/store/chat-streaming-handler.ts` | **新建** — Chunk 处理器 |
| `apps/web/src/features/chat/use-chat-session.ts` | **重写** — 从 useChat wrapper → store wrapper |
| `apps/web/src/features/chat/sse-chat-transport.ts` | **修改** — chunk 输出到 handler 而非 useChat |
| `apps/web/src/features/chat/chat-view.tsx` | **修改** — messageIds + keepMounted 模式 |
| `apps/web/src/features/chat/message-bubble.tsx` | **修改** — 从 props 消费 → store selector 消费 |

## 关键设计决策

### Q1: 为什么不保留 useChat？

`@ai-sdk/react` 的 `useChat` 将**所有消息**存储在一个 React state 中。每次 chunk 到达，整个数组引用更新，触发持有该 state 的组件重渲染。虽然有 `experimental_throttle`，但本质上无法做到 per-message granularity。

### Q2: 如何保留 AI SDK 的 chunk 类型？

继续使用 `ai` 包的类型（`UIMessage`, `UIMessageChunk`），只是不使用 `@ai-sdk/react` 的 hooks。Chunk 协议解析用 `ai` 包的低级 API。

### Q3: keepMounted vs re-animation guard？

两者都需要：
- `keepMounted`：streaming 消息永不回收（防 DOM 重建）
- `StaticRender` fallback：即使意外 remount，非 streaming 消息也不动画

### Q4: Throttle 策略？

- Text delta：每 chunk 立即 append（store 更新很轻）
- Tool calls：300ms throttle（跟 Lobe 一样）
- 组件侧：React 自带 batching + selector shallow equality 已足够

## 渐进迁移策略

可以分两步：
1. **先加 keepMounted**（10 分钟修复，解决当前 bug）
2. **再做 store 重构**（大改，需要完整测试）

这样用户立即看到修复效果，同时长期架构在后台推进。

## 风险

- `@ai-sdk/react` 的 `useChat` 处理了很多边缘情况（retry、abort、error recovery）。**实际审计结果：** 当前只使用了 `messages/setMessages/sendMessage/stop/status/error`，未使用 retry/regenerate/reload/resumeStream，风险低于预期。
- 现有的 snapshot sync 逻辑（被动观察其他 tab 的 streaming）是最复杂的迁移部分（~120 行），需要完整测试覆盖。
- **Immutability requirement:** `appendChunk` 必须产生新的 message/parts 对象引用，否则 selector 不触发 re-render。推荐使用 immer middleware 或显式 spread pattern。
- 测试覆盖：需要为 StreamingHandler 写单元测试确保 chunk 积累正确。

## 优先级（修订后）

| Phase | 耗时 | 风险 | 描述 |
|-------|------|------|------|
| 0 | 10 min | 无 | keepMounted 止血 — 立即 ship |
| 1 | 2-3h | 低 | Zustand store skeleton + selectors + error map |
| 2 | 3-4h | 中 | ChatStreamingHandler 完整 chunk 状态机 + abort |
| 2.5 | 3-4h | **高** | Passive observer 迁移（最多边缘情况）|
| 3 | 1-2h | 低 | ChatView selector wiring + keepMounted from store |
| 4 | 1-2h | 中 | Transport adapter: pipe stream to handler |
| 5 | 30min | 无 | 移除 @ai-sdk/react |

**Phase 2.5 建议：** 写集成测试 BEFORE 修改 passive observer 逻辑。
