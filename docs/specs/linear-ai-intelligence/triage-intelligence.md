# Triage Intelligence SPEC

## 直接结论

Cradle 的 Triage Intelligence 应该是 `work-intelligence` owner 下的 model-backed suggestion system。它不应该只是 workflow rule，也不应该只是 issue-agent 的一段 prompt。它需要拥有独立的 suggestion run、evidence、decision、auto-apply policy、guidance inheritance 和 quality evaluation。

第一版应先交付可解释、可接受/拒绝的建议，再开放自动应用。自动应用必须建立在 suggestion confidence、policy scope、权限和冲突检测之上。

## Linear 行为摘要

Linear Triage Intelligence 的关键行为：

- 当 future issue 进入 triage，会被 agentic models 分析。
- 模型会把当前 issue 与 workspace 历史数据比较。
- 建议包括 teams、projects、assignees、labels、duplicates 和 relationships。
- 用户可以 accept、decline，或查看 suggestion reason。
- 每个 team 可以配置不同 property type 是显示、隐藏还是 auto-apply。
- 可以限制 suggestion scope，例如只包含 team/sub-team。
- sub-team 默认继承 parent team rules，但可以 override。
- workspace、team、sub-team guidance 会影响 suggestion behavior，local guidance 权重更高。
- 非 triage issue 也可以通过 command menu 手动触发 `Find Suggestions`。

## Product Goal

用户在 Cradle 中创建或导入 issue 后，系统可以自动完成初步分流：

- 判断 issue 应进入哪个 status category 或 queue。
- 建议 labels、priority、assignee、delegate agent、milestone、project。
- 检测 duplicates、blocking relations 和 related work。
- 解释建议原因，给出证据。
- 在允许的情况下自动应用低风险建议。
- 把所有 AI 决策留在可审计 timeline 中。

## Non-goals

- 不做“静默改 issue”的 AI。所有 mutation 必须可追溯。
- 不以 free-form comment 作为 suggestion 存储。
- 不把 duplicate detection 做成纯标题 fuzzy search。
- 不让 auto-apply 跨越 private workspace/team 权限。
- 不让 Triage guidance 写入 workflow-rules namespace。

## Current Cradle Fit

当前已有可承接的 schema：

- `kanban_issues`: title、description、priority、labels、assignee、delegate agent、contextRefs。
- `kanban_statuses`: status category 已有 `triage`、`backlog`、`unstarted`、`started`、`completed`、`canceled`。
- `kanban_issue_relations`: supports `blocks`、`duplicates`、`relates_to`。
- `kanban_issue_field_changes`: 可记录 issue field mutation audit。
- `agent_sessions` / `agent_activities`: 可被升级为 agent-interaction-runtime。

缺口：

- 没有 suggestion 表。
- 没有 suggestion decision audit。
- 没有 evidence refs。
- 没有 triage settings / guidance hierarchy。
- 没有 relation suggestion 的 explainable flow。
- 没有 auto-apply policy。
- 没有 quality eval。

## Core Objects

```ts
export type TriageSuggestionProperty =
  | 'status'
  | 'priority'
  | 'label'
  | 'assignee'
  | 'delegateAgent'
  | 'milestone'
  | 'project'

export type TriageSuggestionMode =
  | 'show'
  | 'hide'
  | 'autoApply'

export interface TriageSuggestionRun {
  id: string
  issueId: string
  workspaceId: string
  trigger: 'issueEnteredTriage' | 'manualFindSuggestions' | 'issueUpdated' | 'imported'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'timedOut' | 'canceled'
  guidanceSnapshotId: string | null
  modelProviderId: string
  startedAt: number | null
  completedAt: number | null
  errorText: string | null
}

export interface TriageSuggestionPolicy {
  id: string
  workspaceId: string
  teamId: string | null
  inheritedFromPolicyId: string | null
  propertyModes: Record<TriageSuggestionProperty, TriageSuggestionMode>
  includeScope: 'workspace' | 'teamAndSubteams' | 'teamOnly'
  allowedValues: Partial<Record<TriageSuggestionProperty, string[]>>
  minimumConfidence: number
  autoApplyMinimumConfidence: number
}
```

## Suggestion Payloads

```ts
export interface PropertySuggestionPayload {
  field: TriageSuggestionProperty
  proposedValueId: string
  proposedValueLabel: string
  currentValueId: string | null
}

export interface RelationshipSuggestionPayload {
  relationType: 'duplicates' | 'blocks' | 'relates_to'
  sourceIssueId: string
  targetIssueId: string
  targetIssueTitle: string
  targetIssueIdentifier: string
}

export interface SuggestionEvidenceRef {
  id: string
  kind:
    | 'issue-content'
    | 'historical-issue'
    | 'issue-relation'
    | 'field-history'
    | 'label-history'
    | 'code-reference'
    | 'guidance'
  sourceId: string
  title: string
  summary: string
  sensitivity: 'public' | 'workspace' | 'private' | 'secret'
}
```

## Triage Pipeline

```text
Issue event
  -> Build triage context
  -> Retrieve historical candidates
  -> Generate property suggestions
  -> Generate relationship suggestions
  -> Validate suggestions
  -> Apply policy
  -> Persist proposed or auto-applied suggestions
  -> Project activity into issue timeline
```

### Context Builder

输入：

- 当前 issue title、description、labels、priority、status、assignee、delegate agent。
- 当前 issue comments and field changes。
- workspace/team status vocabulary。
- historical issues in allowed scope。
- relation graph around candidate issues。
- accepted/declined suggestion history。
- guidance documents。
- optional Code Intelligence evidence refs。

输出必须是 bounded context，不允许把全量 issue history 塞进 prompt。推荐先用 deterministic retrieval 生成候选，再让模型判断：

- lexical title/body search。
- shared labels/project/milestone。
- same creator or same source。
- recent issues in same status/team。
- relation-neighborhood candidates。
- Code Intelligence source overlap。

### Model Output Contract

模型必须输出 schema-valid JSON。禁止直接输出 mutation command。

```ts
export interface TriageModelOutput {
  propertySuggestions: Array<{
    field: TriageSuggestionProperty
    valueId: string
    confidence: number
    explanation: string
    evidenceRefIds: string[]
    alternatives: Array<{ valueId: string, confidence: number }>
  }>
  relationshipSuggestions: Array<{
    relationType: 'duplicates' | 'blocks' | 'relates_to'
    targetIssueId: string
    confidence: number
    explanation: string
    evidenceRefIds: string[]
  }>
}
```

Validator 必须拒绝：

- unknown entity id。
- user 无权限访问的 target issue。
- confidence 不在 `0..1`。
- evidenceRefIds 不存在。
- duplicate 自指。
- relation direction 不合法。
- auto-apply policy 不允许的 field。

## Auto-apply Policy

Auto-apply 只允许用于低风险、可回滚字段，且必须按 field 独立配置。建议默认：

| Field | Default |
| --- | --- |
| label | show |
| priority | show |
| status | show |
| assignee | show |
| delegateAgent | show |
| milestone | show |
| project | show |
| relation | show |

Auto-apply gate：

```text
policy mode is autoApply
AND confidence >= autoApplyMinimumConfidence
AND user/system has mutation permission
AND proposed value is allowed by policy
AND no conflicting accepted value exists
AND evidence sensitivity is allowed for target viewer
AND run was not timed out
```

Auto-applied suggestion 仍然必须写入 suggestion decision，并触发 issue field change audit。

## Guidance

Triage guidance 用于修正长期错误模式，而不是初始配置替代品。它应支持：

- workspace guidance。
- team guidance。
- sub-team override。
- personal review preference only for UI/answer style，不应改变 workspace-wide mutation policy。

Guidance snapshot 应在 run 开始时固化，避免后续编辑改变历史解释。

```ts
export interface GuidanceSnapshot {
  id: string
  owner: 'work-intelligence'
  sources: Array<{
    scope: 'workspace' | 'team' | 'subteam' | 'personal'
    sourceId: string
    body: string
    updatedAt: number
  }>
  createdAt: number
}
```

## UI Contract

Issue detail 中的 suggestions 区域应显示：

- grouped property suggestions。
- duplicate / related issue suggestions。
- confidence as qualitative label, not raw score。
- short explanation。
- evidence hover/popover。
- accept、decline、dismiss actions。
- auto-applied badge。
- policy source。

不应显示 chain-of-thought。Reasoning UI 应显示 structured signals：

- similar historical issue。
- same label pattern。
- same project pattern。
- same code area。
- same assignee history。
- guidance match。

## API Targets

```text
POST /issues/:issueId/triage-intelligence/runs
GET /issues/:issueId/triage-intelligence/runs
GET /issues/:issueId/triage-intelligence/suggestions
POST /triage-intelligence/suggestions/:suggestionId/accept
POST /triage-intelligence/suggestions/:suggestionId/decline
POST /triage-intelligence/suggestions/:suggestionId/dismiss
GET /triage-intelligence/policies
PUT /triage-intelligence/policies/:policyId
GET /triage-intelligence/guidance
PUT /triage-intelligence/guidance/:scopeId
```

## Tests and Evals

Unit tests：

- suggestion validator rejects invalid entity refs。
- policy inheritance resolves local override before parent。
- auto-apply gate blocks low confidence。
- private issue relation suggestion is redacted。
- decision audit writes once and is idempotent。

Integration tests：

- issue entering triage creates suggestion run。
- manual run works on non-triage issue。
- accept label suggestion mutates issue and writes field change。
- decline duplicate suggestion leaves issue relation unchanged。
- auto-apply label works only when policy allows。

Eval：

- replay historical issues and compare accepted labels/assignees/status。
- measure duplicate precision and recall on known relation pairs。
- adversarial private issue leakage cases。
- guidance correction cases。

## Implementation Order

1. Create `work-intelligence` module and suggestion tables。
2. Add manual run API with fake model provider。
3. Add validator, evidence refs and decision API。
4. Add issue detail suggestion UI。
5. Add policy and guidance settings。
6. Add auto-apply gate。
7. Add duplicate/relationship candidate retrieval。
8. Add eval harness。

## Completion Criteria

- A triage issue can receive suggestions with evidence and explanation。
- Accept/decline/dismiss are persisted and auditable。
- Auto-apply is disabled by default and policy-gated when enabled。
- Private issue data cannot leak through suggestions。
- Existing workflow rules remain deterministic and separate。
