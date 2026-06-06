# Product Concept and Domain Model

## 直接结论

Cradle 应吸收 Multica 的“一等 agent teammate”模型，但不要照搬其 SaaS schema。目标模型应该是：

- 人类、agent、system 都是 actor，但 actor 不拥有所有业务语义。
- Issue / session / automation 是工作入口，task execution 是统一 durable lifecycle。
- Agent 身份只描述“谁在工作”，runtime 只描述“在哪里、用什么能力执行”。
- Workspace 是 namespace 与权限边界，不能让 agent、skill、runtime 写入非自己 owner 的 namespace。

## Multica 证据

Multica 当前 domain 由以下强证据支撑：

- `server/migrations/001_init.up.sql`: user、workspace、member、agent、issue、comment、inbox、agent_task_queue、activity_log。
- `server/migrations/004_agent_runtime_loop.up.sql`: runtime 从 agent 中拆出，`agent.runtime_id` 与 `agent_task_queue.runtime_id` 指向 `agent_runtime`。
- `server/migrations/084_squad.up.sql`: `issue.assignee_type` 扩展为 `member | agent | squad`。
- `server/migrations/105_issue_metadata.up.sql`: issue 可由 agent 写入小型 JSONB KV metadata。
- `server/internal/handler/actor_guards.go`: task token actor 可进入部分工作流，但被 billing 等 human-only 路由拒绝。
- `packages/core/types/issue.ts`: frontend contract 明确 `IssueAssigneeType = "member" | "agent" | "squad"`。

## 概念模型

### Workspace

Workspace 是所有产品资源的 namespace：

- issue、agent、runtime、skill、project、squad、autopilot 都属于 workspace。
- workspace membership 是 workspace-scoped API 的权限入口。
- workspace context 是所有 agent task 的共享提示词输入。

Cradle 目标：

- `workspace` 继续拥有本地 repo、文件树、git、terminal、workspace rules。
- 其他 feature 只能读取 workspace projection，不直接写 workspace 私有数据。
- external namespace 的数据只能作为 imported projection，不允许写回外部 owner namespace。

### Actor

Multica 使用 polymorphic actor：

```ts
type ActorType = 'member' | 'agent' | 'system'

interface ActorRef {
  actorType: ActorType
  actorId: string | null
}
```

Cradle 应采用同样的 actor ref，但要限制其语义：

- actor ref 只能表达“谁触发/执行/展示为作者”。
- 不能用 actor ref 替代 owner。比如 agent 写 comment，不代表 agent 拥有 comment schema；comment 仍由 issue/comment owner 管。
- system actor 必须带 `action` 与 `details`，不能成为绕过权限的匿名写入者。

### Agent

Agent 是工作者身份，不是模型配置：

- display name、avatar、description、instructions。
- visibility：workspace 或 private。
- owner：谁能管理该 agent 的敏感配置。
- default runtime/profile：偏好绑定，但 runtime 不属于 agent。
- skills：agent 被授权使用的 usage knowledge。

Cradle 目标 owner：

- `agent-identity` 拥有 agent record、avatar、visibility、profile summary。
- `profiles` 或 `provider-runtime` 拥有 provider/model/runtime config。
- `skills` 拥有 skill attachment projection。
- `issue-agent` 读取 agent identity，不能写 agent canonical fields。

### Runtime

Runtime 是执行资源：

- local daemon 或 cloud node。
- provider capability：`claude`、`codex`、`copilot` 等。
- liveness：online/offline、last seen。
- visibility：private/public，控制谁能绑定 agent。
- owner：注册 runtime 的用户或 system。

Cradle 不应把 runtime status 写回 agent 身份。UI 可以读 runtime + active tasks 派生 agent presence，但 presence 是 read model。

### Issue

Issue 是 work item：

- status、priority、assignee、creator、parent、project、labels、dates。
- comments 与 activity timeline。
- metadata 是 agent 写入的轻量状态。
- assignee 可以是 human、agent、squad。

Cradle 若引入 Multica-inspired issue agent，应遵守：

- Issue owner 负责 issue CRUD、metadata schema、subscriber/inbox projection。
- `issue-agent` 只负责“issue 被分派给 agent 后如何创建 task”。
- Agent 不直接改 issue 状态；它通过 scoped tool / API 发起 mutation，服务端按权限和 lifecycle 决定是否接受。

### Comment and Timeline

Multica 评论是触发 agent 的重要入口：

- `@agent` comment 触发 new task。
- agent reply 写入 comment。
- activity 与 comments 混合展示 timeline。

Cradle 目标：

- comment 是 user-visible communication。
- activity 是 audit/projection。
- task transcript 是 execution log，不应混成 comment。
- agent 的“思考流/工具输出”进入 task transcript；用户可见总结进入 comment 或 chat message。

### Project and Project Resources

Multica project 是 issue 的高层容器，project resources 则被 daemon 物化为 `.multica/project/resources.json`。

Cradle 可借鉴 project resources 的“scoped context sidecar”思想：

- 项目/工作空间 owner 维护资源引用。
- task claim 时仅传入相关 project resources。
- runtime 在 workdir 写只读 sidecar。
- agent 需要 checkout repo 或下载 attachment 时走 scoped CLI/API。

### Skill

Skill 是 workspace-owned usage knowledge：

- `skill`: name、description、content、config。
- `skill_file`: supporting files。
- `agent_skill`: M:N attachment。

关键原则：

- Skill 不等于 tool。Skill 教 agent 什么时候、如何使用已有能力。
- Skill 不属于 provider runtime；runtime 只读取 materialized copy。
- Cradle 写自己的 skill namespace，再投影到 provider-native location。

### Squad

Squad 是 routing abstraction：

- squad 有 leader agent。
- squad members 可以是 member 或 agent。
- issue assignee 可为 squad。
- 实际 task 分派先给 leader，由 leader决定是否行动或分派成员。

Cradle 不应把 squad 做成“多个 writer 同时写”。目标是一个 routing/read model：

- squad assignee resolves to leader task。
- leader 输出 structured routing decision。
- child tasks 必须拥有独立 scope 或被 manager 串行合并。

### Autopilot

Autopilot 是 trigger + issue/task factory：

- schedule/webhook/api/manual trigger。
- create_issue 或 run_only。
- run record 关联 issue/task。
- webhook delivery 负责审计、签名、去重、replay。

Cradle 已有 `automation`，因此不应新增 parallel `autopilot` owner。应把 Multica 的 autopilot feature 归入 automation owner。

## 数据标准

### ID 与 Identifier

- Canonical ID 使用 UUID。
- Human identifier 仅用于 UI 和 CLI，如 `MUL-123`。
- 对接受 UUID 或 human identifier 的 API，必须先 loader resolve，再用 canonical UUID 写库。

### Status

Issue status 和 task status 必须分离：

```ts
type IssueStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked'
  | 'cancelled'

type TaskStatus =
  | 'queued'
  | 'dispatched'
  | 'waiting_local_directory'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
```

Issue status 表达 work item 的业务状态；task status 表达 execution lifecycle。它们可以互相驱动 projection，但不能合并。

### Metadata

Issue metadata 应是 flat primitive KV：

```ts
type IssueMetadataValue = string | number | boolean
type IssueMetadata = Record<string, IssueMetadataValue>
```

禁止把 arbitrarily nested JSON 放入 metadata。复杂结构应由拥有者建表或建 typed artifact。

### Visibility

Agent visibility 与 runtime visibility 是不同轴：

- agent visibility 控制谁能看到/使用该 agent 身份。
- runtime visibility 控制谁能把 agent 绑定到该 runtime。

二者默认都应该偏 private。

## Cradle 目标架构

```text
workspace
  ├─ issue / kanban owns work items
  ├─ agent-identity owns agent teammate records
  ├─ provider-runtime owns runtimes and capabilities
  ├─ skills owns reusable usage knowledge
  ├─ chat-runtime owns execution lifecycle
  ├─ issue-agent owns issue-to-task delegation
  ├─ automation owns scheduled / webhook / manual triggers
  └─ observability owns audit, metrics, incidents, timeline read models
```

关键 contract：

- `issue-agent` 创建 task，但不执行 task。
- `chat-runtime` 执行 task，但不拥有 issue semantics。
- `automation` 创建 trigger/run，但不拥有 agent execution。
- `skills` 提供 skill bundle，runtime 只读 materialization。
- `observability` 记录 lifecycle，不能成为业务状态真相源。

## 验收口径

进入实现前必须能回答：

- 每个 canonical field 的 owner 是谁。
- 每个 mutation route 是否只写 owner namespace。
- agent actor 是否通过 task-scoped credential 操作。
- task transcript、comment、activity 三者是否清晰分离。
- issue status 与 task status 是否没有混写。
- runtime status 是否不会直接覆盖 agent identity。

