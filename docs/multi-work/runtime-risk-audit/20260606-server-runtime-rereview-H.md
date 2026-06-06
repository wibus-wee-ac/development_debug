# Server Runtime Rereview H

Date: 2026-06-06

Scope:
- `apps/server/src/modules/chat-runtime/model.ts`
- `apps/server/src/modules/chat-runtime/index.ts`
- `apps/server/src/modules/chat-runtime/service.ts`
- `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts`
- `apps/server/src/modules/provider-contracts/provider-base.ts`
- `apps/server/src/modules/agent-identity/model.ts`
- `apps/server/src/modules/agent-identity/service.ts`
- `packages/db/src/schema/chat.ts`
- `packages/db/src/schema/identity.ts`
- `packages/db/drizzle/0061_chat_runtime_settings.sql`
- `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql`
- `apps/server/tests/chat-runtime.test.ts`
- `apps/server/tests/agent.test.ts`
- module READMEs for Chat Runtime, Provider Runtime, Provider Contracts, and Agent Identity

Question: Are we 100% confident in the strategy for chat runtime queue, `thinkingEffort`, `runtimeSettings`, provider config, and side-chat durability?

Answer: No.

The overall direction is coherent: Chat Runtime owns queue/run/session settings, Provider Contracts owns shared provider config parsing, Provider Runtime owns durable-vs-live runtime handles, and Codex projects chat overrides into its app-server protocol without writing provider config. But there are still loopholes where the contract says a setting is durable or accepted, while a specific execution path ignores or reinterprets it.

## High Findings

### High: live `steer` queue items silently ignore provider/model/thinking/runtime-setting snapshots

Evidence:
- Queue enqueue accepts all override fields for both `queue` and `steer`: `apps/server/src/modules/chat-runtime/model.ts:1004` through `apps/server/src/modules/chat-runtime/model.ts:1012`.
- The route forwards `providerTargetId`, `modelId`, `thinkingEffort`, and `runtimeSettings` into `enqueueSessionQueueItem`: `apps/server/src/modules/chat-runtime/index.ts:188` through `apps/server/src/modules/chat-runtime/index.ts:199`.
- The row persists those snapshots: `apps/server/src/modules/chat-runtime/service.ts:3834` through `apps/server/src/modules/chat-runtime/service.ts:3850`.
- For `mode === 'steer'`, the live path passes only `queueItemId`, `sessionId`, `text`, `files`, and `contextParts`: `apps/server/src/modules/chat-runtime/service.ts:3860` through `apps/server/src/modules/chat-runtime/service.ts:3867`.
- `tryApplyLiveSteer` has no input fields for provider/model/thinking/runtime settings: `apps/server/src/modules/chat-runtime/service.ts:3877` through `apps/server/src/modules/chat-runtime/service.ts:3883`.
- `SteerTurnInput` also only carries `runtimeSession`, `profile`, and `message`: `apps/server/src/modules/chat-runtime/runtime-provider-types.ts:744` through `apps/server/src/modules/chat-runtime/runtime-provider-types.ts:748`.
- Codex live steering sends only `threadId`, `expectedTurnId`, and projected user input: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1075` through `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1082`.
- If provider accepts live steer, the item is marked `completed`, so the durable drain path never replays the persisted overrides: `apps/server/src/modules/chat-runtime/service.ts:3986` through `apps/server/src/modules/chat-runtime/service.ts:4003`.

Risk:
- A `steer` item can be accepted by HTTP with a different `providerTargetId`, `modelId`, `thinkingEffort`, or `runtimeSettings`, then complete live without applying any of them.
- This breaks the queue contract specifically after the migration added per-item runtime-setting snapshots.
- The current queue test covers steer ordering but does not assert override preservation: `apps/server/tests/chat-runtime.test.ts:2670` through `apps/server/tests/chat-runtime.test.ts:2794`.

Immediately fixable bug:
- Treat live steer as valid only when the queue item has no provider/model/thinking/runtime override that differs from the active run.
- If any override is present, either reject `mode: "steer"` at enqueue time or leave the item pending for normal drain.
- If product wants live steer to support these fields, extend `SteerTurnInput` and provider implementations explicitly instead of relying on the existing text-only side channel.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "queue"
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "runtime settings"
pnpm typecheck:server
```

### High: migrated queued runtime settings are nullable, so old pending rows are not real snapshots

Evidence:
- The migration only adds nullable columns: `packages/db/drizzle/0061_chat_runtime_settings.sql:1` and `packages/db/drizzle/0061_chat_runtime_settings.sql:3`.
- The DB schema keeps `runtime_access_mode` and `runtime_interaction_mode` nullable: `packages/db/src/schema/chat.ts:122` through `packages/db/src/schema/chat.ts:127`.
- The README promises queue items include per-item runtime settings snapshots: `apps/server/src/modules/chat-runtime/README.md:28`.
- Reading a queue row merges nullable row fields over the current session runtime settings: `apps/server/src/modules/chat-runtime/service.ts:1622` through `apps/server/src/modules/chat-runtime/service.ts:1629`.
- Draining a queue item reads the current session config at drain time, then calls the merge above: `apps/server/src/modules/chat-runtime/service.ts:6032` through `apps/server/src/modules/chat-runtime/service.ts:6044`.
- The old `permission_mode` column still exists in schema but new enqueue writes it as `null`: `packages/db/src/schema/chat.ts:119` through `packages/db/src/schema/chat.ts:121`, and `apps/server/src/modules/chat-runtime/service.ts:3847`.

Risk:
- Pending rows created before `0061` do not carry the promised snapshot. If the user changes session runtime settings before the row drains, the old row inherits the new session settings.
- Historical `permission_mode` was not backfilled into the new settings columns, so queued permission intent may be lost.

Immediately fixable bug:
- Add a migration/backfill for pending/nonterminal queue rows:
  - `runtime_access_mode`: map historical `permission_mode` if trustworthy, otherwise use the product default `full-access`.
  - `runtime_interaction_mode`: map historical `permission_mode = 'plan'` to `plan` if that was the old meaning, otherwise use `default`.
- After migration, make queue runtime setting columns non-null for new table rebuilds, or make the reader treat `null` as a historical repaired default rather than current session settings.
- Add a direct regression test inserting a pending row with null runtime settings, changing session settings, and proving the row drains with the intended migrated/default snapshot.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "runtime settings"
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "queue"
pnpm typecheck:server
```

## Medium Findings

### Medium: runtime-settings PATCH has intentional split-brain semantics that need a stronger API contract

Evidence:
- PATCH persists the new session settings before attempting live provider update: `apps/server/src/modules/chat-runtime/service.ts:4034` through `apps/server/src/modules/chat-runtime/service.ts:4046`.
- If live provider update fails, it logs and returns `applied: false`: `apps/server/src/modules/chat-runtime/service.ts:4063` through `apps/server/src/modules/chat-runtime/service.ts:4089`.
- The active run only changes its `runtimeSettings` after provider update succeeds: `apps/server/src/modules/chat-runtime/service.ts:4066` through `apps/server/src/modules/chat-runtime/service.ts:4072`.
- Test coverage documents this behavior: persisted session settings are new, but runtime status still reports the active run settings as old when live update fails: `apps/server/tests/chat-runtime.test.ts:1407` through `apps/server/tests/chat-runtime.test.ts:1440`.
- Codex projects live settings through `thread/settings/update`: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1085` through `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1105`.

Risk:
- API consumers can read the PATCH response `runtimeSettings` and assume the current active run uses them even when `applied: false`.
- Queue rows created after the PATCH snapshot the new settings, while the active run may still use old settings. That can be correct, but it must be explicit.

Architecture recommendation:
- Split the response into `persistedRuntimeSettings` and `activeRunRuntimeSettings`, or add `effectiveForActiveRun`.
- Keep `GET /runtime-status` as the active-run source of truth.
- Consider a `409` or warning code if the product expects strong live consistency during active runs.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "runtime settings"
pnpm typecheck:server
```

### Medium: provider config and chat/session override domains are still flattened into one `profile.configJson`

Evidence:
- `getSessionRunContext` merges provider target config, model registry mappings, agent config, and session config into one `profile.configJson`: `apps/server/src/modules/chat-runtime/service.ts:600` through `apps/server/src/modules/chat-runtime/service.ts:620`.
- Codex reads provider-owned fields from that merged config: `apps/server/src/modules/provider-contracts/provider-base.ts:144` through `apps/server/src/modules/provider-contracts/provider-base.ts:156`.
- Chat runtime settings are separately passed as `providerOptions.runtimeSettings`: `apps/server/src/modules/chat-runtime/service.ts:4279` through `apps/server/src/modules/chat-runtime/service.ts:4283`.
- Codex then applies chat runtime settings over provider config for approval/sandbox/collaboration: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:732` through `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:744`, and `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:918` through `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:935`.

Risk:
- The owner split is behaviorally present but not structurally enforced. A session or agent config key named like a provider config field can shadow provider target config before explicit chat overrides are applied.
- This makes future runtime/provider changes hard to audit because provider-owned config and Cradle-owned session settings share one JSON namespace.

Architecture recommendation:
- Carry separate typed objects in `SessionRunContext`: provider target config, agent runtime config, session chat config, and explicit per-turn overrides.
- Let provider adapters read only provider-owned config through `readTrusted*Config`.
- Keep model preference, `thinkingEffort`, and `runtimeSettings` as explicit arguments.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "runtime settings"
pnpm --filter @cradle/server test -- tests/agent.test.ts -t "imports local Claude and Codex config"
pnpm typecheck:server
```

### Medium: side-chat durability is live-only by design, but the API shape can overpromise durability

Evidence:
- Chat Runtime README says side chats create durable Session rows and use bounded Cradle transcript fallback, but also says side conversations do not write durable provider bindings and expire with the live registry: `apps/server/src/modules/chat-runtime/README.md:8`.
- Provider Runtime README defines side conversations as process-local live-only handles: `apps/server/src/modules/provider-runtime/README.md:24` through `apps/server/src/modules/provider-runtime/README.md:30`.
- `attachBinding` explicitly disables durable provider bindings for any side session: `apps/server/src/modules/chat-runtime/service.ts:653` through `apps/server/src/modules/chat-runtime/service.ts:667`.
- `assertSideConversationLive` rejects any side session without a matching live registry entry: `apps/server/src/modules/chat-runtime/service.ts:2361` through `apps/server/src/modules/chat-runtime/service.ts:2390`.
- Tests assert both provider-native and `cradle-context` side sessions fail with `side_chat_expired` after live state is cleared: `apps/server/tests/chat-runtime.test.ts:741` through `apps/server/tests/chat-runtime.test.ts:803`, and `apps/server/tests/chat-runtime.test.ts:818` through `apps/server/tests/chat-runtime.test.ts:878`.

Risk:
- If "side-chat durability" means "the side transcript remains visible but cannot run after restart", current behavior is consistent.
- If product expects `sideContextSource = 'cradle-context'` sessions to continue from durable parent transcript after restart, current behavior is not durable. The name `cradle-context` can mislead because the context source is durable but the runtime handle is still live-only.

Architecture recommendation:
- Make the API/UI contract explicit: side sessions are transcript-durable but runtime-ephemeral.
- If durable Cradle-context side chats are desired, split behavior:
  - provider-native side chats stay live-only and fail closed;
  - `cradle-context` side chats may start a fresh normal runtime using parent transcript context after live handle expiry.
- Keep provider-native side sessions from silently starting replacement provider threads.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "side conversations"
pnpm typecheck:server
```

## Low Findings

### Low: Agent Identity README is stale after the four-value thinking-effort migration

Evidence:
- README still says provider-backed agents may persist `auto`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`: `apps/server/src/modules/agent-identity/README.md:4`.
- Agent HTTP schema now accepts only `low`, `medium`, `high`, and `xhigh`: `apps/server/src/modules/agent-identity/model.ts:3` through `apps/server/src/modules/agent-identity/model.ts:8`.
- Service input schemas use the same four-value enum and only normalize historical values internally: `apps/server/src/modules/agent-identity/service.ts:118` through `apps/server/src/modules/agent-identity/service.ts:130`.
- DB schema is four-value with default `high`: `packages/db/src/schema/identity.ts:38` through `packages/db/src/schema/identity.ts:40`.
- Migration `0065` also repairs queue rows as well as agents: `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql:1` through `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql:15`.

Risk:
- Future reviewers can rely on the README and reintroduce unsupported values into agent/chat UI or service callers.

Immediately fixable bug:
- Update the README to state that generic agent identity uses `low | medium | high | xhigh`; provider-native values such as `none` or `minimal` belong in provider config, not generic agent identity.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/agent.test.ts -t "thinking"
pnpm typecheck:server
```

### Low: `thinkingEffort` queue migration is now present, but read-time invalid values still collapse silently

Evidence:
- `0065` maps historical agent and queue values: `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql:1` through `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql:15`.
- The route schemas reject non-four-value chat efforts: `apps/server/src/modules/chat-runtime/model.ts:594` through `apps/server/src/modules/chat-runtime/model.ts:599`, `apps/server/src/modules/chat-runtime/model.ts:821` through `apps/server/src/modules/chat-runtime/model.ts:830`, and `apps/server/src/modules/chat-runtime/model.ts:1004` through `apps/server/src/modules/chat-runtime/model.ts:1013`.
- `readPersistedThinkingEffort` still returns `null` for any unexpected DB value: `apps/server/src/modules/chat-runtime/service.ts:1632` through `apps/server/src/modules/chat-runtime/service.ts:1639`.
- Queue drain passes `null` as no override: `apps/server/src/modules/chat-runtime/service.ts:6040` through `apps/server/src/modules/chat-runtime/service.ts:6044`.
- Codex then falls back to provider config or `high`: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1310` through `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1322`.

Risk:
- This is lower risk after `0065`, but direct DB writes or partial migrations can still turn a queued effort into provider default without an error.

Architecture recommendation:
- For persisted queue rows, prefer fail-fast or repair-on-read over silent `null`.
- Add a diagnostic test for malformed queue effort if DB corruption tolerance matters.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "thinking"
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "queue"
pnpm typecheck:server
```

## Non-Findings

- I did not find a current HTTP path that accepts `none`, `minimal`, `auto`, or `max` for chat turn `thinkingEffort`. The Chat Runtime schema is four-value and the route helper only returns those four values: `apps/server/src/modules/chat-runtime/model.ts:594` through `apps/server/src/modules/chat-runtime/model.ts:599`, and `apps/server/src/modules/chat-runtime/index.ts:30` through `apps/server/src/modules/chat-runtime/index.ts:34`.
- I did not find Codex writing Cradle runtime settings back into provider config. Codex applies per-turn settings to request config and `turn/start`, and live changes go through `thread/settings/update`: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:740` through `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:744`, `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:918` through `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:935`, and `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1085` through `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1105`.
- I did not find a missing `0065` queue migration in the current worktree. The migration repairs both `agents` and `chat_session_queue_items`: `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql:1` through `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql:15`.

## Recommended Strategy

Immediately fix:
- Guard or extend live steer so accepted `steer` items cannot silently drop provider/model/thinking/runtime-setting snapshots.
- Backfill nullable queue runtime-setting columns and stop interpreting null historical rows as "use current session settings".
- Update the stale Agent Identity README.

Architecture follow-up:
- Split provider config from chat/session/agent override config structurally instead of flattening into `profile.configJson`.
- Clarify side-chat durability in product/API terms: transcript-durable vs runtime-durable.
- Make runtime-settings PATCH responses distinguish persisted settings from active-run effective settings.

## Suggested Focused Verification

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "queue"
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "runtime settings"
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "side conversations"
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "thinking"
pnpm --filter @cradle/server test -- tests/agent.test.ts -t "thinking"
pnpm typecheck:server
```
