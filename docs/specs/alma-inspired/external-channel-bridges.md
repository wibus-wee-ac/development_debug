<!--
Input: Alma Telegram/Discord/Feishu/Weixin evidence and Cradle Slack/connector gap.
Output: Spec for external channel bridges.
Position: docs/specs/alma-inspired/external-channel-bridges.md
-->

# 外部 Channel Bridges

## 目标

Cradle 需要把外部消息 channel 作为进入 Cradle sessions 的 first-class entrypoints，同时不能让 connector 拥有 workspace、session 或 chat runtime 的语义。

## Alma 证据

Alma 集成 Telegram、Discord、Feishu、Weixin。它把外部 chats/channels 映射到 threads，转发文件和语音，支持 group/channel status，并能把 channel conversation 绑定到 workspace。

## Cradle 当前状态

Cradle 有独立 Slack bridge app 和 Chronicle schema 中的 `slack` 线索，但没有统一 Telegram/Discord/Feishu/Weixin channel module，也没有 channel-to-workspace binding。

## Owner / Namespace

未来 `channels` server module 拥有 canonical channel mappings、workspace bindings、delivery status 和 message provenance。各 connector app 或 plugin 只拥有协议级 auth、webhooks、polling、message formatting。

## 目标行为

- External conversations 可映射到 Cradle sessions 和 workspaces。
- Incoming channel message 通过 chat runtime 执行，并带 source provenance。
- Outgoing replies 保留 channel-specific formatting 和 file constraints。
- Connector 不直接写 session tables，只调用 channel-owned ingestion APIs。

## API 草案

- `GET /channels`
- `POST /channels/:kind/conversations/:externalId/bind`
- `POST /channels/:kind/messages/ingest`
- `POST /channels/:kind/messages/:id/reply`
- `GET /channels/status`

## 数据模型

表应包含 `channel_accounts`、`channel_conversations`、`channel_workspace_bindings`、`channel_message_sources`、`channel_delivery_attempts`。

## 验收

- Discord message 可以通过 channel module 创建或恢复 Cradle session。
- 删除 workspace 会禁用相关 channel bindings，但不删除 connector credentials。
- Channel credentials 只存入 `secrets`。
