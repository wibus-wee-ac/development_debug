# Codex Runtime Provider

Owns the Codex app-server runtime adapter for Chat Runtime. This directory translates between Cradle `UIMessage` state and the Codex JSON-RPC app-server protocol.
Codex tool identity and the `{ identifier, apiName, args, result }` envelope are owned by `tools/`; this provider only maps app-server protocol items into that stable contract.

## Files

- `provider.ts`: Codex `ChatRuntime` implementation; starts/resumes app-server threads, injects reconstructed Cradle history through `thread/inject_items`, starts turns, streams notifications, and handles live steering/cancellation.
- `provider.test.ts`: Regression tests for Codex thread startup, provider config, transcript reconstruction, streaming, steering, cancellation, and diagnostics.
- `app-server-client.ts`: Newline-delimited JSON-RPC client for a per-turn Codex app-server process.
- `app-server-client.test.ts`: Client path and transport tests.
- `app-server-mapper.ts`: Maps Codex app-server notifications into AI SDK `UIMessageChunk` events carrying Cradle-owned tool envelopes.
- `app-server-capabilities.ts`: Cradle-owned manifest of the generated app-server client methods, server requests, and server notifications.
- `app-server-bridge.ts`: Generic session-scoped bridge for invoking any generated app-server method and streaming raw notifications as SSE.
- `tools/`: Codex tool identifier and app-server item payload mapper.
- `app-server-tool-payload.ts`: Compatibility re-export for Codex tool payload helpers owned by `tools/mapper.ts`.
- `transcript-projector.ts`: Projects reconstructed Cradle transcript history into Codex Responses API items for native thread injection, unwrapping tool envelopes back to provider-native function-call names, arguments, and outputs.
- `app-server-protocol/`: Generated TypeScript bindings from `codex app-server generate-ts --experimental --out apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol`. Do not edit generated files by hand.
