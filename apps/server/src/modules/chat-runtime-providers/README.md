# chat-runtime-providers

Concrete chat runtime provider implementations consumed by `chat-runtime`.

This module owns provider-specific runtime adapters only. Shared provider metadata, provider target ownership, secrets, sessions, queues, and persistence stay in their owning modules.
Provider adapters parse provider-native protocols, but Cradle-owned tool identity is owned by `tools/`. Tool calls emitted from providers should carry the stable `{ identifier, apiName, args, result }` envelope in their input/output payloads.
Runtime selection metadata is registered by `../chat-runtime/chat-runtime-provider-registry.ts`; provider directories own execution semantics, while Chat Runtime owns the catalog used by Chat, Jarvis, and plugin-registered runtimes.

Runtime provider directories use a shared domain package shape when they own a responsibility: `provider.ts` is the `ChatRuntime` facade, `metadata.ts` owns runtime identity/presentation, `types.ts` owns provider-private shared types, `runtime-context.ts` owns filesystem/env context, `input-projector.ts` owns Cradle input to provider-native input, `event-to-chunk-mapper.ts` owns provider events to AI SDK chunks, `replay-projector.ts` owns experimental Chat Runtime event history to provider-native replay input when present, `state-projector.ts` owns provider snapshot projection, `ui-slot-projector.ts` owns runtime UI slot projection, `stream-diagnostics.ts` owns stream diagnostics, and `stream-handler.ts` owns single-turn stream notification orchestration. Live provider turns currently use each provider's `input-projector.ts`, transcript projector, or direct AI SDK `UIMessage` path; `replay-projector.ts` files are diagnostic/future migration helpers until a provider explicitly wires them into `provider.ts`. Providers should use these names instead of local synonyms when the responsibility exists.

## Files

- `provider-state-snapshot.ts`: trusted provider runtime state snapshot parsing.
- `bounded-text-collector.ts`: bounded streaming text accumulator for diagnostics.
- `async-event-queue.ts`: provider-agnostic async FIFO event queue for runtime streams.
- `openai-compatible/`: OpenAI-compatible AI SDK runtime provider plus an experimental replay projector that sanitizes provider-visible tool names.
- `acp/`: ACP process, connection, runtime integration, timeline mapping, and provider adapter.
- `tools/`: Cradle-owned shared provider tool envelope contract.
- `claude-agent/`: Claude Agent SDK provider package using metadata, input, async stream, event-to-chunk, experimental replay, state, subagent, tool envelope, and test modules.
- `codex/`: Codex app-server provider package using metadata, input, event-to-chunk, experimental replay, stream handler/diagnostics, UI slot, native/transcript projector, tool envelope, app-server bridge/client, and test modules.
- `mock-claude-agent/provider.ts`: mock Claude Agent provider for local diagnostics.
- `system-agent/`: jar-core System Agent provider package using metadata, runtime context, input, model-registry bridge, event-to-chunk, experimental replay, state, and provider facade modules.
