# Runtime and Task Execution

## 直接结论

Cradle 应把 Multica 的 daemon/runtime/task queue 设计提炼成一个统一 execution lifecycle。这个 lifecycle 必须服务所有入口：issue assignment、comment mention、chat message、automation run、external webhook、quick-create。

目标不是让 Cradle 变成 Multica daemon 的兼容层，而是建立 Cradle-owned durable task runtime：

- task 是持久化 execution record。
- runtime 是 claim / heartbeat / result 的执行者。
- task claim 返回完整、最小、可审计的 execution context。
- task-scoped credential 是 agent 与 Cradle API 交互的唯一身份。
- session resume 和 workdir reuse 是 task lifecycle 的一部分，而不是 provider adapter 私有状态。

## Multica 证据

强证据：

- `server/migrations/004_agent_runtime_loop.up.sql`: `agent_runtime`，task 绑定 runtime。
- `server/migrations/020_task_session.up.sql`: task `session_id`、`work_dir`。
- `server/migrations/026_task_messages.up.sql`: task messages。
- `server/migrations/033_chat.up.sql`: chat session + chat task。
- `server/migrations/055_task_lease_and_retry.up.sql`: task lease / retry。
- `server/migrations/066_force_fresh_session.up.sql`: manual rerun fresh session。
- `server/migrations/108_task_token.up.sql`: task token。
- `server/internal/daemon/types.go`: claim payload。
- `server/internal/daemon/execenv/execenv.go`: isolated env, local_directory override, Codex home, OpenClaw config。
- `server/internal/daemon/execenv/context.go`: context files, provider-native skills, project resources sidecar。
- `server/internal/handler/task_lifecycle.go`: recover orphaned tasks、pin session、rerun issue。

## Execution Entity Model

### Runtime

```ts
interface Runtime {
  id: string
  workspaceId: string
  ownerId: string | null
  daemonId: string | null
  provider: string
  mode: 'local' | 'cloud'
  name: string
  visibility: 'private' | 'public'
  status: 'online' | 'offline'
  deviceInfo: string
  metadata: Record<string, unknown>
  lastSeenAt: string | null
}
```

Runtime invariant：

- `(workspaceId, daemonId, provider)` 对 local daemon 应唯一。
- `lastSeenAt` 和 live websocket/polling 状态共同决定 liveness。
- runtime delete 需要处理 active agents/tasks：拒绝、级联 archive/cancel，或迁移到新 runtime。
- runtime 不拥有 agent instructions、skills、issue、chat content。

### Task

```ts
type TaskKind =
  | 'issue'
  | 'comment'
  | 'chat'
  | 'quick_create'
  | 'automation'
  | 'external_ingress'
  | 'squad_leader'
  | 'squad_member'

interface AgentTask {
  id: string
  workspaceId: string
  agentId: string
  runtimeId: string
  kind: TaskKind
  status: TaskStatus
  issueId?: string
  chatSessionId?: string
  automationRunId?: string
  parentTaskId?: string
  triggerCommentId?: string
  triggerSummary?: string
  priority: number
  attempt: number
  maxAttempts: number
  forceFreshSession: boolean
  sessionId?: string
  workDir?: string
  waitReason?: string
  failureReason?: TaskFailureReason
  result?: TaskResult
  createdAt: string
  dispatchedAt?: string
  startedAt?: string
  completedAt?: string
}
```

Task invariant：

- Terminal statuses: `completed | failed | cancelled`。
- Active statuses: `queued | dispatched | waiting_local_directory | running`。
- 一次 task 只能属于一个 source kind，但可以关联多个 read projections。
- retry task 使用 `parentTaskId` 串联，不覆写旧 task。
- manual rerun 默认 `forceFreshSession = true`。
- infrastructure retry 可以继承 session。

### Task Claim Context

Task claim 不应该让 daemon 再拼数据库。server claim endpoint 必须返回完整 execution context：

```ts
interface TaskClaim {
  task: AgentTask
  workspaceContext?: string
  agent: {
    id: string
    name: string
    instructions: string
    model?: string
    thinkingLevel?: string
    customArgs: string[]
    customEnv: Record<string, string>
    mcpConfig?: unknown
    skills: SkillBundle[]
  }
  source: {
    issue?: IssueBrief
    chat?: ChatBrief
    automation?: AutomationRunBrief
    comment?: CommentBrief
    squad?: SquadBrief
    quickCreatePrompt?: string
  }
  context: {
    repos: RepoRef[]
    projectResources: ProjectResourceRef[]
    priorSessionId?: string
    priorWorkDir?: string
    requestingUser?: RequestingUserBrief
  }
  authToken: string
}
```

标准：

- claim response 是 execution snapshot。后续 issue/comment 变化不 retroactively 改变这个 task 的 prompt，除非创建新 task。
- `authToken` 是 task-scoped，不是 daemon token 或 owner PAT。
- secret fields 必须在 server 侧按 actor 权限 redaction。

## Lifecycle

### 1. Enqueue

入口包括：

- issue assigned to agent。
- comment mentions agent。
- user sends chat message。
- automation trigger fires。
- webhook delivery accepted。
- quick-create request。
- squad assignment resolves to leader。

所有入口最终调用同一个 enqueue primitive：

```ts
interface EnqueueTaskInput {
  workspaceId: string
  agentId: string
  runtimeId: string
  kind: TaskKind
  sourceRefs: SourceRefs
  context: Record<string, unknown>
  priority?: number
  createdBy: ActorRef
}
```

要求：

- enqueue 是 durable write。
- 入口 owner 只写自己的 run/trigger/source record，再请求 execution owner 创建 task。
- queue 不应保存完整 prompt text；保存 typed context 和 source refs。

### 2. Claim

Runtime 以 daemon identity 或 cloud worker identity claim：

- 验证 runtime access。
- 原子租约：只有一个 runtime 能把 queued task 转为 dispatched/running。
- 返回 claim context。
- 为 task mint scoped token。
- 记录 task message `system/claimed` 或 activity。

### 3. Prepare Env

Multica 的 env layout：

```text
{workspacesRoot}/{workspaceId}/{shortTaskId}/
  workdir/
  output/
  logs/
  codex-home/
  .gc_meta.json
```

Cradle 目标：

- 标准 task 使用 Cradle-owned env root。
- local directory task 可以把 workdir 指向用户目录，但必须 sidecar manifest 清理 Cradle 写入物。
- provider-specific config 只能写在 env root 或 Cradle-owned sidecar。
- 不写入外部 global namespace，除非用户显式授权并由对应 owner 管生命周期。

### 4. Materialize Context

Multica 写：

- `.agent_context/issue_context.md`
- provider-native skill directories
- `.multica/project/resources.json`

Cradle 目标：

- `runtime-context` 负责 prompt/sidecar assembly。
- sidecar 文件必须有 manifest。
- sidecar collision fail closed 或 degrade to prompt-only，不能覆盖用户文件。
- context materialization 是 read projection，不是 canonical state。

### 5. Execute

Provider adapter 启动 CLI/SDK：

- cwd = workdir。
- inject `CRADLE_TOKEN` 或 equivalent task token。
- inject provider-specific env/config。
- stream stdout/stderr/tool events into task transcript。
- parse provider session id if available。

Provider adapter 不能直接写 issue/comment。它只能调用 Cradle tools/API。

### 6. Pin Session

一旦 provider session id 或 workdir 可用，daemon 应尽早 pin：

```ts
PATCH /tasks/{taskId}/session
{
  "session_id": "...",
  "work_dir": "..."
}
```

原因：

- daemon crash 后仍能 resume。
- UI 能展示 privacy-safe relative workdir。
- retry policy 能区分 poisoned session 与 infra failure。

### 7. Complete / Fail / Cancel

TaskResult：

```ts
interface TaskResult {
  status: 'completed' | 'failed' | 'cancelled'
  comment?: string
  branchName?: string
  sessionId?: string
  workDir?: string
  usage: UsageEntry[]
  artifacts?: ArtifactRef[]
}
```

Failure reason：

```ts
type TaskFailureReason =
  | 'agent_error'
  | 'timeout'
  | 'semantic_inactivity'
  | 'runtime_offline'
  | 'runtime_recovery'
  | 'manual'
```

Terminal transition side effects：

- update task status。
- write usage entries。
- write transcript final message。
- notify source owner。
- maybe write user-visible comment/message。
- maybe retry if policy allows。
- reconcile issue/agent presence read model。

### 8. Recover Orphans

Runtime startup should call recover orphaned tasks for its runtime:

- fail `dispatched/running` tasks still assigned to that runtime。
- feed through same failure pipeline。
- maybe retry。
- record recovery count。

不要依赖 heartbeat sweeper 作为唯一恢复路径。

## Session Resume Policy

Policy matrix：

| Trigger | Resume prior session | Reason |
| --- | --- | --- |
| Same agent continues same issue after comment | Yes | 保留上下文和工作目录。 |
| Automatic retry for infrastructure failure | Yes | 避免重复 checkout/context setup。 |
| Manual rerun after bad output | No | 用户判断旧状态有毒，fresh session。 |
| New chat message in same chat session | Yes | 对话连续性。 |
| Quick-create | No by default | 任务是一次性生成。 |
| Squad leader routing | Yes for same squad/issue if prior leader session exists | 领导者保持 routing memory。 |
| External webhook replay | Configurable | Replay 是审计动作，默认 fresh 以避免重复副作用。 |

## Security Standards

### Task Token

Task token 替代 daemon token 注入 agent：

- bound to `taskId`, `workspaceId`, `agentId`, `runtimeId`。
- expires after task timeout + grace。
- server stamps headers like `X-Actor-Source=task_token`, `X-Agent-ID`, `X-Task-ID`。
- human-only endpoints must reject task-token actor。
- token hash 存库，不存 plaintext。

Task token allowed operations：

- read scoped issue/chat/project resources。
- create comment/message for current source。
- update issue metadata within allowed keys。
- upload/download attachments needed by current task。
- create child issues/tasks only through allowed tools。

Forbidden：

- billing。
- secrets reveal。
- agent env reveal。
- workspace member management。
- runtime deletion。
- arbitrary workspace admin mutations。

### Local Directory

Local directory mode risks高：

- 同一路径并发写冲突。
- sidecar 覆盖用户文件。
- GC 误删用户目录。

标准：

- path lock by absolute path。
- conflict task enters `waiting_local_directory`。
- sidecar manifest records every created file/dir。
- cleanup only deletes manifest-owned paths。
- never delete user workdir。

## Usage and Observability

Multica 的 timezone RFC 给出正确方向：

- usage raw entries 记录 provider/model/input/output/cache tokens。
- rollup 存 UTC hourly grain。
- viewing timezone 是 user preference 或 query param。
- scheduling timezone 只属于 trigger。
- 不按 runtime timezone 物化报表。

Cradle 标准：

- `usage` owner 负责 raw usage + rollups。
- `observability` 负责 task lifecycle metrics。
- product analytics 与 operational telemetry 分离。
- task lifecycle events 高容量，优先 Prometheus/本地 observability，不进产品事件流。

## API Shape 草案

```http
POST /api/runtime/tasks/claim
PATCH /api/runtime/tasks/{taskId}/session
POST /api/runtime/tasks/{taskId}/messages
POST /api/runtime/tasks/{taskId}/complete
POST /api/runtime/tasks/{taskId}/fail
POST /api/runtime/tasks/{taskId}/recover-orphans
```

User-facing:

```http
GET /api/tasks/{taskId}
GET /api/tasks/{taskId}/messages
POST /api/tasks/{taskId}/cancel
POST /api/issues/{issueId}/rerun
```

## 验收口径

- 能用同一 task lifecycle 支撑 issue、chat、automation、external ingress。
- daemon crash 后 startup recovery 不依赖用户手动操作。
- manual rerun fresh session；infra retry resume session。
- agent API 调用使用 task token，不能访问 human-only endpoint。
- task transcript、usage、activity 均可按 task 查询。
- local directory 并发与清理有机械测试。
- usage 按 viewer timezone 查询，不按 runtime timezone 物化。

