# Chat Runtime Module

Provides server-owned chat turn execution for existing sessions, including text/file user input, durable continuation queue items, message snapshot persistence, sequenced delta streaming, usage writes, run state updates, cancellation terminal transitions, and ACP live runtime orchestration.
`messages.message_json` is the only hydration source of truth; invalid snapshots must fail fast instead of falling back to `messages.content`.
User attachments are represented as AI SDK `FileUIPart` entries in `UIMessage.parts`; the OpenAI-compatible AI SDK provider converts those through `convertToModelMessages`, while text-only runtime providers reject non-text parts explicitly instead of silently dropping attachments.
`POST /chat/sessions/:sessionId/cancel` owns the canonical aborted transition: it marks active runs/messages terminal before asking the provider to stop, ignores late provider chunks after terminal state, and repairs persisted `streaming` rows when no in-memory active run exists.
Route metadata includes `x-cradle-cli` descriptors for non-streaming generated CLI commands.
In development, chat stream traces are written directly to `CRADLE_DATA_DIR/chat-runtime/traces/*.jsonl` so provider raw events, mapper output, projection results, and emitted SSE events can be compared without relying on rewritten UI state.
Chat Session queue and steer are owned here: `/chat/sessions/:sessionId/queue` stores follow-up turns in `chat_session_queue_items`, applies true live steering only when the active provider exposes the optional `steerTurn` hook, otherwise drains `steer` items before normal `queue` items after the active run completes, and does not write into Issue Agent namespaces.

## Files

- `index.ts`: Elysia route surface for `POST /chat/sessions/:sessionId/response`, `GET /chat/sessions/:sessionId/queue`, `POST /chat/sessions/:sessionId/queue`, `POST /chat/sessions/:sessionId/queue/reorder`, `DELETE /chat/sessions/:sessionId/queue/:queueItemId`, `GET /chat/sessions/:sessionId/capabilities`, `GET /chat/sessions/:sessionId/messages`, `GET /chat/runs/:runId/trace`, `GET /chat/sessions/:sessionId/traces`, and `POST /chat/sessions/:sessionId/cancel`.
- `model.ts`: HTTP params/body schemas for the chat runtime surface, including optional text plus AI SDK file parts, optional `providerTargetId` overrides for response/queue requests, and decoded chat stream trace responses.
- `service.ts`: active-run orchestration, runtime-native capabilities discovery, duplicate-run reservation, provider target override resolution with runtime/provider compatibility validation, provider target + agent + session runtime config merging, Chronicle long-term memory context injection, text/file draft `UIMessage` persistence, durable queue item list/enqueue/cancel/reorder/drain, native AI SDK snapshot diffing, chunk projection for non-AI SDK runtimes, snapshot persistence, strict snapshot hydration, cancellation terminal-state ownership, persisted streaming cleanup, completion subscription, trace retrieval, and event broadcasting.
- `stream-trace.ts`: dev-mode JSONL trace writer/reader for the provider raw event, mapper output, runtime chunk, projection apply, and SSE emit chain.
- `delta-events.ts`: backend adapter for both provider `UIMessageChunk` streams and progressive `UIMessage` snapshots, accepting text/reasoning/tool/file parts, producing persisted message snapshots and sequenced part-level delta events with global `seq` assignment and subagent routing by `parentToolCallId`.
- `ui-message-input.ts`: provider-boundary helpers for extracting text from `UIMessage` and rejecting attachments for text-only runtimes.
- `chat-turn-context.ts`: system prompt and history resolution.
- `chat-runtime-provider-registry.ts`: runtime provider registry for ACP Chat, OpenAI-compatible, Claude Agent, Codex, System Agent (`jar-core`), and debug/mock variants.
- `engine/`: AI SDK orchestration helpers, compaction, provider selection, approval wrapping, and runtime tools used by the server-owned chat loop.
- `providers/`: concrete runtime providers grouped by backend owner.
  - `providers/acp/config.ts`: ACP runtime config parser for chat-owned profiles.
  - `providers/acp/process-manager.ts`: server-owned ACP subprocess supervisor without Electron shell coupling.
  - `providers/acp/connection-manager.ts`: ACP connection/session/prompt manager for unified chat runtime; forwards plugin-registered MCP servers to ACP new/load/resume session calls; gates ACP `fs.writeTextFile` client-filesystem writes through approval prompts that include the target path and owner boundary.
  - `providers/acp/runtime-integration.ts`: bridges ACP approvals and title updates into server approval/session owners.
  - `providers/acp/provider.ts`: ACP Chat provider bound to the unified `/chat` API.
  - `providers/acp/timeline-mapper.ts`: ACP session updates → unified chat delta input mapper.
  - `providers/openai-compatible/provider.ts`: OpenAI-compatible AI SDK runtime that converts text/file `UIMessage` history through AI SDK `convertToModelMessages` and emits progressive assistant `UIMessage` snapshots directly.
  - `providers/claude-agent/provider.ts`: Claude Agent SDK runtime bound to the unified `/chat` API; injects plugin-registered MCP servers and `config.claudeAgent.modelAliases` environment overrides into Claude Agent SDK query options, and rejects non-text user parts at the provider boundary.
  - `providers/claude-agent/mapper.ts`: Claude Agent SDK message → unified chat delta input mapper.
  - `providers/mock-claude-agent/provider.ts`: debug/test runtime that mimics Claude Agent chunk output under mock configuration.
  - `providers/codex/provider.ts`: Codex app-server runtime bound to the unified `/chat` API; starts/resumes app-server threads, maps `turn/start` notifications into chat deltas, supports live `turn/steer`, interrupts active turns through `turn/interrupt`, projects plugin-registered MCP servers into Codex `mcp_servers` config, and rejects non-text user parts at the provider boundary.
  - `providers/codex/app-server-client.ts`: newline-delimited JSON-RPC client for per-turn Codex app-server processes.
  - `providers/codex/app-server-mapper.ts`: Codex app-server notification → unified chat delta input mapper.
  - `providers/codex/provider.test.ts`: focused app-server provider coverage for streaming, thread resume, and live steer.
  - `providers/system-agent/provider.ts`: System Agent (`jar-core`) runtime bridged into the same snapshot + delta contract, using jar-core `defaultRuntimeConfig` while keeping Cradle-owned session/workspace paths, injecting Cradle chat/workspace env for shell-driven skills, applying profile-owned models.dev mappings as per-model metadata, normalizing thinking level against model reasoning capability, rejecting non-text user parts, and forwarding jar-core result usage/model metadata into Cradle-owned usage logs.
- `runtime-provider-types.ts`: chat runtime provider contracts, including the optional `steerTurn` side-channel used only by providers that can inject input into an active turn.

## Provider MCP Ownership

The server MCP registry owns MCP server discovery for both plugin-registered servers and host-owned builtin servers such as Chronicle. Chat-runtime providers only read that registry when their upstream runtime supports MCP-style tool servers:

- Claude Agent receives the registry through SDK `mcpServers` query options.
- ACP receives the registry on `newSession`, `loadSession`, and `unstable_resumeSession` as ACP `McpServer[]`.
- Codex receives the registry through `config.mcp_servers`.

OpenAI-compatible and System Agent (`jar-core`) providers do not currently expose a compatible plugin-MCP injection surface in this module.

## Live Steer Ownership

`ChatRuntime.steerTurn` is optional. Chat Runtime first persists every follow-up as a `chat_session_queue_items` row, then tries live steering only for active providers that expose this hook. Before calling the provider, the service atomically claims the row from `pending` to `running` and links it to the active run through `startedRunId`, so cancel/reorder/drain cannot race the provider side effect. If the provider accepts the steer message, the queue row is marked `completed` and a completed user message is inserted into Chat Session history. If history persistence fails after provider acceptance, the row remains `completed` with `errorText` so the already-applied input is not replayed. If the provider rejects live steering or does not implement the hook, the row stays or returns to `pending` and the normal queue drain starts it as a later turn. This keeps the HTTP and database contract durable while avoiding fake live steering for runtimes that cannot support it.

Claude Agent supports this hook through the Claude Agent SDK streaming-input query plus `interrupt()`. Codex supports this hook through the Codex app-server JSON-RPC protocol: the provider keeps the active app-server client, `threadId`, and `turnId`, then sends `turn/steer` with the expected active turn id. ACP, OpenAI-compatible, System Agent, and mock runtimes currently fall back to durable queued steering unless their providers add a real side-channel later.

Chronicle registers a builtin `chronicle` MCP server from `../chronicle/mcp.ts`, exposing read-oriented memory, activity segment, and knowledge-card tools to the providers above. Chat Runtime remains a consumer of that registry and does not own Chronicle semantics or writes.

## Chronicle Context

Chat runtime reads Chronicle-owned memory context through `../chronicle/agent-context.ts` during turn context resolution. It uses the current user message as a keyword query, injects a small read-only `Chronicle long-term memory context` block into the system prompt when relevant memory or knowledge exists, and redacts common sensitive values before the prompt reaches the selected runtime provider. The helper intentionally avoids importing the main Chronicle service so chat execution does not create a Chronicle-to-chat dependency cycle or trigger local embedding health probes during ordinary turns.

## ACP Client Filesystem Ownership

ACP `fs.writeTextFile` writes to the client filesystem, not to Cradle-owned data. `providers/acp/connection-manager.ts` must request approval before writing, and the prompt must name the absolute target path and state that the path is outside Cradle-owned data. A rejected approval must leave the target file unchanged or absent.
