# Codex Tools

Codex provider-owned tool semantics.

This directory maps Codex app-server tool items into Cradle's shared tool envelope. The parent `codex/app-server-mapper.ts` owns notification sequencing; this directory owns Codex tool identity and payload semantics.

## Files

- `identity.ts`: Codex tool identifier.
- `mapper.ts`: Codex app-server item input/result envelope constructors.
