# Vercel AI SDK Migration — Provider Layer Overhaul

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

## Purpose / Big Picture

将 Cradle 的 Agent 执行层从自研 `ChatRuntimeProvider` 接口迁移到 Vercel AI SDK (`ai` 包) 作为核心抽象。这是一次**破坏性重构**：

**Before**：
- 4 个自研 provider（`openai-compatible`, `claude-agent`, `codex`, `acp`）
- 每个 provider 自带 mapper 将 SDK 事件转成 `TimelineInputEvent`
- 自研 `streamTurn` AsyncGenerator 抽象
- 自研 timeline-projection 将事件转 UIMessageChunk

**After**：
- Vercel AI SDK `streamText()` 作为统一 agent 执行引擎
- `@ai-sdk/*` provider adapters 替代自研 API 调用
- Claude Code / Codex 作为"委托型 subagent"（CLI 子进程或 SDK 调用）
- AI SDK 的 `toDataStream()` / `toUIMessageStream()` 替代自研 timeline-projection
- `stopWhen` + `AttemptCompletion` 工具控制 agentic loop

**三条执行路径**（对应 Alma 架构）：
1. **AI SDK streamText**（主路径）— 所有非 coder 场景，支持 agentic loop
2. **Claude Code CLI 子进程**（coder 委托）— `claude -p --output-format stream-json`
3. **ACP Provider**（外部 agent）— `@mcpc-tech/acp-ai-provider` + `streamText`

验证方式：现有 chat sessions 能正常发消息、看到流式响应、tool call 显示、approval 弹窗。所有 provider kind 功能保持不变。


## Architecture Design

### 新目录结构

```
apps/server/src/modules/chat-runtime/
├── service.ts                     # Run orchestration (keeps executeRun, persist, etc.)
├── runtime-provider-types.ts      # TimelineInputEvent union (KEEP — backward compatible)
├── index.ts                       # HTTP routes (KEEP)
├── model.ts                       # Elysia models (KEEP)
├── timeline-events.ts             # Event persistence (KEEP)
├── engine/
│   ├── ai-sdk-engine.ts           # NEW: streamText executor + tool registry
│   ├── tools/                     # NEW: Tool definitions for AI SDK
│   │   ├── attempt-completion.ts  # AttemptCompletion tool (agentic loop termination)
│   │   └── index.ts               # Tool registry
│   ├── providers.ts               # NEW: AI SDK provider factory (@ai-sdk/openai, anthropic, etc.)
│   └── stream-to-timeline.ts      # NEW: AI SDK stream → TimelineInputEvent mapper
├── subagents/
│   ├── claude-code-cli.ts         # NEW: Claude Code CLI subprocess runner
│   ├── codex-thread.ts            # RENAMED from providers/codex/provider.ts
│   └── acp-session.ts             # RENAMED from providers/acp/provider.ts
└── providers/                     # DELETE after migration
    ├── openai-compatible/         # → replaced by ai-sdk-engine
    ├── claude-agent/              # → replaced by claude-code-cli OR ai-sdk-engine
    └── codex/                     # → moved to subagents/
```

### 核心 API 设计

#### AI SDK Engine

```typescript
// engine/ai-sdk-engine.ts
import { streamText, tool, generateText } from 'ai'
import type { LanguageModel } from 'ai'

interface AgentRunConfig {
  model: LanguageModel
  system: string
  messages: Array<{ role: 'user' | 'assistant', content: string }>
  tools?: Record<string, Tool>
  maxSteps?: number            // default 100
  abortSignal: AbortSignal
  canUseTool?: CanUseTool      // our approval system
  onStepFinish?: (step: StepResult) => void
}

async function* runAgent(config: AgentRunConfig): AsyncGenerator<TimelineInputEvent> {
  const result = streamText({
    model: config.model,
    system: config.system,
    messages: config.messages,
    tools: config.tools,
    stopWhen: [
      ({ steps }) => steps.length >= (config.maxSteps ?? 100),
      hasTool('attempt_completion'),
    ],
    abortSignal: config.abortSignal,
    onStepFinish: config.onStepFinish,
  })

  // Convert AI SDK stream to TimelineInputEvent
  for await (const chunk of result.fullStream) {
    yield* mapAiSdkChunkToTimeline(chunk)
  }
}
```

#### Provider Factory

```typescript
// engine/providers.ts
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

type ApiFormat = 'openai-chat' | 'openai-responses' | 'anthropic' | 'google'

function createModel(config: {
  apiFormat: ApiFormat
  apiKey: string
  baseUrl?: string
  modelId: string
}): LanguageModel {
  switch (config.apiFormat) {
    case 'openai-chat':
    case 'openai-responses':
      return createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl })(config.modelId)
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl })(config.modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseUrl })(config.modelId)
  }
}
```

#### Claude Code CLI Subagent

```typescript
// subagents/claude-code-cli.ts
import { spawn } from 'node:child_process'

interface ClaudeCodeRunOptions {
  prompt: string
  cwd: string
  maxTurns?: number
  abortSignal: AbortSignal
  env?: Record<string, string>
}

async function* runClaudeCode(options: ClaudeCodeRunOptions): AsyncGenerator<TimelineInputEvent> {
  const claudeBin = findClaudeBinary()
  const args = [
    '-p', '--verbose',
    '--output-format', 'stream-json',
    '--max-turns', String(options.maxTurns ?? 50),
  ]

  const child = spawn(claudeBin, args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...options.env },
  })

  child.stdin.write(options.prompt)
  child.stdin.end()

  // Parse stdout JSON lines → TimelineInputEvent
  for await (const line of readLines(child.stdout)) {
    yield* parseClaudeCodeJsonLine(line)
  }
}
```

#### Approval Integration

```typescript
// In ai-sdk-engine.ts, the tool execution wrapper
const toolsWithApproval = Object.fromEntries(
  Object.entries(config.tools ?? {}).map(([name, toolDef]) => [
    name,
    tool({
      ...toolDef,
      execute: async (input, context) => {
        // Check approval before execution
        if (config.canUseTool) {
          const result = await config.canUseTool(name, input)
          if (result.behavior === 'deny') {
            return `Permission denied: ${result.message}`
          }
        }
        return toolDef.execute(input, context)
      },
    }),
  ])
)
```

### Migration Strategy

分 3 个 Phase：

**Phase A**: 安装 AI SDK + 替换 `openai-compatible` provider
- 最小改动，只替换一个 provider
- 验证 AI SDK 的 streaming 输出能正确映射到 TimelineInputEvent

**Phase B**: 重构 `claude-agent` 为 CLI 子进程 OR 保留 SDK + AI SDK hybrid
- 评估 trade-off: Claude Agent SDK 有 canUseTool (approval)、resume (session)、programmatic control
- CLI 子进程更隔离但失去 approval 集成
- 决定：保留 SDK 但走"委托"模式（SDK 作为 subagent runner，AI SDK 作为主循环）

**Phase C**: 统一 stream output format
- 所有路径输出统一的 TimelineInputEvent 流
- 前端不需要改动（timeline-projection 仍然消费同样的事件）


## Phase A: AI SDK 替换 openai-compatible

### A.1 安装依赖

```bash
cd apps/server
pnpm add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
```

### A.2 新建 engine/ai-sdk-engine.ts

核心执行器，接收 `LanguageModel` + messages + tools，输出 `TimelineInputEvent`。

### A.3 新建 engine/providers.ts

Provider factory，根据 `apiFormat` 创建对应的 AI SDK model instance。

### A.4 新建 engine/stream-to-timeline.ts

将 AI SDK 的 `fullStream` chunks 映射到 `TimelineInputEvent`：
- `text-delta` → `assistant.text.delta`
- `tool-call` → `tool_call.started`
- `tool-result` → `tool_call.completed`
- `step-finish` → (internal, update state)
- `finish` → (triggers `assistant.message.completed`)

### A.5 修改 openai-compatible provider

重写 `streamTurn` 使用 `ai-sdk-engine` 而非直接 `fetch`:
```typescript
async* streamTurn(input: StreamTurnInput) {
  const model = createModel({ apiFormat, apiKey, baseUrl, modelId })
  yield* runAgent({ model, system, messages, tools, abortSignal, maxSteps })
}
```

### A.6 涉及文件

- `apps/server/package.json` — 新增 ai, @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google
- `apps/server/src/modules/chat-runtime/engine/` — 新建目录
- `apps/server/src/modules/chat-runtime/providers/openai-compatible/provider.ts` — 重写

### A.7 验证

- 现有 openai-compatible agent profile 能正常发消息
- 流式响应正常
- tool call (如果有) 正常
- 所有现有测试通过


## Phase B: Claude Agent 路径决策

### 选项对比

| 维度 | 保留 SDK API | 改用 CLI 子进程 |
|------|-------------|----------------|
| Approval | ✅ 原生 canUseTool callback | ❌ 需要 --dangerously-skip-permissions |
| Session resume | ✅ options.resume | ❌ --no-session-persistence |
| Streaming | ✅ AsyncGenerator<SDKMessage> | ✅ --output-format stream-json |
| 隔离性 | ❌ 同进程 | ✅ 独立子进程 |
| 错误恢复 | ⚠️ SDK 崩溃影响 server | ✅ 子进程崩溃不影响 |
| 资源控制 | ❌ 共享内存 | ✅ 可限制 CPU/内存 |

### 决策

**保留 Claude Agent SDK**，但将其定位为"委托型 subagent runner"而非主路径。理由：
1. 我们刚修好了 approval、cwd、abort 这些核心功能
2. SDK 的 `resume` 机制提供了真正的多轮会话恢复
3. SDK 内部已经有 agentic loop（不需要我们用 AI SDK 再包一层）
4. 如果未来要换 CLI 模式，只需要替换 `streamTurn` 内部实现，接口不变

保持现有 `claude-agent` provider 不动。未来如果 Claude Code CLI 稳定了、ACP 协议统一了，可以无缝切换。

### Phase B 实际操作

- 不修改 `claude-agent` provider
- 不修改 `codex` provider
- 保持 `acp` provider 不变

### 涉及文件

无修改。Decision Log 记录。


## Phase C: 统一 Stream Output

### 目标

所有执行路径（AI SDK、Claude Agent SDK、Codex SDK）的输出都是 `AsyncGenerator<TimelineInputEvent>`。这已经是现在的状态。AI SDK 路径通过 `stream-to-timeline.ts` 转换。

### 唯一改动

确保 `stream-to-timeline.ts` 的输出格式与现有 mapper 一致，包括：
- `assistant.message.started` / `assistant.text.delta` / `assistant.message.completed`
- `tool_call.started` / `tool_call.input.delta` / `tool_call.completed`
- `reasoning.started` / `reasoning.delta` / `reasoning.completed`

前端无需改动。


---

## Progress

- [x] Phase A.1: 安装 AI SDK 依赖 (ai, @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google)
- [x] Phase A.2: engine/ai-sdk-engine.ts (streamText executor + usage extraction)
- [x] Phase A.3: engine/providers.ts (model factory with .chat() for OpenAI-compatible)
- [x] Phase A.4: engine/stream-to-timeline.ts (AI SDK v6 fullStream → TimelineInputEvent)
- [x] Phase A.5: 重写 openai-compatible provider (100% AI SDK powered)
- [x] Phase A.6: 验证通过 (72 server + 250 root = 322 tests passing)
- [x] Phase B: 决策记录 (保留 Claude Agent SDK + Codex SDK)
- [x] Phase C: stream-to-timeline 输出验证 (all event types mapped correctly)


## Surprises & Discoveries

- AI SDK v6 uses different chunk types than docs suggest: `text-start`/`text-delta`/`text-end`, `tool-input-start`/`tool-input-delta`/`tool-input-end`, `start-step`/`finish-step`
- `text-delta` chunk uses `text` property (not `textDelta` as in older versions)
- `@ai-sdk/openai` defaults to Responses API (`/responses`); must use `.chat()` for Chat Completions (`/chat/completions`)
- AI SDK passes `(string, init)` to fetch (not Request object), so vi.spyOn(globalThis, 'fetch') works correctly
- AI SDK doesn't abort in-memory ReadableStreams (no TCP close to trigger). Explicit `abortSignal.aborted` check needed in engine loop.
- Mock SSE responses need full OpenAI chunk format: `object`, `created`, `model`, `choices[].index`, `choices[].finish_reason`
- AI SDK usage format: `inputTokens`/`outputTokens` (we map to `promptTokens`/`completionTokens` for backward compatibility)


## Decision Log

- Decision: 保留 Claude Agent SDK，不迁移到 CLI 子进程
  Rationale: SDK 提供 canUseTool (approval)、resume (session)、programmatic abort。这些功能我们刚修好。CLI 模式需要 --dangerously-skip-permissions 放弃 approval 控制。未来 ACP 协议统一后可以无缝切换。
  Date: 2026-05-12

- Decision: 保留 Codex SDK，不迁移
  Rationale: Codex SDK 的 thread-based API 无法用 AI SDK streamText 替代。它有自己的 approval policy、sandbox、file operation 等，是一个完整的 agentic runtime。
  Date: 2026-05-12

- Decision: AI SDK 只替换 openai-compatible provider
  Rationale: openai-compatible 是纯 API 调用场景，最适合 AI SDK 的抽象。Claude Agent 和 Codex 是带完整 agentic loop 的 SDK，用 AI SDK 包一层没有意义（它们内部已经有 loop）。
  Date: 2026-05-12

- Decision: 保持 TimelineInputEvent 作为内部事件格式
  Rationale: 这是我们的统一事件合约。前端、DB persistence、SSE streaming 全部基于它。AI SDK 的输出通过 stream-to-timeline.ts 转换。不引入 AI SDK 的 UIMessageChunk 到我们的后端。
  Date: 2026-05-12


## Outcomes & Retrospective

Migration completed successfully. Key outcomes:

1. **openai-compatible provider** now uses Vercel AI SDK (`streamText` + `@ai-sdk/openai .chat()`)
2. **engine/** module provides reusable AI SDK execution infrastructure:
   - `providers.ts` — model factory supporting openai/anthropic/google formats
   - `ai-sdk-engine.ts` — `executeAiSdkTurn()` generator with abort, usage, error handling
   - `stream-to-timeline.ts` — maps AI SDK v6 fullStream to our TimelineInputEvent contract
   - `tools/attempt-completion.ts` — AttemptCompletion tool for future agentic loops
3. **Zero breaking changes** to:
   - Frontend (still consumes TimelineInputEvent via SSE)
   - Database persistence (same event types)
   - Other providers (claude-agent, codex, acp unchanged)
4. **Removed ~200 lines** of manual SSE parsing + fetch retry logic from openai-compatible provider
5. **Future path**: AI SDK engine ready for multi-step agentic loops with `maxSteps > 1` + tool definitions
