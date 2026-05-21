# Alma 主进程与系统能力审计交接

## 范围

本交接文件只审计 `/Users/wibus/dev/safe-research/Alma-source` 中的本地 packaged app 证据，重点是 Electron main process、preload 暴露面、IPC、native/system 集成和本地服务能力。未使用网络、未读取 upstream 源码、未运行 Alma 应用，也不判断 Cradle 是否具备等价能力。

结论基于构建产物反推：Alma `0.0.792` 是一个 Electron 桌面应用，主进程不是轻量窗口壳，而是承载了本地数据库、HTTP API server、WebSocket、插件运行时、MCP/ACP、聊天模型代理、跨平台机器人桥接、屏幕/活动记录、Computer Use、Whisper、本地通知、更新和系统权限等大量能力。

## 已检查证据

- `/Users/wibus/dev/Cradle/docs/exec-plans/20260521-07-alma-cradle-gap-analysis.md`：确认本节点只负责 Alma 主进程和系统能力盘点。
- `/Users/wibus/dev/safe-research/Alma-source/docs/recovery-plan.md`：确认当前 Alma workspace 不是 Git repository，而是 packaged Electron build output；没有 source maps。
- `/Users/wibus/dev/safe-research/Alma-source/package.json`：确认 `name: alma`、`version: 0.0.792`、`main: out/main/index.js`，并用 dependencies 辅助判断 native/system 能力。
- `/Users/wibus/dev/safe-research/Alma-source/out/main/index.js`：约 `1.89 MB`，单行压缩 ESM bundle，是主进程核心。
- `/Users/wibus/dev/safe-research/Alma-source/out/main/chunks/computer-use-pip-BflIEZ0P.js`：Computer Use 画中画窗口。
- `/Users/wibus/dev/safe-research/Alma-source/out/main/chunks/computer-use-register-CmJNOcjf.js`：Computer Use MCP server 自动注册。
- `/Users/wibus/dev/safe-research/Alma-source/out/main/chunks/fatigueService-pG2U4fBq.js`：疲劳/睡眠状态服务。
- `/Users/wibus/dev/safe-research/Alma-source/out/main/chunks/rtk-stats-s2OgfPTQ.js`：`rtk-tracking.db` 统计读取。
- `/Users/wibus/dev/safe-research/Alma-source/out/preload/index.js`：约 `17.7 KB`，preload API 暴露。
- `/Users/wibus/dev/safe-research/Alma-source/out/renderer/*.html`：辅助确认 main process 管理的窗口入口，包括 `index.html`、`notifications.html`、`lightbox.html`、`prompt-app-runner.html`、`livecoding.html`、`gallery.html`、`settings.html`、`share.html`。

## 主进程能力

### 应用生命周期与窗口系统

Alma main process 直接导入 Electron 的 `app`、`screen`、`globalShortcut`、`BrowserWindow`、`ipcMain`、`safeStorage`、`net`、`shell`、`session`、`nativeImage`、`desktopCapturer`、`powerMonitor`、`systemPreferences`、`clipboard`、`dialog`、`Menu`、`Tray`。这说明主进程不仅负责窗口创建，还负责权限、系统托盘、全局快捷键、剪贴板、文件对话框、会话和系统集成。

窗口入口至少包括：

- 主窗口：`index.html`。
- 设置窗口：`settings.html`。
- 通知浮窗：`notifications.html`，透明、无边框、置顶、点击穿透。
- 图片查看器：`lightbox.html`。
- 图库窗口：`gallery.html`。
- Prompt App runner：`prompt-app-runner.html`。
- Live Coding 窗口：`livecoding.html`。
- Share Conversation 窗口：`share.html`。
- Quick Chat / More Menu / Permission Overlay 等 hash 或特殊窗口角色，证据来自 preload IPC 与 main 的窗口过滤逻辑。

主进程还包含崩溃恢复：监听 `render-process-gone` 后尝试 2 秒后重建窗口，监听 `child-process-gone` 对 crash、launch-failed、abnormal-exit 执行 `app.relaunch()` 和 `app.exit(0)`。退出前会注销全局快捷键、停止 Activity Recorder、销毁托盘、停止 MCP OAuth 定时刷新、清理 ACP sessions。

### 系统托盘、快捷键、启动项和外观

Alma 创建 `Tray`，菜单包含 `Show Alma`、`Quick Chat`、`Activity Recorder` 启停、最近活动摘要、设置和退出。托盘 tooltip 会显示 `Alma • recording` 来反映活动记录状态。主进程通过 `globalShortcut` 注册 Quick Chat 快捷键和 prompt app 快捷键；preload 暴露 `update-quick-chat-shortcut`、`initialize-quick-chat-shortcut`、`register-prompt-app-shortcut`、`unregister-prompt-app-shortcut`。

系统级应用设置包括：

- `set-auto-start` / `get-auto-start`：使用 `app.setLoginItemSettings()` 管理开机自启。
- `set-dock-visibility`：macOS 下通过 `app.dock.show()` / `app.dock.hide()` 支持菜单栏模式。
- `set-app-icon`：在运行时切换 app、dock 和 tray icon，支持 `alma` 与 `alma-alt1`。
- packaged 模式会安装 CLI wrapper：Windows 写入 `%LOCALAPPDATA%/Alma/bin/alma.cmd` 并尝试修改用户 `PATH`；非 Windows 写入 `~/.local/bin/alma`。
- 启动时运行 `fix-path` 修复 GUI app 的 `PATH`。

### 本地 HTTP API server 与 WebSocket

主进程创建 Express HTTP server，并监听本地端口；端口会写入 `process.env.API_SERVER_PORT`，preload 通过 `api-server-info` 暴露给 renderer。证据中默认 OAuth callback 端口变量初始为 `23001`，并存在 `http://127.0.0.1:${port}`、`http://localhost:${port}`、`ws://127.0.0.1:${port}/ws/threads`。

主进程路由规模很大，抽取到约 `146` 个 `GET` 路由、`183` 个 `POST` 路由、`22` 个 `PUT` 路由、`30` 个 `DELETE` 路由。主要 API 域包括：

- Chat 和 thread：`/api/chat/completions`、`/api/threads`、`/api/threads/:threadId/messages`、`/api/messages/:messageId/rollback`、branch、compact、switch。
- Provider 和模型：`/api/providers`、`/api/providers/:id/models`、`/api/providers/:id/test`、`/api/models`、`/api/tool-model`。
- Workspace 和 Git：`/api/workspaces`、files、binary files、preview、git status/log/diff/branch/worktree/stash/rebase/github PR。
- Plugins：`/api/plugins`、permissions、settings、updates、themes、hooks。
- MCP：`/api/mcp-servers`、`/api/mcp-client/tools`、resources、resource templates、marketplace、OAuth status。
- Activity Recorder：status、config、sessions、snapshot-file、digest、reports、semantic search、keyword search、suggestions。
- Computer Use：status、permissions、apps、windows、shot、snap、click、drag、press、scroll、type、launch_app、approvals、PIP。
- Chrome Relay：launch、tabs、navigate、read DOM、screenshot、click、type、upload、back/forward、detach。
- Bot bridges：Telegram group routes、Discord servers/channels/messages/stickers、Feishu status/send、Weixin QR/status/logout。
- Voice/TTS/STT：`/api/tts/generate`、`/api/tts/setup`、`/api/voice/send`、`/api/whisper/models`、local embedding models。
- Memory：`/api/memories`、archive、search、rebuild、sleep runs、embedding model/status/stats。
- Cron/heartbeat：`/api/cron/jobs`、`/api/heartbeat/config`、status。
- Data and usage：data import/export、usage stats、RTK stats、cloud sync state.

server 有 heartbeat 自检：定期请求 `/api/health`，连续失败后尝试 close 并重新 listen，说明 API server 是应用核心依赖。

### 数据库与本地持久化

主进程使用 `better-sqlite3`、`drizzle-orm/better-sqlite3` 和 `drizzle-orm/sqlite-core`。构建产物中可见 42 张普通表、2 张虚拟表、70 个索引和多段迁移逻辑。

关键表按能力可分为：

- 会话和聊天：`chat_threads`、`chat_messages`、`thread_labels`、`thread_diff_stats_cache`。
- Provider 和模型：`providers`、`provider_models_cache`、`model_capabilities_cache`、`usage_records`、`usage_migration_status`。
- Prompt Apps：`prompt_apps`、`prompt_app_executions`。
- Workspaces：`workspaces`、`preview_servers`。
- 插件与技能：`plugins`、`plugin_permissions`、`skills`、`custom_themes`。
- MCP：`mcp_servers`、`mcp_oauth_tokens`。
- Memory：`memories`、`memory_archive`、`memory_metadata`、`memory_sleep_runs`、虚拟表 `memory_embeddings`。
- Activity Recorder：`activity_sessions`、`activity_events`、`activity_snapshots`、`activity_ocr_frames`、`activity_summaries`。
- Computer Use：`computer_use_action_log`、`computer_use_app_approvals`。
- Agent/DAG：`agent_missions`、`agent_runs`、`agent_handoffs`、`mission_sprints`、`sprint_contracts`、`sprint_evaluations`。
- Gallery：`gallery_images`。
- Channels：`channel_mappings`。

全文搜索使用 `messages_fts`，并在 FTS 重建时用 `jieba-wasm` 对中文内容分词。向量能力通过 `sqlite-vec` 加载平台相关 extension，主进程会在 packaged app path 和 dev path 中寻找 `vec0.dylib` / `vec0.so` / `vec0.dll`。

### AI provider、代理和模型能力

主进程 bundle 导入和使用多种 provider SDK：`@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai-compatible`、`@aihubmix/ai-sdk-provider`、`@openrouter/ai-sdk-provider`、`@ai-sdk/deepseek`、`@ai-sdk/azure`、`@mcpc-tech/acp-ai-provider`、`openai` 和 `ai`。内置 URL 证据包括 `https://api.openai.com/v1`、`https://api.anthropic.com/v1`、`https://generativelanguage.googleapis.com/v1beta`、`https://openrouter.ai/api/v1`、`https://api.deepseek.com`、`https://api.moonshot.cn/v1`、`https://api.kimi.com/coding/v1`、`http://localhost:11434/v1`、`https://ark.cn-beijing.volces.com/api/v3`、`https://api.z.ai/api/coding/paas/v4`。

主进程还实现 provider proxy：可见 `/proxy/:providerId/responses`、`/proxy/:providerId/v1/responses`、`/anthropic-proxy/:providerId/v1/messages`。这意味着 Alma 可以在本地 API server 中代理不同 provider 的 Responses API 或 Anthropic Messages API 请求。

GitHub Copilot 和 Claude Subscription 是独立认证域：

- Copilot 使用 GitHub device code flow：`https://github.com/login/device/code`、`https://github.com/login/oauth/access_token`、`https://api.github.com/copilot_internal/v2/token`、`https://api.githubcopilot.com/models`，preload 暴露多账号 token 管理。
- Claude Subscription 使用 OAuth：`https://claude.ai/oauth/authorize`、`https://console.anthropic.com/oauth/code/callback`、`https://console.anthropic.com/v1/oauth/token`，preload 暴露授权、刷新、profile、quota、models。

### MCP、ACP 和工具运行时

Alma 内置 MCP client manager，配置路径是 `~/.config/alma/mcp.json`。支持 stdio、Streamable HTTP、SSE 三类连接，并使用 `@modelcontextprotocol/sdk` 的 client、auth、resource notification 能力。可见能力包括：

- 读取和保存 MCP config。
- 启动 stdio MCP server，捕获 stderr buffer。
- 连接 remote MCP server，优先 Streamable HTTP，失败后 fallback SSE。
- 列出 tools、resources、resource templates。
- 支持 resources subscribe、resource updated/list changed notifications。
- 将 MCP tools 转换为 AI SDK tools，支持 text、image、audio、resource、resource_link 输出。
- OAuth token 存储、刷新、re-authorize 通知和 callback server，callback URL 为 `/mcp/oauth/callback`。

`computer-use-register` chunk 会在 macOS 自动把 `computer-use` MCP server 写入 `~/.config/alma/mcp.json`，server script 名为 `bin/alma-computer-use-mcp.mjs`。packaged 模式使用 `process.execPath` 加 `ELECTRON_RUN_AS_NODE=1` 执行该脚本。

ACP 证据来自 `@mcpc-tech/acp-ai-provider`、`acpx` 和退出时 `cleanupAllSessions()`。这表明 Alma 主进程还维护 ACP provider/session 生命周期，但压缩产物中具体协议边界需要进一步反混淆确认。

### 插件运行时与扩展 UI

Alma 主进程内含插件管理和插件 UI bridge。证据包括 `plugins`、`plugin_permissions`、`custom_themes`、`hooks`、`raw.githubusercontent.com/yetone/alma-plugins/main/registry.json`、插件安装/刷新/更新 API，以及 preload 暴露的 `pluginCommands`、`pluginTheme`、`pluginStatusBar`、`pluginInputBox`、`pluginQuickPick`、`pluginConfirmDialog`、`pluginNotification`、`toolApprovalDialog`。

插件能力面包括：

- 注册和执行 command。
- 插件权限 grant/deny 和持久化。
- 插件设置、enable/disable/update/refresh。
- status bar item 更新和 command 触发。
- theme apply/clear。
- Quick Pick、Input Box、Confirm Dialog、Notification、Tool Approval 等 UI 交互。
- hooks config 读取、更新、reload。

主进程还存在一个 modal input box 的临时 BrowserWindow，实现 `plugin-show-input-box`、`plugin-input-box-submit`、`plugin-input-box-cancel`。

### Activity Recorder 与本地工作记忆

Activity Recorder 是主进程重要系统能力。证据包括数据库表、API 路由、托盘菜单、prompt 注入文本和 Activity suggestions 逻辑。

已确认能力：

- 本地记录屏幕活动：prompt 文本明确提到 screenshots、OCR text、input events、browser URL/tab titles、per-app focus。
- 记录 session、event、snapshot、OCR frame，并保存 snapshot 文件路径、尺寸、字节数、触发原因、app name 等。
- 分析 session，抽取 PR、issue、people handle、code identifier、version、decision、project。
- 提供日/周报告、最近 digest、semantic search、keyword search、suggestions。
- 托盘可启停记录并展示最近活动 digest。
- Activity API 支持权限、配置、启动、停止、session analyze 和 summary generation。
- Activity prompt 建议用户通过 `alma activity report today`、`alma activity digest`、`alma activity sessions` 等 CLI 命令查询。

### Computer Use 与 Chrome Relay

Computer Use 是主进程系统自动化能力。证据包括 `/api/computer-use/*` 路由、`computer_use_action_log`、`computer_use_app_approvals`、`computer-use-pip`、`computer-use-register`。

已确认 Computer Use 能力：

- 应用发现与状态：`list_apps`、`get_app_state`、`windows`、`apps`。
- UI 操作：`click`、`drag`、`press`、`press_key`、`scroll`、`type`、`type_text`、`set_value`、`perform_secondary_action`。
- 截图与状态：`shot`、`snap`、`lens`、`pip/latest`。
- 应用控制：`launch_app`、`raise`、`shutdown`。
- 权限与审批：`permissions`、`approvals`、`check_approval`、`grant`，并持久化 action log 和 app approvals。
- PIP window：从 `/tmp` 查找 `alma-cu-state-*.jpg`，创建透明置顶 320x220 窗口，每 500ms 请求 `http://localhost:23001/api/computer-use/pip/latest` 更新画面，忽略鼠标事件并显示 `Alma · Computer Use`。

Chrome Relay 是另一套浏览器自动化能力，路由包括 launch chrome、tabs、navigate、read、read DOM、screenshot、click、type、upload、scroll、back、forward、detach、token。产物中可见 Chrome binary 探测路径，如 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`、`/usr/bin/google-chrome`、`/usr/bin/chromium`。

### WebSearch 与 WebFetch

主进程内置 WebSearch/WebFetch 工具，使用 hidden `BrowserWindow`、Electron session、`@mozilla/readability`、`turndown`、`turndown-plugin-gfm`、Google 搜索和小红书搜索。证据包括：

- preload 暴露 `webSearch.openDebugWindow()`、`webSearch.openXiaohongshuDebugWindow()`、小红书 cookies export/import/clear。
- preload 暴露 `webFetch.openBrowser(url)`。
- main 中创建隐藏 `BrowserWindow`，设置 User-Agent，尝试隐藏 webdriver 指纹，检测 reCAPTCHA。
- WebSearch 支持 allowed/blocked domains、max results、include markdown。
- WebFetch 支持直接 HTTP fetch 和 BrowserWindow fallback，将页面转 Markdown、提取 Readability 内容、summary、highlights。
- cookie sync 会在 `defaultSession`、`persist:websearch`、`persist:webfetch` 之间复制 cookies，特别处理 Google 和小红书。

### 本地语音、Whisper、TTS 和媒体处理

Alma package 依赖 `@fugood/whisper.node`、`@fugood/node-whisper-darwin-arm64`，主进程暴露 Whisper IPC：

- `whisper-get-status`：初始化状态、当前模型、已下载模型。
- `whisper-initialize`：初始化指定模型和设备，默认 device 为 `auto`。
- `whisper-transcribe`：接收 Float32Array 音频并转文本。
- `whisper-dispose`。
- `get-microphone-status`、`request-microphone-permission`、`open-microphone-settings`。

preload 还监听 `telegram-decode-audio`，在 renderer/preload 侧用 `AudioContext` 将音频 buffer 解码为 16kHz PCM，再通过 `telegram-decode-audio-result` 回传 main。

TTS 证据包括 `/api/tts/generate`、`/api/tts/setup`、OpenAI audio speech URL、ElevenLabs URL、临时文件 `/tmp/alma-tts-*.mp3` 和 `/tmp/alma-tts-*.ogg`。机器人桥接中也会发送 voice、voice action，并能把回复转换成语音。

### 跨平台消息桥接

主进程内置 Telegram、Discord、Feishu、Weixin bridge：

- Telegram：通过 `https://api.telegram.org/bot...` 调用 sendMessage、sendVoice、get file 等；支持 group chat、topic、reply、pin/unpin、leave、photo/document/video/voice；语音输入可转写；活跃生成通过 WebSocket 接入 `/ws/threads`；有健康检查和断线重连。
- Discord：依赖 `discord.js`，支持 servers、channels、messages、DM、reaction、stickers、send file/photo；存在 `/tmp/alma-discord-*.log`。
- Feishu：调用 `https://open.feishu.cn/open-apis/...`，支持 tenant token、bot info、send message、reply、file/image、reaction。
- Weixin：依赖 `weixin-agent-sdk`，可见 `https://ilinkai.weixin.qq.com`、`https://novac2c.cdn.weixin.qq.com/c2c`、`/api/weixin/qrcode`、`/api/weixin/status`、`/api/weixin/logout`。

这些 bridge 通过 `channel_mappings` 把外部 channel 映射到 Alma thread，并使用本地 WebSocket 请求生成回复。

### Cron、Heartbeat、Thread Archiver 和疲劳服务

主进程导入 `croner` 并提供 `/api/cron/jobs`，支持 job create/update/delete/toggle/run/runs。Cron service 可以向 Telegram 和 Discord 发送消息，也和 TTS 临时文件有关。

Heartbeat service 提供 `/api/heartbeat/config` 和 `/api/heartbeat/status`，可汇总 Telegram、Discord、Feishu group status，并可通过 Telegram 发送 heartbeat 消息。

Thread Archiver 会读取 workspace path，默认类似 `~/Library/Application Support/alma/workspaces/default`，并在首次运行时归档已有 threads 到 `threads/.archive-state.json` 相关结构。

`fatigueService` chunk 持久化 `~/.config/alma/fatigue.json`，记录 `fatigue`、`messageCount`、`lastMessageTime`、`lastRestTime`、`manualSleep`、`manualWake`，并向系统 prompt 注入 awake、tired、sleepy、sleeping 状态。它会要求在需要睡眠/唤醒时运行 `alma sleep`、`alma wake`、`alma rest`、`alma fatigue` 等 CLI 命令。

### 文件、文档、截图和系统预览

主进程提供文件系统 IPC 和 API：

- `select-directory`。
- `select-and-read-file`。
- `read-file-as-data-url`。
- `open-in-system-preview`：支持 data image 写入临时文件后 `shell.openPath()`，URL 则 `shell.openExternal()`。
- `show-item-in-folder`。
- workspace file CRUD：copy、mkdir、move、rename、touch、delete、binary read、text read。
- snapshot service：create、snapshotFile、list、get、diff、rollback、rollbackFile、cleanup，文件保存在 `.alma-snapshots` / `snapshots` 相关路径。

文档与媒体处理依赖包括 `mammoth`、`jszip`、`adm-zip`、`xlsx`、`image-size`、`react-pdf`。机器人 bridge 可接收和转发 `pdf`、`doc`、`docx`、`xls`、`xlsx`、`ppt`、`pptx`、`txt`、`md`、`csv`、`json`、`xml`、`html`、`yaml`、`zip`、`tar`、`gz` 等附件。

截图和图片处理证据包括 `desktopCapturer` import、`/usr/bin/sips` 调用、`image-size`、gallery cache、`gallery_images` 表、`lightbox` 和 `gallery` 窗口。

### 通知系统

Alma 不是只用系统 Notification；它依赖本地 native package `alma-notifications`，并创建自有透明通知窗口。preload 暴露：

- `almaNotifications.notify()`、`clearAll()`、`test()`、`setTheme()`。
- `notificationWindow.onShow()`、`onQueueChanged()`、`sendDismiss()`、`sendClearAll()`、`sendClick()`、`sendAction()`、`sendPresented()`、`setClickThrough()`、`onTheme()`、`getTheme()`。

main 中通知窗口使用 `BrowserWindow`，无边框、透明、不可聚焦、置顶、点击穿透，并按 cursor display 重新定位。通知支持 action、swipe、theme、queue count、auto dismiss。

### 更新、遥测和错误上报

主进程使用 `electron-updater`，preload 暴露 `app-check-for-updates`、`app-get-update-info`、`app-download-update`、`app-quit-and-install` 和 `auto-update-status`。main 设置 `autoDownload=false`、`autoInstallOnAppQuit=true`，启动后 3 秒检查更新，并每 30 分钟再次检查。

产物中有 Sentry release 标记 `alma@0.0.792`，并导入 `@sentry/electron/main`，可见 DSN `https://d6d12e1b5a6744f646725d7539440852@o441417.ingest.us.sentry.io/4510488586485760`。renderer 入口也预加载 `ConditionalPostHogProvider`，package 依赖有 `posthog-js`。

## Preload 暴露面

`out/preload/index.js` 暴露 37 个 `contextBridge` namespace。高层分类如下：

- 基础 IPC：`ipcRenderer` 直接暴露 `on`、`off`、`send`、`invoke`。这是强能力桥，renderer 理论上可调用任意 IPC channel。
- 窗口控制：`windowControls`、`settingsWindow`、`promptAppRunner`、`quickChatWindow`、`moreMenu`、`galleryWindow`、`lightboxWindow`、`liveCodingWindow`。
- 系统能力：`platform`、`apiServer`、`permissions`、`accessibility`、`systemFile`、`electronClipboard`、`selectDirectory`、`getPathForFile`、`selectAndReadFile`。
- 应用管理：`almaApp`、`playwright`。
- 认证和 provider：`copilot`、`claudeSubscription`、`mcpOAuth`。
- 本地 AI/浏览器工具：`whisper`、`webSearch`、`webFetch`。
- 插件 UI：`pluginCommands`、`pluginTheme`、`pluginStatusBar`、`pluginInputBox`、`pluginQuickPick`、`pluginConfirmDialog`、`toolApprovalDialog`、`pluginNotification`。
- 通知：`almaNotifications`、`notificationWindow`。
- 文件快照：`snapshot`。

preload 抽取到 138 个 renderer 可调用 `ipcRenderer.invoke()` channel、8 个 `send()` channel、38 个监听 channel。main 中对应抽取到 144 个 `ipcMain.handle()` channel，包含 preload 未直接包装但 main 支持的 `share-window-open`、`share-window-close`、`window-hide`、`plugin-show-input-box` 等。

## IPC 与 native/system 集成摘要

### IPC 重点能力

- Window：`window-minimize`、`window-maximize`、`window-fullscreen`、`window-close`、`window-hide`、focus/max/fullscreen status。
- Quick Chat：toggle、hide、expand、click-through、front app context、app traversal、cached context、recapture。
- Permission：`permissions:get-all`、`permissions:request`、`permissions:open-settings`、`accessibility:start-flow`、permission overlay drag。
- File/clipboard：open preview、external URL、show in folder、read file as data URL、clipboard text/image/rich write。
- App/update：app info、auto update check/download/install、auto-start、dock visibility、app icon。
- Provider auth：Copilot、Claude Subscription、MCP OAuth。
- Tooling：Playwright install/status、Whisper、WebSearch/WebFetch debug windows、Snapshot。
- Plugin UI：command execution、statusbar、input box、quick pick、confirm dialog、tool approval、notification。
- Notifications：notify、theme、queue、click/action/dismiss/presented/click-through。

### Native/system 重点集成

- Electron system APIs：`safeStorage`、`shell`、`session`、`nativeImage`、`desktopCapturer`、`powerMonitor`、`systemPreferences`、`clipboard`、`dialog`、`Tray`、`Menu`、`globalShortcut`。
- OS 命令：`execSync`、`spawn`、`execFile`，包括 Windows registry/PATH、macOS `sips`、Chrome binary launch、CLI wrapper 安装。
- Native modules：`better-sqlite3`、`sqlite-vec`、`node-pty`、`alma-notifications`、Whisper native package。
- Local HTTP/WebSocket：Express、CORS、`ws`、undici proxy agent、SOCKS proxy support。
- Platform permissions：macOS microphone status/request、accessibility flow、system settings deep links、Electron session permission handler。
- Browser sessions：`defaultSession`、`persist:websearch`、`persist:webfetch` cookie sync 和 debug browser windows。

## 不确定性

- 主进程和 preload 都是压缩产物，没有 source maps；函数名大量混淆，能力边界来自字符串、IPC、路由、依赖和局部代码片段，不能精确还原源码模块划分。
- `desktopCapturer`、`powerMonitor` 等 Electron API 被导入，但具体调用点在压缩代码中不一定能通过简单字符串定位；本文件只把它们列为 main 可用/疑似使用的系统集成，不把每个 API 都当成已确认业务功能。
- ACP 能力有依赖、provider 和 session cleanup 证据，但具体用户可见功能边界需要结合 renderer 或运行态进一步确认。
- `out/main/index.js` 中出现 `nindex.html`、`t.html`、`viewer.html` 等 HTML 字符串，但 `out/renderer` 实际可见入口是 8 个 HTML 文件；额外名字可能来自字符串拼接或第三方模板，不作为确定窗口入口。
- 本交接没有运行 Alma，因此无法验证端口、权限弹窗、bot bridge、Computer Use、Whisper 模型下载、Playwright install 等运行时是否在当前机器可用。

## 简明功能清单

1. Electron 多窗口桌面壳：主窗口、设置、通知、图库、图片查看、prompt app、live coding、分享、quick chat。
2. 系统托盘和全局快捷键：Quick Chat、prompt app shortcuts、Activity Recorder 控制。
3. 开机自启、dock 隐藏、运行时 app icon 切换、CLI wrapper 安装和 PATH 修复。
4. 本地 Express API server：聊天、provider、workspace、plugin、MCP、activity、computer use、bot、memory、cron、heartbeat、usage 等路由。
5. 本地 WebSocket：thread generation 和外部 bridge 的实时通信。
6. SQLite/Drizzle 持久化：聊天、provider、workspace、插件、MCP、memory、activity、agent mission、gallery、usage。
7. FTS 与中文分词：`messages_fts` + `jieba-wasm`。
8. 向量记忆：`sqlite-vec` extension + `memory_embeddings`。
9. 多 provider AI 管理：OpenAI、Anthropic、Google、OpenRouter、Aihubmix、DeepSeek、Azure、Moonshot、Kimi、Ollama、Volcengine、Z.ai 等。
10. Provider proxy：OpenAI Responses proxy 和 Anthropic Messages proxy。
11. Copilot OAuth/device flow 与多账号 token 管理。
12. Claude Subscription OAuth、模型、profile、quota。
13. MCP client manager：stdio、Streamable HTTP、SSE、resources、templates、OAuth、tool conversion。
14. ACP provider/session 集成。
15. 插件 runtime：commands、permissions、settings、themes、hooks、status bar、input/quick pick/confirm/tool approval UI。
16. Activity Recorder：截图、OCR、输入事件、浏览器 URL/tab、app focus、session 分析、report、digest、search、suggestions。
17. Computer Use：app/window 状态、截图、点击、拖拽、键盘、滚动、输入、launch、raise、审批和 PIP。
18. Chrome Relay：本地 Chrome 自动化、tab、DOM、截图、上传、导航。
19. WebSearch/WebFetch：隐藏浏览器搜索、Readability、Markdown 转换、小红书/Google cookie 管理。
20. Whisper 本地语音识别：模型状态、下载/初始化、音频转写、麦克风权限。
21. TTS/voice：OpenAI/ElevenLabs 语音生成、临时音频文件、bot voice reply。
22. Telegram、Discord、Feishu、Weixin bridge：外部群聊/频道映射到 Alma threads。
23. Cron jobs 与 heartbeat service：定时任务、群状态、消息投递。
24. Thread archiver 与 snapshot/rollback：workspace thread 归档、文件快照、diff、rollback。
25. 自有通知系统：native package + 透明置顶通知窗口 + queue/action/theme/click-through。
26. 自动更新、Sentry 错误上报、PostHog renderer telemetry 信号。
