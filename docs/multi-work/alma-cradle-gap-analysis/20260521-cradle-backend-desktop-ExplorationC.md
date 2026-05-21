# Cradle 后端、桌面、本地运行时、插件与 CLI 能力审计

## 范围

本交接文件覆盖 Cradle 的后端、桌面壳、本地运行时、插件系统、CLI 与资源能力面，用于后续和 Alma 做功能差异归并。审计范围包括 `apps/server`、`apps/desktop`、`chronicle`、`packages`、`plugins`、`src/cli`、`resources`，并只把 `/Users/wibus/dev/safe-research/Alma-source` 中可见的包依赖、renderer 入口和 preload IPC 作为“相对 Alma 的可见信号”参考。

本节点不覆盖 Cradle Web 产品体验的完整盘点；`apps/web/src/features` 应由前端产品节点补充。

## 已检查证据

- 计划文件：`docs/exec-plans/20260521-07-alma-cradle-gap-analysis.md`。
- 后端组合入口：`apps/server/src/app.ts`、`apps/server/src/index.ts`、`apps/server/README.md`。
- 后端能力模块：`apps/server/src/modules/*/README.md`、各模块 `index.ts`、关键 `service.ts` 与 `model.ts`。
- 数据层：`packages/db/src/schema/*`、`packages/db/drizzle/*`，重点查看 `chat.ts`、`chronicle.ts`、`runtime.ts`。
- 桌面主进程：`apps/desktop/src/main/*`、`apps/desktop/src/preload/index.ts`、`apps/desktop/package.json`。
- 本地被动采集运行时：`chronicle/README.md`、`chronicle/Cargo.toml`、`chronicle/src/*`。
- 插件系统：`apps/server/src/plugins/*`、`packages/plugin-sdk/src/*`、`plugins/browser-use/*`、`plugins/system-info/*`。
- CLI：`packages/cli/src/*`、`packages/cli/README.md`、`resources/skills/cradle-cli/SKILL.md`。
- Alma 可见信号：`/Users/wibus/dev/safe-research/Alma-source/package.json`、`out/renderer/*.html`、`out/preload/index.js` 的 IPC 暴露文本。该证据来自构建产物和依赖，不等同于已读完整源码。

## Cradle 后端总览

Cradle 后端是一个本地优先的 Elysia HTTP 服务，`createServerApp()` 组合所有业务模块、OpenAPI、CORS、请求 ID、请求日志、统一错误映射、插件激活和后台任务。生产启动入口会安装进程级 fatal handler，加载 Langfuse，读取 `CRADLE_HOST`、`CRADLE_PORT`、`CRADLE_DATA_DIR`、`CRADLE_DB_PATH`、`CRADLE_CREDENTIAL_SECRET` 等配置，监听本地 HTTP 服务，并预热 `models.dev` 缓存。

数据层使用 SQLite、`better-sqlite3` 和 Drizzle，服务 README 明确要求类型化访问、迁移与 WAL。`packages/db/src/schema` 显示核心表覆盖 workspace、chat session/message、usage、approval audit、agent identity/profile、issue/kanban、automation、ACP、Chronicle、observability、session await 等。

后端能力定位不是“单个 AI provider 管理器”，而是面向 agent workspace 的控制平面：工作区、会话、运行时 provider、任务/issue、自动化、终端、被动上下文、技能、插件和可观测性都由 server 拥有。

## Cradle 后端模块能力

### 基础设施与控制面

- `health`：`GET /health`，用于桌面等待 server ready 与外部健康检查。
- `database`：SQLite + Drizzle 生命周期、外键、WAL、busy timeout、迁移执行。
- `http`：Elysia 迁移路径的 request id、OpenAPI、错误映射、validation normalization 和 actor context。
- `openapi`：暴露 OpenAPI 文档和 `/docs` 兼容入口；CLI 从 OpenAPI + `x-cradle-cli` 元数据生成。
- `logging` 与 `langfuse`：pino 日志、server log、OpenTelemetry/Langfuse tracing；AI SDK、Claude Agent、Codex runtime 均有 Langfuse 相关接入点。

### Workspace、文件与 Git

- `workspace`：`/workspaces` CRUD、从目录导入、按路径 resolve、列出文件、读取和写入工作区文件。`files.ts` 负责 `.gitignore` 过滤与安全文本 IO。
- `filesystem`：提供文件浏览和 favorites 类能力，主要服务桌面/renderer 选择文件场景。
- `git`：`/workspaces/:id/git/*`，包含 status、branches、remotes、graph、checkout、create branch、fetch。实现基于 `simple-git`，边界归属在 workspace。
- `pack-codebase`：`POST /workspaces/:workspaceId/pack`，通过 `repomix` 打包代码库，具备 workspace 所有权检查。

### Agent、profile、provider 与统一 chat runtime

- `profiles`：保存 agent profile，支持 provider kind、typed config、credential ref、icon、custom models、`models.dev` mapping。删除 profile 会清理 agent/session/runtime audit/usage 等关联数据。
- `secrets`：server-owned secret metadata 与加密存储，使用 `CRADLE_CREDENTIAL_SECRET` 做 AES-256-GCM；HTTP 只暴露 masked metadata 和 CRUD。
- `providers`：支持 `openai-compatible`、`anthropic` provider metadata、model listing、health check、model cache、`models.dev` 查找与搜索。当前 provider taxonomy 明确没有 Azure、DeepSeek、Google、OpenRouter、AIHubMix 等独立 provider kind。
- `agent-identity`：`/agents` CRUD，agent 绑定 runtime/profile，包含 avatar policy 和 enabled 状态。
- `session`：chat session CRUD、message listing、markdown export、linked issue helpers、默认 agent/profile 绑定。
- `chat-runtime`：统一 `/chat/sessions/:sessionId/*` API，支持 response、capabilities、messages、cancel。provider registry 覆盖 `standard`、`claude-agent`、`codex`、`jar-core`、`acp-chat`、`cli-tui`。服务层负责 active run、duplicate reservation、runtime config 合并、stream snapshot 持久化、delta event 序列化、subagent routing、取消终态和 completion subscription。
- `approval`：pending approval registry、SSE stream、respond API、allowed policy 记忆和 approval audit。
- `usage`：daily、summary、stats、session usage 和 cost summary/cost daily/cost sessions，使用模型 pricing 与 step usage 数据。

### ACP 与外部 agent runtime

- `acp`：从 `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` 读取 registry，支持查看可用 distribution type、安装/取消安装/卸载 agent、查询 install path 与 audit log。binary agent 安装到 Cradle runtime data dir 下的 `acp/agents`，package agent 可用 `npx` 等 distribution。
- `chat-runtime/providers/acp`：server-owned ACP subprocess supervisor、connection/session/prompt manager、ACP approvals 与 title updates 桥接；会把 plugin-registered MCP servers 转发给 ACP `newSession`、`loadSession`、`unstable_resumeSession`。
- `chat-runtime/providers/codex`：Codex SDK runtime，能把 plugin MCP registry 投影到 `config.mcp_servers`。
- `chat-runtime/providers/claude-agent`：Claude Agent SDK runtime，能把 plugin MCP registry 投影到 SDK `mcpServers` query options。
- `chat-runtime/providers/system-agent`：基于 `@hijarvis/jar-core` 的 System Agent runtime。
- `chat-runtime/providers/openai-compatible`：AI SDK/OpenAI-compatible backend。

### Issue、Kanban 与 agent delegation

- `issue`：issue CRUD、status、milestone、search、comment、relation、context refs、linked session 等。写入会解析 actor context，避免把 profile 当作者。
- `kanban`：board CRUD 与 workspace validation。
- `issue-agent`：issue delegation、undelegation、issue-agent session、activities、rerun、stop；会把 issue prompt 和 workflow rules 交给 chat runtime 执行，并订阅 completion 状态。

### Automation、await 与 workflow rules

- `automation`：`/automations` 支持定义 CRUD、enable/disable、run now、RRULE schedule、run 记录、artifact list/get。模型支持 runtime kind `standard`、`claude-agent`、`codex`、`jar-core`、`acp-chat`。
- `session-await`：持久化“暂停并等待外部信号”的 session await，支持 manual trigger、cancel、summary 和 live status。内置 source 包括 `github-ci` 与 `github-review`，有 GitHub REST boundary、ETag cache、rate-limit tracking、PR/check/status/review 聚合。
- `workflow-rules`：按 workspace 和可选 agent profile 保存、读取、删除 workflow rule，强调路径安全和 Cradle namespace 写入。

### Chronicle 被动上下文与本地记忆

- server 模块 `chronicle` 暴露 `/chronicle/config`、`/chronicle/status`、`/chronicle/resources`、`/chronicle/model-resources`、`/chronicle/timeline`、frame image、`/chronicle/memories`、memory search、snapshot ingest、memory ingest、`/chronicle/summarize`。
- `chronicle/` 是 Rust crate，提供 screen capture trait、macOS CoreGraphics active display capture、Vision OCR、privacy filtering、frame fingerprint deduplication、artifact persistence、recursive memory pipeline、prompt construction 和 child process boundary。
- Chronicle daemon 由 server 启动，查找 `cradle-chronicle` release/debug/bundled binary，传入 `--daemon --storage-root`，并通过 `CRADLE_URL` 回报 snapshot/memory。
- 数据表包含 `chronicle_snapshots`、`chronicle_memories`、`chronicle_model_resources`、`chronicle_message_sources`、`chronicle_messages`、`chronicle_events`。模型资源 enum 已预留 `ocr`、`audio-vad`、`audio-asr`、`speaker`、`embedding`，但代码证据显示当前真实可用重点是 macOS Vision OCR 和 LLM summary，未看到 Whisper/HuggingFace/向量索引实现。
- `chronicle_message_sources` 当前 platform enum 只有 `slack`，但本轮没有看到对应 Slack fetch route 完整暴露；更像 schema 和部分服务能力已经预留，产品化程度需后续确认。

### Terminal/PTTY 与本地进程

- `pty`：`/terminal-sessions/*` HTTP + WebSocket，支持 chat session 的 `start-or-attach`、generic shell start、socket live channel、resize/input/ping、snapshot/output/exit/pong/error event、resource usage 和 module shutdown。
- `node-pty` runtime 负责 PTY process lifecycle、timeline replay、Codex CLI JSONL metadata reader、process tree resource sampling、shell lease cleanup。

### Observability 与搜索

- `observability`：事件、incident、flush、export bundle。支持按 chat session、run、code、severity、time window 查询，包含 dedupe、incident projection、timeline export。
- `search`：thread search，README 标注 FTS 和 legacy search engine。
- `resources/skills/observability-debugger`：本地调试技能，读取 `observability_events`、`observability_incidents`、`backend_timeline_events` 和 server logs，提供 summary/events/incidents/timeline/logs/bundle。

### Skills 与资源

- `skills`：inventory、document CRUD、import/export、fetch source、import from fetch、cancel fetch。`skills-paths.ts` 负责 scope root resolution 和 write ownership，符合 Cradle namespace 原则。
- `resources/skills/cradle-cli`：面向 agent 的 CLI 使用技能，说明 session await、issue workflow、workspace helpers 和输出约定。

## 桌面、本地运行时与 IPC 能力

Cradle Desktop 是 Electron 壳，`apps/desktop/src/main/index.ts` 首先运行 Velopack startup hook，再进入 `main-app.ts`。启动顺序是：初始化 native IPC service、激活 desktop plugins、fork server、创建主窗口、创建 tray、启动后台更新检查。

桌面能力包括：

- server fork：`server-process.ts` 在本地端口 `21423` 到 `21426` 中选择可用端口，设置 `CRADLE_DATA_DIR` 到 Electron `userData/data`，生成或读取 desktop-owned `credential-secret`，把 desktop plugin shared config 投影为环境变量后 fork server。server 异常退出会最多重启 3 次，失败后显示 crash dialog。
- 窗口生命周期：主窗口支持 bounds 恢复和多显示器可见性校正；session 可 tear off 到独立窗口；另有 devtool window。所有窗口默认 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，主窗口和 session window 开启 `webviewTag`。
- preload：向 renderer 暴露 `window.cradle`，包含 `ipc.invoke/on`、环境信息、窗口控制、desktop update 状态事件、tray action bridge。
- 原生服务：`native-services.ts` 提供 open/save dialog、`openExternal`、`showItemInFolder`、session tear off/focus/close/open list、devtool window、minimize/maximize/close、update check/download/apply。
- tray：系统托盘与无边框 popover，动作包括 open app/chat/new chat/global search/resident/running/approvals/awaits/automation/workspaces/chronicle/usage/plugins/settings/quit，并通过 IPC 转发给主窗口。
- 更新：`update-manager.ts` 使用 Velopack，支持 update feed URL、后台检查、显式检查、下载进度、apply update、失败重试和 renderer 状态广播。Cradle 没用 Alma 的 `electron-updater`，但有等价的 desktop updater 基础能力。
- desktop plugin bridge：主进程在 webview attach 时通知 plugin loader；desktop plugin 可以注册 webview listener、请求 renderer 创建/激活/查询 browser panel tab，并写 shared config 给 server。

## 插件能力

Cradle 插件系统是三层 runtime：

- server layer：Elysia scoped app、HTTP routes、MCP server registration、skill registration、chat lifecycle hooks、event bus、plugin-scoped KV storage、logger、shared config、manifest。
- desktop layer：Electron main plugin，能监听 webview creation、请求 browser tab、激活 tab、查询 active tab、写 shared config。
- web layer：React plugin，能注册 panel、command、本地 storage 和 logger。

server plugin host 会发现 plugin packages，生成 governed descriptors，处理 invalid package diagnostics，挂载 `/api/plugins/:routeSegment`，并提供 `/api/plugins` descriptor list 与 `/api/plugins/:name/web.mjs` bundle。runtime registry 记录 plugin identity、route ownership、layer lifecycle 和 capability records。当前 server plugin storage 是 in-memory，README 明确等待后续持久化。

已存在插件：

- `@cradle/browser-use`：desktop + server plugin，仅 desktop deployment。desktop 层启动 Unix domain socket browser backend，监听 renderer webview 并用 Chrome debugger protocol 执行命令；server 层在 socket path 可用时注册 `browser-use` MCP server，并注册 `browser-use` skill。
- `browser-use` MCP tools：navigate、screenshot、click、type、get text、tabs list/new/close、eval、scroll、hover、DOM accessibility snapshot、wait for selector 等。它控制的是 Cradle 内置 browser panel，不是外部浏览器。
- `@cradle/system-info`：server + web plugin，提供系统信息 API 和 web command/panel 的示例形态。

## CLI 能力

Cradle CLI 是 generated-first TypeScript CLI。根命令位于 `packages/cli/src/index.ts`，默认 server URL 是 `CRADLE_SERVER_URL` 或 `http://localhost:21423`。命令由 OpenAPI 的 `x-cradle-cli` 元数据生成，runtime 负责参数/flag 映射、HTTP 请求、输出格式和本地 man command。

CLI runtime 能力：

- 支持 `--server` 指向不同 Cradle server。
- 每个 generated command 支持 `--format auto|json|pretty|table|ndjson` 和 `--json [fields]`。
- HTTP client 会自动投影 `CRADLE_CHAT_SESSION_ID` 到 `x-cradle-chat-session-id`，服务端可用它识别 runtime session provenance。
- 支持严格 flag parsing、boolean flag、JSON flag、string array flag、path/query/body target 映射。
- `cradle man` 和 `resources/skills/cradle-cli/SKILL.md` 提供 agent 操作说明。

可见 generated command 模块覆盖 `acp`、`agent`、`approval`、`automation`、`board`、`chat`、`health`、`issue`、`issue-agent-session`、`observability`、`preferences`、`profile`、`provider`、`search`、`secret`、`session`、`skill`、`usage`、`workflow-rule`、`workspace` 及 workspace git/file 子命令。

## 相对 Alma 可见信号的缺失或弱项

以下不是最终缺口判定，只是 Cradle 侧反证或弱证据，供主 Agent 与 Alma 节点交叉验证。

- 本地 Whisper/ASR：Alma 依赖 `@fugood/whisper.node`、`@fugood/node-whisper-darwin-arm64`，preload 暴露 `whisper.getStatus`、`initialize`、`transcribe`、microphone permission。Cradle Chronicle schema 预留 `audio-asr`、`audio-vad`、`speaker`，但 Cradle 依赖和源码未见 Whisper 或 microphone capture/transcribe API，当前更接近 screen OCR + memory summary。
- HuggingFace Transformers：Alma 依赖 `@huggingface/transformers`。Cradle 依赖和源码未见 transformers runtime；Chronicle 的 embedding/model resource 目前是 schema 预留。
- 本地向量检索：Alma 依赖 `sqlite-vec`。Cradle 搜索有 thread FTS/legacy search，Chronicle 有 memory search，但未见 `sqlite-vec` 或 vector index 实现。
- 多 provider 管理广度：Alma package 暴露 `@ai-sdk/azure`、`deepseek`、`google`、`openrouter`、`aihubmix`、OpenAI-compatible、Anthropic 等。Cradle provider taxonomy 当前只有 `openai-compatible` 与 `anthropic`，Google/OpenAI 主要作为 AI SDK runtime dependency，不是独立 profile provider kind。
- 第三方通信连接器：Alma 依赖 `discord.js`、`@larksuiteoapi/node-sdk`、`weixin-agent-sdk`，preload 还暴露 Telegram audio decode。Cradle Chronicle schema 当前只看到 `slack` message source enum，且未见 Discord/飞书/微信/Telegram connector。
- 原生通知系统：Alma 有 `alma-notifications` native dependency、`notifications.html` 和 preload 的 `almaNotifications`、`notificationWindow`。Cradle 有 `sonner` 前端依赖和 tray，但本轮未见 desktop native notification queue/window/action API。
- 多窗口产品入口：Alma renderer 有 `index`、`notifications`、`lightbox`、`prompt-app-runner`、`livecoding`、`gallery`、`settings`、`share` 八个 HTML 入口。Cradle desktop 主要加载同一 renderer，并通过 query/hash/surface/session 实现主窗口、tray popover、tearoff session、devtool；未见独立 lightbox/gallery/share/livecoding/prompt-app-runner HTML 入口。
- Quick chat 与系统前台上下文：Alma preload 暴露 `quickChatWindow`、accessibility permission、front app context、traverse app、click-through。Cradle 有 tray popover和 Chronicle screen capture，但未见 quick-chat overlay、click-through、AX app traversal IPC。
- 权限管理 UI/API：Alma preload 暴露 `permissions`、`accessibility`、microphone permissions。Cradle desktop 本轮只看到 native dialog、window、update IPC；Chronicle macOS screen capture 会涉及系统权限，但未见统一 permissions manager。
- Playwright/Chromium BiDi 管理：Alma 依赖 `playwright`、`chromium-bidi`，preload 有 `playwright.getStatus/install`。Cradle root devDependency 有 `@playwright/test` 用于测试，browser-use 走 Electron webview + debugger socket；未见产品化 Playwright install/status 或 Chromium BiDi automation runtime。
- 文档、文件预览和媒体工具：Alma 依赖 `mammoth`、`react-pdf`、`xlsx`、`image-size`、`modern-screenshot`，有 gallery/lightbox 信号。Cradle workspace 能读写文本文件，web 依赖 Tiptap 和 xterm，但本节点未见 backend/desktop 层的 DOCX/PDF/XLSX preview pipeline。
- 远程监控/产品分析：Alma 依赖 `@sentry/electron` 与 `posthog-js`。Cradle 有 server-side observability、Langfuse tracing、logs、incidents，但未见 Sentry Electron crash reporting 或 PostHog product analytics。
- OAuth/account flows：Alma preload 暴露 Copilot、Claude subscription、MCP OAuth。Cradle 有 secrets/profile/provider config，但本轮未见 GitHub Copilot/Claude subscription OAuth 或 MCP OAuth lifecycle。
- Snapshot/diff/rollback：Alma preload 暴露 `snapshot.create`、`snapshotFile`、`list`、`get`、`diff`、`rollback`、`rollbackFile`、`cleanup`。Cradle 有 git graph/status、workspace file write、observability timeline，但未见 workspace snapshot/diff/rollback subsystem。
- Plugin UI affordances：Alma preload 暴露 plugin theme、status bar、input box、quick pick、confirm dialog、notification、commands。Cradle plugin SDK 有 web panels/commands、server hooks/MCP/skills、desktop webview bridge，但未见通用 plugin status bar/input box/quick pick/confirm/native notification IPC primitives。
- Prompt app runner/livecoding/share：Alma preload 和 renderer HTML 明确有 `prompt-app-runner`、`livecoding`、`share` 窗口信号。Cradle 有 automation、chat runtime、issue-agent 和 browser-use，但未见同名的 prompt app runner/live coding sharing window。
- 音乐/音频生成或 Strudel：Alma 依赖 `@strudel/web`、`tone`。Cradle 本轮未见等价音频/音乐 runtime。

## 不确定性

- Alma 证据来自 packaged build output 和 `package.json`，不是完整源码；依赖存在只能作为能力信号，需 Alma 节点进一步确认真实产品路径。
- Cradle Web 前端能力未完整审计；某些 preview、gallery、settings、plugin UI 能力可能在 `apps/web`，需要 ExplorationD 验证。
- Chronicle 的 Slack/message source、audio model resources、embedding resource 已出现在 schema/model 中，但本轮没有确认完整同步 route 和实现成熟度；应按“预留或部分实现”处理。
- Cradle 的 browser automation 能力明显存在，但它的边界是 in-app browser webview + Electron debugger，不等同于 Alma 的 Playwright/Chromium BiDi 管理能力。
- Cradle 的 update 能力存在，但技术栈是 Velopack，不是 Alma 的 `electron-updater`；对最终缺口判断应按用户体验等价而不是依赖名称判断。

## 精简能力清单

| 类别 | Cradle 当前能力 | 主要证据 |
| --- | --- | --- |
| HTTP 后端 | Elysia server、OpenAPI、CORS、request id、日志、错误映射、插件激活 | `apps/server/src/app.ts` |
| 数据层 | SQLite、Drizzle、WAL、迁移、typed schema | `apps/server/src/database/*`、`packages/db/src/schema/*` |
| Workspace | CRUD、目录导入、resolve、文件列表、文本读写 | `apps/server/src/modules/workspace/index.ts` |
| Git | status、branches、remotes、graph、checkout、branch create、fetch | `apps/server/src/modules/git/index.ts` |
| Provider/profile | OpenAI-compatible/Anthropic、model listing、health check、model cache、custom models | `apps/server/src/modules/providers/*`、`profiles/*` |
| Chat runtime | unified chat API、AI SDK、Claude Agent、Codex、jar-core、ACP、stream persistence、cancel | `apps/server/src/modules/chat-runtime/*` |
| ACP | registry、install、cancel install、uninstall、audit、runtime bridge | `apps/server/src/modules/acp/*` |
| Approvals | pending approvals、SSE stream、respond、policy memory | `apps/server/src/modules/approval/*` |
| Usage | token/cost daily、summary、stats、session usage | `apps/server/src/modules/usage/*` |
| Issues/Kanban | issue CRUD、comments、relations、contexts、statuses、milestones、boards | `apps/server/src/modules/issue/*`、`kanban/*` |
| Issue agents | delegate、undelegate、activities、rerun、stop | `apps/server/src/modules/issue-agent/*` |
| Automation | RRULE schedules、run now、runs、artifacts | `apps/server/src/modules/automation/*` |
| Await/resume | manual、GitHub CI、GitHub review、live status、session resume | `apps/server/src/modules/session-await/*` |
| PTY | chat terminal、generic shell、WebSocket live channel、resource usage | `apps/server/src/modules/pty/*` |
| Chronicle | screen capture daemon、macOS Vision OCR、privacy filtering、snapshot/memory ingest/search | `apps/server/src/modules/chronicle/*`、`chronicle/src/*` |
| Observability | events、incidents、export bundle、debug skill | `apps/server/src/modules/observability/*`、`resources/skills/observability-debugger` |
| Skills | inventory、document CRUD、import/export、source fetch/import | `apps/server/src/modules/skills/*` |
| Desktop shell | server fork、window/session tearoff、tray popover、native dialogs、Velopack updates | `apps/desktop/src/main/*` |
| Plugins | server/web/desktop plugin layers、MCP/skills/hooks/panels/commands/shared config | `apps/server/src/plugins/*`、`packages/plugin-sdk/src/*` |
| Browser automation | in-app browser MCP via desktop webview debugger socket | `plugins/browser-use/*` |
| CLI | generated commands from OpenAPI、multi-format output、session header projection、manuals | `packages/cli/src/*`、`resources/skills/cradle-cli/SKILL.md` |

