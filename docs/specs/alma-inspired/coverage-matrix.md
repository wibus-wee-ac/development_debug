# Alma 覆盖矩阵

本矩阵证明 Alma packaged app 中已经识别出的功能面都被规格化到 `docs/specs/alma-inspired/`。这里的“规格覆盖”只表示是否已经有 spec 覆盖该 Alma 功能，不表示 Cradle 当前已经实现。

## 覆盖状态

- `已覆盖`: 该 Alma 功能已经有一个或多个 spec 明确覆盖。
- `部分覆盖`: 该 Alma 功能只被更宽泛 spec 间接覆盖，需要后续拆分或补证。
- `缺失`: 该 Alma 功能还没有 spec 覆盖。当前矩阵不应出现该状态。

## Synthesis 12 类功能地图

| # | Alma 功能类 | Spec 覆盖 | Spec 文件 |
| --- | --- | --- | --- |
| 1 | 桌面多窗口：主应用、设置、透明通知、lightbox、gallery、prompt-app-runner、livecoding、share、quick chat、more menu、permission overlay | 已覆盖 | [desktop-multi-window.md](desktop-multi-window.md), [custom-notifications.md](custom-notifications.md), [gallery-lightbox.md](gallery-lightbox.md), [prompt-apps.md](prompt-apps.md), [live-coding-strudel.md](live-coding-strudel.md), [conversation-share.md](conversation-share.md), [quick-chat-overlay.md](quick-chat-overlay.md), [permissions-manager.md](permissions-manager.md) |
| 2 | 系统集成：tray、global shortcut、auto start、dock visibility、app icon、CLI wrapper、PATH repair、native clipboard、file dialog、system preview | 已覆盖 | [system-tray-shortcuts.md](system-tray-shortcuts.md), [desktop-update-about.md](desktop-update-about.md), [permissions-manager.md](permissions-manager.md), [conversation-share.md](conversation-share.md), [document-media-preview.md](document-media-preview.md) |
| 3 | 本地 API server：chat、provider、workspace、plugin、MCP、activity、computer use、bot bridge、memory、cron、heartbeat、usage、gallery、snapshot | 已覆盖 | [local-api-server.md](local-api-server.md), [chat-thread-runtime.md](chat-thread-runtime.md), [provider-taxonomy-proxy.md](provider-taxonomy-proxy.md), [workspace-files-git-terminal-preview.md](workspace-files-git-terminal-preview.md), [plugin-runtime-marketplace.md](plugin-runtime-marketplace.md), [mcp-management.md](mcp-management.md), [activity-recorder.md](activity-recorder.md), [computer-use.md](computer-use.md), [external-channel-bridges.md](external-channel-bridges.md), [memory-vector-embeddings.md](memory-vector-embeddings.md), [cron-heartbeat.md](cron-heartbeat.md), [usage-savings.md](usage-savings.md), [gallery-lightbox.md](gallery-lightbox.md), [workspace-snapshots.md](workspace-snapshots.md) |
| 4 | AI provider 与账号：OpenAI、Anthropic、Google、DeepSeek、Azure、OpenRouter、AIHubMix、Moonshot、Kimi、Ollama、Volcengine、Z.ai、Copilot、Claude subscription | 已覆盖 | [provider-taxonomy-proxy.md](provider-taxonomy-proxy.md), [subscription-account-oauth.md](subscription-account-oauth.md), [network-proxy.md](network-proxy.md) |
| 5 | MCP、ACP、插件：MCP transports、OAuth、resources/templates、marketplace、plugin commands、permissions、settings、themes、hooks、status bar、quick pick、input box、confirm dialog、notifications、tool approval | 已覆盖 | [mcp-management.md](mcp-management.md), [mcp-oauth.md](mcp-oauth.md), [acp-runtime.md](acp-runtime.md), [plugin-runtime-marketplace.md](plugin-runtime-marketplace.md), [plugin-ui-primitives.md](plugin-ui-primitives.md), [prompts-skills-hooks.md](prompts-skills-hooks.md) |
| 6 | Prompt Apps：表单化 prompt mini-app、独立 runner、快捷键、模型/工具/reasoning、历史、图片结果重试 | 已覆盖 | [prompt-apps.md](prompt-apps.md), [desktop-multi-window.md](desktop-multi-window.md), [chat-thread-runtime.md](chat-thread-runtime.md), [system-tray-shortcuts.md](system-tray-shortcuts.md) |
| 7 | Workspace 与文件媒体：file tree、terminal、preview server、Git/GitHub、PDF/DOCX/XLSX/PPTX/ZIP/audio/video/image preview、gallery、lightbox | 已覆盖 | [workspace-files-git-terminal-preview.md](workspace-files-git-terminal-preview.md), [document-media-preview.md](document-media-preview.md), [gallery-lightbox.md](gallery-lightbox.md), [workspace-snapshots.md](workspace-snapshots.md), [artifact-rendering.md](artifact-rendering.md) |
| 8 | Activity Recorder 与 Memory：screen、OCR、input events、browser URL/tab、app focus、semantic search、digest、report、suggestions、sqlite-vec、HuggingFace embedding | 已覆盖 | [activity-recorder.md](activity-recorder.md), [memory-vector-embeddings.md](memory-vector-embeddings.md), [permissions-manager.md](permissions-manager.md) |
| 9 | Computer Use 与 Chrome Relay：OS app/window automation、approval、action log、PiP、MCP registration、external Chrome tab/DOM/screenshot/click/type/upload | 已覆盖 | [computer-use.md](computer-use.md), [chrome-relay.md](chrome-relay.md), [permissions-manager.md](permissions-manager.md), [mcp-management.md](mcp-management.md) |
| 10 | WebSearch/WebFetch：hidden browser、Google/Xiaohongshu debug window、cookie import/export/sync、Readability、Markdown 转换 | 已覆盖 | [websearch-webfetch.md](websearch-webfetch.md), [chrome-relay.md](chrome-relay.md), [network-proxy.md](network-proxy.md) |
| 11 | 外部 channel：Telegram、Discord、Feishu、Weixin、channel-to-workspace binding、voice reply、thread mapping | 已覆盖 | [external-channel-bridges.md](external-channel-bridges.md), [people-contacts.md](people-contacts.md), [tts-voice.md](tts-voice.md), [cron-heartbeat.md](cron-heartbeat.md), [chat-thread-runtime.md](chat-thread-runtime.md) |
| 12 | 运营/维护：custom notifications、auto update、Sentry、PostHog、cloud sync、backup、network proxy、usage/RTK savings、cron/heartbeat、fatigue/sleep state | 已覆盖 | [custom-notifications.md](custom-notifications.md), [desktop-update-about.md](desktop-update-about.md), [product-telemetry.md](product-telemetry.md), [backup-cloud-sync.md](backup-cloud-sync.md), [network-proxy.md](network-proxy.md), [usage-savings.md](usage-savings.md), [cron-heartbeat.md](cron-heartbeat.md), [fatigue-sleep-state.md](fatigue-sleep-state.md) |

## ExplorationA 26 项主进程与系统功能

| # | Alma 功能 | Spec 覆盖 | Spec 文件 |
| --- | --- | --- | --- |
| 1 | Electron 多窗口桌面壳 | 已覆盖 | [desktop-multi-window.md](desktop-multi-window.md) |
| 2 | 系统托盘和全局快捷键 | 已覆盖 | [system-tray-shortcuts.md](system-tray-shortcuts.md) |
| 3 | 开机自启、dock 隐藏、app icon、CLI wrapper 和 PATH 修复 | 已覆盖 | [system-tray-shortcuts.md](system-tray-shortcuts.md), [desktop-update-about.md](desktop-update-about.md) |
| 4 | 本地 Express API server | 已覆盖 | [local-api-server.md](local-api-server.md) |
| 5 | 本地 WebSocket | 已覆盖 | [local-api-server.md](local-api-server.md), [chat-thread-runtime.md](chat-thread-runtime.md), [workspace-files-git-terminal-preview.md](workspace-files-git-terminal-preview.md) |
| 6 | SQLite/Drizzle 持久化 | 已覆盖 | [local-data-store.md](local-data-store.md) |
| 7 | FTS 与中文分词 | 已覆盖 | [local-data-store.md](local-data-store.md), [chat-thread-runtime.md](chat-thread-runtime.md), [memory-vector-embeddings.md](memory-vector-embeddings.md) |
| 8 | 向量记忆 | 已覆盖 | [memory-vector-embeddings.md](memory-vector-embeddings.md), [local-data-store.md](local-data-store.md) |
| 9 | 多 provider AI 管理 | 已覆盖 | [provider-taxonomy-proxy.md](provider-taxonomy-proxy.md), [subscription-account-oauth.md](subscription-account-oauth.md) |
| 10 | Provider proxy | 已覆盖 | [provider-taxonomy-proxy.md](provider-taxonomy-proxy.md), [network-proxy.md](network-proxy.md) |
| 11 | Copilot OAuth/device flow | 已覆盖 | [subscription-account-oauth.md](subscription-account-oauth.md) |
| 12 | Claude Subscription OAuth、模型、profile、quota | 已覆盖 | [subscription-account-oauth.md](subscription-account-oauth.md), [provider-taxonomy-proxy.md](provider-taxonomy-proxy.md) |
| 13 | MCP client manager | 已覆盖 | [mcp-management.md](mcp-management.md), [mcp-oauth.md](mcp-oauth.md) |
| 14 | ACP provider/session 集成 | 已覆盖 | [acp-runtime.md](acp-runtime.md) |
| 15 | 插件 runtime、permissions、themes、hooks 和 UI primitives | 已覆盖 | [plugin-runtime-marketplace.md](plugin-runtime-marketplace.md), [plugin-ui-primitives.md](plugin-ui-primitives.md), [prompts-skills-hooks.md](prompts-skills-hooks.md) |
| 16 | Activity Recorder | 已覆盖 | [activity-recorder.md](activity-recorder.md), [memory-vector-embeddings.md](memory-vector-embeddings.md) |
| 17 | Computer Use | 已覆盖 | [computer-use.md](computer-use.md), [permissions-manager.md](permissions-manager.md) |
| 18 | Chrome Relay | 已覆盖 | [chrome-relay.md](chrome-relay.md), [playwright-bidi-runtime.md](playwright-bidi-runtime.md) |
| 19 | WebSearch/WebFetch | 已覆盖 | [websearch-webfetch.md](websearch-webfetch.md), [network-proxy.md](network-proxy.md) |
| 20 | Whisper 本地语音识别 | 已覆盖 | [whisper-asr.md](whisper-asr.md), [permissions-manager.md](permissions-manager.md) |
| 21 | TTS/voice | 已覆盖 | [tts-voice.md](tts-voice.md), [external-channel-bridges.md](external-channel-bridges.md) |
| 22 | Telegram、Discord、Feishu、Weixin bridge | 已覆盖 | [external-channel-bridges.md](external-channel-bridges.md), [people-contacts.md](people-contacts.md) |
| 23 | Cron jobs 与 heartbeat service | 已覆盖 | [cron-heartbeat.md](cron-heartbeat.md), [external-channel-bridges.md](external-channel-bridges.md) |
| 24 | Thread archiver 与 snapshot/rollback | 已覆盖 | [thread-archiver.md](thread-archiver.md), [workspace-snapshots.md](workspace-snapshots.md) |
| 25 | 自有通知系统 | 已覆盖 | [custom-notifications.md](custom-notifications.md), [desktop-multi-window.md](desktop-multi-window.md) |
| 26 | 自动更新、Sentry、PostHog | 已覆盖 | [desktop-update-about.md](desktop-update-about.md), [product-telemetry.md](product-telemetry.md) |

## ExplorationB 22 项 Renderer 与产品功能

| # | Alma 功能 | Spec 覆盖 | Spec 文件 |
| --- | --- | --- | --- |
| 1 | 多窗口 Electron renderer | 已覆盖 | [desktop-multi-window.md](desktop-multi-window.md) |
| 2 | AI 聊天：模型、附件、语音、工具、技能、reasoning、incognito、引用、工具卡片、审批卡片 | 已覆盖 | [chat-thread-runtime.md](chat-thread-runtime.md), [provider-taxonomy-proxy.md](provider-taxonomy-proxy.md), [whisper-asr.md](whisper-asr.md), [prompts-skills-hooks.md](prompts-skills-hooks.md), [plugin-ui-primitives.md](plugin-ui-primitives.md) |
| 3 | QuickChat | 已覆盖 | [quick-chat-overlay.md](quick-chat-overlay.md), [system-tray-shortcuts.md](system-tray-shortcuts.md), [chat-thread-runtime.md](chat-thread-runtime.md) |
| 4 | Prompt Apps | 已覆盖 | [prompt-apps.md](prompt-apps.md), [desktop-multi-window.md](desktop-multi-window.md) |
| 5 | Provider 管理 | 已覆盖 | [provider-taxonomy-proxy.md](provider-taxonomy-proxy.md), [subscription-account-oauth.md](subscription-account-oauth.md), [acp-runtime.md](acp-runtime.md) |
| 6 | Agent Crew | 已覆盖 | [agent-crew-delegation.md](agent-crew-delegation.md), [chat-thread-runtime.md](chat-thread-runtime.md), [acp-runtime.md](acp-runtime.md) |
| 7 | Workspace | 已覆盖 | [workspace-files-git-terminal-preview.md](workspace-files-git-terminal-preview.md), [workspace-snapshots.md](workspace-snapshots.md) |
| 8 | Artifact | 已覆盖 | [artifact-rendering.md](artifact-rendering.md), [document-media-preview.md](document-media-preview.md), [chat-thread-runtime.md](chat-thread-runtime.md) |
| 9 | 文件预览 | 已覆盖 | [document-media-preview.md](document-media-preview.md), [gallery-lightbox.md](gallery-lightbox.md) |
| 10 | Gallery/Lightbox | 已覆盖 | [gallery-lightbox.md](gallery-lightbox.md), [desktop-multi-window.md](desktop-multi-window.md) |
| 11 | Share | 已覆盖 | [conversation-share.md](conversation-share.md) |
| 12 | 自定义通知 | 已覆盖 | [custom-notifications.md](custom-notifications.md), [desktop-multi-window.md](desktop-multi-window.md) |
| 13 | MCP | 已覆盖 | [mcp-management.md](mcp-management.md), [mcp-oauth.md](mcp-oauth.md) |
| 14 | Plugins | 已覆盖 | [plugin-runtime-marketplace.md](plugin-runtime-marketplace.md), [plugin-ui-primitives.md](plugin-ui-primitives.md) |
| 15 | Prompts/Skills/Hooks | 已覆盖 | [prompts-skills-hooks.md](prompts-skills-hooks.md), [prompt-apps.md](prompt-apps.md) |
| 16 | Memory | 已覆盖 | [memory-vector-embeddings.md](memory-vector-embeddings.md), [activity-recorder.md](activity-recorder.md) |
| 17 | Activity Recorder | 已覆盖 | [activity-recorder.md](activity-recorder.md), [permissions-manager.md](permissions-manager.md) |
| 18 | Computer Use | 已覆盖 | [computer-use.md](computer-use.md), [permissions-manager.md](permissions-manager.md) |
| 19 | Channels/People | 已覆盖 | [external-channel-bridges.md](external-channel-bridges.md), [people-contacts.md](people-contacts.md), [cron-heartbeat.md](cron-heartbeat.md) |
| 20 | Whisper/TTS | 已覆盖 | [whisper-asr.md](whisper-asr.md), [tts-voice.md](tts-voice.md) |
| 21 | Web Search/Web Fetch | 已覆盖 | [websearch-webfetch.md](websearch-webfetch.md), [chrome-relay.md](chrome-relay.md) |
| 22 | UI/Theme/Network/Keybindings/Data/Usage/About | 已覆盖 | [ui-theme-keybindings.md](ui-theme-keybindings.md), [network-proxy.md](network-proxy.md), [backup-cloud-sync.md](backup-cloud-sync.md), [usage-savings.md](usage-savings.md), [desktop-update-about.md](desktop-update-about.md), [product-telemetry.md](product-telemetry.md) |

## Final Gap 28 项映射

| Gap # | 综合报告缺口 | Spec 覆盖 | Spec 文件 |
| --- | --- | --- | --- |
| 1 | Prompt Apps 与独立 runner | 已覆盖 | [prompt-apps.md](prompt-apps.md) |
| 2 | Quick Chat overlay | 已覆盖 | [quick-chat-overlay.md](quick-chat-overlay.md) |
| 3 | 自定义通知中心 | 已覆盖 | [custom-notifications.md](custom-notifications.md) |
| 4 | Gallery + Lightbox | 已覆盖 | [gallery-lightbox.md](gallery-lightbox.md) |
| 5 | Conversation Share | 已覆盖 | [conversation-share.md](conversation-share.md) |
| 6 | 本地 Whisper ASR 与麦克风权限 | 已覆盖 | [whisper-asr.md](whisper-asr.md), [permissions-manager.md](permissions-manager.md) |
| 7 | TTS/voice replies | 已覆盖 | [tts-voice.md](tts-voice.md) |
| 8 | 第三方 IM bridges | 已覆盖 | [external-channel-bridges.md](external-channel-bridges.md), [people-contacts.md](people-contacts.md) |
| 9 | People/contact profiles | 已覆盖 | [people-contacts.md](people-contacts.md) |
| 10 | MCP 管理 UI | 已覆盖 | [mcp-management.md](mcp-management.md) |
| 11 | MCP OAuth lifecycle | 已覆盖 | [mcp-oauth.md](mcp-oauth.md) |
| 12 | GitHub Copilot 与 Claude Subscription | 已覆盖 | [subscription-account-oauth.md](subscription-account-oauth.md) |
| 13 | 更广 provider taxonomy | 已覆盖 | [provider-taxonomy-proxy.md](provider-taxonomy-proxy.md) |
| 14 | Plugin UI primitives | 已覆盖 | [plugin-ui-primitives.md](plugin-ui-primitives.md) |
| 15 | Workspace/file snapshot-diff-rollback | 已覆盖 | [workspace-snapshots.md](workspace-snapshots.md) |
| 16 | General document/media preview | 已覆盖 | [document-media-preview.md](document-media-preview.md) |
| 17 | WebSearch/WebFetch 产品化 | 已覆盖 | [websearch-webfetch.md](websearch-webfetch.md) |
| 18 | Playwright/Chromium BiDi runtime | 已覆盖 | [playwright-bidi-runtime.md](playwright-bidi-runtime.md) |
| 19 | Activity Recorder | 已覆盖 | [activity-recorder.md](activity-recorder.md) |
| 20 | Local Transformers + sqlite-vec | 已覆盖 | [memory-vector-embeddings.md](memory-vector-embeddings.md) |
| 21 | Computer Use | 已覆盖 | [computer-use.md](computer-use.md) |
| 22 | Chrome Relay | 已覆盖 | [chrome-relay.md](chrome-relay.md) |
| 23 | Live Coding / Strudel | 已覆盖 | [live-coding-strudel.md](live-coding-strudel.md) |
| 24 | Network proxy settings | 已覆盖 | [network-proxy.md](network-proxy.md) |
| 25 | Data backup/cloud sync | 已覆盖 | [backup-cloud-sync.md](backup-cloud-sync.md) |
| 26 | App lifecycle settings | 已覆盖 | [system-tray-shortcuts.md](system-tray-shortcuts.md), [desktop-update-about.md](desktop-update-about.md) |
| 27 | Product telemetry/crash reporting | 已覆盖 | [product-telemetry.md](product-telemetry.md) |
| 28 | Cron/heartbeat/channel status | 已覆盖 | [cron-heartbeat.md](cron-heartbeat.md) |

## 复核结论

三组来源均无 `missing`：综合报告 12 类功能地图、ExplorationA 26 项主进程/系统功能、ExplorationB 22 项 renderer/产品功能全部映射到具体 spec。最终缺口 28 项也全部映射到 spec 文件。新增的 [agent-crew-delegation.md](agent-crew-delegation.md)、[artifact-rendering.md](artifact-rendering.md)、[prompts-skills-hooks.md](prompts-skills-hooks.md) 和 [desktop-update-about.md](desktop-update-about.md) 用于补足原 40 个 spec 中偏宽泛或隐含的 Alma 功能面。
