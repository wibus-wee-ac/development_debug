# Frontend Pending Selection Runtime Risk Audit - ReviewE

## Conclusion

I am not 100% confident in the current strategy.

The broad direction is understandable: avoid persisting provider-only selections, wait for a resolved model, and normalize thinking effort against the selected model where possible. The loophole is that this state machine is reimplemented across chat runtime, settings, Jarvis, Chronicle, automation, and agent management with different save ordering and compatibility rules. That creates several cases where a cold model cache, rapid selection changes, in-flight saves, or legacy agent values can leak stale provider/model/thinking state.

## Findings

### High

#### H1. Chat session provider/model saves are not ordered, so rapid selections can persist stale provider/model pairs.

Evidence:

- [apps/web/src/features/chat/chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:87) defines `persistSessionProviderModel` with optimistic cache updates and a `patchSessionsById` call, but no request sequence, abort, or mutation scope.
- [apps/web/src/features/chat/chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:104) applies the returned server payload directly to the query cache.
- [apps/web/src/features/chat/chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:114) rolls back to `previousSession` on any failure, even if a newer selection already succeeded.
- [apps/web/src/features/chat/chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:140) and [apps/web/src/features/chat/chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:153) can fire multiple saves during rapid provider/model selection.

Why it matters:

If the user selects provider A/model A and then provider B/model B quickly, the slower response can win in cache and potentially in storage, depending on server arrival order. A failed older request can also restore a pre-selection cache snapshot after a newer request has completed.

Suggested fix:

Use one owner for chat runtime selection persistence. Add a monotonically increasing client-side save token or serialize session provider/model mutations per `sessionId`. Only apply success/rollback if the response still matches the latest token. On failure, invalidate instead of restoring a stale full snapshot when a newer save is known.

Suggested validation:

```bash
pnpm --filter @cradle/web test chat-runtime-view
pnpm --filter @cradle/web test composer
pnpm --filter @cradle/web lint
```

Add a focused test that resolves two `patchSessionsById` promises out of order and asserts the final cached session uses the last selected provider/model.

#### H2. Agent detail auto-save can drop edits made while a previous save is in flight.

Evidence:

- [apps/web/src/features/agent-management/agent-detail.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-detail.tsx:1316) captures `currentValues` before awaiting `updateAgent.mutateAsync`.
- [apps/web/src/features/agent-management/agent-detail.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-detail.tsx:1359) calls `form.reset(normalizedValues)` after the await.
- [apps/web/src/features/agent-management/agent-detail.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-detail.tsx:1373) skips scheduling a new auto-save while `saveState === 'saving'`.

Why it matters:

If the user changes provider/model/thinking or any other field while a save is running, the effect does not schedule a save, and the eventual `form.reset(normalizedValues)` can reset the form to the older saved snapshot. This is especially risky for cold-cache provider selection, where model resolution can happen after an unrelated save started.

Suggested fix:

After a save completes, compare the current form snapshot with the submitted snapshot before resetting. If they differ, keep the current dirty values and schedule the next save. A small save queue or revision counter per agent would make the behavior deterministic.

Suggested validation:

```bash
pnpm --filter @cradle/web test agent-batch-configuration
pnpm --filter @cradle/web lint
```

Add a test around `AgentDetailPage` where a save promise is held, the provider/model changes, then the promise resolves. Assert the newer form values remain dirty and are saved later.

#### H3. Bound agent thinking effort bypasses model compatibility filtering in chat.

Evidence:

- [apps/web/src/features/composer-toolbar/use-composer-state.ts](/Users/wibus/dev/Cradle/apps/web/src/features/composer-toolbar/use-composer-state.ts:219) returns `boundAgent.thinkingEffort` directly for chat context.
- [apps/web/src/features/composer-toolbar/use-composer-state.ts](/Users/wibus/dev/Cradle/apps/web/src/features/composer-toolbar/use-composer-state.ts:223) only filters thinking options for non-bound-agent cases.
- [apps/web/src/features/composer-toolbar/constants.ts](/Users/wibus/dev/Cradle/apps/web/src/features/composer-toolbar/constants.ts:52) defines the compatibility filter that excludes `minimal`/`xhigh` for unsupported models.
- [apps/web/src/features/chat/chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:80) forwards the resolved thinking effort into send overrides.

Why it matters:

A legacy or edited agent can carry `xhigh` while the effective model is non-reasoning or only standard reasoning. Chat sends the incompatible value because the bound-agent branch exits before `filterThinkingOptionsForModel`.

Suggested fix:

Run bound-agent thinking effort through `selectSupportedThinkingValue` using `effectiveModel`. Keep the agent value as the preferred value, but clamp it before exposing `selection.thinkingEffort`.

Suggested validation:

```bash
pnpm --filter @cradle/web test composer
pnpm --filter @cradle/web lint
```

Add a hook-level test for a bound agent with `thinkingEffort: 'xhigh'` and a model whose `capabilities.reasoning` is false. Assert the selected thinking is clamped.

### Medium

#### M1. Cold-cache pending provider selections are transient and can be lost on page close or navigation.

Evidence:

- [apps/web/src/features/chat/chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:124) waits for cached models before persisting provider/model.
- [apps/web/src/features/chat/chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:76) intentionally hides the pending provider from send overrides while no model is resolved.
- [apps/web/src/features/settings/chat-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/chat-settings.tsx:330), [apps/web/src/features/settings/jarvis-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/jarvis-settings.tsx:88), and [apps/web/src/features/chronicle/chronicle-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/chronicle-settings.tsx:889) use similar pending-until-model effects.
- [apps/web/src/features/agent-runtime/use-agent-models.ts](/Users/wibus/dev/Cradle/apps/web/src/features/agent-runtime/use-agent-models.ts:130) returns an empty list when the provider model cache is cold or empty.
- [apps/web/src/features/agent-runtime/use-agent-models.ts](/Users/wibus/dev/Cradle/apps/web/src/features/agent-runtime/use-agent-models.ts:19) keeps these inventory queries at `staleTime: Infinity`.

Why it matters:

The UI can show a selected provider while the actual persisted state remains unchanged. If the user navigates away, closes the page, or sends a message before the model cache resolves, the choice is discarded or the old provider/model is used. This avoids provider-only persistence, but it also means pending selection has no durable owner.

Suggested fix:

Represent the selection as an explicit state machine: `idle`, `pendingModels`, `resolved`, `failed`. Either persist a separate draft owned by the surface, or make the UI clearly non-committed until model resolution. If provider-only persistence is disallowed, do not let pending state look equivalent to committed state.

Suggested validation:

```bash
pnpm --filter @cradle/web test composer
pnpm --filter @cradle/web lint
```

Add cold-cache tests for chat, Jarvis, Chronicle, and title generation: select a provider with no cached models, unmount, remount, and assert whether the expected committed state is preserved or intentionally discarded.

#### M2. Jarvis and Chronicle preference saves write full objects without mutation ordering.

Evidence:

- [apps/web/src/features/system-agent/use-jarvis-preferences.ts](/Users/wibus/dev/Cradle/apps/web/src/features/system-agent/use-jarvis-preferences.ts:27) creates an unscoped mutation.
- [apps/web/src/features/system-agent/use-jarvis-preferences.ts](/Users/wibus/dev/Cradle/apps/web/src/features/system-agent/use-jarvis-preferences.ts:34) builds `next` from the current query cache and writes the full preference body.
- [apps/web/src/features/chronicle/use-chronicle.ts](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/use-chronicle.ts:984) creates an unscoped mutation.
- [apps/web/src/features/chronicle/use-chronicle.ts](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/use-chronicle.ts:994) builds `next` from current cache and writes the full config body.
- [apps/web/src/features/settings/jarvis-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/jarvis-settings.tsx:136) and [apps/web/src/features/chronicle/chronicle-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/chronicle-settings.tsx:916) expose several controls that can call saves in quick succession.

Why it matters:

Rapid runtime/provider/model/thinking toggles can race with unrelated toggles. Because the mutations write full objects derived from possibly stale cache, the last server response may not represent the last user action.

Suggested fix:

Use mutation scopes per preference owner, or move to patch semantics where each save only writes changed fields and the server owns merging. If full-object PUT remains, add per-owner save serialization and stale-response suppression.

Suggested validation:

```bash
pnpm --filter @cradle/web lint
```

Add tests that delay two Jarvis or Chronicle saves and resolve them out of order. Assert final query cache and persisted payload match the last interaction.

#### M3. Existing bound agent model IDs are trusted even when absent from the current model list.

Evidence:

- [apps/web/src/features/composer-toolbar/use-composer-state.ts](/Users/wibus/dev/Cradle/apps/web/src/features/composer-toolbar/use-composer-state.ts:185) returns `boundAgent.modelId` without checking `models.some`.
- [apps/web/src/features/composer-toolbar/use-composer-state.ts](/Users/wibus/dev/Cradle/apps/web/src/features/composer-toolbar/use-composer-state.ts:188) validates `boundModelId` against `models` before using it, but the bound-agent path lacks the same guard.

Why it matters:

If an agent retains a model that is no longer visible, disabled, removed from cache, or incompatible with the provider target, chat can continue to expose and send that old model ID. This is an old model leak path distinct from pending provider selection.

Suggested fix:

Apply the same membership rule to `boundAgent.modelId`. If the model list is not loaded yet, keep the string only as display fallback, not as a resolved send override. Once models are loaded and the ID is absent, fall back to the first valid model or force a repair flow.

Suggested validation:

```bash
pnpm --filter @cradle/web test composer
pnpm --filter @cradle/web lint
```

Add a hook-level test where the bound agent model is missing from the provider model cache.

#### M4. Title generation thinking effort is not tied to the selected model capability.

Evidence:

- [apps/web/src/features/settings/chat-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/chat-settings.tsx:324) builds all thinking levels unconditionally.
- [apps/web/src/features/settings/chat-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/chat-settings.tsx:392) renders a standalone `ThinkingEffortPicker` with no model filter.
- [apps/web/src/features/settings/chat-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/chat-settings.tsx:396) persists any selected thinking effort.

Why it matters:

Unlike Jarvis, automation, agent detail, and batch agent configuration, title generation can persist `minimal` or `xhigh` regardless of the chosen model. That leaves another thinkingEffort incompatibility path.

Suggested fix:

Filter title-generation thinking options through `filterThinkingOptionsForModel(selectedModel, thinkingOptions)` and clamp stored values when provider/model changes.

Suggested validation:

```bash
pnpm --filter @cradle/web lint
```

Add a settings-level test that switches title generation to a non-reasoning model and verifies unsupported thinking options disappear or are clamped.

### Low

#### L1. Several pending effects depend on unstable aggregate objects, increasing rerun surface.

Evidence:

- [apps/web/src/features/chat/chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:136) depends on the whole `composerState` object.
- [apps/web/src/features/agent-runtime/use-agent-models.ts](/Users/wibus/dev/Cradle/apps/web/src/features/agent-runtime/use-agent-models.ts:291) rebuilds `modelsByProviderTargetId`, `loadingProviderTargetIds`, and `successfulProviderTargetIds` every render.
- [apps/web/src/features/chronicle/chronicle-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/chronicle-settings.tsx:903) depends on `modelsByProfileId`, which is rebuilt by `useAgentModelMap`.

Why it matters:

The current guards prevent obvious infinite loops, but the effects rerun more often than their semantic inputs change. In a fragile pending-save state machine, unnecessary reruns increase the chance of duplicate saves after future edits.

Suggested fix:

Depend on primitive values and stable callbacks where possible. For chat, replace `[composerState, pendingProviderTargetId, persistSessionProviderModel]` with the specific map entry and setter callback needed by the effect, or memoize the returned composer actions.

Suggested validation:

```bash
pnpm --filter @cradle/web lint
```

Add render-count or duplicate-save assertions around the pending provider effect if the component already has tests.

#### L2. Provider-only persistence is currently mostly prevented, but the invariant is implicit and duplicated.

Evidence:

- [apps/web/src/features/chat/chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:87) allows `providerTargetId` without `modelId` at the helper boundary.
- [apps/web/src/features/agent-management/agent-batch-configuration.ts](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-batch-configuration.ts:26) explicitly rejects batch provider updates without a resolved model.
- [apps/web/src/features/automation/automation-dashboard.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/automation/automation-dashboard.tsx:791) disables save until provider and model are both resolved.
- [apps/web/src/features/settings/chat-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/chat-settings.tsx:341), [apps/web/src/features/settings/jarvis-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/jarvis-settings.tsx:100), and [apps/web/src/features/chronicle/chronicle-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/chronicle-settings.tsx:901) persist provider/model together after model resolution.

Why it matters:

The invariant exists by convention at call sites, not as a shared type or helper. A future call to `persistSessionProviderModel({ providerTargetId })` would violate it silently.

Suggested fix:

Introduce a shared resolved-selection type for provider-backed surfaces, for example a discriminated union where persistence only accepts `{ providerTargetId, modelId }` together or an explicit clear action. Keep provider-only as UI draft state only.

Suggested validation:

```bash
pnpm --filter @cradle/web lint
pnpm --filter @cradle/web test agent-batch-configuration
```

Add type-level or unit tests for the shared selection helper once introduced.

## Suggested Overall Verification Commands

```bash
pnpm --filter @cradle/web lint
pnpm --filter @cradle/web test composer
pnpm --filter @cradle/web test agent-batch-configuration
pnpm --filter @cradle/web test chat-runtime-view
```

If `chat-runtime-view` does not yet have a test target, add focused tests for the persistence helper through the nearest component or hook boundary instead of relying on manual browser checks.
