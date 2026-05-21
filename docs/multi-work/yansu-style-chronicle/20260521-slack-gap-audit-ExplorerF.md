# Chronicle Slack Message Scanner Gap Audit

Date: 2026-05-21
Agent: ExplorerF
Scope: 只审计 `docs/draft-solutions/yansu-chronicle-spec.md` 与当前 Chronicle 实现之间，在 Slack/message scanner 能力上的差距。未修改业务代码。

## 直接结论

当前 Cradle Chronicle 已经具备 screen/OCR snapshot、memory ingest、远程 summary、Settings UI 和通用 secret/provider 基础设施，但没有实现 Yansu spec 中的 Slack/message scanner 能力。

最小可用路径不应把 Slack 作为 provider profile 的子能力，也不应写入 `apps/zhi-slack-bridge` 的私有命名空间。建议由 Chronicle 拥有 Slack scanner 的语义与 DB namespace：Server 保存 scanner config/status/message ingest contract，secrets 只保存加密 token，Rust daemon 或 Server worker 负责连接 Slack Socket Mode / Events API 并把消息写入 Chronicle-owned tables，最终让 Slack messages 进入 Chronicle timeline 与 memory pipeline。

## 当前已有证据

- Spec 明确把 `MessageScanner` 放在 Listen 层，目标是被动监听 Slack/Discord/Telegram/WeChat/Feishu/Teams/RingCentral，并转成统一活动事件。
- Spec 中 Slack 行为包括 `Connect()`, `Disconnect()`, `Scan()`, `SendMessage()`, `SendDM()`, `DownloadFile()`，并列出 Slack 读消息为 `WebSocket RTM / Events API`，发消息为 `Web API`，文件为 `files.upload`。
- 当前 Server Chronicle 只暴露 `/chronicle/config`, `/chronicle/status`, `/chronicle/resources`, `/chronicle/model-resources`, `/chronicle/timeline`, `/chronicle/snapshots`, `/chronicle/memories`, `/chronicle/memories/search`, `/chronicle/summarize`。
- `packages/db/src/schema/chronicle.ts` 只有 `chronicle_snapshots`, `chronicle_memories`, `chronicle_model_resources`, `chronicle_events`，没有 message source、message event、channel、thread、cursor、scanner run、dedup hash 等表。
- `chronicle/src` 只包含 screen capture、OCR、recorder、memory pipeline、Server client；`Cargo.toml` 没有 Slack SDK 或 WebSocket 依赖。
- `chronicle/src/cradle_client.rs` 只上报 `/chronicle/snapshots` 和 `/chronicle/memories`，没有 message ingest endpoint。
- `apps/web/src/features/chronicle` 只显示 capture 开关、model selector、runtime status、local model resources、timeline、memories 和 memory search，没有 Slack 连接、channel selection、scanner status、message preview 或 permission health UI。
- `apps/server/src/modules/secrets` 已有 `agent_credentials` 加密存储和 `readSecret()`，可复用为 Slack bot/app/signing token 的秘密值存储。
- `apps/server/src/modules/providers` 只面向 LLM provider metadata/model list/health check，provider kind 当前为 `openai-compatible | anthropic`。Slack scanner 不应塞进 provider profile。
- `apps/zhi-slack-bridge` 是独立 MCP human-in-the-loop bridge，使用 Slack Socket Mode、`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`，并包含 Slack app setup 文档。它证明仓库已有 Slack 集成经验，但其语义是 agent tool routing，不是 Chronicle passive scanner。

## 缺失能力

- 缺少 Chronicle-owned Slack scanner configuration：workspace/team、enabled、selected channels、mode、credential refs、cursor、retention、privacy policy。
- 缺少 Slack message ingest API：无法把 Slack message 作为 Chronicle event 写入 DB。
- 缺少 message 数据模型：没有 platform message id、team id、channel id、thread ts、user id/name、text、attachments、files、permalink、timestamps、dedup hash、raw payload metadata。
- 缺少 scanner lifecycle：没有 start/stop/status、reconnect/backoff、rate-limit handling、last error、last event time、cursor checkpoint。
- 缺少 Slack auth/secret UI：Chronicle Settings 不能保存或选择 Slack bot token/app token/signing secret，也不能做 health check。
- 缺少消息到 memory pipeline 的桥：现有 memory 只由 OCR frames 和 summary prompt 生成，不能把 Slack messages 作为 `chat` segment 输入。
- 缺少去重策略：Spec 要求 exact hash 与 embedding dedup；当前 Chronicle 只有 snapshot sourceId upsert 和 memory sourceId upsert。
- 缺少 send 行为：Spec 的 Slack `SendMessage`, `SendDM`, `DownloadFile` 未在 Chronicle 或通用 communication API 中实现。

## 建议的 Cradle Ownership / Namespace

推荐 ownership：

- `chronicle` owns passive activity semantics, scanner lifecycle, message event storage, dedup, timeline/memory integration。
- `secrets` owns encrypted secret value lifecycle only；Chronicle 只保存 `credentialRef`，不复制 token 明文。
- `providers` owns LLM provider/model metadata only；Slack scanner 不进入 provider namespace。
- `apps/zhi-slack-bridge` owns MCP human-in-the-loop bridge only；Chronicle 可以参考 setup/scope/runtime 经验，但不能写入其 `~/.zhi-slack-bridge` 数据目录，也不应复用其 persistent state。

建议 namespace：

- DB: `chronicle_message_sources`, `chronicle_messages`, `chronicle_message_cursors`, 可选 `chronicle_message_attachments`。
- API: `/chronicle/message-sources/*`, `/chronicle/messages/*`, `/chronicle/scanners/slack/*`。
- Secret kind: `chronicle.slack.bot-token`, `chronicle.slack.app-token`, `chronicle.slack.signing-secret`。
- Rust module: `chronicle/src/message_scanner/*` 或 Server module worker 二选一，但 ingest contract 仍由 Server Chronicle 拥有。

## 最小可用 Slack 行为闭环

建议 MVP 收敛为“被动读消息到 Chronicle memory”，不要先做全平台抽象和发消息：

1. 用户在 Settings > Chronicle > Slack 添加 Slack credentials，并启用 scanner。
2. Server 保存 `chronicle_message_sources`，token 明文写入 `agent_credentials`，source 只保存 refs。
3. Scanner 连接 Slack Socket Mode 或 Events API，监听 bot 所在 channel 的 `message.channels` / `message.groups`。
4. 每条 Slack message 被规范化为 `chronicle_messages`，用 `source_id + slack_team_id + channel_id + ts` 做唯一键。
5. Timeline 增加 `sourceType = "message"` 的 recent events，至少展示 channel、user、text、timestamp。
6. Memory summarization prompt 合并指定时间窗口内的 OCR snapshots 与 Slack messages，生成 `chronicle_memories`，metadata 记录 message ids。
7. UI 显示 scanner status、last message time、last error、ingested count，并支持手动 refresh。

MVP 暂不建议包含：

- `SendMessage`, `SendDM`, file upload/download。
- 多平台 scanner interface。
- embedding semantic dedup。
- 历史全量 backfill。

这些可作为 Phase 2，因为它们会扩大 permissions、rate limit、privacy 和 UI 行为面。

## 需要的 DB Changes

最小 schema：

```ts
chronicleMessageSources
chronicleMessages
chronicleMessageCursors
```

建议字段：

- `chronicle_message_sources`: `id`, `platform`, `label`, `enabled`, `workspaceId`, `teamId`, `botTokenRef`, `appTokenRef`, `signingSecretRef`, `configJson`, `status`, `lastEventAt`, `lastError`, timestamps。
- `chronicle_messages`: `id`, `sourceId`, `platform`, `externalMessageId`, `teamId`, `channelId`, `channelName`, `threadId`, `userId`, `userName`, `text`, `isDm`, `messageTs`, `permalink`, `attachmentsJson`, `rawJson`, `dedupHash`, timestamps。
- `chronicle_message_cursors`: `id`, `sourceId`, `channelId`, `cursorJson`, `updatedAt`。

Indexes:

- unique `(sourceId, externalMessageId)` 或 `(sourceId, channelId, messageTs)`。
- `messageTs` descending。
- `(sourceId, messageTs)`。
- `dedupHash`。
- 可选 `(workspaceId, messageTs)`，保持 Chronicle 与 workspace 查询一致。

## 需要的 API / Server Changes

- 增加 message source CRUD：`GET/POST/PATCH/DELETE /chronicle/message-sources`。
- 增加 Slack health check：`POST /chronicle/scanners/slack/health-check`，读取 secret refs 后验证 auth。
- 增加 scanner lifecycle：`POST /chronicle/scanners/:sourceId/start`, `POST /chronicle/scanners/:sourceId/stop`, `GET /chronicle/scanners/:sourceId/status`。
- 增加 message ingest：`POST /chronicle/messages`，由 scanner 调用，Server 负责 upsert、dedup、event logging。
- 扩展 `/chronicle/status`：返回 message scanner counts、lastMessageAt、lastScannerError。
- 扩展 `/chronicle/timeline` 或新增 `/chronicle/activity-events`：统一返回 snapshot 和 message events，避免 Web 侧拼接两个语义源。
- 扩展 `summarize()`：允许 `sourceMessageIds` 或时间窗口查询 messages，将 Slack context 放进 summary prompt。

Server worker vs Rust daemon：

- 若优先交付 Slack MVP，建议先放在 Server worker。理由是现有 Slack TypeScript 经验在 `apps/zhi-slack-bridge`，secret/provider/db 都在 Server，迭代成本低。
- 若长期要统一本地 daemon 的 Listen 层，可以后续把 scanner 下沉到 Rust daemon，但要先定义稳定 `/chronicle/messages` ingest contract，避免 Rust 直接拥有 DB 语义。

## 需要的 Web UI Changes

- 在 `apps/web/src/features/chronicle` 增加 Slack integration section。
- UI 控件至少包括：enabled switch、bot token/app token/signing secret refs、health check button、channel scope hint、last message、last error、ingested count。
- Timeline 支持 message entries：icon、channel、user、text excerpt、timestamp。
- Memory prompt/source preview 支持显示 message source count。
- Hook 层继续作为兼容边界，但新增类型应收紧为 Chronicle API generated types，不要扩散 `unknown` cast。

## 需要的 Rust 或 Server Scanner Changes

Server-first MVP：

- 新增 `apps/server/src/modules/chronicle/slack-scanner.ts` 或 Chronicle-owned scanner manager。
- 复用 `@slack/bolt` 或 Slack Web API/Socket Mode client。
- 从 `secrets.readSecret()` 读取 token。
- 监听 message event，规范化后调用 Chronicle service `recordMessage()`。
- 维护 in-memory connection map，并把状态写回 `chronicle_message_sources`。

Rust-later path：

- 增加 `chronicle/src/message_scanner`。
- 增加 config args/env 或从 `/chronicle/config` 拉取 scanner source metadata。
- Rust 不持久化 token；由 Server 下发短生命周期 scanner config 或由 Rust 调用 Server proxy endpoint。
- Rust 通过 `/chronicle/messages` 上报 normalized message，仍由 Server 负责 DB ownership。

不建议让 Rust 直接读 `agent_credentials` 或直接写 SQLite，因为这会绕开 secrets ownership 和 Server schema/API 边界。

## 验证方式

静态验证：

```bash
rg -n "slack|MessageScanner|chronicle_messages|message-sources" apps/server/src/modules/chronicle packages/db/src/schema apps/web/src/features/chronicle chronicle/src
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/web exec eslint src/features/chronicle
pnpm exec drizzle-kit generate --config drizzle.config.ts
```

Server tests:

- `recordMessage()` upserts same Slack `channelId + ts` instead of duplicating。
- `recordMessage()` stores raw payload metadata but never stores token。
- scanner health check maps missing secret to `secret_not_found` / `secret_not_configured` cleanly。
- `/chronicle/timeline` returns mixed snapshot/message order by captured/message time。
- summarization includes selected Slack messages and writes message ids into `chronicle_memories.metadataJson` or a dedicated source ids field。

Scanner integration tests:

- Mock Slack Socket Mode event with normal channel message。
- Mock thread reply with `thread_ts`。
- Ignore bot self messages if configured。
- Reconnect/backoff updates status and last error。

Manual MVP check:

1. Create Slack app with Socket Mode and scopes from `apps/zhi-slack-bridge/README.md` as a reference: `chat:write`, `commands`, `channels:history`, `groups:history`, `message.channels`, `message.groups`, plus `connections:write` for app token。
2. Save credentials through Chronicle UI。
3. Enable Slack scanner。
4. Post a message in an invited channel。
5. Confirm `chronicle_messages` row appears and `/chronicle/status` shows `lastMessageAt`。
6. Confirm Chronicle timeline shows the message。
7. Trigger/await summary and confirm the memory references Slack message ids。

## Residual Risks

- Slack permissions are sensitive: MVP must avoid requesting file or DM scopes until send/download behavior is actually implemented。
- Socket Mode long-running lifecycle overlaps with existing Chronicle daemon lifecycle. A Server-first scanner should have explicit cleanup on process shutdown。
- Message privacy is more sensitive than OCR snippets because channel history can include third parties. Channel allowlist and visible status should be part of MVP, not Phase 2。
- The current search implementation is substring search over memories only. Message search should not be implied until a dedicated `/chronicle/messages/search` or memory integration lands。
