# Agent Runtime Core Upgrades — Alma Architecture Insights

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document must be maintained in accordance with `docs/exec-plans/README.md`.

## Purpose / Big Picture

基于 Alma 团队的 Agent Runtime 架构分析，对 Cradle 的 Agent 运行时核心进行系统性升级。Alma 是一个成熟的 Agent 编排平台，使用 Vercel AI SDK + 自定义 approval 系统 + delta 增量更新 + mission/run/handoff 三层模型。

本计划从中提炼适合 Cradle 当前架构的改进点，分 5 个 Phase 实施：

1. **Phase 1: Approval 系统增强** — policy keys + allow_always + 分层自动放行 + headless 模式
2. **Phase 2: Delta 增量 SSE 优化** — 减少 SSE 带宽，前端增量 apply
3. **Phase 3: Agentic Loop 控制** — step limits + AttemptCompletion 终止信号
4. **Phase 4: 网络韧性** — 指数退避重试 + proxy 支持
5. **Phase 5: Run 生命周期增强** — mission/task 层抽象（预研）

核心原则：**不换底座**。Cradle 不迁移到 Vercel AI SDK —— Claude Agent SDK 和 Codex SDK 都是带 agentic loop 的原生 SDK，AI SDK 的 `streamText()` 管不了它们的内部循环。我们保持自己的 `ChatRuntimeProvider` 接口，只借鉴 Alma 的具体实现细节。

验证方式：每个 Phase 有独立的验证标准，见各 Phase 详细设计。


## Reference: Alma Architecture Key Findings

### Provider 抽象层
- Vercel AI SDK (`streamText`, `generateText`, `tool`, `jsonSchema`, `stopWhen`) 作为核心
- Provider 适配: `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/deepseek` 等
- `providers` 表有 `api_format` 列区分 `openai-chat` / `openai-responses` / `anthropic`
- `toUIMessageStream()` 把 SDK 事件流转 UI 消息流

### Agent 执行循环
- `streamText` + `stopWhen` 控制 agentic loop
- `AttemptCompletion` 工具作为终止信号
- `prepareStep` hook: 动态工具激活 + auto-compaction + Gemini 特殊处理
- Step 上限: 100
- `agent_runs` 表: `parent_run_id`, `spawned_by_handoff_id`, `attempt_number`

### Tool Approval 系统
```
autoApprove =
  globalAutoApproveSetting() ||           // security.autoApproveToolRequests
  isSubagent(request) ||                  // subagent 自动放行
  isExternalSource(request) ||            // telegram/discord/feishu/cron/heartbeat
  isPlatformThread(request.threadId) ||   // 外部平台线程
  isCronThread(request.threadId) ||       // cron 线程
  isPreviouslyAllowedOnce(request);       // 之前 allow_always 过的 tool type
```

Policy key 格式: `source:thread:threadId:tool:toolName`
Timeout: 支持但默认不设（clamp 上限 120s）
Allow always: 往 Set 加 key，下次直查
Headless: `ALMA_HEADLESS=1` + `ALMA_TOOL_APPROVAL=auto`

### Delta 增量更新
```typescript
class DeltaTracker {
  computeDeltas(threadId, messageId, newParts) → Delta[]
  // text_append: curr.text.slice(prev.text.length)
  // tool_input_append: per-input-key 增量
  // tool_output_set: output 整体替换
  // seq: 序号检测丢事件
}
```

### Subagent
- Coder 类型: `child_process.spawn` Claude Code CLI, stdout 逐行解析
- ACP 类型: `@mcpc-tech/acp-ai-provider` + `computeDeltas`
- Subagent 自动放行 approval（安全边界在 prompt 层不在 approval 层）

### 网络层
- 自建 fetch wrapper: `{ proxy, timeout: 30000, retryAttempts: 3, userAgent, preferIpv4 }`
- 指数退避重试 + abort signal + network error 过滤

### 断线策略
- Electron IPC 不需要重连
- 外部平台: 轮询恢复 + `scheduleToolWaitRecovery(threadId, 15000)`


---

## Phase 1: Approval 系统增强

### 目标
让 Cradle 的 approval 系统从"每次都弹"升级到"智能分层放行"，减少用户交互摩擦。

### 设计

#### 1.1 Policy Keys + Allow Always

在 `apps/server/src/modules/approval/service.ts` 中新增：

```typescript
// Policy key 格式
type PolicyKey = string  // "claude-agent:session:{sessionId}:tool:{toolName}"

// Session-scoped allowed set (内存中，随 session 销毁)
const allowedPolicies = new Map<string, Set<string>>()  // sessionId → Set<PolicyKey>

function generatePolicyKeys(input: { providerKind: string, chatSessionId: string, toolName: string }): string[] {
  return [
    `${input.providerKind}:session:${input.chatSessionId}:tool:${input.toolName}`,
    `${input.providerKind}:session:${input.chatSessionId}:all`,
  ]
}

function isPreviouslyAllowed(chatSessionId: string, policyKeys: string[]): boolean {
  const allowed = allowedPolicies.get(chatSessionId)
  if (!allowed) return false
  return policyKeys.some(key => allowed.has(key))
}

function markAllowed(chatSessionId: string, policyKeys: string[]): void {
  let allowed = allowedPolicies.get(chatSessionId)
  if (!allowed) { allowed = new Set(); allowedPolicies.set(chatSessionId, allowed) }
  for (const key of policyKeys) allowed.add(key)
}
```

#### 1.2 分层自动放行

在 `buildCanUseTool` 中添加检查链：

```typescript
// 1. Check if globally auto-approved (via agent profile config)
if (config.permissionMode === 'bypassPermissions') return allow

// 2. Check if previously allowed in this session (allow_always)
const policyKeys = generatePolicyKeys({ providerKind: 'claude-agent', chatSessionId, toolName })
if (isPreviouslyAllowed(chatSessionId, policyKeys)) return allow

// 3. Otherwise, prompt the user
const response = await requestApproval(...)

// 4. If allow_always, persist policy keys
if (response.selectedOptionId === 'allow_always') {
  markAllowed(chatSessionId, policyKeys)
}
```

#### 1.3 Approval 响应类型扩展

当前 options: `allow_once`, `deny`
新增: `allow_always`, `deny_with_reason`

`allow_always` 处理：将 SDK 返回的 `suggestions` 通过 `updatedPermissions` 传给 SDK，同时在我们的 policy keys Set 中记录。

#### 1.4 Headless 模式

```typescript
// 环境变量驱动
if (process.env.CRADLE_HEADLESS === '1') {
  return process.env.CRADLE_TOOL_APPROVAL === 'auto'
    ? { behavior: 'allow', updatedInput: {}, toolUseID }
    : { behavior: 'deny', message: 'Headless mode: auto-deny', toolUseID }
}
```

#### 1.5 Approval 超时（可选）

Alma 实际没用超时。我们也暂不加，但在 API 层面预留 `timeoutMs` 参数。

### 涉及文件

- `apps/server/src/modules/approval/service.ts` — 新增 policy keys 逻辑
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` — 改造 `buildCanUseTool`
- `apps/web/src/features/approval/approval-card.tsx` — 新增 "Always Allow" 按钮
- `apps/web/src/features/approval/use-approval.ts` — 适配新的 option

### 验证
- 单元测试：`allow_always` 后同一 session 同一 tool 不再弹 approval
- 单元测试：不同 session 的 policy keys 互不影响
- 单元测试：headless 模式下直接返回 allow/deny
- 集成测试：UI 点击 "Always Allow" 后，后续相同 tool call 自动放行


---

## Phase 2: Delta 增量 SSE 优化

### 目标
减少 SSE 推送带宽，前端维护 running message state 并增量 apply。

### 设计

#### 2.1 当前状态分析

我们当前的 SSE 已经是增量的：
- `assistant.text.delta` → 只有 delta 字段（新增文字）
- `tool_call.started` → 一次性推 toolName + toolInput
- `tool_call.completed` → 一次性推 result

这本质上和 Alma 的 `text_append` + `tool_output_set` 一致。

#### 2.2 可优化点

1. **tool input streaming**: Claude Agent SDK 的 `content_block_delta` 可以增量推送 tool input JSON，当前我们在 `content_block_start` 时 toolInput 是 null，最终的完整 input 在 `assistant` 消息的 `tool_use` block 里才有。
   → 新增 `tool_call.input.delta` 事件类型

2. **sequence number**: 给每个 SSE event 加 `seq` 号，前端检测丢事件时可以 request missing events 或 full resync。
   → `StoredTimelineEvent` 已经有 `id`（自增），可以直接用作 seq。

3. **command output streaming**: `command.output.delta` 已经是增量的。✅

#### 2.3 实现方案

在 `runtime-provider-types.ts` 中新增：
```typescript
| (TimelineEventBase & { type: 'tool_call.input.delta', itemId: string, delta: string })
```

在 mapper 的 `mapStreamEvent` 中，当收到 `content_block_delta` 且 delta 类型是 `input_json_delta` 时：
```typescript
if (deltaEvent.delta.type === 'input_json_delta') {
  events.push({
    type: 'tool_call.input.delta',
    itemId: currentToolUseId,
    delta: deltaEvent.delta.partial_json,
    source: { ... },
  })
}
```

在 `timeline-projection.ts` 中处理新事件类型。

### 涉及文件

- `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` — 新增事件类型
- `apps/server/src/modules/chat-runtime/providers/claude-agent/mapper.ts` — 处理 input_json_delta
- `src/shared/timeline-projection.ts` — 新增 projection 规则
- `apps/web/src/features/chat/` — 前端渲染 streaming tool input

### 验证
- 单元测试：mapper 正确产生 `tool_call.input.delta` 事件
- 单元测试：timeline-projection 正确处理 input delta
- 前端视觉验证：tool input 逐字展示而非空 → 突然完整


---

## Phase 3: Agentic Loop 控制

### 目标
为 Claude Agent provider 添加 step limit 和安全控制，防止无限 loop。

### 设计

#### 3.1 Step Limit

Claude Agent SDK 已有 `maxTurns` 选项。我们当前从 config 读取：
```typescript
maxTurns: config.maxTurns,
```

确保 `maxTurns` 有合理默认值（比如 100），并在 AgentProfile 配置 UI 中暴露。

#### 3.2 AttemptCompletion 终止信号（不适用）

Claude Agent SDK 的 agentic loop 由 SDK 自己管理（通过 `end_turn` stop reason），不需要 AttemptCompletion 工具模式。这是 Alma 用 AI SDK `streamText` 才需要的——因为 AI SDK 不知道什么时候该停。

但 Codex SDK 和 openai-compatible provider 可以借鉴：在 tool 列表里加一个 `task_complete` 工具，模型调用它表示任务完成。

#### 3.3 Auto-compaction（预研）

Alma 的 `prepareStep` 里做 auto-compaction：context window overflow → 压缩历史。
我们的场景：
- Claude Agent SDK 自己管理 context（有 `snip` 功能）
- Codex SDK 自己管理
- `openai-compatible` provider 需要我们自己做 → 可以在 `history` 参数传入时做 truncation

### 涉及文件

- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` — maxTurns 默认值
- `apps/server/src/modules/chat-runtime/providers/openai-compatible/provider.ts` — history truncation
- AgentProfile 配置 schema — maxTurns 字段暴露

### 验证
- 配置 maxTurns=5，Agent 在 5 个 tool use 循环后停止
- openai-compatible provider 在 context overflow 时自动 truncate 不报错


---

## Phase 4: 网络韧性

### 目标
为 openai-compatible provider 和 HTTP 调用添加指数退避重试。

### 设计

#### 4.1 Retry Fetch Wrapper

```typescript
interface FetchWithRetryOptions {
  maxRetries?: number        // default 3
  baseDelay?: number         // default 1000ms
  maxDelay?: number          // default 30000ms
  signal?: AbortSignal
  retryableStatuses?: number[]  // default [429, 500, 502, 503, 504]
}

async function fetchWithRetry(url: string, init: RequestInit, options?: FetchWithRetryOptions): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal })
      if (!isRetryable(response.status) || attempt === maxRetries) return response
    } catch (err) {
      if (signal?.aborted || !isNetworkError(err)) throw err
      if (attempt === maxRetries) throw err
    }
    await sleep(Math.min(baseDelay * 2 ** attempt, maxDelay))
  }
}
```

#### 4.2 应用范围

- `openai-compatible` provider 的 API 调用
- 不应用于 Claude Agent SDK / Codex SDK（它们内部有自己的重试逻辑）

#### 4.3 Proxy 支持（可选）

通过环境变量 `HTTPS_PROXY` / `HTTP_PROXY`，使用 `undici` 的 `ProxyAgent`。
Alma 有 proxy 配置但 Cradle 的用户场景可能不需要，视后续需求决定。

### 涉及文件

- `apps/server/src/lib/fetch-retry.ts` (新建)
- `apps/server/src/modules/chat-runtime/providers/openai-compatible/provider.ts` — 使用 retry wrapper

### 验证
- 单元测试：429 响应自动重试 3 次
- 单元测试：abort signal 中断重试
- 单元测试：非 retryable status（400, 401）不重试


---

## Phase 5: Run 生命周期增强（预研）

### 目标
为未来多 Agent 协作和任务分解预留架构。

### 设计

#### 5.1 Alma 的三层模型
```
agent_missions (任务目标)
  └── agent_runs (执行实例)
        ├── parent_run_id (父 run)
        ├── spawned_by_handoff_id (交接来源)
        └── attempt_number (重试次数)

agent_handoffs (Agent 间任务委托)
```

#### 5.2 Cradle 当前模型
```
chat_sessions
  └── runs (flat, 无 parent/child)
        └── timeline_events
```

#### 5.3 可能的演进方向

暂不实施，但预留：
- `runs` 表加 `parentRunId` 列（支持 sub-run）
- `runs` 表加 `attemptNumber` 列（支持重试）
- 新建 `tasks` 表（对应 Alma 的 missions）

### 涉及文件
- 暂无修改。仅文档记录设计方向。

### 验证
- N/A（预研阶段）


---

## Progress

- [x] (2026-05-12 15:40Z) Phase 1.1: Policy keys 数据结构
- [x] (2026-05-12 15:40Z) Phase 1.2: 分层自动放行逻辑
- [x] (2026-05-12 15:40Z) Phase 1.3: Approval response type 扩展 (allow_always)
- [x] (2026-05-12 15:40Z) Phase 1.4: Headless 模式
- [x] (2026-05-12 15:40Z) Phase 1.5: 前端 "Always Allow" 按钮
- [x] (2026-05-12 15:50Z) Phase 1 Review: 修复 wildcard :all key、ESLint、session cleanup wiring
- [x] (2026-05-12 16:00Z) Phase 2.1: tool_call.input.delta 事件类型
- [x] (2026-05-12 16:00Z) Phase 2.2: Mapper 处理 input_json_delta (activeToolBlockIds state)
- [x] (2026-05-12 16:00Z) Phase 2.3: Timeline projection 适配 (hydration path accumulates deltas)
- [x] (2026-05-12 16:05Z) Phase 3.1: maxTurns 默认值 100
- [x] (2026-05-12 16:05Z) Phase 3.2: openai-compatible history truncation (maxMessages=50 default)
- [x] (2026-05-12 16:10Z) Phase 4.1: fetchWithRetry wrapper (exponential backoff + abort-aware sleep)
- [x] (2026-05-12 16:10Z) Phase 4.2: openai-compatible provider 集成
- [ ] Phase 5: 预研文档（已在本文档记录设计方向）


## Surprises & Discoveries

- Alma 实际没有用 approval timeout（虽然代码支持，`clampTimeout` 上限 120s），和我们一样是永远阻塞等用户
- Alma 的 subagent 自动放行非常激进——只要 `isSubagent === true` 就全放行，安全边界完全在 prompt engineering 层
- Alma 用 `child_process.spawn` Claude Code CLI 而非 SDK API——更隔离但更粗粒度
- Delta 增量模式其实我们的 `assistant.text.delta` 已经在做了，只是 tool input streaming 没做
- Alma 也没有 SSE 断线重连——Electron IPC 不需要，外部平台靠轮询恢复


## Decision Log

- Decision: 不迁移到 Vercel AI SDK
  Rationale: Claude Agent SDK 和 Codex SDK 都是带 agentic loop 的原生 SDK，AI SDK 的 `streamText()` 无法管理它们的内部循环。对于 openai-compatible provider 可以考虑，但不是当前优先事项。只借鉴 Alma 的实现细节，不换底座。
  Date: 2026-05-12

- Decision: Policy keys scope 为 session（内存），不持久化到 DB
  Rationale: 与 Alma 一致——`allow_always` 只在当前 session 生命周期有效。session 结束后清除。这避免了权限过度累积的安全风险。如果未来需要跨 session 记忆，可以通过 Claude Agent SDK 的 `updatedPermissions` + `suggestions` 机制委托给 SDK 自己管理。
  Date: 2026-05-12

- Decision: 暂不加 approval timeout
  Rationale: Alma 实际也没用。且 Cradle 已经修复了 abort 场景下 pending approval 的清理（`rejectPendingBySession`）。正常场景下用户应该能看到 approval card 并响应。如果未来有 headless/unattended 场景再加。
  Date: 2026-05-12


## Outcomes & Retrospective

（待实施后填写）
