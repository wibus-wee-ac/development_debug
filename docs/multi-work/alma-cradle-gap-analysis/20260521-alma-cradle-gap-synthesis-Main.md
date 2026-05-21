# Alma 与 Cradle 功能差异综合报告

## 直接结论

本轮使用 `multi-work` 并行审计后，结论是：Alma 的产品面更像一个“本地桌面 AI 操作系统”，围绕多窗口、全局快捷入口、外部 IM channel、插件 UI 原语、媒体/文档预览、本地语音、Activity Recorder、Computer Use、WebSearch/WebFetch、MCP marketplace 与账号 OAuth 构建；Cradle 当前更像“agent workspace 控制平面”，强项在统一 chat runtime、workspace/issue/kanban、ACP/Codex/Claude Agent runtime、PTY、Chronicle、skills、插件治理、OpenAPI CLI、observability。

因此缺口不是“Cradle 没有 AI chat”，而是 Alma 已经把很多桌面侧、媒体侧、外部连接器侧、用户可编排 mini-app 侧能力产品化了。按当前证据，有 28 个 Alma 有而 Cradle 没有、或 Cradle 只有局部技术基础但尚未形成等价产品能力的点。

## 研究证据

本综合报告基于四个子 Agent 交接文件，并由主 Agent 额外用 `rg`、`find`、`node` 正则抽取做交叉复核：

- `docs/multi-work/alma-cradle-gap-analysis/20260521-alma-main-system-ExplorationA.md`：Alma main/preload、IPC、native/system 能力。
- `docs/multi-work/alma-cradle-gap-analysis/20260521-alma-renderer-product-ExplorationB.md`：Alma renderer、多窗口、设置页、预览器、Prompt Apps、Gallery、Share、Live Coding。
- `docs/multi-work/alma-cradle-gap-analysis/20260521-cradle-backend-desktop-ExplorationC.md`：Cradle server、desktop、本地 runtime、plugin、CLI 能力。
- `docs/multi-work/alma-cradle-gap-analysis/20260521-cradle-frontend-product-ExplorationD.md`：Cradle Web 产品面、chat、workspace、settings、devtool、browser、Chronicle、skills。

Alma 当前本地目录是 packaged build output，不是完整源码树。证据强度按优先级排序为：HTML 入口、preload IPC、main IPC/API route、renderer chunk/组件名、数据库表/依赖、UI 文案。依赖名只作为辅助信号，不单独计入最终缺口。

## Alma 功能地图

Alma 的功能可以归为 12 类：

1. 桌面多窗口：主应用、设置、透明通知、lightbox、gallery、prompt-app-runner、livecoding、share、quick chat、more menu、permission overlay。
2. 系统集成：tray、global shortcut、auto start、dock visibility、app icon 切换、CLI wrapper 安装、PATH 修复、native clipboard、file dialog、system preview。
3. 本地 API server：chat、provider、workspace、plugin、MCP、activity、computer use、bot bridge、memory、cron、heartbeat、usage、gallery、snapshot。
4. AI provider 与账号：OpenAI、Anthropic、Google、DeepSeek、Azure、OpenRouter、AIHubMix、Moonshot、Kimi、Ollama、Volcengine、Z.ai、Copilot、Claude subscription。
5. MCP/ACP/插件：MCP stdio/HTTP/SSE、MCP OAuth、resources/templates、marketplace、plugin commands、permissions、settings、themes、hooks、status bar、quick pick、input box、confirm dialog、notifications、tool approval。
6. Prompt Apps：可创建带表单输入的 prompt mini-app，支持独立 runner、快捷键、模型/工具/reasoning 配置、历史、图片结果重试。
7. Workspace 与文件媒体：文件树、terminal、preview server、Git/GitHub 操作、PDF/DOCX/XLSX/PPTX/ZIP/audio/video/image preview、gallery、lightbox。
8. Activity Recorder 与 Memory：屏幕截图、OCR、输入事件、browser URL/tab、app focus、semantic search、digest、report、suggestions、sqlite-vec 向量记忆、HuggingFace embedding。
9. Computer Use 与 Chrome Relay：OS app/window automation、approval、action log、PiP、MCP registration、外部 Chrome tab/DOM/screenshot/click/type/upload。
10. WebSearch/WebFetch：隐藏浏览器搜索、Google/Xiaohongshu debug window、cookie import/export/sync、Readability、Markdown 转换。
11. 外部 channel：Telegram、Discord、Feishu、Weixin，channel-to-workspace binding、voice reply、群/频道消息映射到 Alma threads。
12. 运营/维护：custom native notifications、auto update、Sentry、PostHog、cloud sync、backup import/export、network proxy settings、usage/RTK savings、cron/heartbeat、fatigue/sleep state。

## Cradle 覆盖地图

Cradle 当前已经有这些强项，不应算缺口：

- 统一 chat runtime：`standard`、`claude-agent`、`codex`、`jar-core`、`acp-chat`、`cli-tui`，SSE delta、snapshot persistence、cancel、approval、usage。
- Workspace/Issue/Kanban：工作区、文件树、Git、Pack Codebase、Issue、relations、sub-issues、agent delegation、Kanban。
- PTY/TUI：xterm、terminal session、WebSocket live channel、resource snapshot。
- ACP：registry、install、audit、runtime bridge，并能把 plugin MCP registry 转给 ACP。
- Plugin governance：server/web/desktop layers、MCP server registration、skills registration、panels、commands、shared config。
- Browser-use：in-app browser panel + Electron debugger socket + MCP tools，可导航、截图、点击、输入、DOM snapshot。
- Chronicle：screen capture、macOS Vision OCR、artifact persistence、memory pipeline、server ingest、settings UI。
- Skills：global/workspace/agent 层级，CRUD、import/export、source fetch，遵守 Cradle namespace。
- Observability/Devtool：events/incidents/export、health、memory、tabs diagnostics、plugin diagnostics。
- Desktop shell：server fork、window/session tearoff、tray popover、native dialogs、Velopack update。
- OpenAPI CLI：generated commands、format/json/table/ndjson 输出、session header 投影。

## 缺口清单

### P0 / P1 明确缺失

| # | Alma 有的能力 | Cradle 当前状态 | 为什么算缺口 | 建议 owner / namespace |
| --- | --- | --- | --- | --- |
| 1 | Prompt Apps 与独立 runner：CRUD、动态表单、快捷键、指定模型/工具/reasoning、独立窗口、执行历史、图片结果自动重试。证据：`prompt-app-runner.html`、`promptAppRunner` preload、`PromptAppsManager`。 | Cradle 有 automation registry、skills、slash commands，但没有用户可创建并以独立 runner 执行的 prompt mini-app 产品面。 | Automation 是 schedule/run viewer；skills 是 agent context；都不等价于用户面向的 prompt app runner。 | `apps/server/src/modules/prompt-apps` + `apps/web/src/features/prompt-apps`，runner 由 desktop 只承载窗口生命周期。 |
| 2 | Quick Chat overlay：全局快捷键、失焦隐藏、click-through ambient mode、front app context、AX app traversal、cached context。证据：`quickChatWindow` preload、`quick-chat:*` IPC。 | Cradle 有 tray popover、new chat、Chronicle screen capture，但没有全局悬浮 quick chat overlay 与前台 app traversal。 | 这是桌面入口层能力，不是普通 chat tab。 | `apps/desktop` owns window/AX bridge；`apps/server/src/modules/desktop-context` owns read-only context snapshots；Web owns quick chat UI。 |
| 3 | 自定义通知中心：透明置顶通知窗口、queue、action、theme、click-through、sound、clear all。证据：`notifications.html`、`almaNotifications`、`notificationWindow`、`alma-notifications`。 | Cradle 有 toast/tray/badge，但未见 native/custom notification queue/window/action API。 | Cradle 无跨窗口通知 inbox/action runtime。 | `apps/desktop/src/main/notifications` owns native window；`apps/web/src/features/notifications` owns renderer surface。 |
| 4 | Gallery + Lightbox：图片瀑布流、分页、复制、保存、缩放、拖拽、跳转 thread。证据：`gallery.html`、`lightbox.html`、`galleryWindow`、`lightboxWindow`。 | Cradle 有 file tree 和 workspace detail，但没有通用图片资产库或 lightbox。 | 图片生成/附件/会话资产没有统一浏览面。 | `apps/server/src/modules/assets` or `gallery` owns asset index；Web owns gallery/lightbox；desktop only opens windows. |
| 5 | Conversation Share：按消息选择、预览、导出 PNG、复制到剪贴板、zoom preview。证据：`share.html`、`share-AF-wBf-y.js`、`modern-screenshot`。 | Cradle 可导出 session Markdown、copy message，但没有可视化分享图生成面。 | Share 是跨应用传播/审阅能力，不是文本导出。 | `apps/web/src/features/share` owns rendering/export; desktop supplies clipboard/save dialog. |
| 6 | 本地 Whisper ASR 与麦克风权限：模型状态、初始化、transcribe、microphone permission/settings。证据：`whisper` preload、`whisper-*` IPC、`@fugood/whisper.node`。 | Chronicle schema 预留 `audio-asr`，但当前实现证据主要是 screen OCR；未见 Whisper/mic/transcribe API。 | Cradle 没有语音输入或本地 ASR 产品链路。 | `chronicle` owns local audio resources if passive sensing；`chat-runtime` or `composer` owns active voice input. |
| 7 | TTS/voice replies：OpenAI/ElevenLabs/local Qwen3-TTS setup、voice selection、test voice、bot voice reply。证据：Alma renderer TTS settings、main `/api/tts/*`、临时音频文件。 | Cradle 无 TTS settings、voice reply、audio output pipeline。 | 语音输出与 IM voice reply 是完整缺口。 | `apps/server/src/modules/voice` or channel-specific owner；不要写入 provider namespace。 |
| 8 | 第三方 IM bridges：Telegram、Discord、Feishu、Weixin，channel/thread 映射、group/channel status、voice/file forwarding。证据：Alma main route/domain、`discord.js`、`@larksuiteoapi/node-sdk`、`weixin-agent-sdk`、channel tables。 | Cradle 只有 Slack bridge app 与 Chronicle schema 中 `slack` 预留；未见 Telegram/Discord/Feishu/Weixin 产品化 connector。 | Cradle 缺外部消息入口和 channel-to-workspace binding。 | `apps/server/src/modules/channels` owns canonical channel mapping；每个 connector in `apps/<connector>` or plugin owns protocol. |
| 9 | People/contact profiles：Telegram ID、Discord ID、Feishu ID、username、profile、avatar。证据：Alma settings `people`。 | Cradle 有 agent identity、issue actors，但没有跨 IM 的 human/contact profile。 | 外部 channel bridge 需要人类身份映射。 | `apps/server/src/modules/people` or `contacts`，读取 channel namespaces but owns Cradle contact projection. |
| 10 | MCP 管理 UI：marketplace、installed servers、server edit、OAuth badge、resource viewer。证据：Alma `MCPSettings`、`MCPMarketplace`、`MCPResourceViewer`。 | Cradle server plugin registry 能注册 MCP servers，chat providers 可读取；Web 未见 MCP server/tool/resource 管理面。 | 运行时已有 registry，但用户无法管理 MCP lifecycle。 | `apps/server/src/plugins` keeps capability registry；new `apps/server/src/modules/mcp` can own user-managed server records if separate from plugin MCP. |
| 11 | MCP OAuth lifecycle：start auth、callback、token refresh、revoke、needs reauth notification。证据：`mcpOAuth` preload、main OAuth callback server。 | Cradle plugin MCP injection 未见 OAuth token lifecycle 或 user reauth UI。 | Remote MCP adoption 会被认证能力卡住。 | `apps/server/src/modules/mcp-oauth`, with secret storage in `secrets`. |
| 12 | GitHub Copilot device flow 多账号与 Claude Subscription OAuth/quota/models。证据：`copilot`、`claudeSubscription` preload。 | Cradle 有 provider secrets/profile，但没有 Copilot/Claude subscription first-class OAuth/account flows。 | 这不是 API key provider；需要账号生命周期、token refresh、quota/model fetch。 | Provider owner: `profiles/providers` owns account configs; `secrets` owns token material. |
| 13 | 更广 provider taxonomy：DeepSeek、Google、Azure、OpenRouter、AIHubMix、Moonshot、Kimi、Ollama、Volcengine、Z.ai 等 first-class provider。证据：Alma package/main provider enum 与 URLs。 | Cradle provider taxonomy 当前主要是 `openai-compatible` 与 `anthropic`；部分可通过 OpenAI-compatible 兜底，但无 first-class config/metadata/health/model support。 | 兼容 URL 不等于 provider-owned UX、模型能力、pricing、auth defaults。 | `apps/server/src/modules/providers` owns taxonomy expansion。 |
| 14 | Plugin UI primitives：status bar、input box、quick pick、confirm dialog、plugin notification、theme apply、tool approval dialog。证据：Alma preload `pluginStatusBar`、`pluginInputBox`、`pluginQuickPick`、`pluginConfirmDialog`、`pluginTheme`。 | Cradle plugin SDK 有 panels/commands/routes/MCP/skills，但没有通用 plugin UI primitive bridge。 | 插件只能做 panel/command，难以做 Raycast/VS Code 式交互。 | `packages/plugin-sdk` defines contracts; `apps/web` owns UI host; `apps/desktop` owns native overlays only if needed. |
| 15 | Workspace/file snapshot-diff-rollback：create、snapshotFile、list、get、diff、rollback、cleanup。证据：Alma preload `snapshot`。 | Cradle 有 Git status/diff 和 chat snapshot，但没有 Git-independent workspace snapshot subsystem。 | 非 Git 文件、临时生成文件、agent edits 缺恢复点。 | `apps/server/src/modules/workspace-snapshots` owns Cradle workspace snapshots. |
| 16 | General document/media preview：PDF、DOCX、XLSX、PPTX、ZIP、audio、video、image preview。证据：Alma chunks `PdfPreview`、`DocxPreview`、`ExcelPreview`、`PptxPreview`、`ZipPreview`、`AudioPreview`、`VideoPreview`。 | Cradle 文件面偏文本、diff、tree、pack-codebase；未见通用文档/media preview pipeline。 | Agent workspace 常见附件无法在 Cradle 内审阅。 | `apps/web/src/features/file-preview`; server owns safe file read/range if needed. |
| 17 | WebSearch/WebFetch 产品化：hidden browser、Google/Xiaohongshu debug windows、cookie import/export/clear/sync、Readability、Markdown 转换。证据：`webSearch`/`webFetch` preload、main route/cookie code。 | Cradle 有 in-app browser panel 和 provider web tools信号，但没有 WebSearch/WebFetch 管理面、cookie tooling、readability fetch pipeline。 | 浏览器面板不等价于 agent-readable web fetch/search service。 | `apps/server/src/modules/web-fetch` + `apps/web/src/features/web-search`; browser plugin may provide rendering/session support. |
| 18 | Playwright/Chromium BiDi runtime install/status：用户可检查和安装 Playwright。证据：`playwright` preload、Alma package `playwright`/`chromium-bidi`。 | Cradle `@playwright/test` 是测试依赖；browser-use 是 Electron webview debugger，不是 Playwright/BiDi runtime manager。 | 自动化覆盖面和依赖生命周期不同。 | `plugins/browser-use` may own in-app browser; separate `browser-automation` owner for Playwright/BiDi if adopted. |

### 部分覆盖但不等价

| # | Alma 有的能力 | Cradle 当前状态 | 不等价点 | 建议 owner / namespace |
| --- | --- | --- | --- | --- |
| 19 | Activity Recorder：屏幕截图、OCR、输入事件、browser URL/tab title、app focus、session 分析、digest/report、semantic search、suggestions、tray 启停。 | Cradle Chronicle 有 screen capture、Vision OCR、artifact、memory pipeline、settings UI。 | Chronicle 目前更像屏幕 OCR/memory；缺输入事件、browser URL/tab、per-app focus、digest/report/suggestions/tray 控制的完整产品闭环。 | Chronicle 继续拥有 passive context；不要放进 provider/profile。 |
| 20 | Local Transformers + sqlite-vec 向量记忆：本地 embedding 模型下载、rebuild、semantic recall diagnostics。 | Cradle Chronicle schema 预留 `embedding`，search 有 thread FTS；未见 `@huggingface/transformers` 或 `sqlite-vec` 实现。 | 预留 resource 类型不等于本地向量索引。 | Chronicle owns local model resources and vector index. |
| 21 | Computer Use：OS app/window 状态、截图、click/drag/key/type/scroll、launch/raise、approval、action log、PiP、MCP auto registration。 | Cradle browser-use 能控制内置 browser webview；Chronicle 能屏幕 OCR。 | Cradle 不能自动操作任意 OS app/window，也没有 Computer Use approvals/PiP/action log。 | New `apps/server/src/modules/computer-use` only if Cradle wants OS automation; desktop owns native bridge. |
| 22 | Chrome Relay：外部 Chrome launch、tabs、DOM、screenshot、click/type/upload、back/forward/detach。 | Cradle browser panel 是内置 webview；browser-use MCP 控制这个 panel。 | 外部 Chrome profile、upload、remote relay、cookie/session 语义不同。 | Keep `plugins/browser-use` for in-app browser; separate external browser connector if needed. |
| 23 | Live Coding / Strudel：独立 livecoding window、CodeMirror、Strudel/Tone 音频/可视化。 | Cradle 有 PTY/TUI、chat diff、workspace editor，但无 live coding/music/audio runtime。 | Terminal 不等价于可视化 live coding surface。 | If adopted, feature owner should be `apps/web/src/features/live-coding`; audio runtime resources must be explicit. |
| 24 | Network proxy settings：HTTP/HTTPS/SOCKS5、auth、test、prefer IPv4、timeout、retry、custom user agent。 | Cradle provider configs可设置 base URL/API key；未见全局网络 proxy UI/diagnostics。 | 对桌面 app 和 connectors 的统一网络策略缺失。 | `apps/server/src/modules/network` or `preferences` with clear owner; connectors read it, do not own it. |
| 25 | Data backup/cloud sync：按 settings/providers/threads/promptApps/prompts/workspaces/mcpServers/themes/memories 分类导入导出、cloud sync snapshot。 | Cradle 有 DB、workspace、skills import/export 局部能力；未见全产品 backup/cloud sync。 | 缺用户级迁移/备份边界。 | `apps/server/src/modules/export` or `backup`; each namespace contributes serializer. |
| 26 | App lifecycle settings：auto start、start minimized、minimize/close to tray、hide dock icon、app icon switch、CLI wrapper/PATH repair。 | Cradle 有 desktop tray、Velopack update、server fork；未见完整 lifecycle settings UI/API。 | Desktop shell 功能存在但用户设置面不完整。 | `apps/server/src/modules/preferences` stores settings; `apps/desktop` applies native behavior. |
| 27 | Product telemetry/crash reporting：Sentry Electron、PostHog provider、analytics setting。 | Cradle 有 local observability 和 Langfuse tracing，但未见 Electron crash reporting/product analytics。 | 面向开发调试的 observability 不等价于 release crash/product analytics。 | `apps/desktop` owns crash reporting; `apps/web` owns product analytics opt-in; privacy setting in preferences. |
| 28 | Cron/heartbeat/channel status：cron jobs、heartbeat service、group status、Telegram/Discord/Feishu 投递。 | Cradle automation 支持 RRULE runs；session-await 支持 GitHub signals。 | 泛化 automation 有基础，但没有 channel heartbeat/status 投递。 | `automation` owns schedule/run; `channels` owns delivery/status. |

## 推荐优先级

我建议不要按 Alma 全量照搬，而是按 Cradle 的所有权原则分三波：

**第一波：补 Cradle agent workspace 的自然短板**

1. MCP management UI + MCP OAuth：现有 runtime 已能读 plugin MCP registry，补管理面和 OAuth 会直接提升 agent tool ecosystem。
2. Workspace snapshots：和 agent edits、安全恢复、diff review 强相关，能补 Cradle 当前 Git 之外的恢复能力。
3. General file preview + lightbox：workspace 和 chat artifacts 都能受益。
4. Prompt Apps：可以复用 chat-runtime、profiles、skills，把 automation 和用户可运行 mini-app 分清 owner。
5. Quick Chat：Cradle desktop app 已有 tray 和 local server，补一个低摩擦入口价值高。

**第二波：补桌面 native 与外部连接器**

6. Native/custom notification center。
7. Third-party channels + people/contact profile。
8. Unified permissions manager。
9. Network proxy settings。
10. App lifecycle settings。

**第三波：补本地智能与自动化平台**

11. Whisper/ASR + TTS。
12. Chronicle vector memory with local embeddings。
13. Activity Recorder v2：输入事件、browser URL/tab、app focus、digest/report/suggestions。
14. WebFetch/WebSearch service。
15. Computer Use / external browser automation，需要单独安全设计和 approval model。

## 不建议优先追的点

- 只为了对齐 Alma 而引入 Sentry/PostHog。Cradle 先把本地 observability 和隐私边界稳住更重要。
- 立即做 Strudel/livecoding。它是有趣能力，但和 Cradle 当前 agent workspace 主线弱相关。
- 把所有 provider 都做成 first-class。可以先补最常用且配置差异大的 provider；其余继续走 OpenAI-compatible + models.dev enrichment。
- 把 channels 写进 workspace/session namespace。Channel connector 应读 workspace/session，自己的 mapping 和 credentials 放到 channel owner 下。

## 验收复核

本报告满足用户的硬性要求：

- 已使用 `multi-work` 拆成 4 个并行节点，并保留 4 个子交接文件。
- 已盘点 Alma 主要功能地图。
- 已盘点 Cradle 当前已覆盖能力，避免把已有能力误算为缺口。
- 已给出 28 个缺口/弱覆盖点，其中前 18 个是明确缺失，超过用户要求的至少 15 个。
- 每个缺口都包含 Alma 证据、Cradle 当前状态、不等价原因和 owner/namespace 建议。

## 后续可执行方向

如果要进入实现规划，我建议先从 `MCP management UI + OAuth`、`Workspace snapshots`、`Prompt Apps` 三个点中选一个。它们最贴近 Cradle 当前架构，且能复用现有 server/web/desktop/plugin 基础，不需要一开始就引入高风险 OS automation 或外部 IM connector。
