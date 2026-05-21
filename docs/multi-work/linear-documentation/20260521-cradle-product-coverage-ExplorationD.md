<!--
Input: Cradle product feature READMEs and selected user-facing source files.
Output: Product documentation coverage matrix for Cradle.
Position: Multi-work handoff for linear-style documentation planning.
-->

# Cradle Product Documentation Coverage Handoff

本文件是产品向文档覆盖盘点，不实现文档站内容。目标是把用户、管理员和本地运维者需要理解的能力，映射到仓库中可验证的证据，并标出当前仍不确定或只能谨慎描述的部分。

## Scope

检查范围来自任务节点：

- `apps/web/src/features/**/README.md`
- `apps/web/src/features/**` 中与用户可见行为直接相关的源文件
- `apps/desktop/**`
- `apps/server/src/modules/**/README.md` 与必要的 HTTP route 文件
- `chronicle/README.md`
- `apps/zhi-slack-bridge/README.md`

本次没有检查外部发布包、实际运行截图、线上文档或完整 API 生成产物。因此矩阵中的结论只代表仓库当前可验证的产品行为。

## Executive Summary

Cradle 已经具备写成产品文档站的核心证据：桌面端负责启动 Electron、server 子进程、插件与更新；Web workspace 提供 home tab、workspace sidebar、tabbed shell、settings overlay、chat、composer、git、kanban、automation、Chronicle、devtool、browser panel 与 plugin surfaces；Server modules 为大多数能力提供 HTTP route 与 generated CLI metadata。

主要缺口不是功能证据不足，而是现有 README 多为 module inventory，缺少用户路径、前置条件、权限说明、失败恢复和概念边界。文档应避免照搬 inventory，而应重写为任务导向页面。

需要特别谨慎的能力：

- Home dashboard 里存在 mock pending runs 和 artifacts，不应写成已完成后端能力。
- Browser-use 的 active path 属于 desktop plugin runtime，而不是 legacy `browser-backend.ts`。
- Chronicle 第一版 README 明确以平台中立 trait 和 synthetic smoke path 为基础，macOS capture 有命令入口但实际权限和 daemon 生命周期仍应写保守。
- Automation UI 目前是 embedded from Home，README 也提示还没有 dedicated tab。
- Slack bridge 是独立 MCP human-in-the-loop bridge，不是 Cradle 主 Web app 内置设置页。

## Coverage Matrix

| Area | Proposed docs pages | Page purpose | Source evidence files | Known uncertainty |
| --- | --- | --- | --- | --- |
| Overview and get started | `index.mdx`, `getting-started/overview.mdx`, `getting-started/first-workspace.mdx` | 解释 Cradle 是本地 agent workspace，用户从桌面启动、添加 workspace、配置 provider、创建第一段 chat。 | `docs/exec-plans/20260521-05-linear-style-documentation.md`; `apps/web/src/app.tsx`; `apps/web/src/features/home/home-dashboard.tsx`; `apps/web/src/features/new-chat/new-chat-page.tsx`; `apps/desktop/src/main/main-app.ts` | 根 README 未纳入本节点；启动命令、安装方式、发布渠道需要主线程从 package scripts 或 release docs 补证。 |
| Desktop app | `desktop/overview.mdx`, `desktop/updates.mdx`, `desktop/server-process.mdx` | 说明 Electron desktop owns main window, local server process, native IPC, update runtime, desktop plugins, window restore, single-instance behavior。 | `apps/desktop/src/main/README.md`; `apps/desktop/src/main/main-app.ts`; `apps/desktop/src/main/window-manager.ts`; `apps/desktop/src/main/server-process.ts`; `apps/desktop/src/main/update-manager.ts` | 未验证 packaged app 的实际 installer/update feed 配置；Velopack 用户步骤需要补读 build/release 配置。 |
| Web workspace shell | `workspace/overview.mdx`, `workspace/tabs-and-sidebar.mdx`, `workspace/search.mdx` | 解释 home tab、persistent sidebar、workspace groups、sessions、settings overlay、tab URL sync、global search 与 keyboard entry points。 | `apps/web/src/app.tsx`; `apps/web/src/components/layout/app-sidebar.tsx`; `apps/web/src/features/workspace/README.md`; `apps/web/src/features/workspace/workspace-sidebar.tsx`; `apps/web/src/features/search/README.md`; `apps/web/src/features/search/global-search-dialog.tsx` | Sidebar 文案部分中英混合，文档应统一简体中文；全局快捷键清单需要从 shortcut registry 再补证。 |
| Workspace files and packing | `workspace/files.mdx`, `workspace/pack-codebase.mdx` | 说明 workspace 文件树、目录选择、把 workspace 或选中路径 pack 到 clipboard 的用途和选项。 | `apps/web/src/features/filesystem/README.md`; `apps/web/src/features/workspace/file-tree.tsx`; `apps/web/src/features/pack-codebase/README.md`; `apps/web/src/features/pack-codebase/pack-codebase-dialog.tsx`; `apps/server/src/modules/pack-codebase/README.md`; `apps/server/src/modules/pack-codebase/index.ts` | Pack output format、ignore/remove comments/compress 的精确定义需要从 `pack-codebase.service.ts` 和 engine 再补细节。 |
| Chat and composer | `chat/overview.mdx`, `chat/composer.mdx`, `chat/slash-commands-and-mentions.mdx`, `chat/streaming-and-cancel.mdx` | 说明 session chat、SSE streaming、cancel、virtualized history、composer send/stop、file mentions、slash commands、token usage indicator、drag/drop workspace paths。 | `apps/web/src/features/chat/README.md`; `apps/web/src/features/chat/chat-view.tsx`; `apps/web/src/features/chat/composer.tsx`; `apps/web/src/features/chat/mention-panel.tsx`; `apps/web/src/features/chat/slash-command-panel.tsx`; `apps/server/src/modules/chat-runtime/README.md`; `apps/server/src/modules/chat-runtime/index.ts` | Runtime-native slash commands depends on provider capabilities;具体 commands 需要按 runtime 补证，不应写死。 |
| New chat | `chat/new-chat.mdx` | 解释从 home/new chat 选择 workspace、runtime、provider/model 或 CLI TUI agent，发送后创建 session 并打开 chat tab。 | `apps/web/src/features/new-chat/README.md`; `apps/web/src/features/new-chat/new-chat-page.tsx`; `apps/web/src/features/composer-toolbar/README.md`; `apps/web/src/features/composer-toolbar/composer-toolbar.tsx`; `apps/server/src/modules/session/service.ts` | New chat 页面包含 quick action prompt，但文案是否最终产品化未确认；附件按钮目前需要确认是否有后端实现。 |
| Agents, providers, and models | `agents/providers.mdx`, `agents/models.mdx`, `agents/agent-identities.mdx`, `agents/runtime-kinds.mdx` | 说明 Settings > Providers 管理 runtime profiles，provider health/model discovery/cache，agent identities，runtime kind selection，OpenAI-compatible/Anthropic/Codex/CLI TUI/ACP 等边界。 | `apps/web/src/features/agent-management/README.md`; `apps/web/src/features/agent-management/agent-runtime-settings.tsx`; `apps/web/src/features/agent-management/provider-templates.ts`; `apps/web/src/features/composer-toolbar/runtime-selector.tsx`; `apps/server/src/modules/providers/README.md`; `apps/server/src/modules/providers/index.ts`; `apps/server/src/modules/profiles/README.md`; `apps/server/src/modules/agent-identity/README.md`; `apps/server/src/modules/acp/README.md` | Provider preset 列表、credential flows 和各 runtime 的可用性需要逐 provider 补证；不要承诺所有模型都支持 thinking/context metadata。 |
| Skills | `agents/skills.mdx`, `agents/import-skills.mdx` | 说明 Settings > Skills 管理 global skills、workspace/agent scoped inventory，以及 fetch/import workflow。 | `apps/web/src/features/skills/README.md`; `apps/web/src/features/skills/skill-manager.tsx`; `apps/web/src/features/skills/skill-import-dialog.tsx`; `apps/server/src/modules/skills/README.md`; `apps/server/src/modules/skills/index.ts`; `apps/server/src/modules/skills/skills.store.ts`; `apps/server/src/modules/skills/skill-source.store.ts` | 需明确 namespace ownership：可读 agent skills namespace，但 Cradle 写入自己的 namespace；具体路径与 import destination 应从 `skills-paths.ts` 补证。 |
| Approvals | `chat/approvals.mdx`, `admin/approval-policies.mdx` | 说明 agent/tool 需要用户批准时，chat composer 上方出现 approval card，用户可 Allow、Always Allow 或 Deny。 | `apps/web/src/features/approval/README.md`; `apps/web/src/features/approval/approval-card.tsx`; `apps/web/src/features/approval/use-approval.ts`; `apps/server/src/modules/approval/README.md`; `apps/server/src/modules/approval/index.ts`; `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts` | `Always Allow` 的持久化范围和策略语义需要从 approval service/model 进一步确认，避免误写为全局永久规则。 |
| Session await and resume | `chat/wait-for-github.mdx`, `chat/session-awaits.mdx` | 说明 chat 可以等待外部条件，当前证据支持 GitHub CI 和 GitHub review live status、summary banner、await panel。 | `apps/web/src/features/session-await/README.md`; `apps/web/src/features/session-await/await-panel.tsx`; `apps/web/src/features/chat/use-session-await.ts`; `apps/server/src/modules/session-await/README.md`; `apps/server/src/modules/session-await/index.ts`; `apps/server/src/modules/session-await/sources/github-ci.ts`; `apps/server/src/modules/session-await/sources/github-review.ts` | GitHub token 配置位置、支持 private repo 的权限要求和 resume 行为需要补证。 |
| Git and workspace source control | `workspace/git.mdx`, `workspace/branches.mdx` | 说明 workspace 右侧 Git panel：branch status、ahead/behind、fetch all prune、branch picker、virtualized commit graph、非 git repo error。 | `apps/web/src/features/git/README.md`; `apps/web/src/features/git/git-panel.tsx`; `apps/web/src/features/git/branch-picker.tsx`; `apps/web/src/features/git/git-branch-control.tsx`; `apps/server/src/modules/git/README.md`; `apps/server/src/modules/git/index.ts` | 文档应明确当前 UI 证据覆盖 fetch/branch/graph/status；commit、push、pull、stash 等若无证据不可宣称。 |
| Kanban | `kanban/overview.mdx`, `kanban/issue-detail.mdx`, `kanban/views-and-filters.mdx` | 说明 workspace issue board/list、create issue、group/sort/filter/search、peek panel、多选、issue detail、properties、sub-issues、comments/activity。 | `apps/web/src/features/kanban/README.md`; `apps/web/src/features/kanban/index.tsx`; `apps/web/src/features/kanban/kanban-board.tsx`; `apps/web/src/features/kanban/kanban-list.tsx`; `apps/web/src/features/kanban/kanban-toolbar.tsx`; `apps/web/src/features/kanban/issue-detail/README.md`; `apps/web/src/features/kanban/issue-detail/index.tsx`; `apps/server/src/modules/kanban/README.md`; `apps/server/src/modules/issue/README.md` | Board selection/navigation source likely lives in tabs/sidebar; exact URL/tab behavior should be verified in tab definitions. |
| Issue agents | `kanban/delegate-to-agent.mdx`, `kanban/agent-sessions.mdx` | 说明 issue 可委派给 provider-backed agent，生成 issue-scoped agent session，用户可查看 activity、打开 linked chat、rerun/stop、追加 prompt。 | `apps/web/src/features/kanban/issue-detail/agent-session-panel.tsx`; `apps/web/src/features/kanban/issue-detail/agent-prompt-input.tsx`; `apps/server/src/modules/issue-agent/README.md`; `apps/server/src/modules/issue-agent/index.ts`; `apps/server/src/modules/issue-agent/service.ts` | 只应写 provider-backed agent；`issue_agent_agent_not_supported` 表明不是所有 agent identity 都能被委派。 |
| Automation | `automation/overview.mdx`, `automation/runs-and-artifacts.mdx`, `automation/rrule-triggers.mdx` | 说明 agent-authored automation definitions、RRULE trigger、enable/disable、run now、runs、links、artifacts，以及 Home dashboard 嵌入的 viewer。 | `apps/web/src/features/automation/README.md`; `apps/web/src/features/automation/automation-dashboard.tsx`; `apps/server/src/modules/automation/README.md`; `apps/server/src/modules/automation/index.ts`; `apps/server/src/modules/automation/poller.ts`; `apps/server/src/modules/automation/scheduler.ts` | UI README 明确 embedded from Home until dedicated tab exists；创建/编辑 UI 是否完整需要补读当前 dashboard 下半部和 hooks。 |
| Chronicle | `chronicle/overview.mdx`, `chronicle/setup.mdx`, `chronicle/memories.mdx`, `chronicle/troubleshooting.mdx` | 说明本地被动上下文采集、screen capture/OCR/artifacts/privacy filtering/dedup/memory summarization、Settings > Chronicle 的 capture 开关、model selection、status、resources、timeline、memory search。 | `chronicle/README.md`; `chronicle/src/README.md`; `chronicle/src/screen/README.md`; `chronicle/src/recorder/README.md`; `chronicle/src/memory_pipeline/README.md`; `apps/web/src/features/chronicle/README.md`; `apps/web/src/features/chronicle/chronicle-settings.tsx`; `apps/server/src/modules/chronicle/README.md`; `apps/server/src/modules/chronicle/index.ts` | macOS Screen Recording permission、model resource installation、daemon start failure states、privacy filtering guarantees need conservative wording and likely additional code review. |
| Observability and devtools | `devtools/overview.mdx`, `devtools/observability.mdx`, `devtools/plugins.mdx`, `devtools/health-memory-tabs.mdx` | 说明 `#devtool` window 有 Observability、Server Health、Memory、Tabs、Plugins；observability events/incidents 可按 session/run/code/severity 导出 bundle；plugins panel 展示 server/web/desktop layers、panels、commands。 | `apps/web/src/main.tsx`; `apps/web/src/features/devtool/README.md`; `apps/web/src/features/devtool/ipc-devtool-page.tsx`; `apps/web/src/features/devtool/observability/observability-events-table.tsx`; `apps/web/src/features/devtool/plugins/plugins-panel.tsx`; `apps/server/src/modules/observability/README.md`; `apps/server/src/modules/observability/index.ts` | Devtools 是用户文档还是 admin/developer docs 边界需主线程决定；Memory/Health/Tabs 面板细节未完全展开。 |
| Browser panel and browser-use plugin | `browser/overview.mdx`, `browser/agent-browser-use.mdx`, `plugins/browser-use.mdx` | 说明 Electron-only browser panel 支持最多 5 个 tabs、URL navigation、back/forward/reload、script injection preset；browser-use production path 由 desktop plugin loader 激活并桥接 webview。 | `apps/web/src/features/browser/README.md`; `apps/web/src/features/browser/browser-panel.tsx`; `apps/web/src/store/browser-panel.ts`; `apps/desktop/src/main/README.md`; `apps/desktop/src/main/plugin-loader.ts`; `apps/desktop/src/main/plugin-discovery.ts`; `apps/web/src/features/devtool/plugins/plugins-panel.tsx` | 需要补读 `plugins/browser-use/src/desktop.ts` 才能写 agent automation 的精确命令和限制；legacy `browser-backend.ts` 不应作为新用户入口。 |
| Plugins | `plugins/overview.mdx`, `plugins/install-and-trust.mdx`, `plugins/panels-and-commands.mdx` | 说明 Cradle plugin discovery、server/web/desktop layers、client registrations、plugin panel/command surfaces、trusted source。 | `apps/web/src/lib/plugin-host.ts`; `apps/web/src/features/plugins/plugins-sidebar.tsx`; `apps/web/src/features/devtool/plugins/plugins-panel.tsx`; `apps/desktop/src/main/README.md`; `apps/desktop/src/main/plugin-discovery.ts`; `apps/desktop/src/main/plugin-loader.ts`; `apps/server/src/modules/acp/README.md` | Plugin SDK 开发者内容应由开发者覆盖节点补齐；本节点只证明用户/admin 可见管理与诊断面。 |
| Settings | `settings/overview.mdx`, `settings/appearance.mdx`, `settings/providers.mdx`, `settings/agents.mdx`, `settings/jarvis.mdx`, `settings/chronicle.mdx`, `settings/skills.mdx`, `settings/desktop.mdx` | 说明 settings overlay 入口、sidebar sections、外观、Providers、Agents、Jarvis、Chronicle、Skills、Desktop updates。 | `apps/web/src/features/settings/README.md`; `apps/web/src/features/settings/settings-sidebar.tsx`; `apps/web/src/features/settings/settings-content.tsx`; `apps/web/src/features/settings/appearance-settings.tsx`; `apps/web/src/features/settings/jarvis-settings.tsx`; `apps/web/src/features/settings/desktop-update-settings.tsx`; `apps/web/src/features/system-agent/README.md` | Settings labels 当前中英混合；Jarvis 的产品定位需要从 system-agent 相关 hooks 和 server preferences 补证。 |
| Usage and cost visibility | `settings/usage.mdx` or `admin/usage.mdx` | 说明 usage logs、token totals、pricing estimates、session token progress indicator。 | `apps/web/src/features/usage/README.md`; `apps/web/src/features/usage/usage-dashboard.tsx`; `apps/server/src/modules/usage/README.md`; `apps/server/src/modules/usage/index.ts`; `apps/web/src/features/chat/composer.tsx` | Pricing 对未知 model 不估算 cost；文档应说明估算范围，不写成账单系统。 |
| Slack bridge | `integrations/slack-bridge.mdx`, `integrations/zhi-human-loop.mdx`, `integrations/slack-troubleshooting.mdx` | 说明 Zhi Slack Bridge 是 MCP human-in-the-loop bridge：Slack app setup、Socket Mode、tokens/scopes、slash command、channel bind、agent `zhi` tool call creates thread、reply returns to agent。 | `apps/zhi-slack-bridge/README.md`; `apps/zhi-slack-bridge/src/mcp-server.ts`; `apps/zhi-slack-bridge/src/slack-bot.ts`; `apps/zhi-slack-bridge/src/bridge-server.ts`; `apps/zhi-slack-bridge/tests/integration.test.ts` | 这是独立 app，不是 Cradle Web Settings 页面；生产部署、secrets storage 和 timeout policy 应按 README 当前行为写：pending calls do not time out by default。 |
| Troubleshooting | `troubleshooting/index.mdx`, `troubleshooting/provider-errors.mdx`, `troubleshooting/workspace-git.mdx`, `troubleshooting/desktop-server.mdx`, `troubleshooting/chronicle.mdx`, `troubleshooting/slack-bridge.mdx`, `troubleshooting/devtools-export.mdx` | 汇总用户能自查的问题：provider health/model discovery, git non-repo/permission, server health, update state, Chronicle daemon/resources, Slack socket/tokens, observability export bundle。 | `apps/server/src/modules/providers/index.ts`; `apps/web/src/features/git/git-panel.tsx`; `apps/web/src/features/settings/desktop-update-settings.tsx`; `apps/web/src/features/chronicle/chronicle-settings.tsx`; `apps/web/src/features/devtool/ipc-devtool-page.tsx`; `apps/server/src/modules/observability/index.ts`; `apps/zhi-slack-bridge/README.md` | 需要最终集成时从 actual error codes/messages 生成更可靠的 troubleshooting map。 |

## Recommended Information Architecture

建议把产品文档分成七个顶层分区：

1. `getting-started`: overview, desktop install/start, first workspace, first chat。
2. `workspace`: shell, tabs/sidebar, files, pack-codebase, git, search。
3. `chat`: new chat, composer, sessions, approvals, session await, export/cancel。
4. `agents`: providers, models, runtime kinds, agent identities, skills。
5. `kanban`: board/list, issue detail, delegation, issue agent sessions。
6. `automation-and-memory`: automation, Chronicle, usage。
7. `admin-and-integrations`: settings, devtools/observability, browser/plugins, Slack bridge, troubleshooting。

如果侧栏需要更短，可以把 `automation-and-memory` 改为两个独立分区：`automation` 和 `chronicle`。Chronicle 的概念复杂，建议不要埋在 settings 下。

## Evidence Notes by Minimum Acceptance Area

### Overview and get started

可写。`App` 在启动时固定创建 pinned home tab，并初始化 URL 与 tab store sync。`HomeDashboard` 读取 workspaces、sessions 和 automation definitions，同时提供添加 workspace/search/quick actions 的入口。`NewChatPage` 从 workspace/profile/runtime/model 创建 session 并启动 response。

注意：`HomeDashboard` 中 `MOCK_PENDING` 和 `MOCK_ARTIFACTS` 是 mock data，不能作为真实 pending approval/artifact dashboard 文档证据。

### Desktop app

可写。`main-app.ts` 证明桌面 app 会 request single instance lock、activate desktop plugins、start server、create BrowserWindow、启用 webview tag、管理 update status broadcast，并在 quit 前停止 plugin/server。`apps/desktop/src/main/README.md` 给出 ownership：server 子进程、native IPC、Velopack update runtime、desktop plugin runtime。

### Web workspace

可写。`AppSidebar` 支持 main/settings 两种 drill-in，`WorkspaceSidebar` 提供 home、新 chat、workspace/session lists、session rename/pin/export/delete、kanban sidebar、plugins sidebar、global search 和 settings entry。

### Chat and composer

可写。`ChatView` 显示 virtualized messages、thinking/error states、minimap、approval list、await banner、composer；`Composer` 支持 send/stop、mentions、slash commands、drop path、token progress；server `/chat/sessions/:sessionId/response` 使用 SSE，`/cancel` abort active run，`/capabilities` 返回 runtime-native commands。

### Agents/providers/models

可写。Settings 中 Providers 是唯一入口，支持 add provider、search、toggle enabled、profile detail。Server providers routes 支持 list models、model cache、health-check、model lookup/search。Composer toolbar 根据 context 显示 runtime selector 和 provider/model selector；`cli-tui` 走 agent selector。

### Approvals

可写但需谨慎。UI 有 Allow、Always Allow、Deny 三类按钮，挂在 chat composer 上方。需要补服务端确认 always allow 的 scope。

### Git/workspace

可写。Workspace 与 Git 两块证据充足。Git panel 明确支持 branch status bar、fetch all prune、commit graph 和 non-git error state。不要扩展到 push/pull/commit unless evidence is added。

### Kanban and issue agents

可写。Kanban view 支持 board/list、filters、search、sorting、multi-selection、peek/detail。Issue detail 支持 title/description/properties/sub-issues/activity。Issue agent service 证明 delegation 会创建 issue-scoped chat session，并把 workflow rules 和 issue prompt 发给 chat runtime。

### Automation

可写为“agent-authored automation registry and run viewer”。Server routes 覆盖 CRUD、enable/disable、run now、runs、artifacts。UI 可查看 definitions/runs/artifacts 和 run now。创建/编辑的完整用户 UI 需进一步验证。

### Chronicle

可写为独立产品能力。Rust README 证明 smoke path、macOS run-once path、artifact layout、capture/OCR/privacy/dedup/memory pipeline。Web Settings 证明用户可配置 model、toggle capture、看 status/resources/timeline/memories/search。Server `/chronicle` routes 支持 config、status、resources、timeline、frames、memories/search。

### Observability/devtools

可写为 admin/debug 文档。`main.tsx` 用 hash `#devtool` 打开 DevtoolPage；Devtool tabs 有 Observability、Server Health、Memory、Tabs、Plugins。Server supports events/incidents/export bundle。

### Browser panel/plugin use

可写但要区分两层：用户 browser panel 与 agent browser-use plugin。Browser panel 是 Electron webview UI；browser-use production backend 是 plugin-owned path。需要补读 plugin package 后再写具体 agent automation 操作。

### Settings

可写。Settings sidebar 分区明确：appearance、providers、agents、jarvis、chronicle、skills、desktop。Settings overlay 绑定当前 active tab，`Cmd+,` 打开，`Cmd+Escape` 关闭。

### Slack bridge

可写为 integration guide。README 已是较完整用户文档：Slack app setup、tokens/scopes、slash command、event subscriptions、env、run commands、MCP client config、bind/status/unbind、runtime model。

### Troubleshooting

可写，但应从真实错误码组织：provider health-check, git non-repo/permission, Chronicle daemon/resource status, observability export, Slack token/socket scopes, desktop server process/update state。

## Documentation Risks

- 不要把 server module README 的 “Route metadata includes `x-cradle-cli`” 直接写成用户功能，除非最终文档也覆盖 generated CLI。
- 不要把 internal/devtool 功能放在普通用户路径前面；它更适合 admin/debug。
- 不要把 independent Slack bridge 描述成 Cradle desktop 内建 Slack integration。
- 不要把 Chronicle 描述成云同步记忆；证据显示它是 local sensing and local memory generation。
- 不要把 mock homepage pending/artifact cards 写成真实 dashboard。

## Suggested Validation for Integration Writer

- 读 `documentations/content/docs` 最终草稿时，逐页检查是否至少引用本矩阵的一个证据文件。
- 对每个用户任务页，确认页面只描述证据支持的行为，不补写未证实的 future UX。
- 最后用下面的最小 coverage checklist 复核侧栏：
  - overview/get started
  - desktop app
  - web workspace
  - chat and composer
  - agents/providers/models
  - approvals
  - git/workspace
  - kanban and issue agents
  - automation
  - Chronicle
  - observability/devtools
  - browser panel/plugin use
  - settings
  - Slack bridge
  - troubleshooting
