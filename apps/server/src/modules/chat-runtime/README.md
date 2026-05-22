# Chat Runtime Module

Provides server-owned chat turn execution for existing sessions, including message snapshot persistence, sequenced delta streaming, usage writes, run state updates, cancellation terminal transitions, and ACP live runtime orchestration.
`messages.message_json` is the only hydration source of truth; invalid snapshots must fail fast instead of falling back to `messages.content`.
`POST /chat/sessions/:sessionId/cancel` owns the canonical aborted transition: it marks active runs/messages terminal before asking the provider to stop, ignores late provider chunks after terminal state, and repairs persisted `streaming` rows when no in-memory active run exists.
Route metadata includes `x-cradle-cli` descriptors for non-streaming generated CLI commands.

## Files

- `index.ts`: Elysia route surface for `POST /chat/sessions/:sessionId/response`, `GET /chat/sessions/:sessionId/capabilities`, `GET /chat/sessions/:sessionId/messages`, and `POST /chat/sessions/:sessionId/cancel`.
- `model.ts`: HTTP params/body schemas for the chat runtime surface.
- `service.ts`: active-run orchestration, runtime-native capabilities discovery, duplicate-run reservation, profile + agent + session runtime config merging, Chronicle long-term memory context injection, native AI SDK snapshot diffing, chunk projection for non-AI SDK runtimes, snapshot persistence, strict snapshot hydration, cancellation terminal-state ownership, persisted streaming cleanup, completion subscription, and event broadcasting.
- `delta-events.ts`: backend adapter for both provider `UIMessageChunk` streams and progressive `UIMessage` snapshots, producing persisted message snapshots and sequenced part-level delta events with global `seq` assignment and subagent routing by `parentToolCallId`.
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
  - `providers/openai-compatible/provider.ts`: OpenAI-compatible AI SDK runtime that emits progressive assistant `UIMessage` snapshots directly.
  - `providers/claude-agent/provider.ts`: Claude Agent SDK runtime bound to the unified `/chat` API; injects plugin-registered MCP servers and `config.claudeAgent.modelAliases` environment overrides into Claude Agent SDK query options.
  - `providers/claude-agent/mapper.ts`: Claude Agent SDK message → unified chat delta input mapper.
  - `providers/mock-claude-agent/provider.ts`: debug/test runtime that mimics Claude Agent chunk output under mock configuration.
  - `providers/codex/provider.ts`: Codex SDK runtime bound to the unified `/chat` API; projects plugin-registered MCP servers into Codex `mcp_servers` config.
  - `providers/codex/mapper.ts`: Codex SDK thread event → unified chat delta input mapper.
  - `providers/system-agent/provider.ts`: System Agent (`jar-core`) runtime bridged into the same snapshot + delta contract, using jar-core `defaultRuntimeConfig` while keeping Cradle-owned session/workspace paths, applying profile-owned models.dev mappings as per-model metadata, normalizing thinking level against model reasoning capability, and forwarding jar-core result usage/model metadata into Cradle-owned usage logs.
- `runtime-provider-types.ts`: chat runtime provider contracts.

## Provider MCP Ownership

The server MCP registry owns MCP server discovery for both plugin-registered servers and host-owned builtin servers such as Chronicle. Chat-runtime providers only read that registry when their upstream runtime supports MCP-style tool servers:

- Claude Agent receives the registry through SDK `mcpServers` query options.
- ACP receives the registry on `newSession`, `loadSession`, and `unstable_resumeSession` as ACP `McpServer[]`.
- Codex receives the registry through `config.mcp_servers`.

OpenAI-compatible and System Agent (`jar-core`) providers do not currently expose a compatible plugin-MCP injection surface in this module.

Chronicle registers a builtin `chronicle` MCP server from `../chronicle/mcp.ts`, exposing read-oriented memory, activity segment, and knowledge-card tools to the providers above. Chat Runtime remains a consumer of that registry and does not own Chronicle semantics or writes.

## Chronicle Context

Chat runtime reads Chronicle-owned memory context through `../chronicle/agent-context.ts` during turn context resolution. It uses the current user message as a keyword query, injects a small read-only `Chronicle long-term memory context` block into the system prompt when relevant memory or knowledge exists, and redacts common sensitive values before the prompt reaches the selected runtime provider. The helper intentionally avoids importing the main Chronicle service so chat execution does not create a Chronicle-to-chat dependency cycle or trigger local embedding health probes during ordinary turns.

## ACP Client Filesystem Ownership

ACP `fs.writeTextFile` writes to the client filesystem, not to Cradle-owned data. `providers/acp/connection-manager.ts` must request approval before writing, and the prompt must name the absolute target path and state that the path is outside Cradle-owned data. A rejected approval must leave the target file unchanged or absent.
