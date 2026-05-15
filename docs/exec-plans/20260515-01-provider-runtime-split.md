# Provider → Runtime Architecture Migration Plan

## Goal

Split the current single-dispatch `providerKind` into two orthogonal concepts:

- **Provider** = LLM connection configuration (credentials, base URL, API protocol)
- **Runtime** = Conversation orchestration strategy (how the agent loop works)

## New Architecture

```
Session (runtimeKind) → RuntimeRegistry → Runtime implementation
                                             ↓ uses
                         Profile (providerKind) → credentials + connection config
```

### Provider (providerKind) — "How to connect to an LLM"
- `openai-compatible` — any OpenAI-protocol API (covers Anthropic, OpenAI, Groq, xAI, etc.)

### Runtime (runtimeKind) — "How to orchestrate the conversation"
- `standard` — direct AI SDK streaming (current openai-compatible behavior)
- `claude-agent` — Claude native agent loop (tool use, computer use)
- `codex` — OpenAI Codex sandbox agent
- `jar-core` — HiJarvis jar-core agent loop
- `acp-chat` — Agent Communication Protocol bridge
- `cli-tui` — Terminal interaction

## Data Model Changes

### sessions table
- ADD: `runtimeKind TEXT` (nullable, default null → treated as 'standard')

### agent_profiles table
- `providerKind` enum: keep ONLY `'openai-compatible'`
- All existing profiles with other providerKinds: migrate to `openai-compatible`
- The profile is now purely "where are the credentials and how to connect"

### backend_session_bindings table
- Replace `providerKind` with `runtimeKind`

### runtime-provider-types.ts → runtime-types.ts
- Rename `ChatRuntimeProvider` → `ChatRuntime`
- `readonly runtimeKind: RuntimeKind` instead of `readonly providerKind: ProviderKind`
- `RuntimeSession.providerKind` → `RuntimeSession.runtimeKind`

### providers/types.ts
- `providerKinds` simplifies to just `['openai-compatible']`
- NEW: `runtimeKinds = ['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'] as const`
- NEW: `type RuntimeKind = (typeof runtimeKinds)[number]`

## Implementation Units

### Unit 1: Schema + Types (Foundation)
- Modify `packages/db/src/schema/chat.ts`: add `runtimeKind` to sessions
- Modify `packages/db/src/schema/backend-control-plane.ts`: bindings use runtimeKind
- Modify `packages/db/src/schema/identity.ts`: simplify providerKind enum to `['openai-compatible']`
- Create SQL migration (or update baseline)
- Update `providers/types.ts`: add RuntimeKind type, simplify ProviderKind
- Update `runtime-provider-types.ts` → rename to `runtime-types.ts`, use RuntimeKind

### Unit 2: Runtime Registry + Dispatch
- Rename `ChatRuntimeProviderRegistry` → `RuntimeRegistry`
- Change key from `ProviderKind` to `RuntimeKind`
- Modify `service.ts` `createRun()`:
  - Read `session.runtimeKind` (default 'standard')
  - Dispatch to `runtimeRegistry.get(runtimeKind)`
  - Profile still provides credentials via `profile.credentialRef` + `profile.configJson`
- Update `RuntimeSession` type
- Update `getProviderRegistry()` → `getRuntimeRegistry()` singleton factory

### Unit 3: Migrate OpenAI-Compatible → Standard Runtime
- Rename `providers/openai-compatible/` → `runtimes/standard/`
- Change class name: `OpenAICompatibleProvider` → `StandardRuntime`
- Change `providerKind` → `runtimeKind = 'standard'`
- Keep all internal logic (AI SDK engine, streaming)

### Unit 4: Migrate Claude Agent → Runtime
- Rename `providers/claude-agent/` → `runtimes/claude-agent/`
- Change class: `ClaudeAgentProvider` → `ClaudeAgentRuntime`
- Change `providerKind` → `runtimeKind = 'claude-agent'`
- Keep internal logic (Claude SDK, mapper, approval, Langfuse)
- Also migrate `mock-claude-agent/` → `runtimes/mock-claude-agent/`

### Unit 5: Migrate Codex → Runtime
- Rename `providers/codex/` → `runtimes/codex/`
- Change class: `CodexProvider` → `CodexRuntime`
- Change `providerKind` → `runtimeKind = 'codex'`
- Keep internal logic (Codex SDK, Langfuse)

### Unit 6: Migrate ACP → Runtime
- Rename `providers/acp/` → `runtimes/acp/`
- Change class: `AcpChatProvider` → `AcpChatRuntime`
- Change `providerKind` → `runtimeKind = 'acp-chat'`

### Unit 7: Migrate System-Agent → jar-core Runtime
- Rename `providers/system-agent/` → `runtimes/jar-core/`
- Change class: `SystemAgentProvider` → `JarCoreRuntime`
- Change `providerKind` → `runtimeKind = 'jar-core'`
- Update: reads credentials from profile (which is now just openai-compatible)
- jar-core maps provider from profile's configJson (baseUrl determines the LLM)

### Unit 8: Session creation + Jarvis preferences
- `postSessions` endpoint: accept optional `runtimeKind` in body
- Default runtimeKind: 'standard' when not specified
- Jarvis preferences: `{ profileId, modelId, thinkingLevel }` (already done partially)
- Jarvis popover: create session with `runtimeKind: 'jar-core'`

### Unit 9: Frontend updates
- Remove `system-agent` from ProviderKind type
- Add RuntimeKind type
- Update Providers settings page: remove providerKind selector (all profiles are openai-compatible)
- Update session creation flows: pass runtimeKind when needed
- Jarvis settings: profile picker + model combobox + thinking level
- Agent management: agent config specifies runtimeKind

### Unit 10: Cleanup
- Remove `system-agent` from all enums/types
- Remove `cli-tui` from providerKind (it's now a runtime)
- Delete old `providers/` directory structure
- Update tests
- TypeCheck all packages

## Dependency Graph

```
Unit 1 (Schema/Types) ← foundation, everything depends on this
  ↓
Unit 2 (Registry/Dispatch) ← core dispatch change
  ↓
Units 3-7 (Provider → Runtime migrations) ← can be parallel
  ↓
Unit 8 (Session creation + Jarvis) ← depends on runtime system working
  ↓
Unit 9 (Frontend) ← depends on backend API changes
  ↓
Unit 10 (Cleanup) ← final sweep
```

## Key Decisions

1. **All profiles become `openai-compatible`** — providerKind is simplified to just one value. The profile is purely "credentials + base URL + model capabilities".

2. **runtimeKind on sessions** — the session determines execution path, not the profile. Same profile can be used with different runtimes.

3. **Default runtimeKind = 'standard'** — existing sessions without the field use standard streaming.

4. **cli-tui** — becomes a runtime. It doesn't connect to an LLM at all; it's a terminal interaction mode. Profile may not even be needed (or uses a dummy profile).

5. **Provider config schemas** — each runtime has its own config schema. Standard uses OpenAICompatibleConfig, claude-agent uses ClaudeAgentConfig, etc. Config lives in `profile.configJson` or `session metadata` depending on what makes sense.

## Migration Notes

- Breaking change: no backward compatibility needed
- SQL: can drop and recreate tables (no production data)
- Frontend: types.gen.ts will need regeneration after API changes
