# Thinking Effort Contract ReviewC

Date: 2026-06-06

Scope:
- `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`
- `apps/server/src/modules/chat-runtime/model.ts`
- `apps/server/src/modules/chat-runtime/service.ts`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts`
- `apps/web/src/features/agent-management/*`
- `apps/web/src/features/composer-toolbar/*`
- `packages/db/src/schema/chat.ts`

Question: Are you 100% confident that the `thinkingEffort` / reasoning effort contract is closed across layers?

Answer: No.

The current worktree removed the previous `auto` leak from the chat turn path, but there are still three incompatible effort domains:

- Chat turn and queue: `low | medium | high | xhigh`
- Codex protocol/config: `none | minimal | low | medium | high | xhigh`
- Agent identity UI/API/DB: `none | minimal | low | medium | high | xhigh | max`

That split is not only cosmetic. Some agent-management paths can persist values that the composer/chat runtime later cannot apply, so the UI can display an agent effort that does not drive the actual Codex turn.

## Findings

### High: Agent identity accepts efforts that chat turns silently ignore

Evidence:
- Chat runtime exposes only four turn efforts in `ChatThinkingEffort`: `apps/server/src/modules/chat-runtime/runtime-provider-types.ts:17`.
- Chat HTTP bodies validate only `low | medium | high | xhigh`: `apps/server/src/modules/chat-runtime/model.ts:594` and `apps/server/src/modules/chat-runtime/model.ts:821`.
- Chat queue DB stores only `low | medium | high | xhigh`: `packages/db/src/schema/chat.ts:116`.
- `readChatThinkingEffort` in the route drops any non-four-value input to `undefined`: `apps/server/src/modules/chat-runtime/index.ts:30`.
- Agent identity still accepts and persists seven values: `apps/server/src/modules/agent-identity/model.ts:3`, `apps/server/src/modules/agent-identity/service.ts:119`, `packages/db/src/schema/identity.ts:38`.
- Agent detail and batch UI expose the same seven values: `apps/web/src/features/agent-management/agent-detail.tsx:110`, `apps/web/src/features/agent-management/agent-list.tsx:76`, `apps/web/src/features/agent-management/agent-batch-configuration.ts:4`.
- Agent batch writes the selected seven-value effort directly into `UpdateAgentInput`: `apps/web/src/features/agent-management/agent-batch-configuration.ts:35`.
- Composer narrows a bound agent effort to the four chat values; `none`, `minimal`, and `max` become `null`: `apps/web/src/features/composer-toolbar/use-composer-state.ts:52`.
- Once `null` reaches `effectiveThinkingEffort`, the composer falls back to `high` when the selected model supports normal thinking: `apps/web/src/features/composer-toolbar/use-composer-state.ts:217`.

Behavior risk:
- A user can save an agent with `minimal`, `none`, or `max` from agent management.
- Starting a chat with that bound agent does not send the selected value. It either sends `high` from the composer fallback or no override to the provider.
- For Codex specifically, no override means `readCodexReasoningEffort` falls back to profile config or `high`, not the agent's persisted value: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1309`.
- The visible agent configuration and actual turn behavior diverge.

Proper fix:
- Choose one owner contract for agent-run chat effort.
- Recommended fix: split agent identity into two explicit fields/domains instead of using the current overloaded seven-value field everywhere.
  - For chat-run agents, store only `low | medium | high | xhigh`.
  - If `none`, `minimal`, or `max` are still needed for provider-native config import or non-chat runtimes, model them as provider config/runtime-specific metadata, not as the generic agent `thinkingEffort` consumed by chat.
- Apply the same enum in:
  - agent identity server schema/service
  - `packages/db/src/schema/identity.ts`
  - generated web API
  - agent detail and batch UI options
  - composer bound-agent projection
- Add a migration mapping unsupported existing agent values intentionally:
  - `minimal` -> `low` or a newly supported chat value if the product chooses to expand chat
  - `none` -> `low` or explicit `null` if "provider default" becomes a first-class state
  - `max` -> `xhigh`
- Avoid silent fallback to `high` for a persisted agent value that is outside the chat contract. Either reject at save time or normalize visibly at migration/import time.

Suggested verification:

```bash
pnpm generate:web
CRADLE_DATA_DIR=./data pnpm gen:cli
pnpm --filter @cradle/server test -- tests/agent.test.ts -t "thinking effort"
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/agent-management/agent-batch-configuration.test.ts
pnpm typecheck:server
pnpm typecheck:apps-web
pnpm --filter @cradle/cli typecheck
```

Add tests that prove:
- `POST /agents` and `PATCH /agents/:id` reject or normalize `none`, `minimal`, and `max` for chat-run agents.
- Agent batch configuration cannot produce unsupported chat efforts.
- A bound agent with every persisted effort produces the expected chat request `thinkingEffort`.

### Medium: Codex protocol supports `none` and `minimal`, but chat override cannot intentionally request them

Evidence:
- Generated Codex protocol type supports `none | minimal | low | medium | high | xhigh`: `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/ReasoningEffort.ts:8`.
- Codex model metadata also reports `defaultReasoningEffort: ReasoningEffort` and `supportedReasoningEfforts`: `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2/Model.ts:11`.
- Codex provider accepts provider config `none` and `minimal` when no chat override exists: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1324`.
- Chat turn override type excludes `none` and `minimal`: `apps/server/src/modules/chat-runtime/runtime-provider-types.ts:17`.
- Chat response/queue request schema excludes `none` and `minimal`: `apps/server/src/modules/chat-runtime/model.ts:594`, `apps/server/src/modules/chat-runtime/model.ts:821`.
- Title generation is a separate path that permits `minimal`: `apps/server/src/modules/chat-runtime-providers/codex/types.ts:28` and `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1179`.

Behavior risk:
- If a Codex model advertises `minimal` as a supported/default reasoning effort, chat cannot explicitly request it per turn.
- Agent management can display and persist `minimal`, but composer/chat cannot carry it. That creates an attractive but nonfunctional configuration path.
- The provider fallback can still use profile config `minimal`; a user changing agent effort to `medium` works, but changing agent effort to `minimal` is dropped by composer projection. This is asymmetric and hard to diagnose.

Proper fix:
- Decide whether chat owns Codex's full reasoning effort domain or a product-level four-value domain.
- Recommended fix for lowest regression risk: keep chat four-value and remove `none`, `minimal`, and `max` from agent-management chat controls. Leave `minimal` only in title-generation preferences and provider-native Codex config, where it already has a separate typed owner.
- Alternative architecture: expand `ChatThinkingEffort` and queue DB/API to include `none` and `minimal`, then map `max` to `xhigh` or remove `max`. This is a larger API/DB migration and must update generated web/CLI clients.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "thinking effort"
pnpm --filter @cradle/server test -- src/modules/chat-runtime-providers/codex/provider.test.ts -t "reasoning effort"
pnpm typecheck:server
pnpm typecheck:apps-web
```

Add tests that prove:
- If chat remains four-value, unsupported agent efforts cannot reach chat-run agent configuration.
- If chat expands to six values, `minimal` and `none` survive API validation, queue persistence, queue claim, and Codex `turn/start`.
- Runtime settings updates keep using the active turn's effective effort after whichever expansion/removal is chosen.

### Medium: Generated/API projections expose mismatched or weak effort types, increasing future drift

Evidence:
- Generated web API exposes preferences title generation as `minimal | low | medium | high | xhigh`: `apps/web/src/api-gen/types.gen.ts:58`.
- Generated web API exposes agents as `none | minimal | low | medium | high | xhigh | max`: `apps/web/src/api-gen/types.gen.ts:2267`.
- Generated web API exposes chat request bodies as `low | medium | high | xhigh`: `apps/web/src/api-gen/types.gen.ts:2632`.
- Generated queue DTO exposes `thinkingEffort: string | null`, not the four-value schema: `apps/web/src/api-gen/types.gen.ts:6409`.
- Server queue DTO schema is stricter than the generated output implies: `apps/server/src/modules/chat-runtime/model.ts:594` and `apps/server/src/modules/chat-runtime/model.ts:607`.

Behavior risk:
- Client code can accidentally treat queue `thinkingEffort` as an arbitrary provider value because the generated DTO is `string | null`.
- Reviewers cannot rely on type-level friction to catch accidental propagation from agent seven-value effort into chat four-value effort.
- The drift invites future patches that "fix" one UI path while leaving another projection inconsistent.

Proper fix:
- Make queue DTO generation preserve the exact thinking effort schema where possible.
- If the generator cannot infer the nested union cleanly, define a named exported schema/type for chat thinking effort and reuse it across response/request/queue schemas.
- Add a narrow static scan or type assertion test that fails if agent, chat, and preferences effort enums drift without an explicit owner decision.

Suggested verification:

```bash
pnpm generate:web
rg -n "thinkingEffort.*string \\| null|thinkingEffort\\?: 'none' \\| 'minimal'|thinkingEffort: 'none' \\| 'minimal'" apps/web/src/api-gen packages/cli/src/commands/generated
pnpm typecheck:apps-web
pnpm --filter @cradle/cli typecheck
```

Expected result depends on chosen strategy:
- If chat remains four-value, generated chat and queue types should expose only `low | medium | high | xhigh | null`.
- Agent generated types should either match the same chat contract or clearly move provider-native efforts into a different field.

## Non-Findings

- I did not find a remaining `auto` value in the inspected chat turn contract. `auto` occurrences in the scoped search are unrelated to reasoning effort, such as approval review, compacting, image detail, or UI strings.
- The current Codex provider correctly narrows direct chat overrides to `low | medium | high | xhigh` before sending `turn/start`: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1309`.
- Title generation has a separate typed preference contract that intentionally allows `minimal`, and this review does not treat that path as a bug by itself.

## Recommended Strategy

I would not expand chat to all provider protocol values unless product semantics require users to choose `none` or `minimal` per chat turn. The safer contract is:

- Chat-run effort: `low | medium | high | xhigh`
- Title-generation effort: `minimal | low | medium | high | xhigh`
- Provider-native Codex config: `none | minimal | low | medium | high | xhigh`
- Remove `max` from generic agent identity, or normalize it to `xhigh` during migration/import.

This keeps each owner namespace explicit and avoids pretending that one generic `thinkingEffort` field means the same thing in agent identity, chat turn execution, title generation, and Codex app-server config.

## Commands I Ran

Read-only inspection commands:

```bash
rg -n "thinkingEffort|reasoningEffort|ReasoningEffort|minimal|none|xhigh|auto" apps/server/src/modules/chat-runtime apps/server/src/modules/chat-runtime-providers/codex apps/web/src/features/agent-management apps/web/src/features/composer-toolbar packages/db/src/schema/chat.ts -g "*.{ts,tsx}"
rg -n "thinkingEffort" apps/server/src/modules/agent-identity packages/db/src/schema/identity.ts apps/web/src/features/agent-runtime apps/web/src/api-gen apps/web/src/features/agent-management -g "*.{ts,tsx}"
rg -n "AgentBatchThinkingEffort|buildAgentProviderBatchPatches|thinkingOptions|minimal|max|value: 'none'|value: 'minimal'|value: 'max'" apps/web/src/features/agent-management -g "*.{ts,tsx}"
```

No source files were modified for this review.
