# Linear AI Intelligence Runtime Architecture

## 直接结论

Linear AI 的核心不是“给 issue 加一个 AI 按钮”，而是把 AI 放进产品工作流的原生状态机：issue 进入 Triage 后被分析，系统给出可解释建议；agent 被委派后以独立身份工作，发出 activity、plan、signals；Code Intelligence 把 repository 变成受权限约束的产品上下文。Cradle 需要用新的 feature owner 重建这条链路，而不是在现有 `issue-agent` prompt builder 上继续堆逻辑。

目标架构应当包含四层：

1. `work-intelligence`: issue / triage / duplicate / relationship / property suggestion owner。
2. `code-intelligence`: repository context、code retrieval、code-grounded answer owner。
3. `agent-interaction-runtime`: agent session、activity、signals、plan、external links owner。
4. `context-orchestration`: typed context item、evidence、guidance、permission projection owner。

## 关键依据

Linear Triage Intelligence 的官方文档说明，它会对进入 triage 的未来 issue 做 agentic model 分析，并基于历史趋势和当前 issue 内容主动建议 teams、projects、assignees、labels、duplicates 和 relationships。建议可以接受、拒绝，也可以查看原因；不同 property type 可以配置为显示、隐藏或自动应用。配置可以在 workspace、team、sub-team 层生效，并支持 local guidance。

Linear Code Intelligence 的官方文档说明，它通过 GitHub integration 让 Linear 受控访问 repository，使 workspace 成员能在 Linear 内询问产品实现细节。它是 Business 和 Enterprise beta，beta 期免费；默认遵循 GitHub repository 权限，也允许 admin 把选定 repository access 扩展给所有 workspace members。

Linear Agent / AI Agents / developer docs 补齐了技术协议：agent 是独立 app user，不是传统 assignee；人类仍然 accountable。AgentSession 有 `pending`、`active`、`error`、`awaitingInput`、`complete`、`stale` 六类状态；AgentActivity 有 `thought`、`action`、`response`、`elicitation`、`error`，用户 prompt 是单独的 input activity。created webhook 后 10 秒内必须有 thought 或 external URL，否则被视为 unresponsive。Signals 包含 human-to-agent `stop` 和 agent-to-human `auth`、`select`。Agent plan 是 session-level checklist，更新时替换整个数组。

Cradle 当前已有一些相邻能力：`issues` 已有 status category、priority、labels、assignee、delegate agent、relations、field changes；`agent_sessions` 和 `agent_activities` 已存在，但 session status 只有 `created`、`active`、`completed`、`stopped`、`failed`，没有 Linear 式 `awaitingInput` / `stale`，activity content 也还只是 JSON body。`ContextItem` 已经存在 typed context envelope，这可以承接 Code Intelligence 和 Triage guidance，但当前没有 repository intelligence owner。

## 非目标

- 不把 Triage Intelligence 做成普通 workflow rule。workflow rule 是 deterministic automation，Triage Intelligence 是 model-backed suggestion lifecycle。
- 不把 Code Intelligence 做成 workspace file search。workspace search 是文件入口；Code Intelligence 是 permission-aware repository product context。
- 不让 `issue-agent` 继续拥有所有 AI issue 语义。它可以消费 agent interaction runtime，但不应拥有 triage suggestion、code grounding 或 guidance inheritance。
- 不把 MCP 当作内部架构替代品。MCP 是外部 client 接入面，不是 Cradle 内部 owner boundary。
- 不为了兼容旧数据 shape 做长期兼容层。当前未发布，可以按干净架构破坏性升级。

## Owner 边界

### work-intelligence

`work-intelligence` owns：

- Issue intake event classification。
- Triage suggestion generation。
- Property suggestion lifecycle。
- Duplicate and relationship suggestion lifecycle。
- Auto-apply policies。
- Guidance inheritance for triage suggestions。
- Suggestion explanation, confidence, alternatives, accept/decline/dismiss history。
- Evaluation datasets and suggestion quality metrics。

It reads：

- Issue title、description、labels、priority、status、relations、comments、field changes。
- Workspace/team/status metadata。
- Agent guidance and workflow rules as input context。
- Code Intelligence summaries only through typed evidence refs。

It writes：

- Cradle-owned suggestion tables。
- Issue property changes after explicit accept or allowed auto-apply policy。
- Issue relations after explicit accept or allowed policy。
- Audit events owned by work-intelligence。

It must not write：

- Foreign provider namespaces。
- Chronicle memory or repository indexes。
- Agent session transcript except through agent-interaction-runtime activity APIs。

### code-intelligence

`code-intelligence` owns：

- Repository registry and access policy。
- Repository indexing jobs。
- Code chunks, symbols, commits, PR refs, dependency graph summaries and retrieval metadata。
- Code-grounded answer requests。
- Source citation ledger for files、commits、PRs。
- Repository guidance and code interpretation policy。
- Permission-aware retrieval and admin access extension rules。

It reads：

- Workspace files when repository is local and explicitly attached。
- Git metadata through Git/workspace APIs。
- Provider or external GitHub integration data through a provider-specific adapter。
- Issue context and Triage evidence through typed refs。

It writes：

- Cradle-owned repository context tables and artifact cache。
- Code Intelligence answer trace and citation ledger。
- Optional issue comments or agent activities only through owning APIs。

It must not write：

- GitHub repository data。
- Workspace files。
- Issue fields directly unless invoked through work-intelligence or agent action with audit。

### agent-interaction-runtime

`agent-interaction-runtime` owns：

- AgentSession lifecycle。
- AgentActivity append-only log。
- Human prompt activities。
- Signals。
- Agent plan。
- External links such as dashboard links or PR links。
- Session status projection and timeout policy。
- First-response SLA and stale detection。

It reads：

- Issue delegation state。
- ChatRuntime run state。
- Work/Code Intelligence activities as producers。

It writes：

- Agent session rows。
- Agent activity rows。
- Agent plan rows or plan JSON。
- Audit events for stop/auth/select/session status。

It must not write：

- Issue property suggestions。
- Code index data。
- Workflow rules or guidance definitions。

## Conceptual Model

```ts
export type IntelligenceOwner =
  | 'work-intelligence'
  | 'code-intelligence'
  | 'agent-interaction-runtime'

export type SuggestionKind =
  | 'issue-team'
  | 'issue-project'
  | 'issue-assignee'
  | 'issue-label'
  | 'issue-priority'
  | 'issue-status'
  | 'issue-duplicate'
  | 'issue-relation'
  | 'repository'
  | 'code-answer'

export type SuggestionState =
  | 'proposed'
  | 'accepted'
  | 'declined'
  | 'dismissed'
  | 'auto-applied'
  | 'expired'
  | 'superseded'

export interface IntelligenceSuggestion {
  id: string
  owner: IntelligenceOwner
  kind: SuggestionKind
  targetType: 'issue' | 'comment' | 'agent-session' | 'repository'
  targetId: string
  state: SuggestionState
  valueJson: string
  alternativesJson: string
  explanationJson: string
  evidenceRefsJson: string
  confidence: number
  policyId: string | null
  generatedAt: number
  decidedAt: number | null
  decidedByKind: 'user' | 'system' | 'agent' | null
  decidedById: string | null
}
```

这个对象是跨 feature 的 suggestion protocol，不是最终数据库唯一形态。Triage 可以扩展 property-specific payload，Code 可以扩展 source citation payload，但所有建议都必须能落回统一 lifecycle。

## Event Flow

### Issue enters triage

```text
Issue created or moved to triage
  -> work-intelligence receives IssueTriageRequested
  -> context-orchestration reads issue, historical issues, labels, relations, guidance
  -> model generates property and relation suggestions
  -> suggestion validator applies confidence, policy, permission and conflict checks
  -> suggestions are persisted as proposed
  -> auto-apply policy applies eligible suggestions
  -> issue timeline receives field-change or suggestion activity projection
```

### Manual suggestion run

```text
User invokes Find Suggestions on non-triage issue
  -> work-intelligence creates manual suggestion run
  -> same generation path runs with manual trigger metadata
  -> suggestions attach to issue without changing issue status
```

### Code Intelligence question

```text
User asks a code-grounded question
  -> code-intelligence checks user/repository access
  -> repository retriever selects files, symbols, commits, PRs
  -> answer generator produces compact answer with citation ledger
  -> answer is displayed in chat or agent activity
  -> source links remain inspectable and permission-filtered
```

### Delegated agent run

```text
Issue delegated to agent
  -> agent-interaction-runtime creates AgentSession
  -> thought activity is emitted within SLA
  -> ChatRuntime or provider-native runtime starts execution
  -> action/thought/elicitation/error/response activities stream back
  -> stop/auth/select signals alter runtime behavior
  -> final response completes session or leaves it awaiting input
```

## Suggestion Standards

所有 suggestion 必须满足：

- 有 stable id。
- 有 owner。
- 有 target。
- 有 state。
- 有 confidence。
- 有 typed value payload。
- 有 evidence refs。
- 有 explanation。
- 有 generated policy context。
- 有 decision audit。

Property suggestion 的 value 不能只是 display label，必须引用目标实体：

```ts
export interface IssuePropertySuggestionValue {
  field: 'team' | 'project' | 'assignee' | 'label' | 'priority' | 'status'
  entityId: string
  entityLabel: string
  previousValueId?: string | null
}
```

Relationship suggestion 必须表达方向：

```ts
export interface IssueRelationshipSuggestionValue {
  relationType: 'duplicates' | 'blocks' | 'relates_to'
  sourceIssueId: string
  targetIssueId: string
  direction: 'source-to-target' | 'target-to-source'
}
```

Explanation 必须可供 UI 展示，但不能暴露 chain-of-thought。推荐结构：

```ts
export interface SuggestionExplanation {
  summary: string
  supportingSignals: Array<{
    label: string
    evidenceRefId: string
    weight: 'low' | 'medium' | 'high'
  }>
  caveats: string[]
}
```

## Agent Activity Standards

Cradle 当前 `agent_activities.content` 只保存 `{ body }`，目标架构应升级为 server-validated activity payload。

```ts
export type AgentActivityType =
  | 'thought'
  | 'action'
  | 'elicitation'
  | 'response'
  | 'error'
  | 'prompt'

export type AgentSessionStatus =
  | 'pending'
  | 'active'
  | 'error'
  | 'awaitingInput'
  | 'complete'
  | 'stale'
  | 'stopped'

export interface AgentActivityContent {
  type: AgentActivityType
  body: string
  data?: Record<string, unknown>
}

export interface AgentActivitySignal {
  kind: 'stop' | 'auth' | 'select'
  metadata?: Record<string, unknown>
}
```

Cradle 可以保留 `stopped` 作为本地扩展状态，但必须清楚区分：`stopped` 是用户显式 disengage；`error` 是失败；`stale` 是超时未更新；`awaitingInput` 是 agent 正常等待用户。

## Timing Standards

- 新 agent session 创建后 10 秒内必须产生 `thought` activity、`action` activity 或 external link update。
- Webhook-like entrypoint 或 internal event handler 必须在 5 秒内 ack，把长任务交给 background run。
- Agent activity 后续更新超过 30 分钟未到达时，session 进入 `stale`，但新的 activity 可以恢复。
- Triage suggestion run 应有可配置 timeout；超时不得 auto-apply。
- Code Intelligence answer 可以慢于普通 workspace answer，但 UI 必须显示 repository analysis progress。

## Permission Standards

Triage：

- Workspace admin 可以启用 workspace-level intelligence。
- Team owner/admin 可以覆盖 team/sub-team suggestion policy。
- Auto-apply 只允许作用于用户或系统有权限修改的 issue。
- Private workspace/team issue 不得被跨团队 duplicate detection 泄漏，除非用户拥有两个 issue 的可见权限。

Code：

- 默认 repository access follows source provider permission。
- Admin 可以把选定 repository access 扩展给 workspace members，但必须有显式配置和审计。
- Guest users 不应使用 Code Intelligence。
- Code answer citation 在用户无权限时必须隐藏或降级，不返回路径、commit 或 snippet。

Agent：

- Agent identity 必须清楚显示为 agent，不得与 human user 混淆。
- Agent delegation 不替代 human assignee accountability。
- `stop` signal 收到后，agent 不得继续写 issue、repo 或外部 API。
- `auth` signal 只能请求用户完成外部授权，不能要求用户把 secret 粘贴进普通文本。

## Guidance Inheritance

Linear 文档显示 guidance 既可在 workspace，也可在 team/personal 级配置；Triage guidance 多层存在时，最 local 的 guidance 权重最高。Cradle 应采用相同原则：

```text
Personal guidance
  > Team guidance
  > Parent team guidance
  > Workspace guidance
  > Provider/runtime default guidance
```

Work Intelligence 和 Code Intelligence 都可以读取 guidance，但只有各自 owner 解释具体语义。不要把所有 guidance 串成单段 prompt；必须保留 scope、source、updatedAt 和 owner。

## Data Model Targets

建议新增或重构这些表。名称是目标语义，具体迁移可以在 ExecPlan 中调整。

```text
intelligence_suggestion_runs
intelligence_suggestions
intelligence_suggestion_decisions
intelligence_evidence_refs
intelligence_guidance_documents
code_repositories
code_repository_access_policies
code_repository_index_runs
code_chunks
code_symbols
code_answer_runs
agent_sessions
agent_activities
agent_session_plans
```

现有 `agent_sessions` 和 `agent_activities` 可以破坏性升级，而不是新增兼容 wrapper。现有 `kanban_issue_field_changes` 可以继续作为 issue owner 的 field audit，但 suggestion decision 应由 `work-intelligence` owner 记录。

## API Surface Targets

```text
POST /issues/:issueId/intelligence/suggestions/run
GET /issues/:issueId/intelligence/suggestions
POST /intelligence/suggestions/:suggestionId/accept
POST /intelligence/suggestions/:suggestionId/decline
POST /intelligence/suggestions/:suggestionId/dismiss
GET /intelligence/settings/workspace
PUT /intelligence/settings/workspace
GET /teams/:teamId/intelligence/settings
PUT /teams/:teamId/intelligence/settings

GET /code-intelligence/repositories
PUT /code-intelligence/repositories/:repositoryId/access-policy
POST /code-intelligence/repositories/:repositoryId/index
POST /code-intelligence/answers
GET /code-intelligence/answers/:answerRunId

GET /agent-sessions/:agentSessionId
POST /agent-sessions/:agentSessionId/activities
PUT /agent-sessions/:agentSessionId/plan
POST /agent-sessions/:agentSessionId/stop
```

API 命名应在实现时按现有 OpenAPI/x-cradle-cli 约定细化。

## Observability and Eval

必须记录：

- suggestion run count、latency、timeout、error。
- suggestions per issue。
- accept/decline/dismiss/auto-apply rates。
- false positive duplicate rate。
- auto-apply rollback rate。
- code answer source coverage。
- code answer no-access redaction rate。
- first agent activity latency。
- stale session count。
- stop signal compliance。

Eval datasets：

- 历史 issue routing replay。
- Duplicate pair replay。
- Label/project/assignee prediction replay。
- Private issue leakage adversarial cases。
- Repository question-answer golden set。
- Permission-aware repository access cases。
- Agent activity lifecycle simulation。

## Implementation Order

1. Upgrade `agent-interaction-runtime` contract first, because both Triage and Code need visible AI state.
2. Add `work-intelligence` suggestion tables and manual run API without auto-apply.
3. Add duplicate/relationship detection with evidence and accept/decline UI.
4. Add property suggestion automation and scoped settings。
5. Add `code-intelligence` repository registry and local repository indexing。
6. Add permission-aware code answer runs with file/commit citation ledger。
7. Connect Code Intelligence evidence into Work Intelligence and agent prompts。
8. Add admin controls, eval harness and quality dashboards。

## Acceptance Criteria

- Triage suggestions can be generated, inspected, accepted, declined and dismissed without mutating issue fields until policy allows it。
- Auto-apply decisions are explainable and auditable。
- Duplicate suggestions never reveal private issue metadata to unauthorized users。
- Code answers include source refs and refuse or redact inaccessible repository content。
- Agent sessions expose state, activity, plan and stop behavior separately from chat runtime internals。
- Existing `issue-agent` prompt-only behavior is either removed or downgraded to a consumer of the new runtime。
- Docs and implementation identify owner boundaries explicitly。
