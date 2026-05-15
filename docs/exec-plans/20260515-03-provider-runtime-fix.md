# Provider/Runtime Architecture Fix Plan

## Problem Statement

The current migration incorrectly collapsed all `providerKind` values to `'openai-compatible'`. 
In reality:
- **ProviderKind** = API protocol/format for metadata (health check, model listing)
  - `'openai-compatible'` — OpenAI-format API (OpenAI, DeepSeek, other OpenAI-compatible endpoints)
  - `'anthropic'` — Anthropic's native API format (different auth, different /models endpoint)
- **RuntimeKind** = execution orchestration strategy
  - `'standard'` — ai-sdk openai-compatible streaming
  - `'claude-agent'` — Anthropic Claude Agent SDK loop  
  - `'codex'` — OpenAI Codex/Responses API agent loop
  - `'jar-core'` — system agent (internal)
  - `'acp-chat'` — ACP protocol
  - `'cli-tui'` — local CLI process

## Key Relationships

- Runtime `standard` → Provider `'openai-compatible'` OR `'anthropic'`
- Runtime `claude-agent` → Provider `'anthropic'`
- Runtime `codex` → Provider `'openai-compatible'`
- Runtime `jar-core` → Provider `'openai-compatible'` OR `'anthropic'` (config-driven)
- Runtime `acp-chat` → No provider needed (ACP protocol)
- Runtime `cli-tui` → No provider needed (local CLI)

## Work Units

### Unit 1: Expand ProviderKind to include 'anthropic'
- `packages/db/src/schema/identity.ts` — enum: `['openai-compatible', 'anthropic']`
- `apps/server/src/modules/providers/types.ts` — update `providerKinds` array
- `apps/server/src/modules/providers/model.ts` — update TypeBox schema
- `apps/server/src/modules/profiles/model.ts` — update profile schema
- Migration: UPDATE profiles with Anthropic base URLs to `'anthropic'`

### Unit 2: Anthropic Metadata Provider
- `apps/server/src/modules/providers/provider-catalog.ts` — add `AnthropicMetadataProvider`
  - Health check: `GET {baseUrl}/v1/messages` with auth header (or just validate API key exists)
  - List models: Return known Anthropic models (or call Anthropic's models endpoint if available)

### Unit 3: Runtime Selection in Agent Settings (Frontend)
- The Agent entity already has a link to a Profile (via `agentProfileId`)
- Need to add RuntimeKind selection to the Agent config UI
- When creating a session, the runtime comes from the Agent (or defaults based on provider)
- `apps/web/src/features/agent-management/agent-detail.tsx` — add runtime picker

### Unit 4: Provider Presets Update (Frontend)
- `apps/web/src/features/agent-management/provider-templates.ts` — Anthropic preset uses `providerKind: 'anthropic'`
- `apps/web/src/features/agent-management/provider-icons.tsx` — already has icons
- Profile detail panel — show actual providerKind label

### Unit 5: Data Migration
- Profiles that have Anthropic base URLs → `providerKind: 'anthropic'`
- Profiles that were formerly `'claude-agent'` in the old system → `providerKind: 'anthropic'`

## Execution Order (DAG)

```
Unit 1 (Schema) → Unit 2 (Anthropic Provider)
                → Unit 5 (Migration) 
Unit 3 (Frontend Runtime) — independent
Unit 4 (Frontend Presets) — depends on Unit 1
```

## Acceptance Criteria

1. `GET /profiles` returns `providerKind: 'anthropic'` for Anthropic profiles
2. `POST /providers/health-check` works for both openai-compatible and anthropic providers
3. `POST /providers/models` returns models for both provider kinds
4. Agent settings page shows runtime selection
5. New session creation picks the right runtime based on agent config
6. All tests pass, typecheck clean
