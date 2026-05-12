# Auto-Compaction — Long Session Context Management

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document must be maintained in accordance with `docs/exec-plans/README.md`.

## Purpose / Big Picture

长会话的 context window 会被撑满，导致模型请求失败或截断。需要在 context 溢出前自动压缩历史消息。

**当前状态**：
- `ai-sdk-engine.ts` 的 `streamText()` 没有 `prepareStep` 回调
- 没有 context 长度检测
- 没有消息压缩/裁剪机制
- 长会话会直接失败（context overflow error）

**目标状态**：
- `prepareStep` 在每一步前检测 context 是否接近上限
- 自动压缩早期消息（保留最近 N 轮 + 摘要）
- 用户无感知——不需要手动清理历史

**Alma 参考**：
- Alma 在 `prepareStep` 中做 auto-compaction
- 检测 context overflow → 自动压缩历史 → 继续执行
- 使用 `pruneMessages` 辅助函数

验证方式：超过 context 上限的长会话能正常继续，不会因 context overflow 报错。


## Architecture Design

### 核心流程

```
streamText({ prepareStep: ({ messages, stepNumber }) => {
  │
  │  估算 token 数量
  │  (用 AI SDK 的 tokenCount 或简单的字符/4 估算)
  │
  │  if (estimatedTokens > modelContextLimit * 0.85) {
  │    │
  │    │  保留: 系统消息 + 最近 N 轮 + tool results
  │    │  压缩: 早期对话 → 摘要
  │    │  
  │    │  return { messages: compactedMessages }
  │    }
  │
  │  return undefined  // 不修改
  ▼
}})
```

### 压缩策略

#### 策略 1: Sliding Window（Phase 1 实现）

最简单可靠：保留最近 K 条消息，丢弃更早的消息。Alma 默认 `keepRecentMessages = 4`。

```typescript
function compactByWindow(messages: ModelMessage[], keepMessages: number = 4): ModelMessage[] {
  const systemMessages = messages.filter(m => m.role === 'system')
  const nonSystem = messages.filter(m => m.role !== 'system')
  
  const kept = nonSystem.slice(-keepMessages)
  
  return [...systemMessages, ...kept]
}
```

#### 策略 2: Summarize + Window（Phase 2 实现）

Alma 的实际实现：用模型总结早期对话，然后 sliding window 保留最近的。

```typescript
async function compactBySummary(
  messages: ModelMessage[], 
  model: LanguageModel,
  keepMessages: number = 4,
): Promise<ModelMessage[]> {
  const systemMessages = messages.filter(m => m.role === 'system')
  const nonSystem = messages.filter(m => m.role !== 'system')
  
  const recentMessages = nonSystem.slice(-keepMessages)
  const olderMessages = nonSystem.slice(0, nonSystem.length - recentMessages.length)
  
  if (olderMessages.length === 0) return messages
  
  // Alma 的 summarization prompt
  const summary = await generateText({
    model,
    system: 'You are a conversation summarizer...',
    prompt: `Please summarize: ${olderMessages.map(m => JSON.stringify(m.content)).join('\n')}`,
  })
  
  // Alma 的输出格式：<context_summary> + <system-reminder>
  return [
    ...systemMessages,
    { role: 'user' as const, content: `<context_summary>\n${summary.text}\n</context_summary>` },
    { role: 'user' as const, content: '<system-reminder>Context compacted. Continue from where you left off.</system-reminder>' },
    ...recentMessages,
  ]
}
```

**Cradle 的优势**：有 chunk 级持久化 → 可以用 `SELECT chunks WHERE seq < N` 拿到要被压缩的完整历史 → 调 `generateText` 做摘要 → 持久化一个 compaction chunk → 前端消费时自动折叠旧消息。这比 Alma 的 message 级存储更容易实现。

#### 策略 3: AI SDK pruneMessages（Phase 1 辅助）

AI SDK v6 提供 `pruneMessages()` 工具函数：

```typescript
import { pruneMessages } from 'ai'

const pruned = pruneMessages({
  messages,
  reasoning: false,    // 移除 reasoning 内容
  toolCalls: false,    // 移除 tool call 详情
  emptyMessages: true, // 移除空消息
})
```

可以在 compaction 前先清理 reasoning 和 tool call 详情以节省 token。


### Context Limit 数据

已有 `apps/server/src/modules/providers/model-info-registry.ts`，从 `https://models.dev/api.json` 获取：

| Model | Context Window | maxOutputTokens |
|-------|---------------|----------------|
| GPT-4o | 128K | 16K |
| GPT-4o-mini | 128K | 16K |
| Claude 3.5 Sonnet | 200K | 8K |
| Claude 4 Opus | 200K | 32K |
| Gemini 1.5 Pro | 1M+ | 8K |

**无需新建 registry**。`enrichModelsFromRegistry()` 已经返回 `contextWindow`。Phase 3 只需要在 engine input 中传入 model 的 context limit 即可。

### Token 估算 / Overflow 检测

Alma 的实际 overflow 检测逻辑（`FE()` 函数）：

```typescript
function isOverflow(
  usage: { inputTokens: number, outputTokens: number, cacheReadTokens?: number },
  contextWindow: number,
  maxOutputTokens: number | undefined,
): boolean {
  const effectiveTokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0)
  const reserve = Math.min(maxOutputTokens ?? 32000, 32000)
  return effectiveTokens > contextWindow - reserve
}
```

**关键**：用实际的 `usage`（来自 `onStepFinish` 的 `steps[].usage`），不是估算。`prepareStep` 接收 `steps` 参数，包含之前每步的 usage。

**Cradle 的 context limit 来源**：已有 `apps/server/src/modules/providers/model-info-registry.ts`，从 `https://models.dev/api.json` 获取 `contextWindow`。无需新建 registry——直接复用。

### 作用范围

Alma 只对主 AI SDK 路径做 auto-compaction：

| Provider | Compaction | 原因 |
|----------|-----------|------|
| AI SDK streamText | ✅ prepareStep | 多步 loop，context 会增长 |
| ACP (subagent) | ❌ | maxSteps: 1，单步不会超 |
| Claude Code CLI | ❌ | SDK 自己管理 context |
| Codex | ❌ | API 自己管理 context |


## Phases

### Phase 1: Sliding Window Compaction

**目标**：长会话不崩溃，自动丢弃早期消息。

**文件变更**：
- `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts` — 添加 `prepareStep` 回调
- `apps/server/src/modules/chat-runtime/engine/compaction.ts` — 新文件：compaction 策略实现

**配置**：
```typescript
const COMPACTION_CONFIG = {
  // 保留最近多少条消息（Alma 默认 4）
  keepRecentMessages: 4,
  // 默认 maxOutputTokens reserve（未知 model 时使用）
  defaultMaxOutputReserve: 32_000,
  // 默认 context limit（未知 model 时使用）
  defaultContextLimit: 128_000,
}
```

**验证**：
- 模拟 20+ 轮对话 → context 接近上限
- prepareStep 触发 compaction → messages 被裁剪
- 模型正常回复，不报 context overflow

### Phase 2: Summarization Compaction

**目标**：在丢弃早期消息时生成摘要，保留语义上下文。

**文件变更**：
- `apps/server/src/modules/chat-runtime/engine/compaction.ts` — 添加 summarize 策略
- `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts` — prepareStep 中选择策略

**验证**：
- 长会话 → 触发 summarization → 摘要出现在 messages 开头
- 摘要 API 调用的 token 消耗被记录到 usage

### Phase 3: Model Context Limit 集成

**目标**：按 model 动态获取 context limit，而非使用硬编码默认值。

**文件变更**：
- `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts` — 从 model metadata 获取 contextWindow
- `apps/server/src/modules/chat-runtime/service.ts` — 在构建 engine input 时查询 model info
- 复用现有 `apps/server/src/modules/providers/model-info-registry.ts`（无需新建）

**验证**：
- GPT-4o 使用 128K 上限
- Claude 使用 200K 上限
- 自定义 model 使用默认 128K


## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|------|------|------|
| Token 估算不准确 | 过早或过晚 compact | Phase 1 用保守阈值 0.85；Phase 3 用精确 limit |
| Summarization API 调用失败 | Compaction 失败 → 回退到 window 策略 | try-catch + fallback |
| Summarization 丢失关键上下文 | 模型行为异常 | 保留最近 10 轮完整对话 |
| prepareStep 增加每步延迟 | 多步 loop 变慢 | 只在超过阈值时触发，大多数情况 O(1) |


## Progress

- [x] Phase 1: Sliding Window Compaction
- [x] Phase 2: Summarization Compaction
- [x] Phase 3: Model Context Limit Registry


## Surprises & Discoveries

_(empty — to be filled during implementation)_


## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-12 | Compaction 放在 prepareStep 而非 Service 层 | AI SDK 原生支持，per-step 粒度最合适 |
| 2026-05-12 | Phase 1 只做 sliding window 不做 summarization | 零依赖、确定性、立即可用 |
| 2026-05-12 | keepRecentMessages = 4（跟 Alma 一致） | Alma 生产验证的默认值 |
| 2026-05-12 | 用实际 usage token 检测 overflow 而非 chars/4 估算 | prepareStep 提供 steps[].usage，有精确数据 |
| 2026-05-12 | 复用现有 model-info-registry.ts | 已有 models.dev 集成，无需新建 |
| 2026-05-12 | 只对 AI SDK streamText 路径做 compaction | ACP/Codex/Claude Agent 的 context 由各自 SDK 管理 |


## Outcomes & Retrospective

_(empty — to be filled after completion)_
