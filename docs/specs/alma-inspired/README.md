<!--
Input: Alma packaged app evidence, Cradle current capability map, and gap synthesis report.
Output: Alma-inspired spec index and coverage map.
Position: docs/specs/alma-inspired/README.md
-->

# Alma-inspired 规格

这个目录把 Alma 的功能面拆成可执行规格。每个 spec 都包含 Alma 证据、Cradle 当前状态、owner/namespace、目标行为、API/UI/data 草案和验收口径。

## 覆盖口径

覆盖口径不是“同名文件存在”，而是用户可见能力等价。Cradle 已经具备等价能力的点会标记为“已覆盖”，并引用现有 owner；Cradle 只有底层技术基础但缺产品闭环的点会标记为“部分覆盖”；完全没有的点会标记为“缺失”。

全量证据映射见 [coverage-matrix.md](coverage-matrix.md)。该矩阵的“规格覆盖”字段只表示 Alma 功能是否已经被规格文档覆盖，不表示 Cradle 已经实现。

## 规格索引

| # | 规格 | Cradle 状态 | 主要 owner |
| --- | --- | --- | --- |
| 01 | [desktop-multi-window.md](desktop-multi-window.md) | 部分覆盖 | `apps/desktop` |
| 02 | [system-tray-shortcuts.md](system-tray-shortcuts.md) | 部分覆盖 | `apps/desktop` |
| 03 | [local-api-server.md](local-api-server.md) | 已覆盖 | `apps/server` |
| 04 | [local-data-store.md](local-data-store.md) | 已覆盖 | `packages/db` |
| 05 | [chat-thread-runtime.md](chat-thread-runtime.md) | 已覆盖 | `apps/server/src/modules/chat-runtime` |
| 06 | [provider-taxonomy-proxy.md](provider-taxonomy-proxy.md) | 部分覆盖 | `apps/server/src/modules/providers` |
| 07 | [subscription-account-oauth.md](subscription-account-oauth.md) | 缺失 | `profiles` / `secrets` |
| 08 | [mcp-management.md](mcp-management.md) | 部分覆盖 | `plugins` / future `mcp` module |
| 09 | [mcp-oauth.md](mcp-oauth.md) | 缺失 | future `mcp-oauth` module |
| 10 | [acp-runtime.md](acp-runtime.md) | 已覆盖 | `apps/server/src/modules/acp` |
| 11 | [plugin-runtime-marketplace.md](plugin-runtime-marketplace.md) | 部分覆盖 | `apps/server/src/plugins` |
| 12 | [plugin-ui-primitives.md](plugin-ui-primitives.md) | 缺失 | `packages/plugin-sdk` |
| 13 | [prompt-apps.md](prompt-apps.md) | 缺失 | future `prompt-apps` module |
| 14 | [workspace-files-git-terminal-preview.md](workspace-files-git-terminal-preview.md) | 部分覆盖 | `workspace` / `git` / `pty` |
| 15 | [document-media-preview.md](document-media-preview.md) | 缺失 | future `file-preview` feature |
| 16 | [gallery-lightbox.md](gallery-lightbox.md) | 缺失 | future `assets` module |
| 17 | [conversation-share.md](conversation-share.md) | 缺失 | future `share` feature |
| 18 | [custom-notifications.md](custom-notifications.md) | 缺失 | `apps/desktop` |
| 19 | [quick-chat-overlay.md](quick-chat-overlay.md) | 缺失 | `apps/desktop` + chat runtime |
| 20 | [permissions-manager.md](permissions-manager.md) | 缺失 | `apps/desktop` + preferences |
| 21 | [whisper-asr.md](whisper-asr.md) | 缺失 | Chronicle or chat input owner |
| 22 | [tts-voice.md](tts-voice.md) | 缺失 | future `voice` module |
| 23 | [external-channel-bridges.md](external-channel-bridges.md) | 缺失 | future `channels` module |
| 24 | [people-contacts.md](people-contacts.md) | 缺失 | future `people` module |
| 25 | [memory-vector-embeddings.md](memory-vector-embeddings.md) | 部分覆盖 | `chronicle` |
| 26 | [activity-recorder.md](activity-recorder.md) | 部分覆盖 | `chronicle` |
| 27 | [computer-use.md](computer-use.md) | 缺失 | future `computer-use` module |
| 28 | [chrome-relay.md](chrome-relay.md) | 部分覆盖 | `plugins/browser-use` or future connector |
| 29 | [websearch-webfetch.md](websearch-webfetch.md) | 缺失 | future `web-fetch` module |
| 30 | [playwright-bidi-runtime.md](playwright-bidi-runtime.md) | 缺失 | future browser automation owner |
| 31 | [cron-heartbeat.md](cron-heartbeat.md) | 部分覆盖 | `automation` + future `channels` |
| 32 | [thread-archiver.md](thread-archiver.md) | 部分覆盖 | `session` / `workspace` |
| 33 | [workspace-snapshots.md](workspace-snapshots.md) | 缺失 | future `workspace-snapshots` module |
| 34 | [network-proxy.md](network-proxy.md) | 缺失 | future `network` preferences |
| 35 | [backup-cloud-sync.md](backup-cloud-sync.md) | 缺失 | future `backup` module |
| 36 | [product-telemetry.md](product-telemetry.md) | 缺失 | desktop/web telemetry owner |
| 37 | [usage-savings.md](usage-savings.md) | 部分覆盖 | `usage` |
| 38 | [fatigue-sleep-state.md](fatigue-sleep-state.md) | 缺失 | future personal state owner |
| 39 | [live-coding-strudel.md](live-coding-strudel.md) | 缺失 | future `live-coding` feature |
| 40 | [ui-theme-keybindings.md](ui-theme-keybindings.md) | 部分覆盖 | `preferences` / web settings |
| 41 | [agent-crew-delegation.md](agent-crew-delegation.md) | 部分覆盖 | `agent-identity` / `issue-agent` / `chat-runtime` |
| 42 | [artifact-rendering.md](artifact-rendering.md) | 部分覆盖 | `apps/web/src/features/chat` / future `artifacts` |
| 43 | [prompts-skills-hooks.md](prompts-skills-hooks.md) | 部分覆盖 | `skills` / future `prompts` / `plugins` |
| 44 | [desktop-update-about.md](desktop-update-about.md) | 部分覆盖 | `apps/desktop` / `preferences` |

## 文件库存

- **README.md**: 本目录说明和 spec 索引。
- **coverage-matrix.md**: Alma 功能证据到 spec 文件的全量覆盖矩阵。
- **agent-crew-delegation.md**: Agent crew、delegation、routing preview 和 delegation graph 规格。
- **artifact-rendering.md**: Chat artifact renderer、sandbox 和 preview/code switching 规格。
- **desktop-update-about.md**: Desktop update、About 和 release diagnostics 规格。
- **prompts-skills-hooks.md**: Prompts、skills、hooks 的 owner 与产品边界规格。

## 证据来源

主要证据来自 `docs/multi-work/alma-cradle-gap-analysis/20260521-alma-cradle-gap-synthesis-Main.md` 以及四份 Exploration handoff。Alma 目录是 packaged build output，因此 spec 里所有 Alma 行为均按“本地证据强度”标注：HTML 入口、preload IPC、main IPC/API route、renderer chunk/组件名、数据库表/依赖、UI 文案。
