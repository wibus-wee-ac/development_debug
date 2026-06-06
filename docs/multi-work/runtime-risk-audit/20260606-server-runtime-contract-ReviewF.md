# Server Runtime Contract ReviewF

Date: 2026-06-06

Scope:
- `apps/server/src/modules/agent-identity/model.ts`
- `apps/server/src/modules/agent-identity/service.ts`
- `apps/server/src/modules/chat-runtime/model.ts`
- `apps/server/src/modules/chat-runtime/index.ts`
- `apps/server/src/modules/chat-runtime/service.ts`
- `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts`
- `packages/db/src/schema/identity.ts`
- `packages/db/src/schema/chat.ts`
- `packages/db/drizzle/0063_agent_thinking_effort_concrete.sql`
- `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql`
- `apps/server/tests/chat-runtime.test.ts`
- `apps/server/tests/agent.test.ts`
- `packages/cli/src/commands/generated`

Question: Are we 100% confident in the current server chat-runtime / agent-identity / queue / thinkingEffort / runtimeSettings contract strategy?

Answer: No.

The direction is mostly coherent: chat turn effort is now four-value (`low | medium | high | xhigh`), agent HTTP rejects unsupported effort values, Codex projects runtime settings through `providerOptions`, provider-native side chats deliberately fail closed after their live host disappears, and tests cover several key cases. The remaining risk is not one obvious crash; it is contract drift across persistence, generated clients, queue replay, and live-vs-persisted runtime settings.

## Findings

### High: Historical queue `thinking_effort` values are not migrated and can be silently replayed as provider default

Evidence:
- `agents.thinking_effort` is normalized in migration `0065`: `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql:1` maps `none/minimal` to `low`, and `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql:5` maps `max` to `xhigh`.
- There is no equivalent update for `chat_session_queue_items.thinking_effort`; the queue schema still has a nullable four-value enum projection: `packages/db/src/schema/chat.ts:116`.
- Queue DTO conversion turns any non-four-value stored value into `null`: `apps/server/src/modules/chat-runtime/service.ts:1623`.
- Queue replay passes that value into `createRun` after queue claim, so `null` means the turn falls back to session/provider config instead of the user's queued override: `apps/server/src/modules/chat-runtime/service.ts:1647`, `apps/server/src/modules/chat-runtime/service.ts:3252`.
- Codex then falls back to provider config or `high` when no chat override exists: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1310`.

Risk:
- Any pre-existing queued continuation with `none`, `minimal`, `max`, or another old value will list as `thinkingEffort: null` and run without the intended effort.
- This is especially risky for durable queue semantics because the user might enqueue under one contract and replay after migration under another.

Suggested fix:
- Add a migration for `chat_session_queue_items.thinking_effort` with the same explicit mapping as agents, plus a catch-all policy if unknown historical values exist.
- Avoid silent nulling for invalid persisted queue effort. Prefer one of:
  - repair at read time and persist the repaired value, or
  - mark the item failed with a clear `errorText` if the stored contract is unrecoverable.
- Add a queue replay regression test with historical `minimal` and `max` values inserted directly into DB.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "queue"
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "thinking"
pnpm typecheck:server
```

### High: Generated client response weakens queue `thinkingEffort` to `string | null`

Evidence:
- Server response schema is precise: `thinkingEffort` is `low | medium | high | xhigh | null` in `apps/server/src/modules/chat-runtime/model.ts:594` and `apps/server/src/modules/chat-runtime/model.ts:611`.
- Generated web API weakens queue response values to `string | null`: `apps/web/src/api-gen/types.gen.ts:6433` and `apps/web/src/api-gen/types.gen.ts:6513`.
- Generated CLI command specs only model request flags and have no response schema: `packages/cli/src/runtime/types.ts:23`; CLI requests return `Promise<unknown>`: `packages/cli/src/runtime/types.ts:34`.

Risk:
- Frontend or agent-facing CLI consumers can accidentally reintroduce provider-native values into chat queue handling because the response type no longer protects the four-value contract.
- Reviewers cannot rely on generated type friction to catch future drift.

Suggested fix:
- Fix OpenAPI/type generation so `t.Union([thinkingEffortSchema, t.Null()])` emits the literal union, not `string | null`.
- If the generator cannot preserve nested unions, export a named `chatThinkingEffortSchema` and reuse it in request, response, DTO, and generated clients.
- For CLI, either keep responses intentionally untyped but document that generated commands are request projections only, or add response type metadata if agent code consumes CLI JSON structurally.

Suggested verification:

```bash
pnpm generate:web
pnpm gen:cli
rg -n "thinkingEffort: string \\| null" apps/web/src/api-gen packages/cli/src/commands/generated
pnpm typecheck:apps-web
pnpm --filter @cradle/cli typecheck
```

### Medium: Migration order leaves the historical-value strategy fragile

Evidence:
- Migration journal applies `0063_agent_thinking_effort_concrete` before `0065_agent_thinking_effort_chat_contract`: `packages/db/drizzle/meta/_journal.json:447` and `packages/db/drizzle/meta/_journal.json:461`.
- `0063` rebuilds `agents` and only maps `auto` to `high`: `packages/db/drizzle/0063_agent_thinking_effort_concrete.sql:45`.
- `0065` later normalizes `none/minimal/max`: `packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql:1`.
- Current SQLite schema declarations use Drizzle enum metadata but do not create DB-level `CHECK` constraints in these migrations, so invalid text can survive until a later statement repairs it.

Risk:
- A partial migration, manual migration run, or future DB-level constraint added to `0063` would break or preserve invalid values before `0065` runs.
- The strategy depends on application code and later migration cleanup rather than having the table rebuild create already-normalized data.

Suggested fix:
- Fold all known historical mappings into the table rebuild in `0063`, or add a new follow-up migration that validates no old values remain in both `agents` and `chat_session_queue_items`.
- Add a migration smoke test that starts from a fixture DB containing `auto`, `none`, `minimal`, `max`, and an unknown value.

Suggested verification:

```bash
pnpm --filter @cradle/db test -- migrations
sqlite3 path/to/migrated.db "select thinking_effort, count(*) from agents group by thinking_effort;"
sqlite3 path/to/migrated.db "select thinking_effort, count(*) from chat_session_queue_items group by thinking_effort;"
```

### Medium: Runtime settings live update has split-brain semantics by design, but the contract is easy to misuse

Evidence:
- `PATCH /chat/sessions/:sessionId/runtime-settings` persists new settings before trying live provider update: `apps/server/src/modules/chat-runtime/service.ts:4034`.
- If provider live update fails, it logs and returns `applied: false` while the DB remains updated: `apps/server/src/modules/chat-runtime/service.ts:4069`.
- The active run keeps old settings unless provider update succeeds: `apps/server/src/modules/chat-runtime/service.ts:4066`.
- Test coverage documents this exact behavior: persisted settings are new, but runtime status for the active run remains old at `apps/server/tests/chat-runtime.test.ts:1338` and `apps/server/tests/chat-runtime.test.ts:1357`.
- Codex live update only changes access/collaboration settings through `thread/settings/update`: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1085`.

Risk:
- API consumers can read `runtimeSettings` in the PATCH response and assume the current active run uses those settings, even when `applied: false`.
- Queue items created after the patch inherit the newly persisted settings while the current active run may still use the old settings. That is defensible, but it must be explicitly represented in status/UX.

Suggested fix:
- Split the response into `persistedRuntimeSettings` and `activeRunRuntimeSettings`, or keep `runtimeSettings` but add explicit `effectiveForActiveRun`.
- Consider returning `409` or a dedicated warning code when live update fails and the session has an active run, if the product expects strong live consistency.
- Keep `runtime-status` as the source of truth for active run settings.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "runtime settings"
pnpm typecheck:server
```

### Medium: Provider config and chat override domains are still flattened into one profile config object

Evidence:
- Runtime context merges provider target config, model registry config, agent config, and session config into one `profile.configJson`: `apps/server/src/modules/chat-runtime/service.ts:617`.
- Codex reads provider-owned fields such as `approvalPolicy`, `sandboxMode`, and `reasoningEffort` from that merged config: `apps/server/src/modules/provider-contracts/provider-base.ts:144`.
- Chat runtime settings are separately passed as `providerOptions.runtimeSettings`: `apps/server/src/modules/chat-runtime/service.ts:4274`.
- Codex then overrides approval/sandbox from chat runtime settings for each turn: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:741` and `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:923`.

Risk:
- The intended owner split is not enforced structurally. Any session or agent config key with a provider config name can shadow provider target config before `providerOptions` is applied.
- `runtimeSettings` itself is namespaced, but the surrounding merged `configJson` still mixes provider-owned and chat/session-owned data.

Suggested fix:
- Keep provider config and Cradle chat overrides as separate typed objects through `SessionRunContext`.
- Only pass provider target plus provider-owned agent config into `readTrustedCodexConfig`.
- Pass chat runtime settings, model preference, and per-turn thinking effort through explicit fields, not by flattening them into provider config JSON.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "runtime settings"
pnpm --filter @cradle/server test -- src/modules/chat-runtime-providers/codex/provider.test.ts
pnpm typecheck:server
```

### Medium: Provider-native side chats are live-only; restart behavior is intentionally fail-closed but not durable

Evidence:
- Provider-native side sessions require an in-memory registered side conversation: `apps/server/src/modules/chat-runtime/service.ts:2354`.
- Missing live side state throws `side_chat_expired`: `apps/server/src/modules/chat-runtime/service.ts:2372`.
- Side session bindings are attached with `durable: !isEphemeralSideSession(...)`, so ephemeral side sessions are not durable provider bindings: `apps/server/src/modules/chat-runtime/service.ts:656`.
- Test coverage confirms that after clearing side conversations and shutting down the host, a side run is rejected with 409 and does not start a new provider session: `apps/server/tests/chat-runtime.test.ts:789`.

Risk:
- This is correct if provider-native side chat is explicitly a live-only feature.
- It is a loophole if the user/product expects side chats shown in history to remain runnable after server restart. They will instead become transcript-visible but runtime-expired.

Suggested fix:
- Make the product contract explicit in API/UI: provider-native side chats are live-only and can expire after process restart.
- If durable side chats are required, either persist enough provider fork metadata to reattach safely, or automatically convert expired provider-native side chats to `cradle-context` with an explicit state transition and user-visible warning.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "side conversations"
pnpm typecheck:server
```

### Low: API rejection and service normalization boundaries are inconsistent but currently covered for HTTP create

Evidence:
- Agent HTTP schema accepts only `low | medium | high | xhigh`: `apps/server/src/modules/agent-identity/model.ts:3`, `apps/server/src/modules/agent-identity/model.ts:138`, and `apps/server/src/modules/agent-identity/model.ts:150`.
- Service has a historical normalization helper for `none/minimal/max`: `apps/server/src/modules/agent-identity/service.ts:122`.
- That helper is used when updating an existing agent without an explicit `thinkingEffort`: `apps/server/src/modules/agent-identity/service.ts:729`.
- HTTP create rejects `minimal` with a validation error in test coverage: `apps/server/tests/agent.test.ts:300`.

Risk:
- The HTTP boundary rejects unsupported values, while service internals normalize historical values only on some paths. This is acceptable for a migration bridge, but it is not a single obvious contract.
- Future internal callers can still bypass the HTTP validation and depend on service behavior that was intended for historical repair.

Suggested fix:
- Rename/document the normalization helper as a historical DB repair path and keep it out of normal create/update input semantics.
- Add a direct service-level test for updating an old DB row with `minimal`/`max` so the bridge remains intentional.

Suggested verification:

```bash
pnpm --filter @cradle/server test -- tests/agent.test.ts -t "thinking"
pnpm typecheck:server
```

## Non-Findings

- I did not find a live chat HTTP path that accepts `none`, `minimal`, or `max` today. `ChatRuntimeModel.responseBody` and `queueEnqueueBody` both use the four-value schema: `apps/server/src/modules/chat-runtime/model.ts:821` and `apps/server/src/modules/chat-runtime/model.ts:1004`.
- I did not find evidence that invalid HTTP `thinkingEffort` reaches the handler under normal Elysia validation. `readChatThinkingEffort` still silently drops invalid values at `apps/server/src/modules/chat-runtime/index.ts:30`, but the schema should reject them first.
- I did not treat provider-native side chat expiration as a bug by itself because tests clearly encode the fail-closed behavior.

## Recommended Strategy

I would not call the current strategy 100% closed until these boundaries are made explicit:

- Chat runtime effort stays four-value everywhere, including queue DB migration and generated response types.
- Provider-native Codex config keeps its broader provider domain, but it is structurally separated from chat/session overrides.
- Runtime settings responses distinguish persisted settings from active-run-applied settings.
- Provider-native side chats are documented as live-only, or a durable restart path is designed.

## Suggested Full Verification

```bash
pnpm --filter @cradle/server test -- tests/agent.test.ts -t "thinking"
pnpm --filter @cradle/server test -- tests/chat-runtime.test.ts -t "thinking|queue|runtime settings|side conversations"
pnpm generate:web
pnpm gen:cli
pnpm typecheck:server
pnpm typecheck:apps-web
pnpm --filter @cradle/cli typecheck
rg -n "thinkingEffort: string \\| null" apps/web/src/api-gen packages/cli/src/commands/generated
```

## Commands Used

Read-only inspection plus this report write:

```bash
git status --short
sed -n '1,260p' apps/server/src/modules/agent-identity/model.ts
sed -n '1,760p' apps/server/src/modules/agent-identity/service.ts
sed -n '1,1040p' apps/server/src/modules/chat-runtime/model.ts
sed -n '1,532p' apps/server/src/modules/chat-runtime/index.ts
sed -n '1,4300p' apps/server/src/modules/chat-runtime/service.ts
sed -n '1,420p' apps/server/src/modules/chat-runtime/runtime-provider-types.ts
sed -n '1,2225p' apps/server/src/modules/chat-runtime-providers/codex/provider.ts
sed -n '1,220p' apps/server/src/modules/provider-contracts/provider-base.ts
sed -n '1,150p' packages/db/src/schema/chat.ts
sed -n '1,90p' packages/db/src/schema/identity.ts
sed -n '1,220p' packages/db/drizzle/meta/_journal.json
sed -n '1,220p' packages/db/drizzle/0063_agent_thinking_effort_concrete.sql
sed -n '1,80p' packages/db/drizzle/0065_agent_thinking_effort_chat_contract.sql
rg -n "thinkingEffort|runtimeSettings|side_chat_expired|provider-native" apps/server/tests apps/web/src/api-gen packages/cli/src/commands/generated
```

No source files were modified for this review.
