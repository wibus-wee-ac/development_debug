# Feature Inventory

本文件是 Multica feature 面的完整库存。它不替代各 SPEC，而是用于证明“现有 + 预案”能力已经被识别并归档。

状态说明：

- **Core**：应进入 Cradle Multica-inspired 核心架构。
- **Support**：作为支撑能力保留 owner 标准，但不是当前产品主线。
- **Defer**：不建议第一阶段实现。
- **Reject as-is**：不按 Multica 方式照搬，只吸收原则。

## Platform and Deployment

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Cloud app | `README.md`, `apps/web` | Defer | `clean-cradle-architecture.md` |
| Self-hosting | `SELF_HOSTING.md`, compose files, Dockerfiles | Defer | `clean-cradle-architecture.md` |
| CLI install | `CLI_INSTALL.md`, install scripts | Support | `runtime-task-execution.md` |
| CLI update | `server/internal/cli/update.go` | Support | `runtime-task-execution.md` |
| Daemon setup | `CLI_AND_DAEMON.md`, `daemon start/status/logs` | Core | `runtime-task-execution.md` |
| Worktree dev support | `CLAUDE.md`, `Makefile` | Reject as-is | `clean-cradle-architecture.md` |
| Docs site | `apps/docs/content/docs/*.mdx` | Support | `evidence-map.md` |

## Identity, Auth, and Access

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Email verification login | `auth.go`, `verification_code` | Support | `product-concept-and-domain-model.md` |
| Google OAuth | `auth.go` | Support | `product-concept-and-domain-model.md` |
| JWT session | `auth/jwt.go`, cookies | Support | `product-concept-and-domain-model.md` |
| Personal access tokens | `personal_access_token`, `/api/tokens` | Support | `runtime-task-execution.md` |
| Daemon tokens | `daemon_token`, daemon auth middleware | Core | `runtime-task-execution.md` |
| Task-scoped tokens | `108_task_token.up.sql` | Core | `runtime-task-execution.md` |
| Human-only route guard | `actor_guards.go` | Core | `runtime-task-execution.md` |
| Signup allowlist / waitlist | `auth.go`, `cloud_waitlist` | Defer | `clean-cradle-architecture.md` |

## Workspace and Membership

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Workspace CRUD | `workspace.go`, `workspace` table | Core | `product-concept-and-domain-model.md` |
| Workspace slug / reserved slugs | `reserved_slugs.json`, path rules | Support | `product-concept-and-domain-model.md` |
| Workspace context | daemon `WorkspaceContext` | Core | `runtime-task-execution.md` |
| Workspace invitations | `workspace_invitation`, invitation handlers | Support | `product-concept-and-domain-model.md` |
| Member roles | `member.role` | Support | `product-concept-and-domain-model.md` |
| Workspace avatar / issue prefix | migrations `020`, `111_workspace_avatar` | Support | `product-concept-and-domain-model.md` |
| Workspace repositories | product overview, repo context in daemon | Core | `runtime-task-execution.md` |

## Issues and Work Items

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Issue CRUD | `issue.go`, `/api/issues` | Core | `product-concept-and-domain-model.md` |
| Human-readable issue id | `issue.number`, workspace prefix | Core | `product-concept-and-domain-model.md` |
| Status / priority | `IssueStatus`, `IssuePriority` | Core | `product-concept-and-domain-model.md` |
| Assignee member/agent/squad | `IssueAssigneeType` | Core | `product-concept-and-domain-model.md` |
| Creator member/agent | `creator_type` | Core | `product-concept-and-domain-model.md` |
| Parent / child issues | `parent_issue_id`, child progress routes | Core | `product-concept-and-domain-model.md` |
| Dependencies | `issue_dependency` | Support | `product-concept-and-domain-model.md` |
| Labels | `issue_label`, labels routes | Support | `product-concept-and-domain-model.md` |
| Start/due dates | date migrations, core date helpers | Support | `product-concept-and-domain-model.md` |
| Issue metadata | `105_issue_metadata.up.sql` | Core | `product-concept-and-domain-model.md` |
| Acceptance criteria | `acceptance_criteria` | Core | `product-concept-and-domain-model.md` |
| Context refs | initial schema | Core | `runtime-task-execution.md` |
| Batch update/delete | `/api/issues/batch-*` | Support | `product-concept-and-domain-model.md` |
| List / board / grouped views | routes + `packages/views/issues` | Core | `product-concept-and-domain-model.md` |
| Gantt / swimlane UI | `packages/views/issues/components/*` | Defer | `clean-cradle-architecture.md` |
| Quick-create issue | `/api/issues/quick-create`, plan references | Core | `runtime-task-execution.md` |
| Rerun issue | `RerunIssue` | Core | `runtime-task-execution.md` |
| Active task / task runs | `/active-task`, `/task-runs` | Core | `runtime-task-execution.md` |
| Issue usage | `/api/issues/{id}/usage` | Support | `runtime-task-execution.md` |
| Pull requests for issue | `ListPullRequestsForIssue` | Support | `squads-autopilots-and-external-ingress.md` |

## Comments, Timeline, Inbox

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Comments | `comment` table, comment handlers | Core | `product-concept-and-domain-model.md` |
| Nested replies / thread root | trigger thread fields | Core | `runtime-task-execution.md` |
| Comment resolve/unresolve | comment routes | Support | `product-concept-and-domain-model.md` |
| Reactions | issue/comment reactions | Support | `product-concept-and-domain-model.md` |
| @agent trigger | mention tests, task enqueue | Core | `runtime-task-execution.md` |
| Activity log | `activity_log`, `ListTimeline` | Core | `product-concept-and-domain-model.md` |
| Timeline merge comments + activity | `activity.go` | Core | `product-concept-and-domain-model.md` |
| Subscribers | `issue_subscriber` | Support | `product-concept-and-domain-model.md` |
| Inbox items | `inbox_item`, inbox handlers | Support | `product-concept-and-domain-model.md` |
| Notification preferences | notification routes/table | Support | `product-concept-and-domain-model.md` |
| Pins | `pinned_item`, pins routes | Support | `product-concept-and-domain-model.md` |

## Attachments and Files

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Issue/comment attachments | `attachment`, file handlers | Support | `product-concept-and-domain-model.md` |
| Chat attachments | chat attachment e2e and migration `083` | Core | `runtime-task-execution.md` |
| Attachment download/content | `/api/attachments/{id}` routes | Support | `runtime-task-execution.md` |
| S3/CloudFront local fallback | storage handlers/config | Defer | `clean-cradle-architecture.md` |
| Project resources sidecar | `.multica/project/resources.json` | Core | `runtime-task-execution.md` |

## Agents

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Agent CRUD | `/api/agents`, `agent` table | Core | `product-concept-and-domain-model.md` |
| Agent archive/restore | agent routes | Core | `product-concept-and-domain-model.md` |
| Agent visibility | private/workspace tests | Core | `product-concept-and-domain-model.md` |
| Agent instructions | `agent.instructions` | Core | `product-concept-and-domain-model.md` |
| Agent description/avatar | `agent` fields | Core | `product-concept-and-domain-model.md` |
| Runtime binding | `runtime_id` | Core | `runtime-task-execution.md` |
| Max concurrent tasks | `max_concurrent_tasks` | Core | `runtime-task-execution.md` |
| Custom args | `custom_args` | Core | `runtime-task-execution.md` |
| Custom env | `agent_env.go` | Core | `runtime-task-execution.md` |
| MCP config | `agent.mcp_config`, tabs | Core | `runtime-task-execution.md` |
| Model selection | `model`, runtime models | Core | `runtime-task-execution.md` |
| Thinking level | `thinking_level` | Support | `runtime-task-execution.md` |
| Agent tasks list | `/api/agents/{id}/tasks` | Core | `runtime-task-execution.md` |
| Agent activity charts | activity/count routes | Support | `runtime-task-execution.md` |
| Agent templates | `agenttmpl`, `/api/agent-templates` | Core | `skills-and-agent-templates.md` |
| Agent quick create plan | `docs/agent-quick-create-plan.md` | Core | `skills-and-agent-templates.md` |

## Runtimes and Daemon

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Runtime registration | `agent_runtime`, daemon register | Core | `runtime-task-execution.md` |
| Runtime visibility | `runtime.visibility` | Core | `runtime-task-execution.md` |
| Runtime liveness | `last_seen_at`, heartbeat | Core | `runtime-task-execution.md` |
| Runtime local skills listing/import | runtime local skill routes | Core | `skills-and-agent-templates.md` |
| Runtime model listing | runtime models routes | Core | `runtime-task-execution.md` |
| Runtime update flow | runtime update routes | Support | `runtime-task-execution.md` |
| Cloud runtime fleet proxy | `/api/cloud-runtime` | Defer | `clean-cradle-architecture.md` |
| Runtime usage by agent/hour | runtime usage routes | Support | `runtime-task-execution.md` |
| Daemon polling | `CLI_AND_DAEMON.md` | Core | `runtime-task-execution.md` |
| Daemon GC | `daemon/gc.go` | Support | `runtime-task-execution.md` |
| Local directory wait | `waiting_local_directory` | Core | `runtime-task-execution.md` |
| Orphan recovery | `RecoverOrphanedTasks` | Core | `runtime-task-execution.md` |
| Session pin | `PinTaskSession` | Core | `runtime-task-execution.md` |

## Providers

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Claude Code | README, daemon providers | Core | `runtime-task-execution.md` |
| Codex | README, Codex home/skills | Core | `runtime-task-execution.md` |
| GitHub Copilot CLI | README, skills path | Support | `skills-and-agent-templates.md` |
| OpenCode | README, skills path | Support | `skills-and-agent-templates.md` |
| OpenClaw | README, synthesized config | Support | `runtime-task-execution.md` |
| Hermes | README | Defer | `runtime-task-execution.md` |
| Gemini | README | Support | `runtime-task-execution.md` |
| Pi | README | Defer | `skills-and-agent-templates.md` |
| Cursor Agent | README | Support | `skills-and-agent-templates.md` |
| Kimi | README | Defer | `skills-and-agent-templates.md` |
| Kiro CLI | README | Defer | `skills-and-agent-templates.md` |
| Antigravity | daemon skill path | Defer | `skills-and-agent-templates.md` |

## Tasks, Chat, and Execution Logs

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Agent task queue | `agent_task_queue` | Core | `runtime-task-execution.md` |
| Task lease/retry | `055_task_lease_and_retry` | Core | `runtime-task-execution.md` |
| Task transcript messages | `task_message` | Core | `runtime-task-execution.md` |
| Chat sessions | `chat_session` | Core | `runtime-task-execution.md` |
| Chat messages | `chat_message` | Core | `runtime-task-execution.md` |
| Pending chat task | chat pending routes | Core | `runtime-task-execution.md` |
| Chat unread/read | `unread_since`, read route | Support | `runtime-task-execution.md` |
| Task cancel | task cancel routes | Core | `runtime-task-execution.md` |
| Task usage | `task_usage` | Core | `runtime-task-execution.md` |
| Hourly usage rollup | `task_usage_hourly` | Core | `runtime-task-execution.md` |

## Skills

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Skill CRUD | `/api/skills` | Core | `skills-and-agent-templates.md` |
| Skill files | `skill_file` | Core | `skills-and-agent-templates.md` |
| Agent skill attachment | `agent_skill` | Core | `skills-and-agent-templates.md` |
| Skill search | `/api/skills/search` | Core | `skills-and-agent-templates.md` |
| Skill import | `/api/skills/import` | Core | `skills-and-agent-templates.md` |
| skills.sh importer | skill importer tests | Support | `skills-and-agent-templates.md` |
| GitHub importer | skill importer tests | Support | `skills-and-agent-templates.md` |
| ClawHub importer | quick-create plan mentions downline | Reject as-is | `skills-and-agent-templates.md` |
| Provider-native materialization | `execenv/context.go` | Core | `skills-and-agent-templates.md` |
| Skill Finder | `agent-quick-create-plan.md` | Core | `skills-and-agent-templates.md` |
| AI Create Agent | `agent-quick-create-plan.md` | Core | `skills-and-agent-templates.md` |

## Projects

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Project CRUD | `/api/projects`, `project` | Support | `product-concept-and-domain-model.md` |
| Project lead member/agent | project type/docs | Support | `product-concept-and-domain-model.md` |
| Project issue counts | mobile project plan | Support | `product-concept-and-domain-model.md` |
| Project resources CRUD | `/api/projects/{id}/resources` | Core | `runtime-task-execution.md` |
| Mobile project parity | `apps/mobile/docs/project-v1-plan.md` | Reject as-is | `clean-cradle-architecture.md` |

## Squads and Delegation

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Squad CRUD | `/api/squads`, `squad` | Core | `squads-autopilots-and-external-ingress.md` |
| Squad members | `squad_member` | Core | `squads-autopilots-and-external-ingress.md` |
| Squad leader | `leader_id` | Core | `squads-autopilots-and-external-ingress.md` |
| Squad as issue assignee | `issue_assignee_type_check` | Core | `squads-autopilots-and-external-ingress.md` |
| Squad member status | `/members/status` | Support | `squads-autopilots-and-external-ingress.md` |
| Leader no-action activity | squad no-action index | Core | `squads-autopilots-and-external-ingress.md` |
| Private leader routing | private leader tests | Core | `squads-autopilots-and-external-ingress.md` |

## Automations and Autopilots

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Autopilot CRUD | `/api/autopilots` | Core | `squads-autopilots-and-external-ingress.md` |
| Schedule trigger | `autopilot_trigger.kind = schedule` | Core | `squads-autopilots-and-external-ingress.md` |
| Webhook trigger | `kind = webhook` | Core | `squads-autopilots-and-external-ingress.md` |
| API/manual trigger | `source = api/manual` | Core | `squads-autopilots-and-external-ingress.md` |
| create_issue mode | `execution_mode` | Core | `squads-autopilots-and-external-ingress.md` |
| run_only mode | `execution_mode` | Core | `squads-autopilots-and-external-ingress.md` |
| Assignee agent/squad | `assignee_type` | Core | `squads-autopilots-and-external-ingress.md` |
| Event filters | `110_autopilot_trigger_event_filters` | Core | `squads-autopilots-and-external-ingress.md` |
| Trigger signing secret | webhook delivery tests | Core | `squads-autopilots-and-external-ingress.md` |
| Webhook delivery replay | `/deliveries/{id}/replay` | Core | `squads-autopilots-and-external-ingress.md` |
| Concurrency policy | `concurrency_policy` | Core | `squads-autopilots-and-external-ingress.md` |
| Timezone scheduling | `autopilot_trigger.timezone` | Core | `squads-autopilots-and-external-ingress.md` |

## External Integrations

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| GitHub installation | GitHub routes/handler | Support | `squads-autopilots-and-external-ingress.md` |
| GitHub PR status | PR status files/routes | Support | `squads-autopilots-and-external-ingress.md` |
| GitHub webhook | `github.go` | Support | `squads-autopilots-and-external-ingress.md` |
| Lark install | `lark_installation` | Core | `squads-autopilots-and-external-ingress.md` |
| Lark user binding | `lark_user_binding` | Core | `squads-autopilots-and-external-ingress.md` |
| Lark chat binding | `lark_chat_session_binding` | Core | `squads-autopilots-and-external-ingress.md` |
| Lark inbound dedup/audit | `lark_inbound_*` | Core | `squads-autopilots-and-external-ingress.md` |
| Lark outbound cards | `lark_outbound_card_message` | Support | `squads-autopilots-and-external-ingress.md` |
| Binding token redeem | `/api/lark/binding/redeem` | Core | `squads-autopilots-and-external-ingress.md` |

## Dashboards, Billing, Analytics

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Dashboard usage daily | `/api/dashboard/usage/daily` | Support | `runtime-task-execution.md` |
| Dashboard usage by agent | `/api/dashboard/usage/by-agent` | Support | `runtime-task-execution.md` |
| Runtime daily charts | `/api/dashboard/runtime/daily` | Support | `runtime-task-execution.md` |
| Agent runtime dashboard | `/api/dashboard/agent-runtime` | Support | `runtime-task-execution.md` |
| Cloud billing proxy | `/api/cloud-billing` | Defer | `clean-cradle-architecture.md` |
| Product analytics | `docs/analytics.md` | Support | `clean-cradle-architecture.md` |
| Operational metrics | Prometheus-only note | Core | `runtime-task-execution.md` |
| Timezone viewing model | `docs/timezone-architecture-rfc.md` | Core | `runtime-task-execution.md` |

## Frontend Surfaces

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| Next.js web app | `apps/web` | Support | `clean-cradle-architecture.md` |
| Electron desktop | `apps/desktop` | Support | `clean-cradle-architecture.md` |
| Expo mobile | `apps/mobile` | Defer | `clean-cradle-architecture.md` |
| Shared core package | `packages/core` | Support | `clean-cradle-architecture.md` |
| Shared views package | `packages/views` | Support | `clean-cradle-architecture.md` |
| UI package | `packages/ui` | Support | `clean-cradle-architecture.md` |
| TanStack Query server state | `CLAUDE.md` | Support | `clean-cradle-architecture.md` |
| Zustand client state | `CLAUDE.md` | Support | `clean-cradle-architecture.md` |
| Web/Desktop shared routes | `packages/views`, app route wiring | Support | `clean-cradle-architecture.md` |
| Onboarding v3 | `docs/onboarding-refactor-plan.md` | Reject as-is | `clean-cradle-architecture.md` |

## Release and Maintenance

| Feature | Multica evidence | Cradle stance | Target spec |
| --- | --- | --- | --- |
| API response compatibility | `CLAUDE.md` | Support | `clean-cradle-architecture.md` |
| Reserved slug generation | `CLAUDE.md` | Defer | `clean-cradle-architecture.md` |
| Built-in skills source maps | `server/internal/service/builtin_skills` | Support | `skills-and-agent-templates.md` |
| Worktree DB isolation | `CLAUDE.md` | Reject as-is | `clean-cradle-architecture.md` |
| CI requirements | `.github/workflows`, `CLAUDE.md` | Support | `clean-cradle-architecture.md` |

