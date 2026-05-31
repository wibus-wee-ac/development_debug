# chat-runtime-providers

Concrete chat runtime provider implementations consumed by `chat-runtime`.

This module owns provider-specific runtime adapters only. Shared provider metadata, provider target ownership, secrets, sessions, queues, and persistence stay in their owning modules.
Provider adapters parse provider-native protocols, but Cradle-owned tool identity is owned by `tools/`. Tool calls emitted from providers should carry the stable `{ identifier, apiName, args, result }` envelope in their input/output payloads.

## Files

- `provider-state-snapshot.ts`: trusted provider runtime state snapshot parsing.
- `bounded-text-collector.ts`: bounded streaming text accumulator for diagnostics.
- `openai-compatible/provider.ts`: OpenAI-compatible AI SDK runtime provider.
- `acp/`: ACP process, connection, runtime integration, timeline mapping, and provider adapter.
- `tools/`: Cradle-owned shared provider tool envelope contract.
- `claude-agent/`: Claude Agent SDK provider, protocol mapper, Claude Code tool envelope emission, and tests.
- `codex/`: Codex app-server client, protocol mapper, Codex tool envelope emission, Cradle transcript-to-Responses item projection, provider adapter, and tests.
- `mock-claude-agent/provider.ts`: mock Claude Agent provider for local diagnostics.
- `system-agent/provider.ts`: jar-core System Agent runtime provider.
