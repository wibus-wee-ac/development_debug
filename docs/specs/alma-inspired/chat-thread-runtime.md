<!--
Input: Alma chat/thread route evidence and Cradle chat runtime audit.
Output: Spec for chat/thread runtime coverage.
Position: docs/specs/alma-inspired/chat-thread-runtime.md
-->

# Chat Thread Runtime

## 目标

Cradle 应把 chat runtime 继续作为 user messages、agent runs、tool calls、approvals、usage、session persistence 的 canonical execution surface。

## Alma 证据

Alma 暴露 chat completions、threads、messages、rollback、branch、compact、switch、WebSocket generation、tool calls、citations、command surfaces，并能把外部 channel 映射到 threads。

## Cradle 当前状态

Cradle 已有 `chat-runtime`、`session`、`approval`、`usage`、`issue-agent` 和 provider registry。它支持 SSE deltas、persisted snapshots、cancel、subagent routing、approvals 和多 runtime kind。

## Owner / Namespace

`apps/server/src/modules/chat-runtime` 拥有执行语义。`session` 拥有 session metadata 和 export。其他 feature 可以附加 context，但不拥有 chat run lifecycle。

## 目标行为

- Prompt Apps、Quick Chat、Channels、Share 都调用 chat runtime，不另建生成系统。
- 外部 channel message 通过 channel owner 映射到 Cradle sessions。
- branching、compaction、rerun 语义保持 server-owned。

## API 草案

复用现有 `/chat/sessions/:sessionId/*` API。新增调用方传入 `sourceKind`、`sourceId`、`workspaceId` 等 provenance metadata。

## 验收

- Prompt App run 与 Quick Chat message 都生成正常 session messages。
- Usage 和 approvals 走现有 runtime contracts。
- 外部 source metadata 不破坏 session export。
