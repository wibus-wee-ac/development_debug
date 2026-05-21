<!--
Input: Alma Telegram/Discord/Feishu/Weixin evidence and Cradle Slack/connector gap.
Output: Spec for external channel bridges.
Position: docs/specs/alma-inspired/external-channel-bridges.md
-->

# External Channel Bridges

## Goal

Cradle should support external messaging channels as first-class entrypoints into Cradle sessions without letting channel connectors own workspace, session, or chat semantics.

## Alma Evidence

Alma integrates Telegram, Discord, Feishu, and Weixin. It maps external chats/channels to threads, forwards files and voice, supports group/channel status, and can bind channel conversations to workspaces.

## Cradle Current State

Cradle has a separate Slack bridge app and Chronicle schema hints for `slack`, but no unified Telegram/Discord/Feishu/Weixin channel module or channel-to-workspace binding.

## Target Ownership

A future `channels` server module owns canonical channel mappings, workspace bindings, delivery status, and message provenance. Individual connector apps or plugins own protocol-specific authentication, webhooks, polling, and message formatting.

## Target Behavior

- External conversations can be mapped to Cradle sessions and workspaces.
- Incoming channel messages run through chat runtime with source provenance.
- Outgoing replies preserve channel-specific formatting and file constraints.
- Connectors never write directly into session tables except through channel-owned ingestion APIs.

## API Sketch

- `GET /channels`
- `POST /channels/:kind/conversations/:externalId/bind`
- `POST /channels/:kind/messages/ingest`
- `POST /channels/:kind/messages/:id/reply`
- `GET /channels/status`

## Data Model

Tables should include `channel_accounts`, `channel_conversations`, `channel_workspace_bindings`, `channel_message_sources`, and `channel_delivery_attempts`.

## Acceptance

- A Discord message can create or resume a Cradle session through the channel module.
- Deleting a workspace disables related channel bindings without deleting connector credentials.
- Channel credentials are stored only in `secrets`.
