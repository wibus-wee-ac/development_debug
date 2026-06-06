# Multica-inspired 覆盖矩阵

本矩阵把 Multica 现有功能与预案功能映射到 Cradle 的目标 owner。状态含义：

- **已有基础**：Cradle 已有可承载该能力的 owner 或基础设施，但可能缺产品闭环。
- **需升级**：Cradle 有相邻能力，但需要架构边界或数据模型升级。
- **新增**：Cradle 需要新增 owner 或新增稳定 contract。
- **不建议照搬**：Multica 的实现可作为证据，但 Cradle 应采用不同抽象。

| Multica feature | 当前证据 | Cradle 状态 | 推荐 owner | 规格落点 |
| --- | --- | --- | --- | --- |
| Workspace 多租户 | `server/migrations/001_init.up.sql`, `workspace.go`, docs `workspaces.*.mdx` | 已有基础 | `workspace` | `product-concept-and-domain-model.md` |
| Member / role / invite | `member`, `workspace_invitation`, `invitation.go` | 已有基础 | `workspace` / `profiles` | `product-concept-and-domain-model.md` |
| Agent as teammate | `agent` table, `agent.go`, `packages/core/types/agent.ts` | 需升级 | `agent-identity` | `product-concept-and-domain-model.md` |
| Agent private/workspace visibility | `agent.visibility`, private access tests | 需升级 | `agent-identity` | `product-concept-and-domain-model.md` |
| Runtime / daemon | `agent_runtime`, `daemon/`, `CLI_AND_DAEMON.md` | 需升级 | `provider-runtime` | `runtime-task-execution.md` |
| Provider capability detection | daemon detects `claude`, `codex`, `copilot`, `openclaw`, `opencode`, `hermes`, `gemini`, `pi`, `cursor-agent`, `kimi`, `kiro-cli`, `agy` | 需升级 | `provider-runtime` / `provider-catalog` | `runtime-task-execution.md` |
| Task queue lifecycle | `agent_task_queue`, `task_lifecycle.go`, daemon claim endpoints | 需升级 | `chat-runtime` + `issue-agent` | `runtime-task-execution.md` |
| Session resume | `session_id`, `work_dir`, `force_fresh_session`, `PinTaskSession` | 需升级 | `chat-runtime` | `runtime-task-execution.md` |
| Task token scoped auth | `108_task_token.up.sql`, daemon `Task.AuthToken` | 新增/需升级 | `secrets` + `chat-runtime` | `runtime-task-execution.md` |
| Task messages / transcript | `026_task_messages.up.sql`, `ListTaskMessagesByUser` | 已有基础 | `chat-runtime` | `runtime-task-execution.md` |
| Usage rollups | `task_usage`, `task_usage_hourly`, `docs/timezone-architecture-rfc.md` | 已有基础 | `usage` | `runtime-task-execution.md` |
| Issue as work item | `issue`, `issue.go`, list/board/detail UI | 已有基础 | `issue` / `kanban` | `product-concept-and-domain-model.md` |
| Issue metadata | `105_issue_metadata.up.sql` | 需升级 | `issue` | `product-concept-and-domain-model.md` |
| Comments and mentions | `comment.go`, mention trigger tests | 需升级 | `issue` + `issue-agent` | `product-concept-and-domain-model.md` |
| Activity timeline | `activity_log`, `ListTimeline` | 已有基础 | `observability` / `issue` read model | `product-concept-and-domain-model.md` |
| Chat sessions | `033_chat.up.sql`, `chat.go`, `packages/views/chat` | 已有基础 | `chat-runtime` | `runtime-task-execution.md` |
| Attachments | `attachment`, `chat_message_attachments`, file handlers | 已有基础 | `workspace` / future `attachments` | `product-concept-and-domain-model.md` |
| Projects | `project`, `project_resource`, mobile project plan | 已有基础 | `workspace` / future `project` | `product-concept-and-domain-model.md` |
| Project resources | `.multica/project/resources.json`, `project_resource` | 新增/需升级 | `workspace` / `context` | `runtime-task-execution.md` |
| Skills | `skill`, `skill_file`, `agent_skill`, daemon skill materialization | 需升级 | `skills` | `skills-and-agent-templates.md` |
| Provider-native skill paths | `execenv/context.go` | 需升级 | `skills` + `provider-runtime` | `skills-and-agent-templates.md` |
| Agent templates | `server/internal/agenttmpl/templates`, `CreateAgentFromTemplate` | 新增 | `agent-identity` + `skills` | `skills-and-agent-templates.md` |
| Skill finder plan | `docs/agent-quick-create-plan.md` | 新增 | `skills` + `chat-runtime` | `skills-and-agent-templates.md` |
| AI create agent plan | `docs/agent-quick-create-plan.md` | 新增 | `agent-identity` + `skills` + `chat-runtime` | `skills-and-agent-templates.md` |
| Squads | `squad`, `squad_member`, `squad.go`, squad tests | 新增/需升级 | future `agent-routing` | `squads-autopilots-and-external-ingress.md` |
| Squad leader evaluation | `RecordSquadLeaderEvaluation`, `activity_log` details | 新增 | `agent-routing` + `observability` | `squads-autopilots-and-external-ingress.md` |
| Autopilots schedule/api/webhook | `autopilot`, `autopilot_trigger`, `autopilot_run` | 需升级 | `automation` | `squads-autopilots-and-external-ingress.md` |
| Autopilot run-only/create-issue | `execution_mode`, run task linkage | 需升级 | `automation` + `issue-agent` | `squads-autopilots-and-external-ingress.md` |
| Webhook deliveries | `webhook_delivery`, signing secret, replay | 新增 | future `external-ingress` + `automation` | `squads-autopilots-and-external-ingress.md` |
| Lark integration | `109_lark_integration.up.sql`, `lark.go` | 新增 | future `external-ingress` | `squads-autopilots-and-external-ingress.md` |
| GitHub integration | `github.go`, PR status, install routes | 已有基础 | `git` / future `external-ingress` | `squads-autopilots-and-external-ingress.md` |
| CLI and daemon setup | `CLI_AND_DAEMON.md`, `server/cmd/multica` | 已有基础 | `cli` + `provider-runtime` | `runtime-task-execution.md` |
| Self-hosting | `SELF_HOSTING.md`, compose files | 不建议照搬 | deployment docs | `clean-cradle-architecture.md` |
| Analytics taxonomy | `docs/analytics.md` | 已有基础 | `observability` / `usage` | `clean-cradle-architecture.md` |
| Onboarding v3 | `docs/onboarding-refactor-plan.md` | 不建议照搬 | `onboarding` | `clean-cradle-architecture.md` |
| Timezone RFC | `docs/timezone-architecture-rfc.md` | 已有基础 | `usage` + `preferences` | `runtime-task-execution.md` |
| Mobile project parity | `apps/mobile/docs/project-v1-plan.md` | 不建议照搬 | mobile app owner | `clean-cradle-architecture.md` |

## 缺口判断

Cradle 最值得吸收的是 Multica 的 unified task execution contract，而不是它的全量 SaaS/Tenant/Cloud 形态。

高优先级缺口：

- 缺一个 Cradle-owned durable task lifecycle，把 issue delegation、chat run、automation run、external trigger 统一起来。
- 缺 agent identity 与 provider runtime 的硬分离。Agent 是 teammate 身份，runtime 是执行资源。
- 缺 task-scoped credential。运行中的 agent 不应拿 owner 或 daemon 长期 token。
- 缺 skills 从 Cradle namespace 到 provider-native runtime namespace 的只读物化 contract。
- 缺 external ingress 的签名、去重、审计、replay 标准。

低优先级或不建议照搬：

- 多租户 SaaS billing、cloud runtime fleet proxy、自托管安装脚本，不是 Cradle 当前核心。
- Onboarding v3 的前端 transient welcome store 是 Multica 解决历史债务的产物，Cradle 只需要保留“后端薄、通用 API 组合”的原则。
- Mobile parity 计划只作为 feature parity 方法论证据，不作为 Cradle 桌面优先产品路线。

