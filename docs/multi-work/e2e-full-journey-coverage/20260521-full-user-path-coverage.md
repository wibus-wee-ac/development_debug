<!-- Full user-path coverage contract for Cradle product surfaces. -->

# Cradle 全量用户路径覆盖设计

## 直接结论

当前最合理的 100% 覆盖定义不是“所有按钮都写 E2E”，而是建立一份可审计的覆盖契约：

- 每个用户可触达或对用户结果有影响的能力都必须出现在矩阵中。
- 每个能力都必须标明用户意图、入口、当前覆盖证据、缺口、推荐验证层与优先级。
- E2E 只覆盖真实用户旅程；后台进程、外部服务、CLI 生成命令、插件桥、更新器和诊断面板优先下沉到 API / 集成 / 组件 / 手动冒烟，避免制造不稳定场景和孤儿进程。

本文件的覆盖源来自当前代码清单：

- Web tabs: `apps/web/src/tabs/registry.ts`
- Web feature owners: `apps/web/src/features/*`
- Server capability owners: `apps/server/src/modules/*`
- Desktop main/preload owners: `apps/desktop/src/main/*`, `apps/desktop/src/preload/index.ts`
- CLI generated commands: `packages/cli/src/commands/generated/*`
- Existing E2E scenarios: `e2e/src/features/*.feature`
- Existing lower-level tests: `apps/server/tests/*`, `apps/web/src/**/*.test.*`, `apps/desktop/src/**/*.test.*`, `packages/**/*.test.*`, `chronicle/tests/*`

## 覆盖口径

### 优先级

- **P0**: 首次使用、核心聊天、工作区、会话、数据持久化、审批、基础导航。破坏后会阻塞主产品使用。
- **P1**: 高频功能、跨模块用户旅程、设置、技能、看板、搜索、Git、用量、终端、自动化、等待恢复。
- **P2**: 开发者诊断、低频管理操作、导出、资源面板、插件细节、深层配置。
- **P3**: 平台相关、外部依赖重、更新器、系统托盘、Chronicle 本地守护进程、插件浏览器桥等高环境耦合路径。要求有明确手动冒烟或隔离集成测试，不强行进入常规 E2E。

### 验证层

- **E2E**: 真实用户在 Electron/Web shell 中完成的稳定旅程，断言可见结果或公开行为。
- **API/Integration**: Server capability、DB、CLI generated command、进程生命周期、WebSocket、外部 source adapter 的合同测试。
- **Component/Store**: Web 交互状态、可访问控件、渲染分类、布局状态、纯函数。
- **Manual Smoke**: 更新器、系统托盘、权限、webview/browser backend、Chronicle screen capture 等平台能力。
- **Blocked**: 需要外部凭据、真实平台权限、未完成 UI 或不可稳定自动化的路径。Blocked 不是遗漏，必须有恢复条件。

### E2E 接收门槛

一个场景只有同时满足这些条件才进入 E2E：

- 用户意图明确，能用自然语言描述。
- 跨越至少一个真实产品边界，例如 UI 到 Server、会话到用量、工作区到文件系统。
- 断言用户可见结果、剪贴板、持久化数据或公开 API 结果。
- 不依赖真实公网、真实更新 feed、系统权限弹窗、长驻守护进程或不受控子进程。
- 运行结束后能确定关闭 browser、server、mock LLM、PTY、websocket、临时 HOME / data dir。

## 当前 E2E 证据索引

- Workspace: `CRADLE-WORKSPACE-001..007`
- First-run journeys: `CRADLE-JOURNEY-001..002`
- Chat: `CRADLE-CHAT-002..008`, `CRADLE-CHAT-011..017`
- Home: `CRADLE-HOME-001..002`
- Tabs: `CRADLE-TAB-001..007`
- Keyboard shortcuts: `CRADLE-SHORTCUTS-001..004`
- Agent identity: `CRADLE-AGENT-IDENTITY-001..009`
- Agent runtime / profiles: `CRADLE-AGENT-RUNTIME-001..010`
- Model selection: `CRADLE-MODEL-001..002`
- Approval: `CRADLE-APPROVAL-001..002`
- Kanban / issue UI: `CRADLE-KANBAN-002..012`
- Issue agent integration: `CRADLE-ISSUE-AGENT-001..003`
- Git: `CRADLE-GIT-001..003`
- Search: `CRADLE-SEARCH-001..002`
- Skills: `CRADLE-SKILLS-001..008`
- Workflow rules: `CRADLE-WORKFLOW-RULES-001..002`
- Terminal: `CRADLE-PTY-001`
- Usage: `CRADLE-USAGE-001..002`

## 全量覆盖矩阵

| Domain owner | 用户路径 / 意图 | 入口 | 当前覆盖证据 | 缺口 | 推荐验证层 | Priority | 进程风险 |
|---|---|---|---|---|---|---|---|
| `workspace` | 首次进入应用看到空工作区状态 | Home/sidebar | `CRADLE-WORKSPACE-001`, `CRADLE-TAB-001` | 无 | E2E | P0 | Low |
| `workspace` | 添加、导入、解析本地工作区 | Sidebar, directory picker, CLI `workspace create/import/resolve` | `CRADLE-WORKSPACE-002`, `CRADLE-JOURNEY-001`, `apps/server/tests/workspace.test.ts` | Electron native picker fallback 与 CLI import 缺少端到端合同 | E2E + API/CLI integration | P0 | Medium |
| `workspace` | 删除、重命名、切换工作区 | Sidebar workspace menu | `CRADLE-WORKSPACE-003..005`, `apps/web/src/features/workspace/workspace-sidebar.test.tsx` | CLI `workspace update/delete` 应保留 generated command 合同 | API/CLI integration | P1 | Low |
| `workspace-detail` | 打开工作区详情并查看项目内容 | `workspace-detail` tab | `CRADLE-WORKSPACE-006`, `apps/web/src/tabs/workspace-detail.tab.test.tsx` | 文件树深层导航与 tab label 失效路径需补组件/集成 | Component + API | P1 | Low |
| `workspace-detail` | 编辑 README / AGENTS 文档并保存 | Workspace detail editor | `apps/web/src/features/workspace-detail/capsule-composer.test.tsx`, `apps/server/tests/workspace.test.ts` | 缺少真实 UI 保存旅程 | E2E candidate | P1 | Low |
| `pack-codebase` | 从工作区菜单复制代码库上下文到剪贴板 | Workspace menu, pack dialog, CLI `workspace pack` | `CRADLE-WORKSPACE-007`, `apps/server/tests/pack-codebase.test.ts`, `apps/web/src/features/pack-codebase/pack-codebase-utils.test.ts` | CLI pack output 合同可补 runtime test | API/CLI integration | P1 | Low |
| `filesystem` | 浏览目录、收藏目录、fallback directory browser | Directory picker fallback | `apps/web/src/features/filesystem/directory-browser-dialog.test.ts`, server route exists | 真实 Electron picker 属平台能力，缺手动 smoke checklist | Component + Manual Smoke | P1 | Medium |
| `new-chat` | 打开新聊天并选择工作区 / agent / runtime / model | `new-chat` tab | `CRADLE-CHAT-002`, `CRADLE-MODEL-001`, `apps/web/src/features/new-chat/*.test.*` | CLI-TUI runtime 与 ACP runtime 选择缺用户旅程 | E2E candidate + Component | P0/P1 | Medium |
| `chat-runtime` | 创建会话、发送消息、接收完成回复 | Chat tab, SSE, CLI `session create`, `chat messages` | `CRADLE-CHAT-003`, `CRADLE-JOURNEY-001`, `apps/server/tests/chat-runtime.test.ts`, `apps/server/tests/session.test.ts` | CLI create/messages 合同需覆盖输出格式 | E2E + API/CLI integration | P0 | Medium |
| `chat-runtime` | 多轮对话、继续发送、恢复刷新后的会话 | Chat tab | `CRADLE-CHAT-004`, `CRADLE-CHAT-008`, `CRADLE-CHAT-011` | 后端 message snapshot migration 已有低层覆盖，E2E 足够 | E2E + DB test | P0 | Medium |
| `chat-runtime` | 停止流式回复、处理 provider 失败 | Chat tab | `CRADLE-CHAT-006..007`, `apps/web/src/features/chat/chat-streaming-handler.test.ts` | ACP / Codex provider cancel 需集成层兜底 | API/Integration | P0 | High |
| `chat-runtime/providers` | 使用不同 runtime kind 完成聊天：`standard`, `openai-compatible`, `claude-agent`, `codex`, `jar-core`, `acp-chat`, `cli-tui` | New chat runtime selector, profile settings, chat tab | `CRADLE-MODEL-001..002`, `CRADLE-AGENT-RUNTIME-009..010`, `apps/server/tests/chat-runtime.test.ts`, `apps/server/tests/acp-chat-runtime.test.ts`, provider-specific tests | Codex/Claude/ACP/CLI-TUI 都可能启动外部进程；常规 E2E 只跑 mockable happy path，其余用 provider integration + cleanup assertions | API/Integration + targeted E2E smoke | P0/P1 | High |
| `chat-runtime` | 渲染 reasoning、tool call、文件读写结果块 | Chat message blocks | `CRADLE-CHAT-016..017`, `apps/web/src/features/chat/blocks/tool-call-block.test.tsx`, `chat-render-plan.test.ts` | grouped tool call 与 edit-file/read-files 视觉状态缺组件用例 | Component | P1 | Low |
| `chat-runtime` | 导出 / 复制会话 Markdown | Chat session menu, CLI `session export markdown` | `CRADLE-CHAT-015`, `apps/server/tests/session.test.ts` | CLI export command output contract 可补 | API/CLI integration | P1 | Low |
| `session` | 重命名、置顶、删除、列表归属 | Sidebar session list, CLI `session list/get/update/delete` | `CRADLE-CHAT-005`, `CRADLE-CHAT-012..014`, `apps/server/tests/session.test.ts` | 批量删除或 linked issue 入口主要是 API/CLI | API/CLI integration | P1 | Low |
| `session` | 会话链接 / 取消链接 Issue | Issue detail, CLI `session linked-issue *` | `apps/server/tests/session.test.ts`, `apps/server/tests/issue-agent.test.ts` | 缺 UI 显式路径，如已有入口应补组件/用户旅程 | API/Component | P1 | Low |
| `approval` | Agent 请求工具审批，用户批准或拒绝 | Approval inbox / chat overlay, CLI `approval list/respond` | `CRADLE-APPROVAL-001..002`, `apps/server/tests/approval.test.ts`, `apps/web/src/features/approval/approval-state.test.ts` | 新 `approvals` tab inbox 需要独立导航/响应旅程 | E2E candidate | P0 | Medium |
| `agent-identity` | 创建、编辑、删除 agent，头像预览，列表空态 | Settings > Agents | `CRADLE-AGENT-IDENTITY-001..009`, `apps/server/tests/agent.test.ts`, `apps/web/src/features/agent-management/agent-detail.test.ts` | CLI `agent *` generated command 合同 | API/CLI integration | P1 | Low |
| `agent-runtime` | 读取 agent/profile/model 可用性并为 UI 提供联动状态 | Agent settings, composer toolbar | `CRADLE-AGENT-RUNTIME-001..010`, `apps/web/src/features/agent-runtime/*.test.*`, `apps/server/tests/agent-runtime-config.test.ts` | runtime visibility 与 profile list fallback 主要是状态逻辑，不应重复 E2E | Component + API | P1 | Low |
| `profiles` | 创建、编辑、删除、启用 provider profile | Settings > Providers, CLI `profile *` | `CRADLE-AGENT-RUNTIME-001..010`, `apps/server/tests/profiles.test.ts`, `apps/web/src/features/agent-management/custom-models-editor.test.tsx` | model registry mapping 与 icon update 缺 UI/组件覆盖 | Component + API | P1 | Low |
| `providers` | 拉取模型、健康检查、模型搜索/lookup/cache | Provider setup dialogs, composer toolbar | `CRADLE-AGENT-RUNTIME-005`, `apps/server/tests/sdk-providers.test.ts`, `apps/web/src/features/composer-toolbar/provider-model-selector.test.tsx` | models.dev registry mapping 与 cache stale 分支需 API 覆盖 | API/Integration | P1 | Medium |
| `secrets` | 保存、列出、删除 secret metadata | Provider profile, Chronicle Slack source, CLI `secret list/delete` | `apps/server/tests/profiles.test.ts` indirectly, `apps/server/src/modules/secrets` | Web 不应直接暴露 raw secret；需要 secret save/delete API 合同和“不回显明文”断言 | API/Integration | P0 | Low |
| `preferences` | 设置默认聊天偏好 | Settings / CLI `preferences chat get/set` | `apps/server/tests/preferences.test.ts` | UI 默认偏好入口不清晰，需在 Settings 中补组件或 E2E | Component + API/CLI | P1 | Low |
| `system-agent` | 打开 Jarvis，携带当前上下文对话 | Jarvis popover | `apps/web/src/features/system-agent/format-context.test.ts` | 缺 Jarvis popover 真实打开、上下文注入、会话恢复旅程 | E2E candidate | P1 | Medium |
| `preferences` / `system-agent` | 配置 Jarvis provider/model/thinking | Settings > Jarvis, CLI `preferences jarvis get/set` | `apps/web/src/features/system-agent/format-context.test.ts`, `apps/server/tests/preferences.test.ts` | 缺 settings UI 保存旅程 | E2E candidate + API/CLI | P1 | Low |
| `composer-toolbar` | 在新聊天/聊天中切换 provider、model、thinking、runtime | Composer toolbar | `CRADLE-MODEL-001..002`, `apps/web/src/features/composer-toolbar/*.test.*` | per-message override 和 bound profile fallback 主要组件层覆盖 | Component | P1 | Low |
| `skills` | 全局 / 工作区 / Agent skill 创建、导入、编辑、删除、导出 | Settings, workspace detail, agent detail, CLI `skill *` | `CRADLE-SKILLS-001..008`, `apps/server/tests/skills.test.ts`, `apps/web/src/features/skills/skill-manager.test.tsx` | fetch source / cancel fetch / import-from-fetch 缺隔离集成，避免真实网络 | API integration with mock fetch | P1 | Medium |
| `workflow-rules` | 保存 All Agents / Agent 专属规则并重新打开 | Settings / workspace detail, CLI `workflow-rule *` | `CRADLE-WORKFLOW-RULES-001..002`, `apps/server/tests/workflow-rules.test.ts` | workspace-scoped rules 如已有 UI 需补组件或 E2E | Component + API/CLI | P1 | Low |
| `kanban` | 创建看板、进入看板、删除看板 | `kanban-board` tab, CLI `board *` | `CRADLE-KANBAN-002..003`, `CRADLE-KANBAN-008`, `apps/server/tests/kanban.test.ts` | CLI board generated output 合同 | API/CLI integration | P0/P1 | Low |
| `issue` | 创建、编辑、删除、搜索 Issue | Kanban board/detail, CLI `issue *` | `CRADLE-KANBAN-004..005`, `CRADLE-KANBAN-009..012`, `apps/server/tests/kanban.test.ts` | Issue list/search CLI 与 bulk update 缺 API/CLI 合同 | API/CLI integration | P0/P1 | Low |
| `issue` | 评论、状态列、优先级、标签、assignee、milestone | Issue detail/sidebar | `CRADLE-KANBAN-006..007`, `CRADLE-KANBAN-011`, many component tests under `features/kanban/issue-detail` | milestone、label、relation、sub-issue UI 只在组件层，缺 API/CLI 全合同 | Component + API/CLI | P1 | Low |
| `issue` | context refs、relations、sub-issues | Issue detail, CLI `issue context-ref/relation *` | `apps/server/tests/kanban.test.ts`, relation/sub-issue component tests | 缺用户路径：从 issue detail 添加/删除 relation/context ref | E2E candidate or Component + API | P1 | Low |
| `issue-agent` | 委派 Issue 给 Agent，查看活动，取消、停止、重跑 | Issue detail, CLI `issue delegate/undelegate`, `issue-agent-session *` | `CRADLE-ISSUE-AGENT-001..003`, `apps/server/tests/issue-agent.test.ts` | stop activities CLI output 与失败态缺集成覆盖 | API/CLI integration | P1 | Medium |
| `automation` | 创建/查看/启停/删除 automation | Automations tab, CLI `automation *` | `apps/server/tests/automation.test.ts` | Web automation dashboard 无 E2E；run-now/artifacts 缺真实用户旅程 | E2E candidate + API/CLI | P1 | Medium |
| `automation` | 手动运行 automation，查看 run、artifact、linked chat/backend run | Automations tab | `apps/server/tests/automation.test.ts` | 缺稳定 E2E；必须用 mock runtime 避免后台孤儿进程 | API integration first, then E2E smoke | P1 | High |
| `session-await` | 为会话创建 GitHub CI / review await，查看 pending/live/cancel/trigger | Chat right aside, Awaits tab, CLI `session await-*` | `apps/server/tests/session-await.test.ts`, `apps/server/tests/session-await-github.test.ts`, `apps/web/src/features/session-await/await-github.test.ts` | Awaits overview tab 无 E2E；live GitHub 需 mock adapter | E2E candidate + API integration | P1 | Medium |
| `desktop` / `desktop-tray` | 托盘查看 running/resident sessions、awaits、quick actions | Tray popover, main window action bridge, `/desktop/tray` | `apps/server/tests/desktop-tray.test.ts`, `apps/web/src/features/desktop-tray/*.test.*` | Electron tray window 与 IPC quick action 缺平台 smoke | Component + Manual Smoke | P2/P3 | High |
| `settings` | 打开设置、切换 section、返回 active tab | Settings overlay | `CRADLE-SHORTCUTS-001`, `apps/web/src/features/settings/settings-sidebar.test.tsx` | section deep link 与 overlay restore 可补组件 | Component | P1 | Low |
| `settings` / `desktop-update` | 检查、下载、应用桌面更新 | Settings > Desktop update, preload IPC, Velopack | `apps/desktop/src/main/update-manager.ts`, no stable E2E | 真实更新 feed 不进常规 E2E；需 fake IPC component + release manual smoke | Component + Manual Smoke | P3 | High |
| `home` | 启动看到首页，进入最近会话、看板、用量入口 | Home tab | `CRADLE-HOME-001..002`, `CRADLE-JOURNEY-001..002` | Home automation/awaits/plugin shortcuts 如有入口需组件覆盖 | Component | P0/P1 | Low |
| `tabs-next` | 默认 tab、切换、关闭、保持内容、URL/persist reconciliation | App tab bar | `CRADLE-TAB-001..007`, `packages/tabs-next/src/__tests__/*`, `apps/web/src/tabs/reconcile-persisted-tabs.test.ts` | plugin-panel tab missing panel fallback covered only by code | Component | P0/P1 | Low |
| `keyboard-shortcuts` | 设置、侧栏、右侧/底部面板、新建/切换/关闭 tab | Global shortcut provider | `CRADLE-SHORTCUTS-001..004` | Shortcut conflict / input focus guard 需组件层 | Component | P1 | Low |
| `search` | 搜索会话标题/消息并打开命中会话 | Global search dialog, CLI `search threads` | `CRADLE-SEARCH-001..002`, `apps/server/tests/search.test.ts`, search component tests | 空查询、中文 tokenization、workspace filter 需 API/组件覆盖 | API + Component | P1 | Low |
| `git` | 查看分支、创建分支、切换分支、提交图、fetch/status | Header, Git aside, CLI `workspace git *` | `CRADLE-GIT-001..003`, `apps/server/tests/git.test.ts`, `apps/web/src/features/git/*.test.*` | fetch remote、conflict/error states 不应强行 E2E，需 temp repo API 覆盖 | API integration | P1 | Medium |
| `pty` / `tui` | 打开工作区终端、执行命令、关闭/重连 | Bottom panel shell, WebSocket | `CRADLE-PTY-001`, `apps/server/tests/pty.test.ts`, `pty-websocket.test.ts`, `apps/web/src/features/tui/pty-protocol.test.ts` | CLI-TUI agent session attach/capture 缺隔离集成 | API/WebSocket integration | P1 | High |
| `browser` | 打开嵌入式 browser tab，导航、返回、刷新、脚本注入 | Browser panel / plugin bridge | browser component code, no E2E | Electron webview 与 plugin backend 高风险，先补 component + plugin integration + manual smoke | Component + Manual Smoke | P2/P3 | High |
| `plugin-panel` / `plugins` | 插件注册 panel 并在 tab 中渲染，panel 缺失显示 fallback | Plugin panel tab | plugin store code, devtool plugin tests | 缺 plugin panel tab renderer 组件测试和 plugin SDK contract | Component + Integration | P2 | Medium |
| `devtool` | 查看 IPC、ACP、agent context、observability、resources、tabs state | `/devtool` second window | `apps/web/src/features/devtool/plugins/plugins-panel.test.tsx`, `resources-popover.test.tsx` | devtool window lifecycle 与 observability table 缺组件/手动 smoke | Component + Manual Smoke | P2 | Medium |
| `observability` | 查看 events/incidents/export bundle，资源弹窗显示部分失败 | Devtool / resources popover, CLI `observability *` | `apps/server/tests/observability.test.ts`, `apps/web/src/features/devtool/resources/resources-popover.test.tsx` | Observability table/detail UI 缺组件覆盖；CLI export 合同 | Component + API/CLI | P2 | Low |
| `usage` | 空状态、聊天产生用量后查看 summary/daily/session/cost | Usage tab, CLI `usage *` | `CRADLE-USAGE-001..002`, `apps/server/tests/usage.test.ts`, `apps/web/src/features/usage/usage-format.test.ts` | cost sessions/daily CLI output contract 与 heatmap edge cases | API/CLI + Component | P1 | Low |
| `health` | 用户/脚本确认 server liveness | CLI `health`, devtool health panel | `apps/server/tests/health.test.ts`, `apps/server/tests/elysia-skeleton.test.ts` | devtool health panel 缺组件覆盖 | API + Component | P2 | Low |
| `acp` | 查看 registry、安装/取消/卸载 agent、查看 audit/install path | CLI `acp *`, ACP runtime setup | `apps/server/tests/acp.test.ts`, `apps/server/tests/acp-chat-runtime.test.ts` | UI 管理入口如在插件/设置中出现需补；真实 install 需 mock distribution | API/CLI integration | P2 | High |
| `chat-runtime/acp` | 使用 ACP agent 作为 runtime 完成聊天 | Chat provider runtime | `apps/server/tests/acp-chat-runtime.test.ts` | 缺 E2E 用户选择 ACP runtime；仅在 mock agent 稳定后加入 | API integration then E2E candidate | P1 | High |
| `chronicle` | 配置 capture、查看 status/resources/timeline/memories/search | Settings > Chronicle, Chronicle server API | `apps/server/tests/chronicle.test.ts`, `chronicle/tests/smoke.rs`, `apps/web/src/features/chronicle/README.md` | Web UI 无 E2E；screen capture/daemon 不进常规 E2E | API + Component + Manual Smoke | P2/P3 | High |
| `chronicle` | 管理本地模型资源：reconcile/verify/install/remove | Settings > Chronicle model resources | `apps/server/tests/chronicle.test.ts` | 真实下载/安装需 mock installer 与 manual smoke | API integration + Manual Smoke | P2/P3 | High |
| `chronicle` | 管理 Slack source、同步消息、生成 memory | Settings > Chronicle Slack, Secrets | `apps/server/tests/chronicle.test.ts` | 真实 Slack 不进 E2E；需 mock GitHub/Slack source adapter | API integration with mocked external service | P2/P3 | High |
| `desktop-main` | 启动 server 子进程、创建窗口、恢复窗口 bounds、关闭清理 | Electron main | `apps/desktop/src/main/window-state.test.ts` | server-process/main-app 生命周期缺集成 smoke，不能常规 E2E 每次跑 | Desktop integration + Manual Smoke | P0/P3 | High |
| `desktop-preload` | Renderer 调用 IPC、window controls、update、tray action bridge | `window.cradle` preload API | preload code, tray component tests | 缺 preload contract test | Integration | P1 | Medium |
| `desktop-plugin-runtime` | 发现、校验、激活 desktop plugins，桥接 webview listener | Desktop plugin loader, plugin SDK | `apps/server/src/plugins/runtime-registry.test.ts`, plugin docs/code | 缺 desktop plugin loader integration test | Integration + Manual Smoke | P2/P3 | High |
| `browser-use-plugin` | Agent/browser automation 控制 webview：navigate/click/type/screenshot | `plugins/browser-use`, Browser panel | `plugins/browser-use/src/browser-commands.ts` pure helpers only | 缺 plugin backend lifecycle、webview event bridge、screenshot smoke | Integration + Manual Smoke | P2/P3 | High |
| `server-infra` | DB migration/config/request id/error mapping/OpenAPI/plugin activation | Server startup and generated clients | `apps/server/tests/database.test.ts`, `config.test.ts`, `request-id.test.ts`, `exception-filter.test.ts`, `openapi.test.ts`, `plugins/runtime-registry.test.ts` | Elysia migration path route parity must stay in capability tests | API/Integration | P0/P1 | Medium |
| `test-reset` | E2E harness 清空测试数据库与隔离状态 | Test-only server module | `apps/server/tests/test-reset.test.ts`, E2E support lifecycle | 非产品路径；只在 `NODE_ENV=test` 注册，不能进入用户 E2E 矩阵 | API integration | Test-only | Low |
| `cli-runtime` | Generated command HTTP mapping、output formatting、errors | `packages/cli/src/runtime` | `packages/cli/src/runtime/*.test.ts`, generated command files | 每个 command family 需要至少一个 golden output / error-path contract | CLI integration | P1 | Low |
| `db/schema` | Persistent data shapes and migrations for all features | `packages/db` | `packages/db/src/message-snapshot-migration.test.ts` | Chronicle/session-await/automation migrations need migration smoke when schema changes | DB integration | P0/P1 | Medium |
| `streamdown` | Streaming markdown/code rendering, incomplete fences, profiler | Chat renderer package | `packages/streamdown/src/**/*.test.ts` | End-user E2E covered by chat; package stays unit/component | Unit/Component | P1 | Low |

## 必补用户旅程候选

这些是下一轮最值得补进 E2E 的真实路径，均需保持薄步骤和稳定清理：

1. **`CRADLE-APPROVAL-003`**: 从 `approvals` tab 查看 pending approval 并响应。覆盖新 tab surface，不重复 chat overlay。
2. **`CRADLE-AUTOMATION-001`**: 创建 automation，手动 run，查看 run history 和 artifact。必须使用 mock runtime，不启动不可控后台进程。
3. **`CRADLE-AWAITS-001`**: 在聊天中创建 GitHub CI await，在 `awaits` tab 看到 pending，手动 trigger 后恢复。GitHub live status 用 mock adapter。
4. **`CRADLE-JARVIS-001`**: 打开 Jarvis popover，注入当前 active tab/workspace/context，发送一条 mock 回复。
5. **`CRADLE-WORKSPACE-008`**: 在 workspace detail 编辑 `AGENTS.md` 并保存，刷新后仍可见。
6. **`CRADLE-CHRONICLE-001`**: Settings > Chronicle 只做配置读写和 timeline/memory mocked read，不启动真实 recorder。
7. **`CRADLE-BROWSER-001`**: Browser panel navigation smoke，仅在 Electron/webview lifecycle 已有可控 harness 后加入。

## 不进入常规 E2E 的路径

以下不是遗漏，而是更适合其他验证层：

- Velopack 更新检查/下载/应用：用 fake IPC component test + release manual smoke。
- Electron tray popover 真实系统托盘：用 component test + platform manual smoke。
- Chronicle 真实屏幕采集、OCR、本地模型下载、Slack 真实同步：用 mocked API integration + permission/manual smoke。
- Browser-use 真实 webview screenshot/click/type：用 plugin integration + manual smoke。
- ACP 真实 agent 安装与外部 distribution 下载：用 mock registry/distribution integration + manual smoke。
- PTY / CLI-TUI 长驻进程压力路径：用 WebSocket integration + explicit cleanup assertions。
- Devtool second window：以组件与 desktop manual smoke 为主。

## CLI command family 覆盖清单

所有 generated CLI command 必须至少被对应 server API integration 覆盖；每个 family 至少保留一个 CLI runtime output/error contract。

- Registry: `index.generated` 只负责聚合 generated commands，不是用户命令；由 CLI runtime registry tests 覆盖。
- ACP: `acp registry list`, `acp registry distribution-types`, `acp agent list/get/install/cancel-install/install-path/uninstall`, `acp audit`
- Agent: `agent list/get/create/update/delete`
- Approval: `approval list/respond`
- Automation: `automation list/get/create/update/delete/enable/disable/run/runs`, `automation run get`, `automation artifacts`, `automation artifact list/get`
- Board: `board list/create/update/delete`
- Chat: `chat messages/cancel`
- Health: `health`
- Issue agent session: `issue-agent-session activities/rerun/stop`
- Issue: `issue list/get/search/create/update/delete`, `issue delegate/undelegate/delegation/sessions`
- Issue comments: `issue comment list/add/delete`
- Issue context refs: `issue context-ref add/remove`
- Issue milestones: `issue milestone list/create/update/delete`
- Issue relations: `issue relation list/create/delete`
- Issue statuses: `issue status list/create/update/delete/reorder`
- Observability: `observability events/incidents/export`
- Preferences: `preferences chat get/set`, `preferences jarvis get/set`
- Profiles: `profile list/get/set/delete/custom-models`
- Providers: `provider models/health-check`
- Search: `search threads`
- Secrets: `secret list/delete`
- Session awaits: `session await-create/await-get/await-list/await-cancel/await-trigger/await-summary`
- Session: `session list/get/create/update/delete/messages`, `session export markdown`, `session linked-issue get/link/unlink`
- Skills: `skill list/create/import/export`, `skill document get/update/delete`, `skill source fetch/import/cancel-fetch`
- Usage: `usage summary/daily/session/stats`, `usage cost summary/daily/sessions`
- Workflow rules: `workflow-rule list/get/save/delete`
- Workspace: `workspace list/get/create/import/update/delete/resolve/files/pack`, `workspace file read/write`, `workspace git status/branches/checkout/fetch/graph/branch create`

## 落地批次

### Batch 0: 覆盖合同守门

- 把本文件作为 E2E 新增场景的准入清单。
- 新 E2E 必须引用矩阵中的 Domain owner 和用户意图。
- 新 capability / tab / CLI command 进入代码库时，必须同步更新本矩阵或对应 README。

### Batch 1: P0/P1 E2E 缺口

- Approval inbox tab。
- Automation dashboard run/artifact smoke。
- Session Await create -> overview -> trigger。
- Jarvis popover context injection。
- Workspace detail document save.

### Batch 2: API/CLI contract 补强

- Automation、Session Await、ACP、Secrets、Provider models、Usage cost、Workspace Git command families。
- CLI runtime golden output / error contract 每个 family 至少一个。
- Server integration tests 对所有 generated command 背后的 route 保持 schema/response 断言。

### Batch 3: 高进程风险隔离

- PTY reconnect / cleanup integration。
- Browser-use plugin backend lifecycle。
- Desktop tray IPC action bridge integration。
- Chronicle daemon mocked lifecycle and resources。
- Desktop update fake IPC component and release manual smoke checklist。

### Batch 4: 组件与诊断面板

- Devtool observability table/detail。
- Browser panel controls。
- Settings section deep link / restore。
- Plugin panel fallback and plugin SDK panel rendering。
- Chronicle settings UI adapters after generated API types settle.

## 完成定义

本目标完成时应满足：

- 当前代码中所有已识别产品域都在矩阵中有一行或多行覆盖。
- 每行都有当前证据、缺口、推荐验证层、优先级和进程风险。
- E2E 候选只来自真实用户路径，不包含纯实现细节。
- 高进程风险路径都有更安全的验证层，且不要求常规 E2E 强行启动不可控进程。
- CLI generated command family 全部被列入附录，没有未归属 command。
