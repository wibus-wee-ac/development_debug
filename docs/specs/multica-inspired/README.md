# Multica-inspired 规格

这个目录记录对 `/Users/wibus/dev/safe-research/multica` 的证据化调研，并把 Multica 的现有功能、预案功能和可迁移架构思想重写为 Cradle 可用的 SPEC。

目标不是复刻 Multica 的实现细节，而是提炼出一套脱离历史债务的 feature 思考：谁拥有语义、数据、执行、权限、事件、UI surface 和未来迁移。

## 结论

Multica 的核心价值不是“有一个 agent 看板”，而是把 agent 变成任务系统里的一等行动者：

- `workspace` 是多租户和权限边界。
- `issue` 是工作承载物。
- `agent` 是可分配、可评论、可创建工作项的 actor。
- `runtime` 是执行能力，不是 agent 身份。
- `agent_task_queue` 是所有执行入口的统一 durable lifecycle。
- `skill` 是 workspace-owned usage knowledge，daemon 只把它物化到 provider-native skill 目录。
- `squad` 和 `autopilot` 是 routing 与 trigger 层，不应该直接拥有执行语义。
- 外部系统入口（GitHub、Lark、webhook、CLI）都应该转化为同一套 task / issue / chat primitive，而不是创建平行工作流。

Cradle 当前已有 `workspace`、`session`、`chat-runtime`、`issue-agent`、`automation`、`skills`、`profiles`、`usage`、`observability` 等 owner。推荐方向不是把 Multica 的 Go schema 原样搬进来，而是把 Multica 的 domain contracts 映射到 Cradle 的 owner 边界，并在必要处升级架构。

## 规格索引

| 文件 | 作用 |
| --- | --- |
| [coverage-matrix.md](coverage-matrix.md) | Multica 现有与预案 feature 的覆盖矩阵，标注 Cradle 推荐 owner 与规格落点。 |
| [evidence-map.md](evidence-map.md) | 源码、迁移、路由、文档和计划文件的证据索引。 |
| [feature-inventory.md](feature-inventory.md) | Multica feature 面完整库存，用于确认现有和预案能力均已归档。 |
| [product-concept-and-domain-model.md](product-concept-and-domain-model.md) | 产品概念、领域模型、数据标准和 actor 设计。 |
| [runtime-task-execution.md](runtime-task-execution.md) | daemon/runtime/task queue/session resume/usage/security 的执行规格。 |
| [skills-and-agent-templates.md](skills-and-agent-templates.md) | skills、agent templates、skill finder、AI create agent 的规格。 |
| [squads-autopilots-and-external-ingress.md](squads-autopilots-and-external-ingress.md) | squads、autopilots、webhook、Lark/GitHub/CLI 外部入口规格。 |
| [clean-cradle-architecture.md](clean-cradle-architecture.md) | 脱离历史债务后，Cradle 应采用的 owner/namespace 架构升级。 |
| [restart-prompt.md](restart-prompt.md) | 未来继续此调研或进入 ExecPlan/实现时可复用的恢复 prompt。 |

## 范围

已覆盖的 Multica 证据面：

- 产品入口：README、中文 README、自托管、CLI/daemon、docs site。
- 后端：Go server、Chi routes、sqlc queries、PostgreSQL migrations、daemon、task lifecycle、runtime health、webhook/Lark/GitHub handlers。
- 前端：Next.js web、Electron desktop、Expo mobile、`packages/core`、`packages/ui`、`packages/views` 的共享边界。
- 数据模型：workspace、member、agent、runtime、issue、comment、activity、task queue、task messages、chat、skill、squad、autopilot、usage、task token、project resource、Lark integration。
- 功能库存：auth、workspace、issues、comments、attachments、agents、runtimes、providers、tasks、skills、projects、squads、autopilots、external integrations、dashboards、billing、analytics、frontend surfaces、release maintenance。
- 预案：Agent 快速创建三阶段、Onboarding v3、Timezone 架构重构、Mobile project v1、analytics taxonomy。

不在本规格中尝试完成的事：

- 不复制 Multica 的产品文案。
- 不把 Multica 的 table-by-table schema 作为 Cradle 目标 schema。
- 不为 Cradle 保留与 Multica 兼容的 legacy adapter。
- 不引入新的 agent orchestration，除非它服务于明确 owner 的 task lifecycle。

## 推荐实施顺序

1. 先把 Cradle 的 `issue-agent` 与 `chat-runtime` 收敛为一个 durable task lifecycle read/write contract。
2. 再升级 `profiles` / `agent-identity` / `provider-runtime`，把 agent 身份和 runtime 执行能力分离。
3. 然后实现 Cradle-owned skills materialization，而不是写入外部 agent namespace。
4. 最后补 squads、autopilots、external ingress，把它们作为 task routing/trigger 层挂到统一 lifecycle 上。
