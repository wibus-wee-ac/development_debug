# Cross-Window Tab State Synchronization

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a reader should be able to understand why tab state currently drifts across windows, which files own the change, and how to verify the synchronized behavior without relying on earlier chat context.

## Purpose / Big Picture

Cradle can run more than one renderer window. A user may open or activate a Window Tab in one window, then switch to another window and expect the tab bar to show the same active tab and tab list. The same expectation applies to Jarvis tabs in the footer: if a Jarvis session is selected, added, or removed in one window, other windows should reflect that UI state without a full reload.

After this change, the persisted Window Tab state and persisted Jarvis Tab state are synchronized across same-origin renderer windows. A user can verify it by opening two Cradle windows, changing tabs or Jarvis sessions in either window, and observing the other window update in near real time.

## Progress

- [x] (2026-05-23 23:46 +0800) Read `/Users/wibus/.agents/skills/execplan/references/PLANS.md` and confirmed the plan must stay self-contained, living, and validation-focused.
- [x] (2026-05-23 23:46 +0800) Inspected the current worktree and confirmed there are unrelated uncommitted changes outside this task; this plan must leave them untouched.
- [x] (2026-05-23 23:46 +0800) Located Window Tab ownership in `packages/tabs-next/src/store.ts` and Cradle's registry in `apps/web/src/tabs/registry.ts`.
- [x] (2026-05-23 23:46 +0800) Located Jarvis Tab ownership in `apps/web/src/features/system-agent/jarvis-ui-store.ts` and its footer usage in `apps/web/src/components/layout/app-footer.tsx`.
- [x] (2026-05-23 23:46 +0800) Confirmed today's next ExecPlan filename is `docs/exec-plans/20260523-04-cross-window-tab-sync.md` because `20260523-01`, `20260523-02`, and `20260523-03` already exist.
- [x] (2026-05-23 23:52 +0800) Added `packages/tabs-next/src/persisted-store-sync.ts`, a key-scoped persisted Zustand slice synchronization helper.
- [x] (2026-05-23 23:52 +0800) Wired the helper into `packages/tabs-next/src/store.ts` for Window Tab state and into `apps/web/src/features/system-agent/jarvis-ui-store.ts` for Jarvis footer tab state.
- [x] (2026-05-23 23:52 +0800) Added `packages/tabs-next/src/__tests__/cross-window-sync.test.ts` and `apps/web/src/features/system-agent/jarvis-ui-store.test.ts`.
- [x] (2026-05-23 23:53 +0800) Updated local README files for `packages/tabs-next`, `apps/web/src/features/system-agent`, and `docs/exec-plans`.
- [x] (2026-05-23 23:53 +0800) Ran focused validation: `pnpm --filter @cradle/tabs-next test`, `pnpm --filter @cradle/tabs-next typecheck`, and `pnpm --filter @cradle/web test -- src/features/system-agent/jarvis-ui-store.test.ts` passed.
- [x] (2026-05-23 23:53 +0800) Ran `pnpm --filter @cradle/web exec tsc --noEmit`; it failed on unrelated existing files under `agent-management`, `chronicle`, `chat`, and `store/chat`, not on this task's touched files.
- [x] (2026-05-23 23:54 +0800) Completed one reviewer-to-fix pass. The review found Jarvis persisted hydration should tolerate malformed local storage, and the fix changed Jarvis sanitization to use `safeParse` fallback defaults.
- [x] (2026-05-23 23:56 +0800) Re-ran final validation after the reviewer fixes: `pnpm --filter @cradle/tabs-next test`, `pnpm --filter @cradle/tabs-next typecheck`, `pnpm --filter @cradle/web test -- src/features/system-agent/jarvis-ui-store.test.ts`, and `git diff --check -- packages/tabs-next apps/web/src/features/system-agent docs/exec-plans/20260523-04-cross-window-tab-sync.md docs/exec-plans/README.md` passed.

## Surprises & Discoveries

- Observation: Window Tab state is already persisted to `localStorage` through Zustand persist, but Zustand persist hydration does not keep another already-open window's in-memory store up to date after the initial load.
  Evidence: `packages/tabs-next/src/store.ts` uses `persist` with default key `cradle:tabs-next:v1`; no code listens for `storage` events or `BroadcastChannel` messages to rehydrate a running store.

- Observation: Jarvis footer tabs are feature-owned UI state, not part of the generic tabs package.
  Evidence: `apps/web/src/features/system-agent/jarvis-ui-store.ts` persists `sessions` and `activeSessionId` under the `jarvis-ui` key, while `apps/web/src/components/layout/app-footer.tsx` renders those sessions as footer tabs.

- Observation: Tear-off chat windows intentionally use a separate Window Tab persist key.
  Evidence: `apps/web/src/tabs/registry.ts` sets `cradle:tabs-next:tearoff:${tearoffSessionId ?? 'unknown'}:v1` for tear-off windows. Syncing by persist key means tear-off windows do not accidentally join the main-window tab group.

- Observation: Web typecheck is currently blocked by unrelated worktree errors outside this task.
  Evidence: `pnpm --filter @cradle/web exec tsc --noEmit` reports errors in `src/features/agent-management/agent-detail.tsx`, `src/features/agent-management/profile-detail-panel.tsx`, `src/features/agent-runtime/agent-config-schema.ts`, `src/features/chat/blocks/tool-call-block.tsx`, `src/features/chronicle/use-chronicle.ts`, and `src/store/chat.ts`. None of those files are part of this plan's implementation.

## Decision Log

- Decision: Synchronize at the persisted store boundary instead of adding component-level effects to tab bars and footers.
  Rationale: The store owns the tab state semantics. Synchronizing at the store boundary covers open, close, activate, reorder, navigation, Jarvis session selection, and Jarvis session removal without scattering event listeners through UI components.
  Date/Author: 2026-05-23 / Codex

- Decision: Use both `BroadcastChannel` and the browser `storage` event when available.
  Rationale: `BroadcastChannel` provides fast same-origin window delivery. The `storage` event is a durable fallback for browsers or embedded environments that do not expose `BroadcastChannel`, and it also reflects direct writes to the persisted key.
  Date/Author: 2026-05-23 / Codex

- Decision: Scope synchronization by persist key.
  Rationale: Main windows should share `cradle:tabs-next:v1`, while tear-off windows should keep their session-specific tab state. Jarvis UI uses its own key, so it receives only Jarvis updates.
  Date/Author: 2026-05-23 / Codex

- Decision: Complete one reviewer-to-fix pass, not five.
  Rationale: The user explicitly reduced the workflow to one review cycle. The single pass should inspect correctness, ownership, and test coverage, then apply any necessary fix.
  Date/Author: 2026-05-23 / Codex

- Decision: Keep Jarvis `expanded` local while synchronizing Jarvis `sessions` and `activeSessionId`.
  Rationale: `expanded` is a window presentation state. The requested Jarvis Tab synchronization is about footer session tabs and selected session state, which are represented by the persisted slice.
  Date/Author: 2026-05-23 / Codex

- Decision: Treat malformed remote and local persisted payloads as recoverable.
  Rationale: A bad persisted payload from one window or local storage should not break all open windows. The generic sync helper catches apply errors, and the Jarvis store falls back to default persisted values when schema parsing fails.
  Date/Author: 2026-05-23 / Codex

## Outcomes & Retrospective

Implemented store-level cross-window synchronization for Window Tabs and Jarvis footer tabs. Window Tab state now syncs the persisted `tabs`, `contexts`, and `activeTabId` slice by persist key, preserving the existing main-window versus tear-off-window isolation. Jarvis UI state now syncs persisted `panelWidth`, `panelHeight`, `sessions`, and `activeSessionId`, while leaving `expanded` local to each window.

Focused automated validation passed for the new behavior. Full web typecheck did not pass because of unrelated pre-existing errors outside this task's touched files. The remaining manual validation is to run two Cradle windows and observe the tab bar and Jarvis footer tabs update across windows.

## Context and Orientation

The Window Tab runtime lives in `packages/tabs-next`. It is a shared package used by the web renderer. Its main store is `packages/tabs-next/src/store.ts`, which exports `createTabStore(registry, options?)`. The store contains `tabs`, `contexts`, and `activeTabId`. `tabs` is the visible list in the top tab bar. `contexts` is each tab's local navigation history and view state. `activeTabId` is the selected tab.

Cradle registers concrete app tabs in `apps/web/src/tabs/registry.ts`. Main windows use the default tabs persist key. Tear-off windows use a session-specific key so they can show a single chat session independently.

Jarvis Tab state is not part of `packages/tabs-next`. It lives in `apps/web/src/features/system-agent/jarvis-ui-store.ts`. It stores `sessions` and `activeSessionId`, which `apps/web/src/components/layout/app-footer.tsx` renders as compact footer tabs next to the pinned "Ask Jarvis" button. This plan uses "Jarvis Tab" to mean those footer session tabs.

Zustand persist writes store slices into `localStorage` using JSON shaped like `{ "state": ..., "version": 1 }`. A newly opened window reads the persisted state once during store creation. An already-open window needs an explicit listener to receive later writes from another window.

## Plan of Work

First, add a small synchronization utility in `packages/tabs-next/src/persisted-store-sync.ts`. It should be independent of React and should work with any Zustand store that has a persisted slice. The utility should subscribe to local store changes, publish the selected persisted slice through a key-specific `BroadcastChannel`, listen for remote messages, listen for `storage` events for the same key, and call an `applyPersistedState` callback when remote state arrives. It must suppress echo loops while applying remote state.

Second, integrate the utility into `packages/tabs-next/src/store.ts`. Define a reusable persisted slice type for `tabs`, `contexts`, and `activeTabId`. Reuse the existing sanitize function before applying remote state so malformed or stale route entries do not corrupt a running store. The default behavior should enable synchronization, with an option to disable it in tests or special environments if needed.

Third, add tests in `packages/tabs-next/src/__tests__/cross-window-sync.test.ts`. The tests should create two stores with the same persist key, mutate the first store, and assert that the second store receives the new tab list and active tab. Another test should simulate a `storage` event and assert that sanitized persisted state is applied.

Fourth, integrate the same utility into `apps/web/src/features/system-agent/jarvis-ui-store.ts`. Export a store factory for tests if needed, then export the app singleton as before. Keep volatile `expanded` local to the current window; synchronize persisted Jarvis tab fields: `panelWidth`, `panelHeight`, `sessions`, and `activeSessionId`.

Fifth, add `apps/web/src/features/system-agent/jarvis-ui-store.test.ts`. The test should create two Jarvis stores with the same persist key, add a session in one store, and assert that the other store receives the session and active session. It should also prove that `expanded` remains local and is not overwritten by synchronization.

Sixth, update local READMEs for touched directories: `packages/tabs-next/README.md` and `apps/web/src/features/system-agent/README.md`. If this plan file changes the exec-plan directory, update `docs/exec-plans/README.md` with the new file entry.

Seventh, run validation from `/Users/wibus/dev/Cradle`: `pnpm --filter @cradle/tabs-next test`, `pnpm --filter @cradle/tabs-next typecheck`, `pnpm --filter @cradle/web test -- src/features/system-agent/jarvis-ui-store.test.ts`, and `pnpm --filter @cradle/web exec tsc --noEmit`. Fix any failures.

Eighth, perform one reviewer-to-fix pass. Review the diff against the original goal: Window Tab state must sync across windows, Jarvis Tab state must sync across windows, tear-off windows must remain key-isolated, remote payloads must be sanitized, and tests must prove the behavior. Record the review finding and any fix in `Artifacts and Notes`.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

Inspect relevant files:

    sed -n '1,620p' packages/tabs-next/src/store.ts
    sed -n '1,220p' apps/web/src/features/system-agent/jarvis-ui-store.ts
    sed -n '1,220p' apps/web/src/tabs/registry.ts
    sed -n '1,220p' packages/tabs-next/src/__tests__/store.test.ts

Create and update implementation files:

    packages/tabs-next/src/persisted-store-sync.ts
    packages/tabs-next/src/store.ts
    packages/tabs-next/src/index.ts
    packages/tabs-next/src/__tests__/cross-window-sync.test.ts
    apps/web/src/features/system-agent/jarvis-ui-store.ts
    apps/web/src/features/system-agent/jarvis-ui-store.test.ts

Update documentation:

    packages/tabs-next/README.md
    apps/web/src/features/system-agent/README.md
    docs/exec-plans/README.md
    docs/exec-plans/20260523-04-cross-window-tab-sync.md

Run validation:

    pnpm --filter @cradle/tabs-next test
    pnpm --filter @cradle/tabs-next typecheck
    pnpm --filter @cradle/web test -- src/features/system-agent/jarvis-ui-store.test.ts
    pnpm --filter @cradle/web exec tsc --noEmit

Observed focused validation:

    pnpm --filter @cradle/tabs-next test
    Test Files  8 passed (8)
    Tests  25 passed (25)

    pnpm --filter @cradle/tabs-next typecheck
    exited with code 0

    pnpm --filter @cradle/web test -- src/features/system-agent/jarvis-ui-store.test.ts
    Test Files  5 passed (5)
    Tests  11 passed (11)

Observed broad validation limitation:

    pnpm --filter @cradle/web exec tsc --noEmit
    exited with code 2 due to unrelated errors in agent-management, agent-runtime, chat, chronicle, and store/chat files.

## Validation and Acceptance

The implementation is accepted when two stores using the same persist key converge after either one changes the synchronized persisted slice. For Window Tabs, opening, activating, closing, reordering, or navigating a tab in one main window should update the other main window's tab store. For Jarvis Tabs, adding, selecting, or removing a Jarvis session in one window should update the other window's footer tab store. Tear-off windows should remain isolated because they use session-specific Window Tab persist keys.

Automated acceptance requires the focused tests to pass. Manual acceptance should be performed by starting the app, opening two main Cradle windows, and observing these behaviors:

1. Open a new app tab in window A. Window B shows the same tab without reload.
2. Activate a different app tab in window B. Window A shows that tab as active.
3. Open Jarvis in window A, create or select a Jarvis session, and observe window B's Jarvis footer tabs update.
4. Remove a Jarvis session in window B and observe window A remove the same footer tab.

This plan does not synchronize transient popover open state or Jarvis expanded state. Those are per-window presentation states. It does synchronize the persisted Jarvis footer tab state and selected Jarvis session.

## Idempotence and Recovery

The code changes are additive and local to frontend and tabs runtime files. Running tests repeatedly is safe. If a synchronization message is malformed, the receiver should ignore it or sanitize it using the same schema already used for persisted hydration. If the `BroadcastChannel` API is missing, the code should still work through the `storage` event when available. If both APIs are missing, the store should continue working locally with persisted initial hydration only.

Do not run destructive Git commands. The current worktree contains unrelated uncommitted changes; leave them untouched. Use scoped diffs such as `git diff -- packages/tabs-next apps/web/src/features/system-agent docs/exec-plans` to review this task's files.

## Artifacts and Notes

Initial evidence gathered before implementation:

    packages/tabs-next/src/store.ts persists Window Tabs under cradle:tabs-next:v1 by default.
    apps/web/src/tabs/registry.ts gives tear-off windows a session-specific Window Tab persist key.
    apps/web/src/features/system-agent/jarvis-ui-store.ts persists Jarvis footer tab sessions under jarvis-ui.
    No existing code listens for remote persisted state changes for either store.

Reviewer pass result:

    Scope: one reviewer-to-fix pass as requested by the user.
    Finding: Jarvis cross-window sync tolerated malformed remote messages through the generic helper, but malformed local persisted Jarvis state could still throw during Zustand persist merge.
    Fix: `apps/web/src/features/system-agent/jarvis-ui-store.ts` now uses `PersistedJarvisUiSliceSchema.safeParse` and falls back to default persisted values when parsing fails.
    Additional fix: `packages/tabs-next/src/persisted-store-sync.ts` now treats failed persisted-slice comparison as a changed state instead of throwing, so an unexpected non-serializable value cannot interrupt a store update.
    Revalidation: `pnpm --filter @cradle/tabs-next test`, `pnpm --filter @cradle/tabs-next typecheck`, and `pnpm --filter @cradle/web test -- src/features/system-agent/jarvis-ui-store.test.ts` passed after the fixes.

React Doctor diff scan:

    npx -y react-doctor@latest . --verbose --diff
    Score: 99 / 100
    Warnings: two no-derived-state warnings in src/features/session-await/await-panel.tsx, an unrelated modified file outside this task.

## Interfaces and Dependencies

In `packages/tabs-next/src/persisted-store-sync.ts`, define and export:

    export interface PersistedStoreSyncOptions<TState, TPersisted> {
      store: StoreApi<TState> | UseBoundStore<StoreApi<TState>>
      persistKey: string
      channelName: string
      selectPersistedState: (state: TState) => TPersisted
      applyPersistedState: (persistedState: unknown) => void
      isSamePersistedState?: (left: TPersisted, right: TPersisted) => boolean
    }

    export interface PersistedStoreSyncHandle {
      dispose: () => void
    }

    export function installPersistedStoreSync<TState, TPersisted>(
      options: PersistedStoreSyncOptions<TState, TPersisted>,
    ): PersistedStoreSyncHandle

The utility depends on Zustand store types, `BroadcastChannel` when available, and `window.addEventListener('storage', ...)` when available. It must not import React.

In `packages/tabs-next/src/store.ts`, `createTabStore` should accept:

    options?: {
      persistKey?: string
      crossWindowSync?: boolean
    }

The default should enable cross-window sync.

In `apps/web/src/features/system-agent/jarvis-ui-store.ts`, define a testable factory:

    export function createJarvisUiStore(options?: {
      persistKey?: string
      crossWindowSync?: boolean
    })

The existing `useJarvisUiStore` export should remain the singleton used by app components.

Revision note: Initial plan created before implementing cross-window synchronization for Window Tabs and Jarvis footer tabs.

Revision note: Updated after implementing Window Tab and Jarvis Tab synchronization, running focused validation, recording the unrelated web typecheck blocker, and completing the single reviewer-to-fix pass requested by the user.

Revision note: Updated after final revalidation of the reviewer fixes and scoped whitespace checks.
