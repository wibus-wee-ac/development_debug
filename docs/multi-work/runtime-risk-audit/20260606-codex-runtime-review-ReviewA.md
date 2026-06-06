# Codex Runtime Risk Audit ReviewA

Date: 2026-06-06
Reviewer: ReviewA
Scope: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts`, `apps/server/src/modules/chat-runtime-providers/codex/types.ts`, `apps/server/src/modules/provider-runtime/*`, `apps/server/src/modules/chat-runtime/service.ts`, `apps/server/src/modules/chat-runtime/index.ts`, and related tests.

I am not 100% confident in the current strategy. I found four state-machine or behavior-regression risks that should be fixed before treating the host lease and Codex runtime lifecycle as stable.

## Finding 1 - Active host leases can be reaped while still in use

Severity: High

Files:
- `apps/server/src/modules/provider-runtime/host-manager.ts:119`
- `apps/server/src/modules/provider-runtime/host-manager.ts:142`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:821`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:920`

State path:
1. `CodexProvider.streamTurn` acquires a host lease through `acquireCodexAppServerHost`.
2. The active turn stores the lease in `activeTurns` and then blocks in `readTurnNotifications`.
3. `ProviderRuntimeHostManager.reapIdleHosts` can be called by a concurrent `acquireResource`, `acquireLease`, or `listHosts`.
4. `reapIdleHosts` removes any entry whose `expiresAt <= now`, without checking `refCount` or `pinnedCount`.
5. `removeHost` disposes the resource and closes the shared Codex client while the stream still owns an active lease.

Why this can regress:

`releaseLease` only removes a host when `refCount === 0`, but `reapIdleHosts` ignores `refCount`. A long Codex turn, long-running goal, shell command, or side conversation that lasts past the default 30 minute TTL can have its app-server client closed by an unrelated runtime operation. This breaks the basic lease invariant: a resource should not be disposed while a live lease still exists.

The current tests reinforce the unsafe behavior: `apps/server/tests/provider-runtime.test.ts:150` expects TTL reaping to dispose a pinned resource. That test proves the implementation, but not the lease contract needed by active Codex streams.

Suggested fix:

Treat TTL as idle expiry, not live lease expiry. `reapIdleHosts` should only remove entries with `refCount === 0`, or at minimum skip entries with `refCount > 0 || pinnedCount > 0`. If bounded lifetime for active leases is required, add an explicit stale-lease policy that interrupts the owning runtime first rather than silently closing its resource.

Suggested verification:

```bash
pnpm --filter @cradle/server test apps/server/tests/provider-runtime.test.ts
pnpm --filter @cradle/server test apps/server/src/modules/chat-runtime-providers/codex/provider.test.ts -t "retains active Codex host leases past TTL"
```

Add a provider-runtime test where a resource lease remains unreleased, time advances past TTL, `reapIdleHosts()` runs, and `disposeResource` is not called until `lease.release()`.

## Finding 2 - Side-chat fork host lease leaks if session persistence fails after provider fork

Severity: High

Files:
- `apps/server/src/modules/chat-runtime/service.ts:1830`
- `apps/server/src/modules/chat-runtime/service.ts:1832`
- `apps/server/src/modules/chat-runtime/service.ts:1874`
- `apps/server/src/modules/chat-runtime/service.ts:1887`
- `apps/server/src/modules/chat-runtime/service.ts:1898`

State path:
1. `createSideChat` reserves a pinned child host lease before calling `runtime.forkRuntimeSession`.
2. `CodexProvider.forkRuntimeSession` acquires a resource for the same child scope and releases its own lease in `finally`, leaving the reserved pinned lease to retain the resource.
3. After the fork succeeds, `createSideChat` persists the child session via `SessionService.create`.
4. Only after `registerSideConversation` does it release `pendingSideHostLease`.

Why this can regress:

There is no `finally` covering the successful-fork path between `reserveSideConversationHost` and `pendingSideHostLease?.release()`. If `SessionService.create`, `registerSideConversation`, or any DB operation in that window throws, the reserved pinned lease is never released. The host manager then retains the app-server resource and its client with no durable session or side-conversation registry record that can release it.

This is especially risky because forked side sessions are explicitly live-only: `attachBinding` skips durable bindings for child sessions after `SessionService.create`. A failure before registration leaves no durable or in-memory owner except the leaked lease.

Suggested fix:

Wrap the post-reservation side-chat creation path in a `try/finally` that releases `pendingSideHostLease` unless ownership has been transferred to `registerSideConversation`. A simple shape is to keep a `sideConversationRegistered` boolean and release the pending lease in `finally` when it is still non-null.

Suggested verification:

```bash
pnpm --filter @cradle/server test apps/server/tests/chat-runtime.test.ts -t "releases reserved side host when side session persistence fails"
pnpm --filter @cradle/server test apps/server/tests/provider-runtime.test.ts
```

Add a test that makes `forkRuntimeSession` succeed, then forces child session creation to fail, and asserts `providerRuntimeHostManager.listHosts()` is empty or at least has no retained child scope.

## Finding 3 - Runtime setting updates can silently reset Codex collaboration effort

Severity: Medium

Files:
- `apps/server/src/modules/chat-runtime/service.ts:3844`
- `apps/server/src/modules/chat-runtime/service.ts:3871`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1050`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1062`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1066`

State path:
1. A run can start with a per-turn `thinkingEffort` override.
2. `CodexProvider.streamTurn` sends that override to `turn/start` through `requestedReasoningEffort`.
3. During the active turn, `updateSessionRuntimeSettings` calls `activeRun.runtime.updateRuntimeSettings`.
4. `CodexProvider.updateRuntimeSettings` sends `thread/settings/update` with `collaborationMode.settings.reasoning_effort` set to `config.reasoningEffort`, not the active turn's effective effort.

Why this can regress:

Changing an unrelated runtime setting, such as access mode or interaction mode, can also change the provider's active collaboration settings back to the profile default effort. That is surprising because the service stores only `runtimeSettings` on `ActiveRun`, while the provider loses the effective per-turn effort after `turn/start`.

This is a behavior regression for users who start a Codex run with a high or low effort override and then toggle plan/default mode or access mode mid-run. The update request can mutate more provider state than the UI action intended.

Suggested fix:

Carry the effective model and thinking effort into the active Codex turn entry, or include them in `UpdateRuntimeSettingsInput`. Then build `collaborationMode` from the active turn values rather than `config.reasoningEffort`. If no active turn effort exists, fall back to the snapshot/config value.

Suggested verification:

```bash
pnpm --filter @cradle/server test apps/server/src/modules/chat-runtime-providers/codex/provider.test.ts -t "preserves active thinking effort when runtime settings update"
pnpm --filter @cradle/server test apps/server/tests/chat-runtime.test.ts -t "applies runtime settings to active Codex run"
```

Add a Codex provider test that starts a turn with `thinkingEffort: "high"`, calls `updateRuntimeSettings`, and asserts `thread/settings/update` uses `reasoning_effort: "high"` rather than the profile default.

## Finding 4 - Host resource reuse ignores changed client-level options for the same session scope

Severity: Medium

Files:
- `apps/server/src/modules/provider-runtime/host-manager.ts:69`
- `apps/server/src/modules/provider-runtime/host-manager.ts:78`
- `apps/server/src/modules/provider-runtime/host-manager.ts:79`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1102`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1109`
- `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:1120`

State path:
1. `ProviderRuntimeHostManager.acquireResource` keys resources only by `runtimeKind`, `providerTargetId`, and `scopeId`.
2. If `entry.resourcePromise` already exists, later acquires reuse the existing resource and ignore the new `createResource` options.
3. `CodexProvider.acquireCodexAppServerHost` initializes the shared resource once via `resource.initialized ??= ...`.
4. Later calls for the same session scope can pass different client-level options: API key/base URL, app-server env, config, ChatGPT auth, or user-agent mode. The existing Codex client remains configured with the first options.

Why this can regress:

This is most visible for retained side conversations and concurrent session operations. A child side session can retain a Codex client created during `forkRuntimeSession`, then later reuse that client for normal child turns even if the requested model/profile/session config has changed. Some per-turn values are sent in `thread/resume` or `turn/start`, but client-level state such as env, auth, base URL/API key, and app-server initialization cannot be corrected by later request params.

The risk is stale provider behavior that is hard to diagnose: UI settings or provider-target edits appear accepted by Cradle, while the reused app-server process still runs with an older client configuration.

Suggested fix:

Add a compatibility fingerprint to host resources or host keys. The fingerprint should include only client-level invariants that cannot safely change after app-server initialization, such as auth mode/credential identity, base URL, env identity, and user-agent mode. On mismatch, either invalidate and recreate the resource or use a wider key that separates incompatible resources.

Suggested verification:

```bash
pnpm --filter @cradle/server test apps/server/tests/provider-runtime.test.ts -t "recreates resource when host options fingerprint changes"
pnpm --filter @cradle/server test apps/server/src/modules/chat-runtime-providers/codex/provider.test.ts -t "reinitializes retained side host when client config changes"
```

Add a host-manager test that acquires the same key twice with different fingerprints and asserts the second acquire creates a new resource and disposes the old one only after existing leases are released or explicitly invalidated.

## Additional Paths Checked

I also checked these paths and did not find a concrete issue requiring a finding:

- `CodexProvider.cancelTurn`: pauses active goals before interrupting and updates the in-memory provider snapshot. The double release path is guarded by `releaseTurn`.
- `CodexProvider.steerTurn`: fails closed when no `turnId` exists; chat-runtime requeues live steer items on provider failure.
- `CodexProvider.streamTurn` goal and compact command paths: chat-runtime explicitly allows no-output Codex command turns, so early return is not by itself a validation failure. The residual risk is that goal continuation can produce successful no-op runs if app-server accepts `thread/goal/set` but never emits a turn; this should be covered by integration tests around `hasActiveCodexGoal` and continuation backoff.
- `provider-runtime/directory.ts`: binding writes use Drizzle and preserve Cradle ownership. No raw SQL or cross-namespace write issue found.

## Residual Risk

I did not run the test suite because this pass was a focused independent review and documentation output. The highest residual risk is interaction with the real Codex app-server protocol: several correctness assumptions depend on whether `thread/resume`, `thread/settings/update`, and `thread/goal/set` fully apply changed config or only mutate thread state.
