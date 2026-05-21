# Cradle Web 前端与产品能力审计交接

## 范围

本交接文件只审计 Cradle 当前工作树中的 Web 前端与产品可见能力，重点路径是 `apps/web`，并补充读取 `docs/design-system`、`docs/draft-solutions`、`docs/ROADMAP-agent-experience.md` 与计划文件 `docs/exec-plans/20260521-07-alma-cradle-gap-analysis.md`。本节点没有修改业务代码，没有审计 Cradle 后端实现细节，也没有直接打开 Alma 构建产物逐项反编译；相对 Alma 的判断只使用计划文件和 Cradle 文档中已经可见的 Alma 信号。

本文件的目标是让后续归并者不打开原始源码，也能理解 Cradle 当前 Web 产品表面：有哪些入口、哪些能力已经可见、哪些只是文档或路线图信号、哪些相对 Alma 暴露出产品弱项。

## 已检查证据

- `docs/exec-plans/20260521-07-alma-cradle-gap-analysis.md`：确认本研究目标是找出 Alma 有而 Cradle 没有或未形成等价体验的能力；计划文件中可见 Alma 信号包括多 renderer 入口、notifications、lightbox、prompt-app-runner、livecoding、gallery、settings、share、本地 Whisper、Transformers、文档预览、Discord/飞书/微信、Playwright、Chromium BiDi、MCP、ACP、sqlite-vec、Strudel、PostHog、Sentry、electron-updater、native notifications。
- `apps/web/package.json`：确认 Web 技术栈是 React 19、Vite、Zustand、TanStack Query、`@cradle/streamdown`、Tiptap、xterm、`@pierre/diffs`、`@pierre/trees`、motion、Lobe icons、`ai` SDK、Base UI 风格组件等。
- `apps/web/src/app.tsx` 与 `apps/web/src/tabs/registry.ts`：确认主应用是 tab-first shell，内置 tab 类型为 `home`、`chat`、`new-chat`、`kanban-board`、`workspace-detail`、`usage`、`plugin-panel`；settings 是 active tab 上的 overlay，而不是独立 route。
- `apps/web/src/features/*/README.md`：读取全部 feature README，作为各模块 owner 和 intended surface 证据。
- 关键实现文件：`features/chat/chat-view.tsx`、`features/chat/composer.tsx`、`features/chat/message-bubble.tsx`、`features/chat/tool-ui-classifier.ts`、`features/settings/settings-content.tsx`、`components/layout/right-aside.tsx`、`features/devtool/ipc-devtool-page.tsx`、`features/browser/browser-panel.tsx`、`features/new-chat/new-chat-page.tsx`、`features/home/home-dashboard.tsx`、`features/kanban/index.tsx`、`features/usage/usage-dashboard.tsx`、`features/workspace/file-tree.tsx`、`features/agent-management/agent-runtime-settings.tsx`、`features/agent-management/agent-detail.tsx`、`features/skills/skill-manager.tsx`、`features/session-await/await-panel.tsx`。
- `packages/streamdown` 文件清单：确认 Cradle 有自有流式 Markdown/动画渲染包，包含 block queue、smooth content、rehype stream animation、presets、scroll helpers、profiler。
- `docs/design-system/DESIGN.md`：确认 Cradle 视觉语言目标是 desktop AI environment、two-tone chrome、spring-everywhere animation，并定义 composer、message bubble、popover、tab pill、layout 尺寸等 token。
- `docs/design-system/ai-assistant-ui-reference.md`：确认 Cradle 设计参考包含 Linear、Raycast、Cursor、Copilot 的 chat surface、slash command、tool call、diff、quick AI 和 sidebar patterns。
- `docs/draft-solutions/done/streamdown-alma-lobe-fusion.md`：确认 Cradle 已研究 Alma 的 streaming text visual richness，并把 Alma 的 blur reveal、cursor trail、block glow、`Intl.Segmenter`、delayed animated wrapper 等作为 Streamdown fusion 参考。
- `docs/draft-solutions/done/thread-search.md`：确认 thread search 的中文分词和高亮方案已经形成过设计草案。
- `docs/draft-solutions/done/codex-chronicle-spec.md` 与 `docs/ROADMAP-agent-experience.md`：确认 Chronicle、session await/resume、agent plans、elicitation、sandbox/VFS、multi-agent 等有产品路线或局部 UI，但并非全部落地。

## Cradle Web 总体产品结构

Cradle Web 是一个桌面式 AI 工作台，而不是单页 chat。它的主壳层由侧边栏、tab canvas、顶部 header、底部 footer/panel、右侧 aside 组成。tab runtime 由 `@cradle/tabs-next` 驱动，启动时至少保留一个 pinned home tab，并采用 activity-pool 渲染策略，最多保留多个活跃 tab mounted。URL 与 tab store 做 hash-based sync。

当前稳定产品入口包括：

- Home dashboard：工作区、最近会话、自动化 registry 入口、全局搜索、快速动作卡片。这里也存在部分 mock 的 pending run 与 artifact 展示，不能视为完整后端能力。
- New Chat：新会话启动页，选择 runtime、provider profile、model、thinking effort、workspace，支持 quick action prompt 与最近会话。
- Chat：会话阅读与输入主表面，支持流式消息、tool call 渲染、reasoning、approvals、await banner、右侧 aside、token capacity indicator、scroll minimap。
- Workspace detail：工作区详情页，编辑 `AGENTS.md`、workflow rules、workspace skills，并带 workspace 内 capsule composer。
- Kanban board：Issue-owned board/list/detail UI，包含 issue metadata、状态、优先级、milestone、relations、sub-issues、activity、agent delegation controls。
- Usage dashboard：token/cost 统计、年度 heatmap、sparkline、按 model/agent breakdown。
- Plugin panel：按 owner-scoped panel id 渲染 Web plugin panel。
- Settings overlay：appearance、providers、agents、Jarvis、Chronicle、skills、desktop update。
- Devtool 独立窗口：observability、server health、memory、tabs runtime、plugins diagnostics。

## Feature 库存

### Agent 与 Provider

`features/agent-management` 与 `features/agent-runtime` 共同构成 provider/profile/agent identity 管理面。Settings 中的 Providers 页面支持添加 provider、搜索 provider、启停 provider、编辑 provider detail、管理模型可见性、自定义模型与 registry 映射。Agents 页面支持 agent identity、avatar、description、system prompt、runtime kind、provider/model/thinking、Claude Agent model aliases、CLI TUI executable/args/env，以及 agent-private skills。

Runtime options 在 agent detail 中包括 `standard`、`claude-agent`、`codex`、`cli-tui`。New Chat 和 workspace capsule composer 还出现 `jar-core`、`acp-chat` 类型签名，但当前前端可见的 agent detail runtime UI 主要是前述四类。

Provider 能力是 Cradle 自己的 agent-runtime namespace。Cradle 前端没有表现为 Alma 式“AI Provider Management Desktop App”的完整 provider marketplace 或多 provider 监控页，但 provider/profile/model 的基础设置面已经存在。

### Chat

Chat 使用 server SSE 作为流式更新来源，前端通过 React Query 读取 canonical snapshot，再投影到 Zustand。`useChatSession` 负责 hydration、reload/recovery、streaming response、stop、server-owned cancellation 后刷新。`sse-chat-transport` 与 `chat-streaming-handler` 处理 sequenced part-level delta。

消息渲染包括：

- assistant markdown 由 `@cradle/streamdown` 渲染，支持 streaming animation preset、granularity 和 cursor preference。
- reasoning block 可折叠展示。
- tool call block 基于 classifier 输出稳定 UI category。
- edit file tool 可以用 `@pierre/diffs/react` 展示 multi-file diff，支持 split/stacked layout。
- subagent messages 按 parent tool call 分桶，折叠到对应 tool call 下。
- 执行阶段在非 streaming 时可折叠为 `Show execution details`，最终答复单独显示。
- 消息复制按钮只在非 streaming 且有纯文本时出现。
- chat minimap 在右边缘显示消息条、阅读进度、hover preview、click/drag scroll。

Tool UI classifier 当前能识别：`file-read`、`file-diff`、`notebook-diff`、`terminal`、`search`、`web`、`subagent`、`task-control`、`todo`、`plan`、`question`、`mcp`、`worktree`、`generic`。这说明 Cradle 前端已经为 agentic coding workflow 的工具轨迹做了较细投影，尤其是文件读写、terminal、search/web、MCP、worktree 与 user question。

Chat 还集成 pending approval inline cards；右侧 Feed/Await 能展示 session awaits；chat 底部可在 awaiting 时显示 banner 并跳转右侧 panel。

### Composer

Chat composer 是 rich textarea，但不是 Tiptap editor。它支持：

- `@` 文件路径 mention，使用 workspace files 和 fzf fuzzy search。
- workspace file drag/drop，把文件树拖入 composer 后插入可消费的路径文本。
- runtime-native slash command autocomplete，数据来自 `/chat/sessions/{sessionId}/capabilities`，支持 fuzzy search、command description、argument hint，并允许 raw `/command args` send-through。
- send/stop icon action。
- token usage indicator：如果 session 绑定的 provider/model 有 context window，则显示当前 token 与 context window 的圆形进度；否则只显示 token 数。
- 外部 toolbar slot 与 context bar slot，用于 New Chat、workspace capsule、provider/model selector 复用。

New Chat composer 的 `Attach file` 按钮存在 UI，但从当前实现看只是按钮，没有看到实际文件选择或 attachment 管线。Chat composer 支持 workspace file path/drop，不等同于 Alma 可能存在的通用附件、图片、文档 preview 或 lightbox。

### Rendering / Markdown / Editor

Cradle 自有 `@cradle/streamdown` 已经存在，并且 Web message bubble 直接使用。包结构显示其支持 block queue、smooth content、rehype stream animation、presets、scroll、profiler、code block streaming、citation popover 和 error boundary。设计草案明确借鉴 Alma 的 streaming visual layer，但当前前端直接可见的保证是 Streamdown 已产品化用于 chat markdown，具体 Alma 式 cursor trail/block glow 是否完全落地需要继续打开包实现验证。

Workspace detail 和 shared editor 使用 Tiptap-based Markdown editor，支持 slash command、bubble menu、heading id、Shiki code block、code language selector。该 editor 用于 `AGENTS.md`、workflow rules、issue description 等结构化文本编辑，不是 chat composer 的主输入。

### Files / Workspace

Workspace UI 包含：

- 侧边栏 workspace 列表、添加工作区、删除工作区、session grouping。
- session rename、pin/unpin、copy as Markdown、delete、drag payload。
- right aside 文件树，使用 `@pierre/trees`，展示 workspace files、Git status annotations、search、selection、context menu、copy absolute/relative path、Pack & Copy to AI。
- 文件树支持把 workspace file path 作为 DataTransfer payload 拖到 chat 或 TUI。
- workspace detail 可以 inline rename workspace，查看/编辑 `AGENTS.md`，编辑 global/per-agent workflow rules，管理 workspace skills。
- `pack-codebase` dialog 可配置 format、compression、scope path、pattern filters，并把结果写到 clipboard。
- browser fallback directory picker 在非 Electron 环境下可用；Electron 下使用 native directory dialog。

当前没有看到 Alma 式 gallery/lightbox/document preview 的等价 Web 产品面。Cradle 的 file surface 更偏 coding workspace 文件树、context handoff 与 AI prompt packing。

### Settings

Settings 是 active tab canvas 上的 overlay，当前 section map 包括：

- `appearance`：主题切换。
- `providers`：Agent Runtime provider settings。
- `agents`：Agent identity 列表与详情。
- `jarvis`：系统助手 Jarvis 的 provider/model/thinking 配置。
- `chronicle`：Chronicle settings，包括 capture 开关、runtime status、model selection、本地模型资源类别、capture timeline、memories 与 memory search。
- `skills`：全局 skills 管理。
- `desktop`：Desktop update settings，通过 Electron preload/IPC 管理 Velopack update 状态、检查、下载与应用。

Settings 里没有看到通知中心、share target、第三方 IM 集成、telemetry opt-in/out、voice/audio ASR 设置等独立产品面。

### Devtool

当前可执行 devtool 页面是 `/devtool` 独立窗口，tab 包括：

- Observability：读取 `/observability/events` 与 `/observability/incidents`，列表展示 kind/time/source/code/severity/session/run，详情显示 JSON payload，可 clear 本地 store。
- Server Health：每 10 秒读取 `/health`，展示 status、uptime、heap、RSS、external、timestamp。
- Memory：读取 renderer performance memory 与 web vitals，展示当前 heap、recent trend、vitals。
- Tabs：通过 `@cradle/tabs-next` debug stream/BroadcastChannel/localStorage 展示 tab runtime snapshot、metrics、mounted tabs、contexts，并可 refresh/reset metrics。
- Plugins：展示 plugin discovery、runtime layer status、topology graph、client panel/command registrations，并能执行 command diagnostics。

`features/devtool/README.md` 提到 `ipc`、`acp`、`agent-context` 目录，但当前 `apps/web/src/features/devtool` 文件树中没有对应源码目录；因此这些只能算文档残留或未落地信号，不能当作当前 Web 产品能力。

AppHeader 资源 popover 不是 devtool 主页的一部分，但它在 devtool/resources 中实现，显示 renderer、server、CLI TUI、bottom panel、Chronicle 的资源占用和 partial endpoint failure warning。

### Browser / Webview

Electron-only browser panel 存在。它支持最多 5 个 embedded webview tab，包含 New Tab、close、back/forward/reload、URL input、favicon/title/loading 同步、`persist:browser` partition，以及脚本注入 preset，目前可注入 React Scan。非 Electron 环境下该 panel 返回 null。

这与 Alma 计划信号中的 Playwright/Chromium BiDi 不是同一层能力。Cradle 前端有人工可见的 embedded browser panel，但没有看到 Playwright-style browser automation UI、record/replay、BiDi session inspector 或 browser task gallery。

### Git / Issue / Await

Right aside 包括 Files、Git、Issue、Feed 四个 tab。

Git panel 支持 branch status、ahead/behind、fetch、branch picker、checkout/create branch、virtualized commit graph、Git status annotations。Header breadcrumb 也能显示 Git branch control。

Issue/Kanban 是较完整的 product surface：board/list/detail、status manager、filters、sorting、multi-selection、bulk status/priority update、peek panel、keyboard navigation、create issue、issue context menu、properties、activity timeline、relations、sub-issues、agent prompt input、agent session panel、chat session linked issue aside。

Session Await UI 目前聚焦 GitHub：可以为 active session 创建 `github-ci` 和 `github-review` await，支持 repository detection、target parsing、PR number inference、check run/status tree、review status、pending badge、live refresh。Roadmap 中更泛化的 await/resume runtime、external source registry、agent registration contract、awaiting badges 等属于进行中或计划，不应全部视作已完成。

### Skills

Skills Manager 提供 filesystem-first 管理界面，覆盖 `global`、`workspace`、`agent` 可写层，并展示 `legacy`、`builtin` 只读/继承层。能力包括 inventory、搜索、scope filter、详情、create/edit/delete、export、import dialog。本模块明确遵守 Cradle namespace：可展示 `.agents/skills` 标准位置，但 Cradle-only 写入走自己的层。

Skills 已是 Cradle 相对强项。它不是 Alma 计划信号中的通用 prompt app runner，但可以为 agent runtime 提供稳定输入层。

### Chronicle

Cradle Web 有 Chronicle settings surface：capture toggle、runtime status、model selection、本地模型资源类别、timeline、memories、memory search。文档中的 Chronicle spec 描述了被动屏幕录制、OCR、recursive summary、memory pipeline。前端 README 表示首个可用本地路径是 screen capture + OCR；audio VAD、ASR、speaker、embedding resources 默认 optional，除非 server 返回更严格状态。

与 Alma 的本地 Whisper、Transformers、sqlite-vec 信号相比，Cradle Web 只显示 Chronicle 资源状态和 memory search，没有看到在 Web 中完整暴露本地 ASR、speaker diarization、embedding/vector index 管理、模型下载/缓存管理等产品面。

### Automation

Home dashboard 集成 automation registry/viewer。`features/automation` 提供 definitions、latest run state、run history、chat/backend run links、recipe snapshots、inputs、artifacts、run-now 操作。实现使用临时本地 fetch boundary 到 `/automations` endpoints。

这说明 Cradle 有 agent-authored automation 的前端表面，但和 Alma 的 prompt-app-runner/livecoding/share/gallery 等是否等价仍不确定。当前 Cradle automation 更偏 registry/run viewer，不像独立 app runner 多窗口 renderer。

### TUI / Terminal

`features/tui` 使用 xterm.js，支持 CLI TUI provider sessions 和 bottom-panel shell。PTY lifecycle 走 HTTP，live channel 走 WebSocket，支持 snapshot/output/exit/ping、input/resize、reconnect、queued sends。Terminal theme 从 CSS variables 派生，macOS shortcut 由 keyboard handler 转 ANSI sequence，workspace file drop 可以插入 shell-safe text。

这是 Cradle 的强 coding-agent 能力面。它不等价于 Alma 的 livecoding renderer，除非后续 Alma 节点证明 livecoding 只是 terminal-like coding session。

### Search

Global search 是 command-palette-style dialog，聚合 thread/file/issue/command 结果。Thread search 使用主进程 ThreadSearchEngine，README 明确是 jieba-tokenized，结果按 workspace 分组并高亮标题和消息片段。File result 可打开 workspace detail tab 并复制相对路径。

这不是 Alma 明确可见信号中的重点，但作为 Cradle 产品面应保留：全局搜索已经相对成熟。

## 相对 Alma 可见信号的缺口或弱项

以下不是最终缺口清单，只是从 Cradle Web 侧看到的“缺失、弱化或证据不足”的候选点，供主 Agent 与 Alma A/B/C 节点交叉复核。

1. 多 renderer / 多窗口产品面弱。计划文件显示 Alma 有 `notifications.html`、`lightbox.html`、`prompt-app-runner.html`、`livecoding.html`、`gallery.html`、`settings.html`、`share.html` 等独立 renderer 入口。Cradle Web 当前主产品是 single shell + tabs，devtool 是独立窗口，embedded browser 是 panel；没有看到 notifications、lightbox、gallery、share、prompt app runner 这些独立用户窗口。
2. 通知系统弱。Cradle 有 unread session activity、await badge、toast provider，但没有看到 Alma 式 native notifications 或独立 notifications renderer 的等价前端。
3. Gallery/lightbox/media preview 缺失。Cradle 的文件树、workspace detail、diff preview 很强，但没有看到面向图片/媒体/文档的 gallery 或 lightbox 产品面。
4. Share surface 缺失。Cradle session 可 copy Markdown，file tree 可 copy path，pack-codebase 可 copy to clipboard，但没有看到 Alma `share.html` 对应的分享流、share target 或跨应用 share UI。
5. Prompt app runner 缺失或未显性。Cradle 有 automation registry、slash commands、skills 和 plugin panel，但没有看到一个用户可运行 prompt app 的独立 runner surface。
6. Livecoding 等价不明确。Cradle 有 CLI TUI、terminal、chat tool diff、kanban delegation，但没有看到明确叫 livecoding 的协作/实时代码演示窗口。
7. Browser automation 弱。Cradle embedded browser 支持 webview 导航和 React Scan 注入，但没有看到 Playwright、Chromium BiDi、record/replay、自动网页任务面板。若 Alma 的 Playwright/BiDi 是产品能力，这会是缺口。
8. 本地语音/ASR 产品面弱。Chronicle settings 文档提到 audio VAD、ASR、speaker resources optional；前端没有看到 Whisper/transcription/voice input/voice memo UI。若 Alma 本地 Whisper 是真实功能，这是缺口。
9. Local Transformers / model resource management 弱。Cradle Chronicle 可显示本地模型资源类别，但 Web 没有看到 HuggingFace Transformers 模型下载、缓存、启停、推理任务管理的完整表面。
10. Vector memory / sqlite-vec 表面弱。Chronicle memory search 存在，但没有看到 vector index 管理、embedding model 选择、memory graph、semantic recall diagnostics。若 Alma 使用 sqlite-vec 形成用户可见 memory/search 能力，Cradle 只算部分覆盖。
11. 第三方 IM 集成缺失。计划文件列出 Discord、飞书、微信信号。Cradle Web 没有看到 Discord/Lark/WeChat 设置、消息桥、通知桥或分享桥。
12. Telemetry/observability 方向不同。Cradle 有本地 devtool observability，但没有看到 Sentry/PostHog 用户级 analytics/telemetry 设置面。如果 Alma 有 Sentry/PostHog 产品或运营诊断能力，Cradle Web 当前没有等价用户设置。
13. ACP 面板文档强于实现。Cradle tool classifier 能识别 `mcp`，runtime type 里出现 `acp-chat`，devtool README 提到 ACP event inspection，但当前 devtool 页面没有 ACP tab。若 Alma ACP 是可见功能，Cradle 证据不足。
14. MCP 可见管理弱。Chat tool classifier 可以把 MCP tool calls 分类为 `mcp`，但没有看到 MCP server 管理 UI、权限、连接状态、tool catalog 或 per-agent MCP 配置。
15. Elicitation / structured agent activity 仍偏 roadmap。Chat 能渲染 question tool 与 approval card，Roadmap 中 L3 的 thought/action/elicitation/ephemeral activity 尚未落地为统一消息模型。若 Alma 有成熟的 agent activity/progress UI，Cradle 现在是分散实现。
16. Sandboxed diff accept/reject 缺失。Cradle chat 能预览 file diff，但 Roadmap L4 的 VFS、diff preview panel、accept/reject/partial accept、shell sandbox 是计划。若 Alma 有可审阅落盘流程，Cradle 只覆盖展示，不覆盖安全执行闭环。
17. 附件/文档 preview 弱。New Chat 有 Attach file 按钮但当前实现未见实际管线；chat 支持 workspace path mention/drop，不等于通用 file attachment、PDF/doc preview、image preview 或 lightbox。
18. Native desktop update 已有但实现所有权在 Desktop。Settings 中有 Velopack update UI；计划文件 Alma 信号是 `electron-updater`。这不是缺口，但需要 C 节点确认 desktop update 的后端/preload 是否完整。

## 不确定性

- 本节点没有直接检查 Alma `out/renderer` 和 `out/main`，因此 Alma 能力仅来自计划文件和 Cradle 内部 Alma fusion 草案。最终差异报告必须用 ExplorationA/B 的 Alma 正向证据复核。
- `features/*/README.md` 有一些与当前文件树不完全一致的条目，例如 devtool README 提到 `ipc`、`acp`、`agent-context`，但当前源码只看到 observability/health/memory/tabs/plugins。本文把源码实现优先于 README。
- `@cradle/streamdown` 包存在并被 chat 使用，但没有逐行审计 CSS/preset 是否完全实现 Alma fusion 草案列出的所有 visual effects。当前只能确认 Streamdown 是已落地包，不能确认每个 Alma visual detail 都已落地。
- Home dashboard 中 pending runs 和 artifacts 明确是 mock data；不能把它们当作完整后端支持。
- Chronicle 前端 settings 已存在，但后端资源是否真的支持 screen capture/OCR/memory search 需要由后端/桌面节点确认。本文件只说明 Web 表面。
- `acp-chat`、`jar-core` 在部分 TypeScript 类型或 composer payload 中出现，但没有看到对应完整 Web route 或 settings 面。需要主 Agent 判断它们属于后端能力、实验能力还是残留类型。

## 简明能力库存

Cradle Web 已有的强能力：

- Tab-first desktop shell：home、chat、new-chat、kanban、workspace-detail、usage、plugin-panel。
- Agent/profile/provider/model 管理：provider CRUD、model visibility、自定义模型、agent identity、runtime、system prompt、CLI TUI config、Claude aliases。
- Coding-agent chat rendering：SSE streaming、Streamdown markdown、reasoning、tool call classification、diff preview、subagent folds、approval cards、await banner、scroll minimap、token/context indicator。
- Composer：file mention、workspace file drag/drop、runtime-native slash commands、provider/model/thinking toolbar、send/stop。
- Workspace/file：workspace CRUD、session grouping、file tree、Git annotations、copy path、Pack & Copy to AI、`AGENTS.md` 和 workflow rules editor、workspace/agent/global skills。
- Git/Issue/Kanban：branch control、fetch/checkout/create branch、commit graph、board/list/detail、status/priority/milestone/filter/relation/sub-issue/activity/delegation。
- Session Await：GitHub CI/review await composer、live check/review status、right aside Feed、chat awaiting banner。
- Skills：filesystem-first layered inventory、create/edit/delete/import/export、global/workspace/agent writable scopes。
- Devtool：observability events/incidents、server health、renderer memory/web vitals、tabs-next runtime diagnostics、plugin diagnostics。
- Usage：tokens/cost summary、year heatmap、sparkline、by model/agent breakdown。
- Browser/TUI：Electron webview panel with navigation/script injection；xterm-based CLI TUI and bottom shell over PTY WebSocket。
- Chronicle settings：capture/status/model/resources/timeline/memories/search UI。
- Design system：two-tone chrome、tokenized primitives、motion-first desktop AI visual language。

Cradle Web 当前弱或缺的 Alma-like 产品面：

- notifications、gallery、lightbox、share、prompt app runner、livecoding 这类独立 renderer/window surface。
- Native notification center 与 cross-app share flow。
- General attachment/media/document preview。
- Browser automation UI around Playwright/BiDi。
- Voice/Whisper/ASR/audio user flows。
- Local Transformers/model cache/inference management。
- Vector memory/index diagnostics beyond memory search。
- Discord/飞书/微信 integration surfaces。
- MCP server/tool catalog management and visible ACP diagnostics。
- Unified structured activity/elicitation UI。
- Sandboxed execution with accept/reject/partial accept workflow。
