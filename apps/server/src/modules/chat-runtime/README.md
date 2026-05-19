# Chat Runtime Module

Provides server-owned chat turn execution for existing sessions, including message snapshot persistence, sequenced delta streaming, usage writes, run state updates, and ACP live runtime orchestration.
`messages.message_json` is the only hydration source of truth; invalid snapshots must fail fast instead of falling back to `messages.content`.
Route metadata includes `x-cradle-cli` descriptors for non-streaming generated CLI commands.

## Files

- `index.ts`: Elysia route surface for `POST /chat/sessions/:sessionId/response`, `GET /chat/sessions/:sessionId/capabilities`, `GET /chat/sessions/:sessionId/messages`, and `POST /chat/sessions/:sessionId/cancel`.
- `model.ts`: HTTP params/body schemas for the chat runtime surface.
- `service.ts`: active-run orchestration, runtime-native capabilities discovery, duplicate-run reservation, native AI SDK snapshot diffing, chunk projection for non-AI SDK runtimes, snapshot persistence, strict snapshot hydration, completion subscription, and event broadcasting.
- `delta-events.ts`: backend adapter for both provider `UIMessageChunk` streams and progressive `UIMessage` snapshots, producing persisted message snapshots and sequenced part-level delta events with global `seq` assignment and subagent routing by `parentToolCallId`.
- `chat-turn-context.ts`: system prompt and history resolution.
- `chat-runtime-provider-registry.ts`: runtime provider registry for ACP Chat, OpenAI-compatible, Claude Agent, Codex, System Agent (`jar-core`), and debug/mock variants.
- `engine/`: AI SDK orchestration helpers, compaction, provider selection, approval wrapping, and runtime tools used by the server-owned chat loop.
- `providers/`: concrete runtime providers grouped by backend owner.
  - `providers/acp/config.ts`: ACP runtime config parser for chat-owned profiles.
  - `providers/acp/process-manager.ts`: server-owned ACP subprocess supervisor without Electron shell coupling.
  - `providers/acp/connection-manager.ts`: ACP connection/session/prompt manager for unified chat runtime; forwards plugin-registered MCP servers to ACP new/load/resume session calls.
  - `providers/acp/runtime-integration.ts`: bridges ACP approvals and title updates into server approval/session owners.
  - `providers/acp/provider.ts`: ACP Chat provider bound to the unified `/chat` API.
  - `providers/acp/timeline-mapper.ts`: ACP session updates → unified chat delta input mapper.
  - `providers/openai-compatible/provider.ts`: OpenAI-compatible AI SDK runtime that emits progressive assistant `UIMessage` snapshots directly.
  - `providers/claude-agent/provider.ts`: Claude Agent SDK runtime bound to the unified `/chat` API; injects plugin-registered MCP servers into Claude Agent SDK query options.
  - `providers/claude-agent/mapper.ts`: Claude Agent SDK message → unified chat delta input mapper.
  - `providers/mock-claude-agent/provider.ts`: debug/test runtime that mimics Claude Agent chunk output under mock configuration.
  - `providers/codex/provider.ts`: Codex SDK runtime bound to the unified `/chat` API; projects plugin-registered MCP servers into Codex `mcp_servers` config.
  - `providers/codex/mapper.ts`: Codex SDK thread event → unified chat delta input mapper.
  - `providers/system-agent/provider.ts`: System Agent (`jar-core`) runtime bridged into the same snapshot + delta contract, using jar-core `defaultRuntimeConfig` while keeping Cradle-owned session/workspace paths and normalizing thinking level against model reasoning capability.
- `runtime-provider-types.ts`: chat runtime provider contracts.

## Provider MCP Ownership

The server plugin registry owns MCP server discovery. Chat-runtime providers only read that registry when their upstream runtime supports MCP-style tool servers:

- Claude Agent receives the registry through SDK `mcpServers` query options.
- ACP receives the registry on `newSession`, `loadSession`, and `unstable_resumeSession` as ACP `McpServer[]`.
- Codex receives the registry through `config.mcp_servers`.

OpenAI-compatible and System Agent (`jar-core`) providers do not currently expose a compatible plugin-MCP injection surface in this module.
