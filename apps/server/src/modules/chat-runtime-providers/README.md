# chat-runtime-providers

Concrete chat runtime provider implementations consumed by `chat-runtime`.

This module owns provider-specific runtime adapters only. Shared provider metadata, provider target ownership, secrets, sessions, queues, and persistence stay in their owning modules.

## Files

- `provider-state-snapshot.ts`: trusted provider runtime state snapshot parsing.
- `bounded-text-collector.ts`: bounded streaming text accumulator for diagnostics.
- `openai-compatible/provider.ts`: OpenAI-compatible AI SDK runtime provider.
- `acp/`: ACP process, connection, runtime integration, timeline mapping, and provider adapter.
- `claude-agent/`: Claude Agent SDK provider, mapper, TodoWrite plugin state projection, and tests.
- `codex/`: Codex app-server client, mapper, tool payload projection, provider adapter, and tests.
- `mock-claude-agent/provider.ts`: mock Claude Agent provider for local diagnostics.
- `system-agent/provider.ts`: jar-core System Agent runtime provider.

