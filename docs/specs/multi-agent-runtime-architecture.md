# Multi-Agent Runtime Architecture

## 目标

这份 SPEC 定义 Cradle 多 Agent runtime 的技术标准。它面向未来架构升级，不要求沿用当前历史实现，但必须复用已经正确的 owner 边界：`chat-runtime` 负责 run execution，`observability` 负责 trace，`issue-agent` 负责 issue delegation lifecycle，`automation` 负责 durable scheduled run，`workspace` / `git` 负责 filesystem 与 diff projection。

核心目标：

- 支持 short interactive collaboration 和 long resumable workflow。
- 支持 single writer、parallel read-only worker、isolated writer、clean reviewer、smart friend、manager synthesis。
- 支持 MCP、A2A、Agent Client Protocol / ACP 等协议接入，但不让外部协议污染 Cradle canonical model。
- 支持 trace、budget、permission、rollback 和 recovery。

## 分层架构

```text
User / Web / Desktop / CLI / IDE
  -> App Server Session API
    -> Chat Runtime
      -> Runtime Provider Adapter
        -> AI SDK UIMessageChunk stream
    -> Agent Orchestration
      -> Task Registry
      -> Router / Policy
      -> Scheduler
      -> Checkpoint Store
      -> Blackboard Projection
      -> Guardrails
      -> Workspace Isolation
      -> Observability Event Log
    -> Protocol Gateway
      -> MCP servers
      -> A2A remote agents
      -> Agent Client Protocol agents
```

`agent-orchestration` 是未来 owner。只有当 Cradle 实现 graph workflow、dynamic workflow、task registry、checkpoint、parallel / pipeline runtime 时才新增。Phase 1 / 2 可以先用 `chat-runtime` + `issue-agent` + `observability` 增量实现，不急于新增 canonical tables。

## 模块职责

| 模块 | 职责 | 不负责 |
|---|---|---|
| App Server Session API | HTTP / WS / SSE ingress、session route、cancel、resume | agent task semantics |
| `chat-runtime` | run execution、provider stream、message snapshot、terminal status | workflow graph state |
| Runtime Provider Adapter | 把 Codex / Claude Agent / ACP / OpenAI-compatible 等转为 AI SDK boundary | Cradle orchestration policy |
| `agent-orchestration` | task registry、workflow state、routing、scheduling、checkpoint、budget | provider-specific event parsing |
| Router / Policy | 选择 agent/runtime/tool/workspace，执行 allowlist | 自己写业务代码 |
| Scheduler | concurrency、timeout、retry、cancel、backoff、circuit breaker | prompt synthesis |
| Blackboard Projection | facts、decisions、artifacts、claims、finding refs | 真实 agent cognition |
| Event Log | append-only trace、span、metrics、incident | direct UI state mutation |
| Guardrails | permission tiers、risk scoring、approval card、sandbox policy | code review quality judgment |
| Workspace Isolation | worktree / branch / container / snapshot / rollback | deciding semantic merge |
| Protocol Gateway | MCP / A2A / ACP adapter、auth、identity、audit | hiding protocol-specific provenance |

## Canonical 数据模型草案

以下类型是概念模型，真正实现时应优先用现有 schema 和 AI SDK 类型，不要为局部方便发明平行 projection。

```ts
export type AgentTaskStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'complete'
  | 'failed'
  | 'cancelled'

export type AgentTaskKind =
  | 'consultation'
  | 'review'
  | 'worker'
  | 'verifier'
  | 'handoff'
  | 'synthesis'
  | 'workflow-node'

export interface AgentTask {
  id: string
  parentId: string | null
  workflowId: string | null
  chatSessionId: string
  backendRunId: string | null
  kind: AgentTaskKind
  contextPolicy: ContextPolicy
  assignedAgentId: string | null
  providerTargetId: string | null
  runtimeKind: string
  workspaceRef: string | null
  goal: string
  inputRef: string | null
  outputRef: string | null
  status: AgentTaskStatus
  createdAt: number
  updatedAt: number
}

export interface WorkflowCheckpoint {
  id: string
  workflowId: string
  nodeId: string
  taskCursor: string | null
  messageCursor: string | null
  blackboardVersion: string | null
  budgetSnapshot: BudgetSnapshot
  stateJson: string
  createdAt: number
}

export interface BlackboardItem {
  id: string
  workflowId: string | null
  taskId: string | null
  kind: 'fact' | 'claim' | 'decision' | 'artifact' | 'finding' | 'context-request'
  contentJson: string
  sourceRunId: string
  sourceMessageId: string | null
  confidence: number | null
  expiresAt: number | null
  createdAt: number
}
```

## Run boundary

Cradle 的 provider run boundary 必须保持 AI SDK-native：

```ts
export interface RuntimeProvider {
  streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void>
}
```

多 Agent runtime 可以创建多个 run，但每个 run 仍然通过 `chat-runtime` 执行，输出仍然是 `UIMessageChunk` / terminal snapshot。不得重新引入 Cradle-owned stream delta。

Subagent output 的 UI 显示优先使用 AI SDK tool part / output snapshot。若 provider 原生暴露 collab event，例如 Codex 的 `collabAgentToolCall`，Cradle 只将其映射为 runtime UI slot / stream evidence，不把 provider type 变成 canonical orchestration state。

## Task registry

Task registry 是 long workflow 的 backbone。它要解决：

- parent / child task tree。
- task status。
- assigned runtime / agent / workspace。
- output artifact refs。
- timeout / retry / cancellation。
- resume cursor。

设计标准：

- task id 必须出现在 observability event 中。
- task input / output 必须结构化，禁止只靠 transcript parse。
- child task 不直接写 parent state，只提交 outputRef / signal。
- task status 只能由 owner service 改写。
- task retry 必须产生新 run id，不能覆盖历史 run。

## Router / Policy

Routing 策略分三层：

| 层 | 作用 |
|---|---|
| Rule routing | 确定性规则，例如 high-risk 必须 review，file-write 必须 isolated workspace |
| Capability routing | 根据 model/runtime capability 选择 provider target |
| LLM routing | 在 allowed set 内选择 agent 或下一步 |

LLM routing 必须输出结构化决策：

```ts
export interface RoutingDecision {
  action: 'call-agent' | 'handoff' | 'ask-user' | 'continue' | 'final'
  targetAgentId: string | null
  targetRuntimeKind: string | null
  contextPolicy: ContextPolicy
  reason: string
  confidence: number
  requiredApproval: boolean
}
```

Policy 必须先计算 allowed set，LLM 只能在 allowed set 内选择。LLM 返回越权 target 时应 fail closed，并记录 `routing.policy_denied`。

## Scheduling semantics

### Parallel barrier

适用：全局 ranking、dedupe、voting、cross-file comparison。

标准：

- 同一 batch 的 tasks 同时启动或按 concurrency cap 分批启动。
- gather phase 等所有 task terminal 后开始。
- 任一 task timeout 不应永久阻塞 barrier；需要 failure strategy。
- gather 必须显式处理 failed / cancelled branch。

### Pipeline stream

适用：大量独立 item、latency 不均、需要 progressive checkpoint。

标准：

- item 完成当前 stage 后可进入下一 stage，不等待 batch。
- 每个 item-stage 都有 trace event。
- checkpoint 可以 per item / per stage。
- partial state update 必须 idempotent。

### Retry / timeout / cancellation

标准：

- retry 只针对 transient failure，semantic failure 进入 review / human decision。
- 每次 retry 产生独立 run id，并保留 parent attempt id。
- cancellation 从 workflow -> task -> run -> provider process 逐层传播。
- timeout 需要区分 queue timeout、run timeout、tool timeout。

## Context builder

Context builder 是多 Agent 质量的核心，不应散落在 prompt 字符串里。

```ts
export interface ContextEnvelope {
  policy: ContextPolicy
  goal: string
  constraints: string[]
  verifiedFacts: string[]
  excludedContext: string[]
  inputArtifacts: Array<{ kind: string, ref: string, reason: string }>
  outputSchema: unknown
  decisionLogRefs: string[]
}
```

标准：

- `clean-review` 明确列出 excluded context，例如完整历史、writer chain-of-thought、未验证假设。
- `adversarial-verifier` 输入 claim 和 evidence，不输入 worker 全上下文。
- `handoff-receiver` 输入 minimal relevant history 和 transfer reason。
- `manager-synthesis` 输入 child handoff refs，不输入所有 raw transcript。

## Blackboard projection

Blackboard 只保存共享事实、artifact、decision 和 claim projection，不保存真实 agent state。

标准：

- append-only by default。
- 每条 item 必须有 sourceRunId。
- 每条 item 必须有 kind、schemaVersion、createdAt。
- 可过期信息必须有 TTL。
- conflicting claims 不覆盖，产生 conflict event。
- synthesis 只能引用 blackboard item id 或 artifact ref，不能只说“某 agent 说过”。

首期可以使用：

- `observability_events.attrs` 保存 trace-level projection。
- `agentActivities.signalMetadata` 保存 issue-level signal。
- `automation.artifacts` 保存 durable artifact。

当需要跨 session 查询、筛选、状态迁移时，再新增 `agent_orchestration_blackboard_items`。

## Observability event model

所有多 Agent action 必须进入 append-only trace。

最小事件：

| Event | 触发 |
|---|---|
| `workflow.created` | graph 或 script 被创建 |
| `workflow.approved` | 用户批准 workflow run |
| `workflow.phase.started` | phase 开始 |
| `workflow.phase.completed` | phase 结束 |
| `task.created` | task registry 记录产生 |
| `task.assigned` | task 分配给 agent/runtime |
| `agent.run.started` | backend run 启动 |
| `agent.run.completed` | backend run complete |
| `agent.run.failed` | backend run failed |
| `routing.decision` | router 选择下一步 |
| `routing.policy_denied` | router 输出被 policy 拒绝 |
| `review.finding.created` | reviewer 产出 finding |
| `review.finding.decided` | writer 接受/拒绝/fixed |
| `handoff.requested` | active agent 请求 handoff |
| `handoff.accepted` | receiver 接管 |
| `blackboard.item.created` | shared projection 写入 |
| `workspace.isolated.created` | isolated workspace 创建 |
| `workspace.diff.created` | isolated output 产生 diff |
| `approval.requested` | high-risk action 等待人类 |
| `approval.resolved` | approval 完成 |
| `checkpoint.saved` | checkpoint 保存 |
| `checkpoint.resumed` | 从 checkpoint 恢复 |

字段标准：

```ts
export interface AgentTraceEvent {
  id: string
  traceId: string
  spanId: string
  parentSpanId: string | null
  sessionId: string
  runId: string | null
  workflowId: string | null
  taskId: string | null
  actor: string
  type: string
  payload: unknown
  occurredAt: number
  schemaVersion: number
}
```

Cradle 当前 `observability` 已有 `traceId`、`parentEventId`、`chatSessionId`、`runId`、`messageId`、`attrs`，足够承载 Phase 1 / 2。Graph / dynamic workflow 需要 span-level tree 时再升级 schema。

## Guardrails

权限分层：

| Level | Action | 默认策略 |
|---|---|---|
| L0 | read-only docs/context | allow |
| L1 | file read/search/static analysis | allow + log |
| L2 | file write/config change | policy check |
| L3 | shell/dependency/network | sandbox or approval |
| L4 | git commit/deploy/database write | human approval |
| L5 | production/finance/permission change | deny by default |

多 Agent 特有规则：

- Subagent 不得自动继承更高权限；继承必须显式记录。
- Wide fan-out workflow 的 permission card 必须显示 tool categories、write paths、agent count、budget。
- High-risk action 的 approval card 必须包含 action、reason、scope、diff、rollback、risk、timeout。
- Approval 后必须记录当时上下文，不能只记录 approved boolean。
- Policy denied 不应被 prompt retry 绕过。

## Workspace isolation

并行 writer 必须使用 isolation。

可选策略：

| 策略 | 适用 |
|---|---|
| read-only worker | research、review、audit |
| artifact namespace | child 产出 markdown/json/report |
| git worktree | parallel code modification |
| branch / PR output | large migration |
| container sandbox | dependency install、shell-heavy task |

标准：

- Isolated writer 不能写 main worktree。
- 每个 isolated workspace 有 owner task id。
- 输出必须是 artifact 或 diff。
- 合并由 manager / active writer 串行完成。
- cleanup 是 workflow terminal 的一部分。
- rollback strategy 在 write 前定义。

## Protocol gateway

### MCP

MCP 是 agent-to-tool / resource / prompt 边界。Cradle 应通过 MCP 暴露或消费 raw capabilities，不把 MCP server 当作 Cradle agent lifecycle owner。

标准：

- MCP tool call 必须有 server、tool、args、duration、result/error trace。
- MCP resource 可作为 context artifact 输入。
- MCP prompt 可作为 skill-like usage knowledge，但不能绕过 Cradle workflow rule ownership。

### A2A

A2A 是 cross-agent / cross-vendor collaboration 边界。Cradle 未来接入时应映射为 remote task / message / artifact，不直接映射为 local `AgentTask` write authority。

标准：

- Remote agent identity 必须独立记录。
- Remote task output 先进入 artifact / blackboard projection。
- Remote agent 不获得 local workspace write，除非通过 explicit sandbox adapter。
- A2A auth、capability card、task id、artifact id 必须进入 trace。

### Agent Client Protocol / ACP

Agent Client Protocol 是 editor / IDE 到 coding agent 的边界。Cradle 已有 `acp` 模块和 `acp-chat` runtime，应继续把 ACP agent output 适配进 `chat-runtime`，而不是让 ACP 拥有 Cradle session semantics。

标准：

- ACP local agent process lifecycle 归 `acp` 模块。
- ACP chat output 归 `chat-runtime` snapshot。
- ACP-specific UI elements 可以投影到 runtime UI slot。
- ACP remote support 需要重新评估 auth、workspace、diff 和 file operation boundary。

## Implementation phases

### Phase 1: Review and consultation without new owner

使用现有 owner：

- `chat-runtime` 创建 review / consultation run。
- `observability` 记录 events。
- `issue-agent` activity signal 展示 issue 维度 finding。

不新增 graph tables。

### Phase 2: Manager delegation read model

增强：

- child handoff schema。
- crew / manager overview read model。
- active writer marker。

只读聚合 `agent-identity`、`profiles`、`issue-agent`、`chat-runtime`。

### Phase 3: Agent orchestration owner

当需要 graph / task registry / checkpoint 后新增：

- `agent_workflows`
- `agent_tasks`
- `agent_checkpoints`
- `agent_blackboard_items`

必须有 Drizzle schema、migration、module README、OpenAPI schema、observability tests。

### Phase 4: Dynamic workflow

新增：

- workflow script artifact。
- script review / approval。
- sandboxed runtime。
- parallel / pipeline primitives。
- checkpoint resume。
- worktree isolation manager。

## 验证标准

每个实现 PR 必须验证：

- `rg` 无旧 Cradle chat stream delta 或 parallel approval protocol 回归。
- 所有 provider output 仍进入 `UIMessageChunk` / `UIMessage` 边界。
- 多 Agent run 有 traceId、taskId、runId。
- Clean review context 不包含完整历史。
- Reviewer / smart friend 无 workspace write path。
- Parallel writer 必须有 isolated workspace evidence。
- Approval card 包含 risk、scope、diff 或 artifact。
- Event replay 能重建 task tree 或 workflow phase tree。
