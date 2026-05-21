<!--
Input: Alma packaged app evidence, Cradle current capability map, and gap synthesis report.
Output: Alma-inspired spec index and coverage map.
Position: docs/specs/alma-inspired/README.md
-->

# Alma-Inspired Specs

这个目录把 Alma 的功能面拆成可执行规格。每个 spec 都包含 Alma 证据、Cradle 当前状态、owner/namespace、目标行为、API/UI/data 草案和验收口径。

## Coverage Policy

覆盖口径不是“同名文件存在”，而是用户可见能力等价。Cradle 已经具备等价能力的点会标记为 covered，并引用现有 owner；Cradle 只有底层技术基础但缺产品闭环的点会标记为 partial；完全没有的点会标记为 missing。

## Spec Index

| # | Spec | Status | Primary owner |
| --- | --- | --- | --- |
| 01 | [desktop-multi-window.md](desktop-multi-window.md) | partial | `apps/desktop` |
| 02 | [system-tray-shortcuts.md](system-tray-shortcuts.md) | partial | `apps/desktop` |
| 03 | [local-api-server.md](local-api-server.md) | covered | `apps/server` |
| 04 | [local-data-store.md](local-data-store.md) | covered | `packages/db` |
| 05 | [chat-thread-runtime.md](chat-thread-runtime.md) | covered | `apps/server/src/modules/chat-runtime` |
| 06 | [provider-taxonomy-proxy.md](provider-taxonomy-proxy.md) | partial | `apps/server/src/modules/providers` |
| 07 | [subscription-account-oauth.md](subscription-account-oauth.md) | missing | `profiles` / `secrets` |
| 08 | [mcp-management.md](mcp-management.md) | partial | `plugins` / future `mcp` module |
| 09 | [mcp-oauth.md](mcp-oauth.md) | missing | future `mcp-oauth` module |
| 10 | [acp-runtime.md](acp-runtime.md) | covered | `apps/server/src/modules/acp` |
| 11 | [plugin-runtime-marketplace.md](plugin-runtime-marketplace.md) | partial | `apps/server/src/plugins` |
| 12 | [plugin-ui-primitives.md](plugin-ui-primitives.md) | missing | `packages/plugin-sdk` |
| 13 | [prompt-apps.md](prompt-apps.md) | missing | future `prompt-apps` module |
| 14 | [workspace-files-git-terminal-preview.md](workspace-files-git-terminal-preview.md) | partial | `workspace` / `git` / `pty` |
| 15 | [document-media-preview.md](document-media-preview.md) | missing | future `file-preview` feature |
| 16 | [gallery-lightbox.md](gallery-lightbox.md) | missing | future `assets` module |
| 17 | [conversation-share.md](conversation-share.md) | missing | future `share` feature |
| 18 | [custom-notifications.md](custom-notifications.md) | missing | `apps/desktop` |
| 19 | [quick-chat-overlay.md](quick-chat-overlay.md) | missing | `apps/desktop` + chat runtime |
| 20 | [permissions-manager.md](permissions-manager.md) | missing | `apps/desktop` + preferences |
| 21 | [whisper-asr.md](whisper-asr.md) | missing | Chronicle or chat input owner |
| 22 | [tts-voice.md](tts-voice.md) | missing | future `voice` module |
| 23 | [external-channel-bridges.md](external-channel-bridges.md) | missing | future `channels` module |
| 24 | [people-contacts.md](people-contacts.md) | missing | future `people` module |
| 25 | [memory-vector-embeddings.md](memory-vector-embeddings.md) | partial | `chronicle` |
| 26 | [activity-recorder.md](activity-recorder.md) | partial | `chronicle` |
| 27 | [computer-use.md](computer-use.md) | missing | future `computer-use` module |
| 28 | [chrome-relay.md](chrome-relay.md) | partial | `plugins/browser-use` or future connector |
| 29 | [websearch-webfetch.md](websearch-webfetch.md) | missing | future `web-fetch` module |
| 30 | [playwright-bidi-runtime.md](playwright-bidi-runtime.md) | missing | future browser automation owner |
| 31 | [cron-heartbeat.md](cron-heartbeat.md) | partial | `automation` + future `channels` |
| 32 | [thread-archiver.md](thread-archiver.md) | partial | `session` / `workspace` |
| 33 | [workspace-snapshots.md](workspace-snapshots.md) | missing | future `workspace-snapshots` module |
| 34 | [network-proxy.md](network-proxy.md) | missing | future `network` preferences |
| 35 | [backup-cloud-sync.md](backup-cloud-sync.md) | missing | future `backup` module |
| 36 | [product-telemetry.md](product-telemetry.md) | missing | desktop/web telemetry owner |
| 37 | [usage-savings.md](usage-savings.md) | partial | `usage` |
| 38 | [fatigue-sleep-state.md](fatigue-sleep-state.md) | missing | future personal state owner |
| 39 | [live-coding-strudel.md](live-coding-strudel.md) | missing | future `live-coding` feature |
| 40 | [ui-theme-keybindings.md](ui-theme-keybindings.md) | partial | `preferences` / web settings |

## Source Evidence

主要证据来自 `docs/multi-work/alma-cradle-gap-analysis/20260521-alma-cradle-gap-synthesis-Main.md` 以及四份 Exploration handoff。Alma 目录是 packaged build output，因此 spec 里所有 Alma 行为均按“本地证据强度”标注：HTML 入口、preload IPC、main IPC/API route、renderer chunk/组件名、数据库表/依赖、UI 文案。
