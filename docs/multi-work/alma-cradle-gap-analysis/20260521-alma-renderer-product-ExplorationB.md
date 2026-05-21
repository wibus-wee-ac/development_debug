# Alma Renderer 与用户可见产品能力交接

## 范围

本交接只审计本地打包产物中的 Alma renderer 与用户可见产品面，不使用网络、不推断 upstream 当前状态，也不对 Cradle 是否已有等价能力做判断。证据来源限定为 `/Users/wibus/dev/safe-research/Alma-source/package.json` 与 `/Users/wibus/dev/safe-research/Alma-source/out/renderer`。由于这是构建后产物，结论以“打包进 renderer 且有入口、组件、API 调用或 UI 文案支撑”为准。

## 已检查证据

- `package.json`：确认应用名为 `alma`，版本 `0.0.792`，描述为 `AI Provider Management Desktop App`，Electron 主入口为 `out/main/index.js`。依赖中有 `ai`、多家 `@ai-sdk/*` provider、`@modelcontextprotocol/sdk`、`@mcpc-tech/acp-ai-provider`、`@uiw/react-codemirror`、`@xterm/*`、`react-pdf`、`mammoth`、`xlsx`、`jszip`、`modern-screenshot`、`posthog-js`、`@sentry/electron`、`alma-notifications`、`@strudel/web`、`@fugood/whisper.node`、`@huggingface/transformers` 等能力信号。
- `out/renderer/*.html`：确认 8 个独立 HTML 入口，每个入口加载不同 chunk，并共享主题、平台、观测与基础 UI 资产。
- `out/renderer/assets/*`：重点读取了 `index-B3ClzaVV.js`、`PluginNotificationListener-TIVFr7nm.js`、`ExecutionHistory-BVxzzVHu.js`、`prompt-app-runner-Cu4xnzQc.js`、`share-AF-wBf-y.js`、`gallery-DQoRj7hd.js`、`lightbox-BI1AnNNa.js`、`notifications-BVczgDe3.js`、`livecoding-DNYjSLeL.js` 以及命名预览器 chunk。
- 可读符号与 API 调用：重点提取了组件名、窗口桥接对象、`/api/*` 与 `/ws/*` 路径、设置页 tab、Prompt Apps 文案、工作区预览与 terminal WebSocket、Gallery/Lightbox API、Share IPC、通知交互逻辑。

## Renderer 入口

Alma renderer 不是单窗口应用，而是多个独立入口组成的桌面产品面：

- `index.html`：主应用入口，加载 `index-B3ClzaVV.js`。包含聊天、QuickChat、侧边栏、工作区、artifact、Prompt Apps 管理、插件通知、设置路由、onboarding、自动更新等主要产品面。
- `settings.html`：设置窗口入口，加载 `settings-Cw0JyfsZ.js`，实际设置页实现主要来自 `PluginNotificationListener-TIVFr7nm.js`。入口同时挂载 `SettingsWindow` 与插件交互弹窗。
- `notifications.html`：透明通知窗口入口，加载 `notifications-BVczgDe3.js`，有队列、声音、自动关闭、滑动关闭、清空全部等行为。
- `lightbox.html`：图片灯箱入口，加载 `lightbox-BI1AnNNa.js`，用于 Gallery 或聊天图片查看。
- `prompt-app-runner.html`：Prompt App 独立运行窗口入口，加载 `prompt-app-runner-Cu4xnzQc.js`。
- `livecoding.html`：Live Coding 独立窗口入口，加载 `livecoding-DNYjSLeL.js`，依赖 `useLiveCoding-BK3dX-nU.js`、CodeMirror 与音乐/可视化相关能力。
- `gallery.html`：图片 Gallery 入口，加载 `gallery-DQoRj7hd.js`，用于集中浏览生成或保存的图片。
- `share.html`：会话分享/导出入口，加载 `share-AF-wBf-y.js`，通过 IPC 接收分享数据并导出图片。

## 主应用产品面

`index-B3ClzaVV.js` 是最大 renderer chunk，包含以下明确用户功能：

- 聊天输入器：有 `ChatComposer`、模型选择、文件附件、语音输入、工作区选择、工具选择、技能选择、reasoning effort、incognito 开关等入口。工具与技能选择通过 `ToolSelectorAction`、`SkillSelectorAction`、`ReasoningEffortAction`、`IncognitoAction` 等组件暴露。
- 消息渲染：有虚拟化消息列表、响应引用/citation、代码块高亮、工具调用卡片、Bash 输出、任务工具块、审批卡片、待审批卡片、自动滚动、时间线等聊天体验。
- Prompt Apps：主应用内有 `PromptAppsManager`，可创建、编辑、启停、删除、排序 Prompt App；支持图标、描述、全局快捷键、字体大小、指定模型、tool selection、reasoning effort、incognito、是否期望图片结果、动态占位符与执行历史。
- Prompt App 占位符：编辑器支持 `text`、`textarea`、`select`、`number`、`checkbox`、`file`、`image` 等输入类型；文件/图片占位符支持 MIME accept、多文件或多图配置。
- Prompt App 运行：独立 runner 支持读取 app 定义、收集输入、上传图片/文件、生成 prompt、执行、流式接收结果、复制文本、打开聊天 thread、图片结果复制/保存/灯箱查看、执行历史重跑与删除。
- 工作区侧栏：有文件树、文件内容读取、二进制文件预览、隐藏文件开关、sidebar 状态持久化、workspace WebSocket 刷新。
- Workspace terminal：使用 xterm，支持多个 terminal session、创建、关闭、重启、按 thread 恢复、通过 `/ws/terminal/{sessionId}` 接收输出。
- Preview server：支持从工作区选择 HTML 文件、启动/停止预览服务、通过 `/ws/preview/{workspaceId}` 接收状态，预览状态在侧栏 tab 上有运行指示。
- Git/GitHub 工作区操作：renderer 调用包含 git status、diff、stage、commit、branch、stash、worktree、push/pull/fetch、rebase、conflict resolution、GitHub PR、CI logs 等 API。此处只说明 renderer 暴露了相应操作面，后端实现由其他节点审计。
- Artifact 面板：支持 code/html/react/mermaid/svg/script 等 artifact 渲染，以及 preview/code tab 切换。
- 自动更新 UI：有 `UpdaterDialog`，读取 `window.almaApp.getUpdateInfo()` 与 `onAutoUpdateStatus`，支持下载更新、显示下载进度、错误、重试、`quitAndInstall`。
- Onboarding/权限引导：主入口包含音频检查背景视频/音频、系统权限 onboarding、快捷键、设置状态保存。
- QuickChat：有独立快速聊天面，设置中可注入实时屏幕上下文、失焦隐藏、ambient click-through 模式，并有全局快捷键配置。
- 命令面板：有命令搜索入口，文案显示可搜索 threads、settings、actions，并包含深链到 terminal font、persist terminals 等设置项。

## Chunk 与 asset 反推出的产品能力

以下能力来自明确 chunk 名、组件名、API 路径或 UI 字符串，而非单纯依赖名：

- 多 provider 管理：`NewProvidersSettings` 中出现 OpenAI-compatible provider、预定义 provider、API key、base URL、models fetch、models storage、model options、capability override、pricing/test connection 等管理面。
- GitHub Copilot 与 Claude Subscription：设置里有 `GithubCopilotSettings` 与 `ClaudeSubscriptionSettings`，GitHub Copilot 支持 device code flow、多账号、保存/删除账号；Claude subscription 是否为完整功能需主进程证据补足。
- ACP provider：设置中有自定义 ACP provider，对用户暴露 provider name、ACP command、arguments，并提示会 spawn 本地 CLI process。
- MCP：`MCPSettings`、`MCPMarketplace`、`MCPInstalledServers`、`MCPServerEditDialog`、`MCPResourceViewer` 等组件显示 Alma 有 MCP marketplace、安装、编辑、OAuth badge、resource viewer 与客户端资源面。
- Prompts 与 Skills：有 prompts CRUD/reorder；skills 支持 refresh、打开 skills folder、按 bundled/personal/Claude Code/Codex CLI/marketplace/project 分类显示，另有 skill extraction 开关与最小 tool calls 阈值。
- Plugins：有安装/卸载/启停、权限开关、配置表单、更新检查、marketplace registry、从 URL/npm/local/marketplace 安装、打开 plugins folder。
- Hooks：`HooksSettings` 和 `AVAILABLE_HOOKS` 表明有 hook 配置与 reload/path 操作。
- Memory：有记忆启停、自动检索、query rewriting、max retrieved memories、similarity threshold、auto summarize、sleep card、记忆列表、搜索、手动新增、编辑、删除、清空、embedding 模型变更和 rebuild progress。
- Local embeddings：有 `/api/local-embeddings/models` 与 `/api/local-embeddings/download`，并与 memory embedding model selector 关联。
- Activity Recorder：设置页显示 Activity Recorder，包括状态、存储体积、OCR languages、输出目录、sessions、删除所有 recorded activity。文案明确包含 screenshots、OCR text、embeddings。
- Computer Use：设置页显示 strict approval、action logging、PiP、helper path、macOS permissions、approved apps、revoke approval。
- System Permissions：有权限检查和授予界面，涉及 accessibility 与 screen recording，强调读取 focused window 与 capture screen context。
- Channels：有 Telegram、Discord、Feishu、Weixin 设置；支持 channel workspace bindings，将 channel/chat 绑定到 workspace，确保 Bash/Read/Write 等工具在正确项目目录运行。
- People：有联系人/人物管理面，字段包括 Telegram ID、Discord ID、Discord username、Feishu ID、username、Markdown profile、avatar upload/remove。
- Whisper：设置页支持启用本地 Whisper、模型下载/删除、下载进度/速度/ETA、选择模型与语言。
- TTS：设置页支持 local Qwen3-TTS、ElevenLabs、OpenAI，支持本地依赖/模型 setup、下载进度、voice selection、API key、test voice。文案说明 TTS 主要用于 Telegram voice replies。
- Web Search/Web Fetch：设置页支持 Google 与 Xiaohongshu search engine、Google debug window、Xiaohongshu debug window、cookie export/import/clear、web fetch browser 打开 URL。
- Chrome Relay：设置页有 `ChromeRelaySettings`，具体用户功能需要主进程或相关 preload 证据补充。
- Theme/UI：支持 UI 字体、terminal 字体/字号/光标、word wrap、minimap、system caret、tool card 默认展开、labels、自定义主题编辑、base30/base16/simple colors、plugin theme card。
- Data：支持按类别导出/导入 Alma 备份，类别包含 settings、providers、threads、promptApps、prompts、workspaces、mcpServers、customThemes、memories；另有 cloud sync 状态、启停、push snapshot，标注为实验功能。
- Usage/RTK Savings：有 usage settings、activity calendar、daily savings chart、command breakdown、efficiency gauge、RTK savings settings，说明 renderer 有用量/节省统计展示面。
- Observability：多个入口初始化 observability，chunk 顶部写入 `SENTRY_RELEASE`，主入口和 settings 包含 `ConditionalPostHogProvider` 与 analytics event tracking。

## 预览器与渲染器

Alma renderer 的文件预览和 artifact 渲染面较完整：

- 文件预览 lazy chunk：`ImagePreview-BDji9yUA.js`、`VideoPreview-BlIzGnaD.js`、`AudioPreview-D87boiPT.js`、`PdfPreview-DKfSPVbr.js`、`DocxPreview-BiD6McKo.js`、`ExcelPreview-CeU9qBWw.js`、`PptxPreview-BzcEP_oH.js`、`ZipPreview-C30nMos8.js`、`UnsupportedPreview-KJozHNG1.js`。
- 图片预览：配合 `lightbox.html` 与 Gallery，可复制、保存、打开灯箱；灯箱支持左右切换、懒加载更多、缩放、拖拽、触摸 pinch、键盘 Escape/ArrowLeft/ArrowRight、跳转回 thread。
- 视频预览：有播放/暂停、静音、进度、时长、seek、fullscreen。
- 音频预览：有播放/暂停、静音、进度、时长、seek，并用 `AudioContext` 和 canvas 做波形/频谱可视化。
- PDF 预览：使用 `react-pdf`，支持页码、缩放、拖拽平移、滚轮缩放、触摸操作、文本层与 annotation layer。
- DOCX 预览：使用 `mammoth` 产出 HTML，并内置文档样式、标题、段落、表格、图片、列表样式。
- Excel 预览：chunk 很大，结合 `xlsx` 依赖与预览 chunk 命名，可推断支持电子表格解析/显示；具体交互粒度未完全展开。
- PPTX 预览：存在独立 `PptxPreview`，结合 `jszip` 和 `react-pdf` 相关资产，显示有 PowerPoint 文件预览面；具体渲染质量需运行验证。
- ZIP 预览：存在 `ZipPreview`，结合 `jszip` 依赖，显示有压缩包内容查看面。
- Artifact 渲染：`HtmlRenderer`、`ReactRenderer`、`MermaidRenderer`、`SvgRenderer`、`ScriptRenderer`、`CodeRenderer`、`PreviewRenderer`。`ReactRenderer` 用 sandbox iframe 加载 React 18、ReactDOM 和 Babel；`SvgRenderer` 会移除 `<script>` 与 inline event handler 后再展示；`MermaidRenderer` 依赖 Mermaid 大 chunk 和各类 diagram assets；代码高亮包含大量语言和主题 chunk。
- Markdown/数学/图表：KaTeX 字体、Mermaid diagram chunks、Shiki 语言/主题资产、`@antv/infographic` 依赖和 chart 组件名表明消息与 artifact 支持富文本、代码、数学/图表类展示。

## Settings 面

`SettingsWindow` 的 tab 清单能直接反映用户可见配置面：

- `general`：tool model、coding agent 选择、语言、app icon、auto start、start minimized、minimize/close to tray、macOS hide dock icon、QuickChat 行为、权限请求自动批准、analytics。
- `providers`：provider、模型、连接测试、API key/base URL、GitHub Copilot OAuth、多 provider 类型、自定义 ACP provider、model capability 与 provider options。
- `agents`：Agent Crew，支持 managed agents、subagent delegation、profile roster、custom profile、preferred model、mission summary、focus areas、delegates-to、specialist prompt、routing preview、delegation graph。
- `channels`：Telegram、Discord、Feishu、Weixin 以及 channel-to-workspace binding。
- `workspace`：工作区管理；从主 chunk 调用看还配合文件树、terminal、preview、git、GitHub PR。
- `chat`：聊天参数、sound effects、auto compact、auto suggestions 等。
- `rtkSavings`：RTK 节省统计配置。
- `prompts`：prompt 管理。
- `memory`：长期记忆、embedding、检索、搜索、手动编辑和 rebuild。
- `activity`：Activity Recorder。
- `computer-use`：Computer Use 与 approved apps。
- `mcp`：MCP servers、marketplace、resources。
- `skills`：skills 管理与自动提取。
- `plugins`：插件安装、市场、权限、配置、更新。
- `hooks`：hooks 管理。
- `whisper`：本地语音转文本。
- `tts`：语音合成。
- `people`：人物资料管理。
- `websearch`：搜索引擎、cookie 管理、debug window、web fetch browser。
- `chromeRelay`：Chrome relay。
- `ui`：字体、editor/terminal、labels、tool card 展开等。
- `themeConfig`：主题编辑与自定义主题。
- `network`：HTTP/HTTPS/SOCKS5 proxy、认证、proxy test、prefer IPv4、timeout、retry、custom user agent。
- `keybindings`：new chat、QuickChat、search threads、send message、settings、toggle sidebar、toggle Whisper、next/previous thread，可录制、清除、重置。
- `data`：cloud sync、导出/导入备份。
- `permissions`：系统权限。
- `usage`：使用统计。
- `about`：版本与外部链接等关于页。

## Share 面

`share.html` 与 `share-AF-wBf-y.js` 显示 Alma 有会话图片导出窗口：

- 通过 `window.ipcRenderer` 接收 `share-data`，并在窗口 ready 时发送 `share-window-ready`。
- `MessageSelector` 支持按消息选择、全选、取消全选，展示 user/assistant 角色。
- `SharePreview` 根据选中消息、title、是否包含 header、是否包含 timestamp 生成导出预览。
- 使用 `modern-screenshot` 把 DOM 转成 data URL，支持复制到剪贴板和保存为 PNG。
- 预览区使用 `react-zoom-pan-pinch`，支持 zoom in、zoom out、reset transform。

## Gallery 与 Lightbox 面

`gallery.html` 与 `lightbox.html` 是图片资产浏览链路：

- Gallery 使用 `masonic` masonry grid，分页常量 `PAGE_SIZE`，通过 `/api/gallery/images` 获取图片列表。
- Gallery 有懒加载图片、加载状态、空状态、刷新/加载更多、点击打开灯箱等行为。
- Lightbox 通过 `window.lightboxWindow.getInitialParams()` 与 `onUpdate()` 接收初始图片列表和后续更新。
- Lightbox 在缺 URL 时调用 `/api/gallery/images/{imageId}` 获取真实图片 URL，接近尾部时调用 `/api/gallery/images?limit=30&offset=...` 继续加载。
- Lightbox 可复制图片、保存图片、显示创建时间、显示关联 thread 标题并通过 `navigateToThread` 跳转。

## Notification 面

`notifications.html` 与 `notifications-BVczgDe3.js` 显示 Alma 有自定义透明通知窗口，而不只是系统通知：

- 页面 CSS 设置透明背景、隐藏 overflow、禁用选择，适合桌面悬浮通知。
- 通知逻辑有队列、active notification、queue count、dismiss、clear all。
- 通知卡片支持 icon data URL、title、body、CTA、进度条、自动关闭。
- 有 `playNotificationChime`，默认音量约 `0.18`。
- 支持 hover 暂停/交互、滑动关闭阈值、速度阈值、`Clear All`。
- 会应用主题、font family、root font size 等设置快照。

## Live Coding 面

`livecoding.html` 与 `livecoding-DNYjSLeL.js` 显示 Alma 有独立 Live Coding 窗口：

- 组件包括 `LiveCodingEditor`、`LiveCodingVisualization`、`LiveCodingHelp`、`LiveCodingConsole`、`LiveCodingWindow`。
- 入口预加载 `useLiveCoding-BK3dX-nU.js`，package 依赖包含 `@strudel/web`、`tone`、CodeMirror 相关包，说明该功能更像实时音乐/代码执行环境，而不是普通代码编辑器。
- UI 有 help、share、console、visualization 等面；具体语言、音频引擎状态和运行时权限需要结合主进程或运行态验证。

## Prompt App 独立运行面

`prompt-app-runner.html` 与 `prompt-app-runner-Cu4xnzQc.js` 显示 Prompt App 是一等产品能力：

- runner 通过 `window.promptAppRunner.getPromptApp()` 读取 app 定义，并把窗口标题设置为 app emoji/name。
- 支持窗口关闭、保存窗口大小、从 runner 跳转到生成的 thread。
- 输入类型覆盖文本、多行文本、select、number、checkbox、image upload、file upload。
- 图片上传支持点击、拖放、剪贴板粘贴、追加/替换、多图。
- 文件上传支持任意文件或 accept 过滤，多文件。
- 执行时调用 `promptAppsApiClient.executePromptApp()`，再根据 app 的模型、工具、reasoning effort 等配置创建/继续 thread。
- 对 `expectsImageResult` 的 app，会在结果没有图片时自动重试，常量显示最多 10 次。
- 结果面支持复制、打开 thread、生成中状态、错误、regenerate、history。
- 图片结果支持右键/菜单式复制、保存、灯箱打开。

## 不确定性

- 这是压缩后的打包产物，没有 source map。可读组件名和字符串足以确认用户面，但某些内部流程、边界条件和后端语义无法仅靠 renderer 完整判断。
- `package.json` 中的依赖不能单独证明产品能力。本交接只把依赖作为辅助证据，优先使用 HTML 入口、chunk 名、组件名、API 路径和 UI 文案。
- `ExcelPreview`、`PptxPreview`、`ChromeRelaySettings`、`ClaudeSubscriptionSettings`、部分 provider 类型与 Activity Recorder 的深层流程没有完整逐行展开，需主进程/预加载或运行态证据确认细节。
- renderer 中暴露的 Git/GitHub/terminal/preview API 只能证明用户界面和调用面存在，不能证明所有 API 在本地环境均可成功执行。
- Gallery、Lightbox、Prompt Apps、Notifications、Share 都依赖 preload 暴露的 `window.*` bridge；bridge 的完整接口和安全边界不在本节点范围内。
- 部分文案使用 fallback English，说明 i18n key 存在但翻译内容可能在其他资产或运行时加载。

## 简明功能清单

1. 多窗口 Electron renderer：主应用、设置、通知、图片灯箱、Prompt App runner、Live Coding、Gallery、Share。
2. AI 聊天：模型选择、附件、语音输入、工具选择、技能选择、reasoning effort、incognito、引用、工具卡片、审批卡片。
3. QuickChat：全局快捷键、失焦隐藏、屏幕上下文注入、click-through ambient 模式。
4. Prompt Apps：CRUD、排序、全局快捷键、动态占位符、指定模型/工具/reasoning、独立运行窗口、历史、图片结果自动重试。
5. Provider 管理：多 provider、模型拉取/存储、连接测试、capability override、provider options、GitHub Copilot OAuth、ACP provider。
6. Agent Crew：managed agents、delegation、profile roster、custom specialist、routing preview、delegation graph。
7. Workspace：文件树、文件预览、terminal、preview server、workspace WebSocket、Git/GitHub PR 操作面。
8. Artifact：HTML、React、Mermaid、SVG、Script、Code 渲染，代码/预览切换。
9. 文件预览：image、video、audio、PDF、DOCX、Excel、PPTX、ZIP、unsupported fallback。
10. Gallery/Lightbox：图片瀑布流、分页、灯箱、复制、保存、缩放、拖拽、跳转 thread。
11. Share：按消息选择、导出预览、复制到剪贴板、保存 PNG、缩放预览。
12. 自定义通知：透明悬浮通知窗口、队列、声音、自动关闭、滑动关闭、CTA、清空全部。
13. MCP：marketplace、installed servers、server edit、OAuth badge、resource viewer。
14. Plugins：安装源 URL/npm/local/marketplace、启停、卸载、权限、配置、更新检查。
15. Prompts/Skills/Hooks：prompts 管理、skills 多来源分类和自动提取、hooks 管理。
16. Memory：记忆检索、query rewriting、embedding 模型、本地 embedding 下载、搜索、新增、编辑、删除、rebuild 进度。
17. Activity Recorder：screen/OCR/session/embedding 记录管理、输出目录、语言、清理 recorded activity。
18. Computer Use：严格审批、action logging、PiP、helper、权限、approved apps、revoke。
19. Channels/People：Telegram、Discord、Feishu、Weixin，channel-workspace binding，人物资料和头像。
20. Whisper/TTS：本地 Whisper 模型管理；local Qwen3-TTS、ElevenLabs、OpenAI TTS 与测试语音。
21. Web Search/Web Fetch：Google/Xiaohongshu、debug window、Xiaohongshu cookie 管理、Web Fetch browser。
22. UI/Theme/Network/Keybindings/Data/Usage/About：字体、主题编辑、proxy、shortcut 录制、cloud sync、backup 导入导出、用量与节省统计、关于页。
