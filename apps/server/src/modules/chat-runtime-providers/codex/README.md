# Codex Runtime Provider

Owns the Codex app-server runtime adapter for Chat Runtime. This directory translates between Cradle `UIMessage` state and the Codex JSON-RPC app-server protocol.
Codex tool identity and the `{ identifier, apiName, args, result }` envelope are owned by `tools/`; this provider only maps app-server protocol items into that stable contract.
Codex thread names are read from app-server `thread/start`/`thread/resume` responses and `thread/name/updated` notifications, then reported through Chat Runtime's title callback. Cradle owns the final `sessions.title` write.
Codex UI slots are projected from the app-server capability manifest. Slot state stays provider-owned: `goal` reads `thread/goal/get`; `compact` keeps lifecycle from `contextCompaction` item `item/started` and `item/completed`, treats deprecated `thread/compacted` only as a compatibility signal, and keeps the usage meter from thread-level `thread/tokenUsage/updated` plus effective config limits such as `model_auto_compact_token_limit`; `status`, `model`, and `reasoning` come from thread start/resume responses, settings/status notifications, config, model list, and model-provider capability reads; `plan` uses `turn/plan/updated` as the canonical session plan snapshot; `toolActivity` summarizes recent `item/started` and `item/completed` lifecycle records; `mcp` merges `mcpServerStatus/list` reads with startup, OAuth, and progress notifications; `diff`, `terminal`, `approvals`, and `alerts` summarize their corresponding app-server notifications without storing full output history; `filesystem`, `search`, and `usage` keep bounded notification snapshots from `fs/changed`, fuzzy file search, and rate-limit updates; `skills`, `plugin`, `crew`, and `config` are read from app-server list/read methods at render time. Cradle stores only the provider snapshot needed to render the composer-adjacent state surface.

## Files

- `provider.ts`: Codex `ChatRuntime` implementation; starts/resumes app-server threads, projects app-server thread names and provider-owned UI slot states to Chat Runtime, injects reconstructed Cradle history through `thread/inject_items`, starts turns, streams notifications, and handles live steering/cancellation.
- `provider.test.ts`: Regression tests for Codex thread startup, provider title projection, provider config, transcript reconstruction, UI slot state projection, streaming, steering, cancellation, and diagnostics.
- `app-server-client.ts`: Newline-delimited JSON-RPC client for a per-turn Codex app-server process.
- `app-server-client.test.ts`: Client path and transport tests.
- `app-server-mapper.ts`: Maps Codex app-server notifications into AI SDK `UIMessageChunk` events carrying Cradle-owned tool envelopes. Reasoning items are projected only when Codex provides displayable `content`, `summary`, or reasoning deltas; encrypted-only reasoning is not surfaced as an empty UI part.
- `app-server-capabilities.ts`: Generated Cradle-owned manifest of the app-server client methods, server requests, and server notifications.
- `app-server-bridge.ts`: Generic session-scoped bridge for invoking any generated app-server method and streaming raw notifications as SSE.
- `tools/`: Codex tool identifier and app-server item payload mapper.
- `app-server-tool-payload.ts`: Compatibility re-export for Codex tool payload helpers owned by `tools/mapper.ts`.
- `transcript-projector.ts`: Projects reconstructed Cradle transcript history into Codex Responses API items for native thread injection, unwrapping tool envelopes back to provider-native function-call names, arguments, and outputs.
- `ui-slots.ts`: Projects generated Codex app-server capabilities into provider-owned runtime UI slot descriptors.
- `app-server-protocol/`: Generated TypeScript bindings from `codex app-server generate-ts --experimental --out apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol`. Do not edit generated files by hand.

## Regeneration

After regenerating `app-server-protocol/`, run `pnpm --filter @cradle/server generate:codex-app-server-capabilities` to refresh `app-server-capabilities.ts`. The capability generator derives method names and params from the generated protocol files, and keeps only Cradle-owned runtime semantics such as stream-capable methods in the generator.
