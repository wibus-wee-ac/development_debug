# Clean Cradle Architecture

## 直接结论

如果以“脱离历史债务”重做 Cradle 的 Multica-inspired 能力，核心升级不是加更多页面，而是建立一个清晰的 owner graph：

```text
agent-identity      teammate identity
provider-runtime    executable capability
chat-runtime        durable execution lifecycle
issue-agent         issue delegation bridge
automation          scheduled / triggered work
skills              reusable usage knowledge
external-ingress    signed inbound events and bindings
observability       audit, metrics, incidents, read models
```

所有 feature 都围绕 task lifecycle 组合，而不是各自实现一套 agent run。

## 架构升级原则

### 1. Agent identity is not runtime config

Agent 身份：

- name
- avatar
- description
- instructions
- visibility
- owner

Runtime config：

- provider
- model
- executable path / SDK target
- environment and secrets
- liveness
- capability metadata

这两个概念可以在 UI 上组合，但数据 owner 必须分离。原因：

- 一个 agent 可以迁移 runtime。
- 一个 runtime 可以承载多个 agents。
- runtime offline 不应修改 agent identity。
- provider/model drift 是 runtime/profile 问题，不是 teammate identity 问题。

### 2. Execution lifecycle is canonical

所有 agent 执行都应该经过 `chat-runtime` 或 future `task-runtime`：

- chat prompt
- issue assignment
- comment mention
- automation run
- external webhook
- manager delegation
- reviewer loop

这避免以下坏味道：

- 每个 feature 自己 spawn CLI。
- 每个 feature 自己记录 transcript。
- 每个 feature 自己处理 cancellation/retry/usage。
- UI 只能靠轮询多张表判断 agent 是否在工作。

### 3. Routing is not execution

Squad、autopilot、external ingress 都只是 routing/trigger：

- routing creates task request。
- trigger creates run/delivery record。
- execution owner claims and executes task。

Routing owner 不应写 task transcript、provider session、usage raw entries。

### 4. Skills are knowledge, tools are boundaries

Skill 不应成为 tool registry，也不应成为 prompt snippet dump。

- Tool 是系统边界，暴露原始 capability。
- Skill 是 usage knowledge，描述何时如何用 tool/runtime/workflow。
- Template 是 create-flow preset，引用 skills。

Cradle 要写 Cradle-owned skills namespace，再在 task env 中投影到 provider-native paths。

### 5. External ingress is a first-class owner

Webhook/Lark/GitHub/Slack 这类外部入口必须有统一 owner：

- installation
- external actor binding
- external thread binding
- inbound audit
- dedupe
- signature
- replay

不要让 automation、chat、issue 分别半实现一套 webhook。

### 6. Observability owns evidence, not business truth

Activity、timeline、metrics、incidents、trace 都是 evidence/read model。

它们可以回答：

- 发生了什么。
- 什么时候发生。
- 谁触发。
- 成本多少。
- 失败原因。

它们不应该成为：

- issue status 真相源。
- task status 真相源。
- agent presence 真相源。
- permission source。

## Target Module Contracts

### agent-identity

Owns：

- agent record。
- teammate display profile。
- visibility。
- archive/restore。
- template catalog metadata。

Reads：

- runtime capability summary。
- skill attachment summary。
- task activity read model。

Does not own：

- provider secrets。
- runtime process。
- task status。

### provider-runtime

Owns：

- runtime registration。
- provider catalog/capabilities。
- daemon/cloud worker liveness。
- runtime visibility。
- local skill/model listing requests。
- per-provider execution adapter。

Reads：

- task claim payload。
- skills bundle。

Does not own：

- agent identity。
- issue/chat/automation state。

### chat-runtime / task-runtime

Owns：

- task/run lifecycle。
- transcript。
- cancellation。
- retry。
- provider session id/workdir。
- usage raw entries。
- task-scoped token。

Reads：

- source refs from issue/chat/automation。
- agent identity/profile projection。
- runtime availability。

Does not own：

- source entity semantics。
- external webhook delivery semantics。

### issue-agent

Owns：

- issue assignment -> task request。
- comment mention -> task request。
- issue task read projection。
- issue-specific completion policy。

Does not own：

- task execution。
- provider adapter。
- agent identity。

### automation

Owns：

- automation definition。
- triggers。
- runs。
- schedule evaluation。
- run result summary。

Reads：

- agent/squad routing target。
- task terminal events。
- external delivery dispatch requests。

Does not own：

- webhook signature/dedupe generic logic。
- execution transcript。

### skills

Owns：

- skill canonical data。
- skill files。
- import/fetch/validate。
- agent skill attachment relation or attachment projection API。

Does not own：

- provider global skill lifecycle。
- runtime execution。

### external-ingress

Owns：

- provider installation。
- inbound delivery/audit。
- signature/dedupe/rate limit。
- external actor/thread binding。
- replay。

Does not own：

- chat message canonical state。
- issue canonical state。
- automation business decision。

## Data Shape Recommendations

### Use source refs instead of nullable everything

Multica 逐步让 `agent_task_queue` 支持 `issue_id` nullable、`chat_session_id`、`autopilot_run_id` 等字段。Cradle clean schema 可以改为 typed source refs：

```ts
type TaskSourceRef =
  | { kind: 'issue'; issueId: string; triggerCommentId?: string }
  | { kind: 'chat'; chatSessionId: string; messageId: string }
  | { kind: 'automation'; automationRunId: string }
  | { kind: 'external'; deliveryId: string }
  | { kind: 'quick_create'; requestId: string }
```

SQL 可以使用 source_kind + source_id + source_detail JSON，或拆 typed link tables。不要继续扩展一张热表上的 nullable FK 直到不可维护。

### Use projections for UI presence

Agent status/presence 应由以下信号派生：

- runtime liveness。
- active tasks。
- last terminal task。
- failure reason。
- manual blocked state。

不要让 provider adapter 直接写 `agent.status`。

### Store tokens and model dimensions, compute cost later

Usage raw/rollup 应记录：

- provider
- model
- input/output/cache tokens
- task count/event count
- bucket UTC

Cost 由 pricing owner 按当前 price table 计算。这样价格变更无需重灌 rollup。

## Migration Strategy

若后续从当前 Cradle 状态实施：

1. 先定义 task source ref 与 task lifecycle contract。
2. 让 `issue-agent` 和 chat flows 都写同一 task table/read model。
3. 引入 task token，逐步替代长期 credentials 注入。
4. 把 runtime/provider config 从 agent/profile 混合结构中拆出。
5. 把 skills materialization 移到 runtime claim path。
6. 引入 automation trigger/run，但只通过 task lifecycle 执行。
7. 引入 external-ingress，先支持 webhook，再支持 chat integrations。
8. 最后实现 squads/manager delegation。

## Verification Standards

每个新 feature spec 进入 ExecPlan 前必须包含：

- Owner table。
- Canonical entities。
- Read projections。
- Mutation boundaries。
- Task lifecycle interaction。
- Auth model。
- Observability events。
- Failure/retry model。
- Migration and deletion story。

## Anti-patterns to reject

- Agent row 同时存身份、runtime、secret、status、execution state。
- Automation 直接 spawn provider。
- Webhook handler 直接写 issue/comment，跳过 delivery audit。
- Skill import 直接写 provider global skill path。
- Comment 里塞完整 execution transcript。
- Activity log 被用作业务状态。
- Runtime offline 直接把 issue 改 failed。
- Manager/squad 同时让多个 agents 写同一个 workdir。

