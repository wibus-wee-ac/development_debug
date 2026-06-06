# Agent Interaction Runtime SPEC

## 直接结论

Cradle 需要把 agent interaction 从 `issue-agent` 的后台 run wrapper 升级为独立 runtime owner。Linear 的 AI 产品链路依赖一个清晰协议：agent 有独立身份、可被提及、可被委派、能发出 activity、能请求输入、能被停止、能暴露 plan，并且永远不取代 human accountability。

这个 SPEC 定义 `agent-interaction-runtime`，它是 Triage Intelligence、Code Intelligence、coding agents、MCP-driven agents 和 future automations 的共同交互层。

## Linear 行为摘要

Linear 官方文档呈现的 agent 体系：

- Linear Agent 是内置 beta，可在 dedicated chat、`Cmd/Ctrl + J`、comment 中 `@Linear` 触发。
- AI Agents 作为 app users 安装，由 workspace admins 管理。
- Agent 可以被 mention，也可以通过 issue assignment 被 delegated。
- Agent 不是 assignee；human teammate 保持 ownership/accountability。
- Agent guidance 支持 workspace/team/personal scopes。
- Skills 可把成功工作流保存成 personal 或 team-shared reusable instructions。
- Automations 让 Linear 对进入 triage 的 issues 按 open-ended instruction 自动响应。
- MCP server 让外部 AI clients 通过 authenticated remote MCP 访问 Linear data。
- Developer AgentSession 和 AgentActivity 形成技术协议：状态、活动、signals、plan、external links、webhooks 和 timing SLA。

## Current Cradle Gap

当前 `packages/db/src/schema/issue-agent.ts` 已有：

- `agent_sessions`
- `agent_activities`

但还缺：

- Linear 式 session status：`pending`、`awaitingInput`、`stale`。
- plan object。
- external URLs。
- first response SLA。
- stale timeout。
- signal-specific behavior。
- validated activity content payload。
- human prompt activity as first-class row。
- guidance snapshot。
- agent identity disclosure contract。

当前 `apps/server/src/modules/issue-agent/service.ts` 仍以 issue prompt + ChatRuntime run 为核心。它可以作为 migration evidence，但不应继续拥有完整 agent 交互语义。

## Owner Boundary

`agent-interaction-runtime` owns：

- Agent identity projection in sessions and activities。
- Session lifecycle and status projection。
- Activity append-only log。
- Prompt activity ingestion。
- Plan updates。
- External URLs。
- Signals。
- Stop/disengage enforcement。
- First response and stale timers。
- Agent activity UI data contract。

It reads：

- Issue delegation state from issue owner。
- ChatRuntime run status。
- Work Intelligence and Code Intelligence events。
- Guidance documents。

It writes：

- Agent session rows。
- Agent activity rows。
- Agent plan rows or replacement plan JSON。
- Agent session audit events。

It must not own：

- Issue field mutation semantics。
- Triage suggestion generation。
- Code repository index。
- Provider-specific runtime internals。
- MCP server configuration namespace。

## Session Model

```ts
export type AgentSessionTrigger =
  | 'issue-delegation'
  | 'comment-mention'
  | 'chat'
  | 'triage-automation'
  | 'manual'
  | 'mcp-client'

export type AgentSessionStatus =
  | 'pending'
  | 'active'
  | 'awaitingInput'
  | 'complete'
  | 'error'
  | 'stale'
  | 'stopped'

export interface AgentSessionRecord {
  id: string
  trigger: AgentSessionTrigger
  issueId: string | null
  commentId: string | null
  chatSessionId: string | null
  providerTargetId: string | null
  agentId: string
  status: AgentSessionStatus
  guidanceSnapshotId: string | null
  firstActivityDueAt: number
  staleAfterAt: number | null
  completedAt: number | null
  createdAt: number
  updatedAt: number
}
```

`stopped` 是 Cradle 本地扩展状态，用于表达 user stop signal 已被执行。它不应被混同为 `error`。

## Activity Model

```ts
export type AgentActivityType =
  | 'thought'
  | 'action'
  | 'elicitation'
  | 'response'
  | 'error'
  | 'prompt'

export interface AgentActivityRecord {
  id: string
  agentSessionId: string
  type: AgentActivityType
  body: string
  dataJson: string
  signal: AgentSignalKind | null
  signalMetadataJson: string | null
  ephemeral: boolean
  authorKind: 'agent' | 'user' | 'system'
  authorId: string | null
  createdAt: number
}

export type AgentSignalKind =
  | 'stop'
  | 'auth'
  | 'select'
```

Activity rules：

- `prompt` 只能由 user/system ingress 创建，agent 不能自发创建 prompt。
- `thought` 和 `action` 可为 ephemeral。
- `response` 表示完成或阶段性最终答复。
- `elicitation` 表示等待用户输入，session status 应进入 `awaitingInput`。
- `error` 表示失败，session status 应进入 `error`。
- 所有 activity 都是 frozen-in-time snapshots，comments 只是 projection。

## Signals

### stop

Human-to-agent signal。

```ts
export interface StopSignalMetadata {
  reason?: string
  requestedByUserId: string
}
```

收到 `stop` 后：

- cancel linked ChatRuntime run。
- cancel pending queue items。
- prevent further issue/code/external writes。
- append final `response` or `error` activity。
- mark session `stopped`。

### auth

Agent-to-human signal。

```ts
export interface AuthSignalMetadata {
  url: string
  providerName: string
  targetUserId?: string
}
```

Rules：

- URL 必须通过 allowlist / external link policy。
- UI 只给目标用户展示 action。
- 不允许要求用户在普通 prompt 中粘贴 secret。
- 完成 auth 后 agent 应以 thought activity 恢复。

### select

Agent-to-human signal。

```ts
export interface SelectSignalMetadata {
  options: Array<{
    label: string
    value: string
    description?: string
  }>
}
```

Rules：

- 用户可以选项，也可以 free-form reply。
- 选择结果进入 `prompt` activity。
- Agent 必须用 LLM 解释用户回复，不能只处理 exact option value。

## Plan Model

```ts
export type AgentPlanStepStatus =
  | 'pending'
  | 'inProgress'
  | 'completed'
  | 'canceled'

export interface AgentPlanStep {
  id: string
  content: string
  status: AgentPlanStepStatus
}

export interface AgentSessionPlan {
  agentSessionId: string
  steps: AgentPlanStep[]
  updatedAt: number
}
```

Plan update 替换完整数组，不能只 patch 单个 step。这样 UI 和审计能避免 partial order ambiguity。

## Timing and State Projection

```text
session created
  -> pending
  -> first thought/action/externalUrl within 10s
  -> active
  -> response -> complete
  -> elicitation -> awaitingInput
  -> error -> error
  -> no update for stale window -> stale
  -> stop signal -> stopped
```

Timing standards：

- First activity SLA: 10 seconds。
- Internal handler ack: 5 seconds。
- Stale window: default 30 minutes after last agent activity。
- Stale is recoverable when a new agent activity arrives。

## Delegation Contract

Delegating an issue to an agent must preserve human assignee accountability。

Target issue fields：

- `assigneeKind` / `assigneeId`: accountable human or owner。
- `delegateAgentId`: executing agent。
- `delegateAgentProfileId`: optional runtime profile。

Delegation flow：

```text
User delegates issue
  -> issue owner records delegateAgentId
  -> agent-interaction-runtime creates session
  -> agent emits thought within SLA
  -> if issue status is not started/completed/canceled, issue owner may move it to first started status by policy
  -> activities stream
  -> final response projects comment if configured
```

The runtime must not silently replace assignee with agent。

## Skills and Automations

Skills are reusable instructions. In Cradle:

- Personal skills belong to user-owned Cradle namespace。
- Team/shared skills belong to Cradle-owned workspace namespace。
- Runtime may inject skill instructions by id。
- Skill invocation should be recorded in activity data。

Automations are open-ended instructions attached to triggers. Triage automations should be owned by `work-intelligence` but executed through `agent-interaction-runtime` when they involve agent behavior。

```ts
export interface AgentAutomationDefinition {
  id: string
  owner: 'work-intelligence' | 'agent-interaction-runtime'
  trigger: 'issueEnteredTriage' | 'manual'
  instruction: string
  scopeJson: string
  enabled: boolean
}
```

## MCP Boundary

MCP is an external access surface, not the internal owner model。

Cradle should expose MCP tools only through owner APIs:

- issue tools call issue/work-intelligence APIs。
- code tools call code-intelligence APIs。
- agent tools call agent-interaction-runtime APIs。

MCP tools must not bypass:

- permission policy。
- suggestion lifecycle。
- stop signal enforcement。
- audit logging。

## API Targets

```text
POST /agent-sessions
GET /agent-sessions/:agentSessionId
GET /agent-sessions/:agentSessionId/activities
POST /agent-sessions/:agentSessionId/activities
PUT /agent-sessions/:agentSessionId/plan
PUT /agent-sessions/:agentSessionId/external-urls
POST /agent-sessions/:agentSessionId/stop
POST /issues/:issueId/delegation
DELETE /issues/:issueId/delegation
```

Existing issue-agent routes can be migrated or deleted after the new runtime is complete。

## Tests

Unit tests：

- session status transitions。
- first activity SLA marks unresponsive/stale state。
- stop cancels linked runs and prevents further writes。
- auth/select signal metadata validation。
- plan replacement validation。

Integration tests：

- issue delegation creates agent session。
- first thought activity activates session。
- elicitation moves session to awaitingInput。
- user prompt resumes session。
- stop cancels active ChatRuntime run。
- final response projects issue comment when configured。

## Completion Criteria

- Agent session lifecycle is independent from ChatRuntime internals。
- Activity log is append-only and typed。
- Stop/auth/select signals have enforced behavior。
- Plan is visible and replaceable。
- Delegated agent is not treated as accountable assignee。
- Work Intelligence and Code Intelligence can use the runtime without owning its tables。
