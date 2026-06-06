# Squads, Autopilots, and External Ingress

## 直接结论

Multica 的 squads、autopilots、webhooks、Lark/GitHub integrations 都是同一件事的不同入口：把外部或高层意图转化为统一 task lifecycle。

Cradle 应避免新增多个平行执行系统。推荐抽象：

- **Agent Routing** owns squads and delegation decisions。
- **Automation** owns schedules/manual/API runs。
- **External Ingress** owns signed inbound events, dedupe, audit, replay, and source bindings。
- **Task Runtime** owns actual execution。

## Multica 证据

强证据：

- `server/migrations/084_squad.up.sql`: squad、squad_member、issue assignee squad。
- `server/internal/handler/squad.go`, `squad_*_test.go`: CRUD、leader evaluation、private leader access。
- `server/migrations/042_autopilot.up.sql`: autopilot、trigger、run、issue origin。
- `server/migrations/091_autopilot_webhook_triggers.up.sql`, `093_webhook_deliveries.up.sql`, `110_autopilot_trigger_event_filters.up.sql`: webhook triggers/deliveries/filter。
- `server/internal/handler/autopilot.go`, `autopilot_webhook.go`, `webhook_delivery.go`: trigger/run/delivery/replay/signature。
- `server/migrations/109_lark_integration.up.sql`: Lark install/user/chat binding/dedup/audit/outbound/binding token。
- `server/internal/handler/github.go`: GitHub installation and PR status integration。

## Squad 规格

### Domain

```ts
interface Squad {
  id: string
  workspaceId: string
  name: string
  description: string
  leaderAgentId: string
  avatarUrl?: string
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

interface SquadMember {
  id: string
  squadId: string
  memberType: 'agent' | 'member'
  memberId: string
  role: string
  createdAt: string
}
```

### Routing Semantics

Assigning work to a squad does not run all members. It creates a leader task：

1. Issue assignee = squad。
2. `agent-routing` resolves squad leader。
3. Enqueue task for leader with `isSquadLeader = true`。
4. Leader returns one of:
   - `no_action`
   - `self_handle`
   - `delegate_to_member`
   - `delegate_to_agent`
   - `ask_human`
5. Routing decision is recorded as activity。
6. Child task is created only if scope is clear。

Decision schema：

```ts
type SquadDecisionKind =
  | 'no_action'
  | 'self_handle'
  | 'delegate_to_agent'
  | 'delegate_to_member'
  | 'ask_human'

interface SquadDecision {
  kind: SquadDecisionKind
  targetActor?: ActorRef
  rationale: string
  confidence: number
  proposedPrompt?: string
  risk?: string
}
```

### Cradle Constraints

- Squad is routing layer, not execution owner。
- Child agent cannot write same workspace state concurrently unless isolated by worktree/sandbox/artifact。
- Manager/leader remains accountable for final merge/synthesis。
- Private leader must be accessible to routing path, but not necessarily visible to all workspace members.

## Autopilot / Automation 规格

### Domain

```ts
interface Automation {
  id: string
  workspaceId: string
  projectId?: string
  title: string
  description?: string
  assigneeType: 'agent' | 'squad'
  assigneeId: string
  status: 'active' | 'paused' | 'archived'
  executionMode: 'create_issue' | 'run_only'
  issueTitleTemplate?: string
  concurrencyPolicy: 'skip' | 'queue' | 'replace'
  createdBy: ActorRef
  lastRunAt?: string
}

interface AutomationTrigger {
  id: string
  automationId: string
  kind: 'schedule' | 'webhook' | 'api'
  enabled: boolean
  cronExpression?: string
  timezone?: string
  nextRunAt?: string
  webhookToken?: string
  label?: string
  eventFilters?: WebhookEventFilter[]
}

interface AutomationRun {
  id: string
  automationId: string
  triggerId?: string
  source: 'schedule' | 'manual' | 'webhook' | 'api'
  status: 'pending' | 'issue_created' | 'running' | 'completed' | 'failed' | 'skipped'
  issueId?: string
  taskId?: string
  triggerPayload?: unknown
  failureReason?: string
}
```

### Execution Modes

`create_issue`：

- create issue with `originType = automation` and `originId = runId`。
- assign issue to agent/squad。
- normal issue assignment flow enqueues task。

`run_only`：

- no issue required。
- enqueue task with `automationRunId`。
- result attaches to automation run artifact/transcript。

Cradle recommendation：

- Prefer `create_issue` for work that should remain visible and reviewable。
- Use `run_only` for periodic reports, diagnostics, or external sync tasks where issue noise is undesirable。

### Scheduling Timezone

Scheduling timezone belongs to trigger：

- `cronExpression` + `timezone` define user intent。
- Viewing timezone for dashboards is user preference。
- Runtime physical timezone is not a scheduling or reporting source of truth。

## Webhook Delivery 规格

Webhook delivery is not a task. It is an ingress audit record that may dispatch an automation run.

```ts
type WebhookDeliveryStatus =
  | 'queued'
  | 'dispatched'
  | 'rejected'
  | 'ignored'
  | 'failed'

type WebhookSignatureStatus =
  | 'not_required'
  | 'valid'
  | 'invalid'
  | 'missing'

interface WebhookDelivery {
  id: string
  workspaceId: string
  automationId: string
  triggerId: string
  provider: string
  event: string
  action?: string
  dedupeKey?: string
  dedupeSource?: string
  signatureStatus: WebhookSignatureStatus
  status: WebhookDeliveryStatus
  attemptCount: number
  contentType?: string
  responseStatus?: number
  automationRunId?: string
  receivedAt: string
}
```

Standards：

- verify signature before dispatch when secret configured。
- invalid signature counts against rate limit。
- store delivery even for ignored path when useful for audit。
- dedupe by provider delivery id when present。
- replay creates a new dispatch attempt linked to original delivery or marks replay metadata。
- event filters are evaluated before task/run creation。
- raw payload retention must have size and privacy policy。

## Lark / External Chat Ingress

Multica Lark integration has these concepts：

- installation bound to workspace agent。
- user binding maps external user to Multica user。
- chat session binding maps external chat thread to Multica chat session。
- inbound dedup and audit tables。
- outbound card message tracking。
- binding token for account linking。

Cradle clean external ingress model：

```ts
interface ExternalInstallation {
  id: string
  workspaceId: string
  provider: 'lark' | 'slack' | 'github' | 'linear' | string
  boundAgentId?: string
  config: Record<string, unknown>
  installedBy: string
  revokedAt?: string
}

interface ExternalActorBinding {
  id: string
  installationId: string
  externalActorId: string
  userId: string
}

interface ExternalThreadBinding {
  id: string
  installationId: string
  externalThreadId: string
  sourceType: 'chat' | 'issue' | 'automation'
  sourceId: string
}

interface ExternalInboundAudit {
  id: string
  installationId: string
  externalMessageId: string
  status: 'accepted' | 'ignored' | 'rejected' | 'failed'
  reason?: string
  sourceId?: string
  receivedAt: string
}
```

Rules：

- External message is ingress, not canonical chat state。
- Accepted inbound event creates/updates Cradle chat/issue/comment through owner APIs。
- Dedup occurs before owner mutation。
- Account binding is explicit and revocable。
- Outbound message ids are stored for update/delete/reaction sync if supported。

## GitHub / Pull Request Ingress

Cradle already has `git` owner; external PR integration should follow same ingress pattern：

- GitHub installation belongs to workspace integration owner。
- PR status/read model belongs to `git` or `diff-review` owner。
- Agent task can create branch/PR only through scoped tool。
- Webhook updates write delivery/audit first, then update read model。

## API 草案

Squads：

```http
GET /api/agent-routing/squads
POST /api/agent-routing/squads
GET /api/agent-routing/squads/{id}
PATCH /api/agent-routing/squads/{id}
POST /api/agent-routing/squads/{id}/members
DELETE /api/agent-routing/squads/{id}/members
POST /api/issues/{id}/routing-decisions
```

Automation：

```http
GET /api/automations
POST /api/automations
GET /api/automations/{id}
PATCH /api/automations/{id}
POST /api/automations/{id}/trigger
GET /api/automations/{id}/runs
GET /api/automations/{id}/deliveries
POST /api/automations/{id}/deliveries/{deliveryId}/replay
```

External ingress：

```http
POST /api/ingress/webhooks/{provider}/{token}
GET /api/external/installations
POST /api/external/installations/{provider}/begin
DELETE /api/external/installations/{id}
POST /api/external/bindings/redeem
```

## 验收口径

- Squad assignment resolves to one leader task, not uncontrolled parallel writes。
- Squad leader decisions are structured and auditable。
- Automation trigger/run/delivery are separate records。
- Webhook delivery dedupe/signature/rate-limit/replay have tests。
- External chat ingress writes through chat/issue owners only after dedup。
- Scheduling timezone and viewing timezone remain separate。
- Task runtime remains the only execution owner.

