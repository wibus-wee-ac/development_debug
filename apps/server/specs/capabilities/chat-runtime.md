<!--
Output: Chat runtime capability spec for server migration.
Input: Legacy chat engine, backend control-plane, and HTTP streaming requirements.
Position: apps/server/specs/capabilities chat-runtime spec.
-->

# Capability: Chat Runtime

## User / System Goal

- 系统需要在已有 session 上发起 chat run，流式写入 timeline，并支持中止。
- server 必须成为 chat write-side owner：负责 `messages`、`backend_runs`、`backend_timeline_events`、`usage_logs` 的一致写入。
- 第一阶段只支持 `openai-compatible` provider，不引入 Electron watch registry / ACP continuity / tool runtime 兼容层。

## Current Behavior Evidence

- 旧 `ChatService` 提供 `createAndSend/send/abort/getSessionTimeline/hasActiveTurn/ensureLive/watchSession/unwatchSession`。
- 旧 `chat-engine` + `chat-turn-executor` 负责 user/assistant message、backend binding/run、timeline persistence、usage 写入。
- 旧 `openai-compatible-provider` 本质是无状态 chat session，适合 server-first 最小迁移。

## Target API

- `POST /chat/sessions/:sessionId/runs` → 在已有 session 上发起一次 turn
- `GET /chat/sessions/:sessionId/timeline` → 返回 timeline hydration 结果
- `GET /chat/runs/:runId/stream` → 返回 server-native SSE timeline 流
- `PATCH /chat/runs/:runId` → 更新 run 资源状态（当前仅支持 `{ status: 'aborted' }`）

## Target Module Design

- `ChatRuntimeModule`
  - `ChatRuntimeController`: HTTP 参数校验与 SSE surface
  - `ChatRuntimeService`: run orchestration、active run registry、abort
  - `ChatRuntimeStore`: DB write/read model for run/timeline/message/usage
  - `ChatTimelineQuery`: timeline hydration
  - `ChatTurnContext`: history + system prompt assembly
  - `ChatRuntimeProviderRegistry`: runtime provider owner
  - `OpenAICompatibleChatProvider`: OpenAI-compatible SSE parser

## Test Plan

- 成功 run 会写入 user/assistant message、timeline、usage，并可被搜索读到。
- abort 会把 assistant message / backend run 收口为 `aborted`。
- 缺失 session、缺失 text、缺失 run 返回结构化错误。
