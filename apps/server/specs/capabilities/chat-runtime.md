# Capability: Chat Runtime

## User / System Goal

- 系统需要在已有 session 上发起 chat run，流式广播 sequenced part events，并支持中止。
- `messages.messageJson` 是 chat hydration 的唯一真相源；`messages.content` 只是派生纯文本缓存，绝不能反向重建 UIMessage。
- server 必须成为 chat write-side owner：负责 `messages`、`backend_runs`、`usage_logs` 的一致写入。
- chat runtime 当前支持 `openai-compatible`、ACP Chat、Claude Agent、Codex、System Agent (`jar-core`) 以及调试/测试用 mock runtime，并统一收敛到同一条 snapshot + SSE delta 写路径。

## Current Capability Contract

- `POST /chat/sessions/:sessionId/response` 会创建 user/assistant message rows，并返回 server-native SSE stream。
- `GET /chat/sessions/:sessionId/messages` 返回按 `createdAt` 排序的全部 message snapshot rows（包含主消息与 subagent rows，使用 `parentToolCallId` 区分）；若 `messageJson` 非法，接口返回结构化 `chat_message_snapshot_invalid` 错误。
- `POST /chat/sessions/:sessionId/cancel` 会中止当前 active run，并将 assistant / backend run 收口为 `aborted`。
- stream 事件协议只暴露 `message_delta` / `subagent_message_delta` / `run_completed` / `run_aborted` / `run_failed`，不再暴露旧 chunk timeline。

## Target API

- `POST /chat/sessions/:sessionId/response` → 在已有 session 上发起一次 turn 并直接返回 SSE stream
- `GET /chat/sessions/:sessionId/messages` → 返回 message snapshot hydration 结果（直接读取 `messageJson`，包含主消息与 subagent rows）
- `POST /chat/sessions/:sessionId/cancel` → 中止当前 session 的 active run

## Stream Protocol Contract

- 主 assistant 流事件：`{ type: 'message_delta', data: { messageId, deltas } }`
- subagent 流事件：`{ type: 'subagent_message_delta', data: { context, deltas } }`
- `deltas[*].seq` 必须在单次 run 内全局单调递增，不能按 message 分别重置。
- `subagent_message_delta.data.context.parentToolCallId` 必须等于触发该子消息的 tool call id；snapshot endpoint 返回全部 rows，由调用方通过 `parentToolCallId` 区分主消息与 subagent 消息。
- 坏 snapshot 不允许回退到 `content` 重建，必须在 hydration 边界 fail fast。

## Target Module Design

- `ChatRuntimeModule`
  - `chat-runtime/index.ts`: Elysia route surface
  - `ChatRuntimeModel`: HTTP 参数校验与 body schema
  - `ChatRuntimeService`: run orchestration、active run registry、abort
  - `ChatTurnContext`: history + system prompt assembly
  - `ChatRuntimeProviderRegistry`: runtime provider owner
  - `OpenAICompatibleChatProvider` / `AcpChatProvider` / `ClaudeAgentProvider` / `CodexProvider` / `SystemAgentProvider` / mock runtime variants

## Test Plan

- 成功 run 会写入 user/assistant message snapshot、usage，并可被搜索读到。
- abort 会把 assistant message / backend run 收口为 `aborted`。
- 缺失 session、缺失 text、缺失 run 返回结构化错误。
- 直接消费 SSE stream，断言 `message_delta` / `subagent_message_delta` 事件类型、`seq` 全局递增、以及 `parentToolCallId` 路由语义。
- hydration 对非法 `messageJson` 返回结构化 `chat_message_snapshot_invalid`，而不是使用 `content` 兜底。
