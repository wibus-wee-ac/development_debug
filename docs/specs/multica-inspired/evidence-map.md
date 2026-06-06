# Evidence Map

本文件列出本轮调研使用的主要证据。后续进入实现或 ExecPlan 时，应先重新确认这些路径仍存在且语义未漂移。

## 顶层产品与开发说明

| 证据 | 关键信息 |
| --- | --- |
| `/Users/wibus/dev/safe-research/multica/README.md` | 产品定位、功能列表、CLI quickstart、architecture diagram、支持的 agent CLI。 |
| `/Users/wibus/dev/safe-research/multica/README.zh-CN.md` | 中文产品叙述。 |
| `/Users/wibus/dev/safe-research/multica/CLAUDE.md` | monorepo 分层、state/query 规则、package boundary、desktop/mobile/web 共享原则、API compatibility。 |
| `/Users/wibus/dev/safe-research/multica/AGENTS.md` | agent working rules，与 `CLAUDE.md` 同类。 |
| `/Users/wibus/dev/safe-research/multica/CONTRIBUTING.md` | dev workflow。 |
| `/Users/wibus/dev/safe-research/multica/SELF_HOSTING.md` | self-hosting 部署形态。 |
| `/Users/wibus/dev/safe-research/multica/CLI_AND_DAEMON.md` | CLI、daemon、runtime registration、polling、GC、provider env override。 |
| `/Users/wibus/dev/safe-research/multica/CLI_INSTALL.md` | AI agent 安装指南。 |

## Multica 自带产品文档

| 证据 | 关键信息 |
| --- | --- |
| `/Users/wibus/dev/safe-research/multica/docs/product-overview.md` | 2026-04-21 的产品全景，包含核心概念词典和功能模块。 |
| `/Users/wibus/dev/safe-research/multica/apps/docs/content/docs/*.mdx` | 用户文档：agents、issues、comments、skills、runtimes、autopilots、squads、tasks、CLI、providers、Lark、GitHub 等。 |
| `/Users/wibus/dev/safe-research/multica/docs/analytics.md` | analytics event taxonomy，区分 PostHog product events 与 Prometheus operational metrics。 |
| `/Users/wibus/dev/safe-research/multica/docs/timezone-architecture-rfc.md` | scheduling/viewing timezone 分层，以及 UTC hourly rollup 设计。 |

## 预案与计划

| 证据 | 状态 | 关键信息 |
| --- | --- | --- |
| `/Users/wibus/dev/safe-research/multica/docs/agent-quick-create-plan.md` | Draft | Agent template、Skill Finder、AI Create Agent 三阶段。 |
| `/Users/wibus/dev/safe-research/multica/docs/onboarding-refactor-plan.md` | Implemented plan | Thin server、frontend orchestrated welcome、删除 v2 持久化字段。 |
| `/Users/wibus/dev/safe-research/multica/apps/mobile/docs/project-v1-plan.md` | Pre-implementation | mobile project parity、route-modal picker、progress、board/list、draft store。 |
| `/Users/wibus/dev/safe-research/multica/apps/mobile/docs/project-v1-gap-audit.md` | Gap audit | mobile project surface 差距。 |

## 后端路由

| 证据 | 关键信息 |
| --- | --- |
| `/Users/wibus/dev/safe-research/multica/server/cmd/server/router.go` | workspace/user/auth/cloud/workspace-scoped route registration。 |
| `router.go` workspace routes | issues、tasks、labels、projects、squads、autopilots、pins、attachments、comments、agents、agent templates、skills、dashboard、runtimes、cloud-runtime、chat、inbox、notification preferences。 |
| `router.go` external routes | GitHub integration、Lark integration、autopilot webhooks、billing proxy、tokens、invitations。 |

## 数据模型与迁移

| 证据 | 关键信息 |
| --- | --- |
| `server/migrations/001_init.up.sql` | 初始 domain：user、workspace、member、agent、issue、comment、inbox、agent_task_queue、daemon_connection、activity_log。 |
| `server/migrations/004_agent_runtime_loop.up.sql` | `agent_runtime` 引入，agent 与 task 绑定 runtime。 |
| `server/migrations/008_structured_skills.up.sql` | `skill`、`skill_file`、`agent_skill`。 |
| `server/migrations/020_task_session.up.sql` | task `session_id` 与 `work_dir`。 |
| `server/migrations/026_task_messages.up.sql` | task transcript message table。 |
| `server/migrations/033_chat.up.sql` | `chat_session`、`chat_message`，task 可无 issue。 |
| `server/migrations/042_autopilot.up.sql` | `autopilot`、`autopilot_trigger`、`autopilot_run`。 |
| `server/migrations/055_task_lease_and_retry.up.sql` | task lease / retry 字段。 |
| `server/migrations/066_force_fresh_session.up.sql` | manual rerun starts fresh session。 |
| `server/migrations/084_squad.up.sql` | `squad`、`squad_member`、issue assignee supports squad。 |
| `server/migrations/101_task_usage_hourly_schema.up.sql` | UTC hourly usage rollup。 |
| `server/migrations/105_issue_metadata.up.sql` | per-issue JSONB metadata。 |
| `server/migrations/108_task_token.up.sql` | task-scoped auth token。 |
| `server/migrations/109_lark_integration.up.sql` | Lark installation/binding/session/dedup/audit/outbound/token tables。 |
| `server/migrations/113_sys_cron_executions.up.sql` | system cron execution tracking。 |
| `server/migrations/114_agent_task_queue_running_started_at_index.up.sql` | hot queue index。 |
| `server/migrations/115_agent_runtime_last_seen_at_index.up.sql` | runtime liveness index。 |

## Daemon 与执行环境

| 证据 | 关键信息 |
| --- | --- |
| `server/internal/daemon/types.go` | Claimed task payload：workspace context、agent、skills、repos、project resources、prior session、chat/autopilot/quick-create/squad fields、task auth token。 |
| `server/internal/daemon/daemon.go` | daemon polling、claim、spawn、result submission、quick-create env。 |
| `server/internal/daemon/execenv/execenv.go` | per-task env root、workdir、local directory mode、Codex home、OpenClaw config。 |
| `server/internal/daemon/execenv/context.go` | `.agent_context`、provider-native skills path、project resources sidecar。 |
| `server/internal/daemon/execenv/runtime_config.go` | runtime config materialization。 |
| `server/internal/daemon/gc.go` | workspace GC for completed/cancelled/orphan/artifacts。 |
| `server/internal/daemon/local_directory.go` | local directory lock/wait flow。 |
| `server/internal/handler/task_lifecycle.go` | orphan recovery、pin session、rerun issue。 |

## Frontend 与 shared packages

| 证据 | 关键信息 |
| --- | --- |
| `packages/core/types/agent.ts` | Runtime/Agent/AgentTask/AgentTemplate/skill summary TypeScript contract。 |
| `packages/core/types/issue.ts` | issue status、priority、assignee、metadata contract。 |
| `packages/core/types/autopilot.ts` | autopilot trigger/run/delivery contract。 |
| `packages/core/runtimes/*` | runtime health、models、local skills、usage queries。 |
| `packages/core/agents/*` | agent availability、presence、activity。 |
| `packages/views/agents/*` | agents page/detail/create/template/skills/env/mcp UI。 |
| `packages/views/issues/*` | issue board/list/detail/timeline/task log/comments。 |
| `packages/views/autopilots/*` | autopilot UI and webhook delivery sections。 |
| `packages/views/chat/*` | persistent chat task UI。 |
| `apps/web/app/[workspaceSlug]/(dashboard)/*` | route surface inventory。 |

## 证据强度

强证据：

- SQL migration、generated model、handler route、TypeScript exported type、daemon payload struct。

中证据：

- docs site、README、product overview、tests。

弱证据：

- Draft plan、pre-implementation plan、marketing page。

本规格中凡是涉及 Multica 当前真实行为，优先使用强证据；涉及未来能力时标注为预案，并给出 Cradle clean architecture 版本。

