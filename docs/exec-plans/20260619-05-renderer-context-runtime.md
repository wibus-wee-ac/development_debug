# Refactor renderer context provider lifecycle

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The file itself is the plan, so it intentionally omits an outer Markdown code fence. It is self-contained: a contributor who has only this repository and this file should be able to understand and implement the renderer context lifecycle refactor without relying on prior chat history.

## Purpose / Big Picture

Jarvis context currently fails in development with errors such as `Context provider already registered: system-agent`. That error means the renderer-side context registry already has a provider for the `system-agent` owner, then another copy tries to register the same owner. The immediate trigger is usually React StrictMode, Vite hot module replacement, or repeated feature mounting, but the architectural problem is deeper: each feature owns both its context semantics and the global registry installation lifecycle.

After this refactor, a user can keep the app open during development, change Jarvis, Chat, or Kanban context code, and continue asking Jarvis without duplicate provider crashes. The implementation also makes ownership clearer. `apps/web/src/features/context` owns the renderer context runtime contracts and registry lifecycle. Feature modules such as Chat, Kanban, and System Agent own only the meaning of the context items they publish. App composition owns which providers are installed in this renderer process.

The user-visible proof is that opening Jarvis and sending a context-enabled message still injects a `<cradle_context>` prompt block, while repeated mounting or hot replacement of provider modules no longer throws `Context provider already registered: system-agent`.

## Progress

- [x] (2026-06-19 15:03 +0800) Read the ExecPlan rules and confirmed the non-negotiables: the plan must be self-contained, living, novice-friendly, concrete about files and commands, and independently verifiable.
- [x] (2026-06-19 15:03 +0800) Audited the current renderer context registry, provider install functions, Jarvis send path, Chat attention path, and Kanban attention path.
- [x] (2026-06-19 15:03 +0800) Identified the duplicate registration failure as a lifecycle ownership bug rather than a single missing guard.
- [x] (2026-06-19 15:03 +0800) Created this ExecPlan at `docs/exec-plans/20260619-05-renderer-context-runtime.md`.
- [x] (2026-06-19 16:48 +0800) Refactored `apps/web/src/features/context/context-registry.ts` into an owner-slot registry with generation-aware disposers and a neutral `rendererContextRegistry` export.
- [x] (2026-06-19 16:48 +0800) Moved provider installation to app composition in `apps/web/src/app-providers.tsx` through a `RendererContextRuntime` component.
- [x] (2026-06-19 16:48 +0800) Removed feature-local `install*ContextProvider()` functions and module-level `providerInstalled` booleans from System Agent, explicit context, Chat, and Kanban.
- [x] (2026-06-19 16:48 +0800) Made `collectContextEnvelope()` a pure read that never installs providers.
- [x] (2026-06-19 16:48 +0800) Split generic registry behavior into `apps/web/src/features/context/context-registry.test.ts`, kept System Agent semantic coverage in `apps/web/src/features/system-agent/context-registry.test.ts`, and added missing Chat attention provider coverage.
- [x] (2026-06-19 16:48 +0800) Updated affected README files for `apps/web/src/features/context`, `apps/web/src/features/system-agent`, `apps/web/src/features/chat`, `apps/web/src/features/kanban`, and `docs/exec-plans`.
- [x] (2026-06-19 16:48 +0800) Ran focused validation and web typecheck successfully.

## Surprises & Discoveries

- Observation: The current duplicate-owner error is thrown deliberately by the registry, not by React or the browser.
  Evidence: `apps/web/src/features/context/context-registry.ts` throws `new Error(\`Context provider already registered: ${provider.owner}\`)` when the internal provider map already has that owner.

- Observation: Each provider module tries to protect the global singleton with a module-local boolean.
  Evidence: `apps/web/src/features/system-agent/system-context-provider.ts`, `apps/web/src/features/system-agent/explicit-context.ts`, `apps/web/src/features/chat/context/chat-context.ts`, and `apps/web/src/features/kanban/kanban-context.ts` each define `let providerInstalled = false` and an `install*ContextProvider()` function.

- Observation: Module-local booleans are not the same lifecycle boundary as the singleton registry.
  Evidence: Vite hot module replacement can reload a provider module and reset its `providerInstalled` value while the old `jarvisContextRegistry` map still contains the provider owner.

- Observation: The Jarvis context collection function has a hidden write side effect.
  Evidence: `apps/web/src/features/system-agent/use-context-snapshot.ts` calls `installSystemAgentContextProvider()` inside `collectContextEnvelope()` before reading from the registry.

- Observation: The current ownership documentation is stale.
  Evidence: `apps/web/src/features/system-agent/README.md` says `context-items.ts` and `context-registry.ts` are System Agent files, but the current files live in `apps/web/src/features/context/`.

- Observation: The working tree already contains unrelated uncommitted changes.
  Evidence: `git status --short` shows many modified server and web files unrelated to this renderer context lifecycle plan. This plan must avoid reverting or modifying those unrelated changes.

- Observation: The Chat README already listed `chat-context.test.ts`, but the current tree did not contain that file.
  Evidence: `rg --files apps/web/src/features/chat | rg "context.*test"` returned no files before implementation. This refactor added `apps/web/src/features/chat/context/chat-context.test.ts`.

- Observation: Focused context validation and full web typecheck both pass after the lifecycle refactor.
  Evidence: `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/context/context-registry.test.ts src/features/system-agent/context-registry.test.ts src/features/system-agent/format-context.test.ts src/features/system-agent/explicit-context.test.ts src/features/chat/context/chat-context.test.ts src/features/kanban/kanban-context.test.ts` reported 6 files and 11 tests passed. `pnpm --filter @cradle/web exec tsc --noEmit --pretty false` exited 0.

- Observation: Targeted ESLint has no errors for touched TypeScript and TSX files, but still reports warnings from existing files.
  Evidence: `pnpm exec eslint ...` over the touched source files exited 0 after the import-order fix. It reported `react-refresh/only-export-components` on `apps/web/src/app-providers.tsx` because that file already exports `useThemeClass` alongside components, and `react-hooks/exhaustive-deps` warnings in `apps/web/src/features/kanban/index.tsx`.

## Decision Log

- Decision: Treat `apps/web/src/features/context` as the owner of renderer context contracts and registry lifecycle.
  Rationale: The registry is shared by System Agent, Chat, Kanban, and future context publishers. Keeping the registry under `system-agent` naming makes the ownership ambiguous and encourages feature modules to manage global lifecycle themselves.
  Date/Author: 2026-06-19 / Codex

- Decision: Feature modules should export provider factories, not install themselves into the global registry.
  Rationale: Chat owns chat attention semantics, Kanban owns issue attention semantics, and System Agent owns ambient Jarvis semantics. None of those features should decide when the global renderer process installs providers. App composition already owns process-wide providers and is the correct place to list the active provider set.
  Date/Author: 2026-06-19 / Codex

- Decision: Replace duplicate-owner throwing at normal installation time with an owner-slot registry and generation-aware disposer.
  Rationale: The registry should contain at most one active provider per owner, but replacing the active provider for the same owner is the correct lifecycle operation during StrictMode remounts and hot replacement. A disposer returned by an older installation must not delete a newer provider for the same owner.
  Date/Author: 2026-06-19 / Codex

- Decision: Keep duplicate-owner validation in the app composition provider list.
  Rationale: Replacing a provider at the registry slot level solves runtime lifecycle, but two different entries with the same owner in the same configured provider list is still an ownership bug. The app-level installer should detect that and throw a clear error before installation.
  Date/Author: 2026-06-19 / Codex

- Decision: Do not solve this by catching and ignoring `Context provider already registered`.
  Rationale: Swallowing the error would hide lifecycle drift and leave unclear which provider instance is active. The registry should have explicit replacement semantics rather than accidental exception control flow.
  Date/Author: 2026-06-19 / Codex

- Decision: Do not add browser automation for this refactor unless a later user request asks for it.
  Rationale: The repository frontend guidance says not to run browser tests just to test frontend behavior. This change is an internal lifecycle and unit-testable context runtime refactor; focused Vitest coverage and typechecking are the right validation first.
  Date/Author: 2026-06-19 / Codex

## Outcomes & Retrospective

Implemented. `ContextRegistry.registerProvider` was replaced by `ContextRegistry.setProvider`, which writes a provider into an owner slot and returns a generation-aware registration disposer. The old `jarvisContextRegistry` singleton was removed and replaced with `rendererContextRegistry`. App-level composition now lives in `apps/web/src/app-providers.tsx` via `RendererContextRuntime`, which installs System Agent, explicit context, Chat, and Kanban provider factories through `installContextProviders`.

Feature-local installation functions were removed from `apps/web/src/features/system-agent/system-context-provider.ts`, `apps/web/src/features/system-agent/explicit-context.ts`, `apps/web/src/features/chat/context/chat-context.ts`, and `apps/web/src/features/kanban/kanban-context.ts`. `collectContextEnvelope()` now reads `rendererContextRegistry.collectEnvelope()` without mutating provider lifecycle. The remaining Vite hot replacement behavior is covered at the registry semantic level by tests that model provider replacement and stale disposer cleanup; no browser automation was added.

Validation passed with 6 focused context test files and 11 tests, full `@cradle/web` TypeScript checking, targeted ESLint with 0 errors, no old context install API matches under `apps/web/src`, and `git diff --check` over the touched paths.

## Context and Orientation

This work is in the web renderer under `apps/web/src`. The renderer is the browser-like React application that runs inside Electron and also supports a web development server. Jarvis is the System Agent user interface: the user opens it from the app footer and asks questions grounded in the current Cradle UI context.

The term "context provider" means a small object with an `owner` string and a `readContext(input)` function. It returns `ContextItem` objects, which are compact semantic facts such as "the user is viewing historical chat messages" or "Kanban has issue CRAD-123 open." The registry collects all active providers into a `ContextEnvelope`, then Jarvis formats selected items into a `<cradle_context>` prompt block.

The generic context contracts live in `apps/web/src/features/context/context-items.ts` and `apps/web/src/features/context/context-registry.ts`. `context-items.ts` defines `ContextItem`, `ContextReference`, `ContextEnvelope`, freshness, sensitivity, and token-estimation contracts. `context-registry.ts` defines `ContextProvider`, `ContextRegistry`, `ContextProviderRegistration`, `createContextRegistry()`, `installContextProviders()`, and the neutral singleton `rendererContextRegistry`.

The System Agent ambient provider lives in `apps/web/src/features/system-agent/system-context-provider.ts`. It reads current shell stores such as active surface, open surfaces, layout, chat summary, unread sessions, and active Jarvis profile. It exports `createSystemAgentContextProvider()` and does not install itself.

Explicit Jarvis attachments live in `apps/web/src/features/system-agent/explicit-context.ts`. This module owns user-attached selections and references. It exports `createExplicitContextProvider()` and does not install itself.

Chat attention context lives in `apps/web/src/features/chat/context/chat-context.ts`. It owns chat viewport and focus snapshots and emits a `chat` provider factory. `apps/web/src/features/chat/ui/use-chat-scroll-runtime.ts` updates and clears Chat-owned snapshots, but no longer installs the provider.

Kanban attention context lives in `apps/web/src/features/kanban/kanban-context.ts`. It owns selected/open/peek/focused/hovered issue snapshots and emits a `kanban` provider factory. `apps/web/src/features/kanban/index.tsx` updates and clears Kanban-owned snapshots, but no longer installs the provider.

The Jarvis popover lives in `apps/web/src/features/system-agent/jarvis-popover.tsx`. It owns popover UI, sessions, and explicit context controls, but no longer installs context providers. Its send path calls `collectContextEnvelope()` from `apps/web/src/features/system-agent/use-context-snapshot.ts`.

App-level composition lives in `apps/web/src/app-providers.tsx`. `AppEnvironmentProviders` installs process-wide renderer providers such as LazyMotion, Toast, Tooltip, Shortcut, DirectoryPicker, and now `RendererContextRuntime`. `RendererContextRuntime` installs the active context provider list because it wraps the application once per renderer process.

## Plan of Work

Milestone 1 changes the registry API without moving provider composition yet. In `apps/web/src/features/context/context-registry.ts`, rename the singleton export from `jarvisContextRegistry` to `rendererContextRegistry`. Remove the duplicate-owner throw from ordinary provider installation. Replace `registerProvider(provider)` with a method named `setProvider(provider)` or `installProvider(provider)` that writes the provider into the owner's slot and returns a disposer. The registry must keep an internal generation number per owner. When installing a provider, increment that owner's generation, store the provider, and capture the generation in the returned disposer. When the disposer runs, delete the provider only if the current generation still matches the captured generation. This makes stale cleanup safe after hot replacement.

The registry should still expose `collectEnvelope()` and keep the existing `ContextProviderInput` shape. Do not change `ContextItem` or `ContextEnvelope` unless implementation reveals a direct need. Do not introduce `unknown`-heavy helper code; the existing TypeScript interfaces already describe the expected data.

Milestone 2 adds app-level provider composition. In `apps/web/src/features/context/context-registry.ts`, add a small helper such as `installContextProviders(registry, providers)` or `installContextProviders(providers, registry = rendererContextRegistry)`. It should validate that the provided array has no duplicate `owner` values, install each provider through the registry slot API, and return one cleanup function that disposes all installed providers in reverse order. This helper must not import Chat, Kanban, or System Agent; it is generic runtime infrastructure.

In `apps/web/src/app-providers.tsx`, add a `RendererContextRuntime` component rendered inside `AppEnvironmentProviders`. It should use a React effect to install these providers once for the app process: `createSystemAgentContextProvider()`, `createExplicitContextProvider()`, `createChatContextProvider()`, and `createKanbanContextProvider()`. Use the generic helper from `features/context`. This component is app composition, so it is allowed to import provider factories from multiple features. It should return `null` and should not render UI.

Milestone 3 removes feature-local installation. In `apps/web/src/features/system-agent/system-context-provider.ts`, `apps/web/src/features/system-agent/explicit-context.ts`, `apps/web/src/features/chat/context/chat-context.ts`, and `apps/web/src/features/kanban/kanban-context.ts`, delete the module-level `providerInstalled` booleans and the `install*ContextProvider()` functions. Keep the `create*ContextProvider()` factories and the snapshot update/read APIs. Update import sites so components no longer call installation functions.

In `apps/web/src/features/system-agent/jarvis-popover.tsx`, remove the effect that installs System Agent and explicit context providers. In `apps/web/src/features/chat/ui/use-chat-scroll-runtime.ts`, remove the effect that installs the Chat provider. In `apps/web/src/features/kanban/index.tsx`, remove the effect that installs the Kanban provider. Those components should continue updating their feature-owned snapshots exactly as before.

Milestone 4 makes context collection a pure read. In `apps/web/src/features/system-agent/use-context-snapshot.ts`, remove the call to `installSystemAgentContextProvider()`. The function should import `rendererContextRegistry` and return `rendererContextRegistry.collectEnvelope()` only. If a test or caller depends on collection auto-installing providers, update the test to install providers through the generic app-level helper or a local test registry. The production collection path must not mutate registration state.

Milestone 5 updates tests and documentation. Move generic registry tests out of `apps/web/src/features/system-agent/context-registry.test.ts` into a new `apps/web/src/features/context/context-registry.test.ts`, or add the new generic tests there and leave System Agent semantic tests where they are. Add tests that prove: installing a provider collects its item; installing another provider with the same owner replaces the first; disposing the old registration after replacement does not delete the new provider; duplicate owners in one app-level provider list throw a clear error; collecting an envelope is a pure read. Update feature tests and imports to use the new registry names and provider composition boundary.

Create `apps/web/src/features/context/README.md` because that directory currently has no README and is becoming an explicit feature/runtime owner. Update `apps/web/src/features/system-agent/README.md` so it no longer claims ownership of `context-items.ts` and `context-registry.ts`. If edits touch Chat or Kanban README-covered directories, update their README files only for the changed context lifecycle descriptions. Update `docs/exec-plans/README.md` with this plan entry.

## Concrete Steps

Start by confirming the current relevant code:

    cd /Users/wibus/dev/Cradle
    sed -n '1,180p' apps/web/src/features/context/context-registry.ts
    sed -n '210,235p' apps/web/src/features/system-agent/system-context-provider.ts
    sed -n '155,170p' apps/web/src/features/system-agent/explicit-context.ts
    sed -n '125,140p' apps/web/src/features/chat/context/chat-context.ts
    sed -n '132,145p' apps/web/src/features/kanban/kanban-context.ts
    sed -n '1,20p' apps/web/src/features/system-agent/use-context-snapshot.ts
    sed -n '1,80p' apps/web/src/app-providers.tsx

Then edit `apps/web/src/features/context/context-registry.ts`. The final public shape should be close to:

    export interface ContextProviderRegistration {
      owner: string
      dispose: () => void
    }

    export interface ContextRegistry {
      setProvider: (provider: ContextProvider) => ContextProviderRegistration
      collectEnvelope: () => ContextEnvelope
    }

    export function installContextProviders(
      providers: ContextProvider[],
      registry = rendererContextRegistry,
    ): () => void

If implementation chooses the method name `installProvider` instead of `setProvider`, use that name consistently across tests and docs. Do not keep the old `registerProvider` name as a compatibility alias; this is an internal breaking refactor and the repository guidance prefers removing compatibility debt.

Update provider modules so they export only factories and feature state helpers. The following searches should no longer find production install functions after the refactor:

    rg -n "providerInstalled|installSystemAgentContextProvider|installExplicitContextProvider|installChatContextProvider|installKanbanContextProvider" apps/web/src

Expected result after implementation: no production matches. Test names may mention old behavior only if they are deliberately asserting it was removed; prefer updating tests to the new names.

Wire the app composition in `apps/web/src/app-providers.tsx`. The new component should look conceptually like this, adjusted for actual imports and the chosen registry helper name:

    function RendererContextRuntime() {
      useEffect(() => {
        return installContextProviders([
          createSystemAgentContextProvider(),
          createExplicitContextProvider(),
          createChatContextProvider(),
          createKanbanContextProvider(),
        ])
      }, [])

      return null
    }

Render `<RendererContextRuntime />` inside `AppEnvironmentProviders`, near the other process-wide provider bridges. This component must not import UI components, create stores, or read the DOM. It only composes provider factories.

Update `apps/web/src/features/system-agent/use-context-snapshot.ts` so the full function is a pure read:

    export function collectContextEnvelope(): ContextEnvelope {
      return rendererContextRegistry.collectEnvelope()
    }

Update tests. The focused registry test command should include the new generic context test plus existing semantic tests:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/context/context-registry.test.ts src/features/system-agent/context-registry.test.ts src/features/system-agent/format-context.test.ts src/features/system-agent/explicit-context.test.ts src/features/chat/context/chat-context.test.ts src/features/kanban/kanban-context.test.ts

If a listed test file is moved or renamed during implementation, update this command in the plan before stopping. If unrelated tests fail, record the exact unrelated failure in `Surprises & Discoveries` and keep the focused context tests passing.

Run a web typecheck if the focused tests pass:

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false

If typecheck is blocked by unrelated working-tree errors, record the exact first errors here and run a narrower command if one is available. Do not hide a context-related type error as unrelated.

Finally inspect the scoped diff:

    git diff -- apps/web/src/features/context apps/web/src/features/system-agent apps/web/src/features/chat/context apps/web/src/features/chat/ui/use-chat-scroll-runtime.ts apps/web/src/features/kanban apps/web/src/app-providers.tsx docs/exec-plans/20260619-05-renderer-context-runtime.md docs/exec-plans/README.md

## Validation and Acceptance

The registry refactor is accepted when focused unit tests prove owner-slot behavior. A provider for owner `system-agent` can be installed, replaced by a later provider with the same owner, and collected without throwing. Calling the old disposer after replacement must leave the later provider active. Installing an app-level provider list with duplicate owners must throw a clear error before partial installation.

The composition refactor is accepted when provider installation happens only in app composition. Searches for `installSystemAgentContextProvider`, `installExplicitContextProvider`, `installChatContextProvider`, `installKanbanContextProvider`, and `providerInstalled` should return no production matches under `apps/web/src`. The feature modules should still export provider factories and should still own their snapshot state.

Jarvis behavior is accepted when `collectContextEnvelope()` remains able to collect System Agent, explicit, Chat, and Kanban items after `AppEnvironmentProviders` has installed the provider list. Existing focused tests for formatting and provider semantics should still pass. The user-visible behavior remains that Jarvis sends a `<cradle_context>` block when context is enabled.

Development lifecycle behavior is accepted when re-running the provider installation helper twice does not produce `Context provider already registered: system-agent`. This should be covered by the generation-aware registry tests. Full Vite hot replacement does not need browser automation for this milestone, but the unit test must model the critical stale-disposer case that hot replacement creates.

## Idempotence and Recovery

The code changes are idempotent. Running the app-level installer multiple times should leave one active provider per owner. Running an old cleanup function after a newer provider was installed should not remove the newer provider. Running the newest cleanup function should remove only its own owner slot.

If implementation is interrupted after changing the registry but before updating all callers, TypeScript will report stale `registerProvider` or `jarvisContextRegistry` imports. Resume by searching for those names and updating callers to `setProvider` or `rendererContextRegistry`.

If tests fail because providers are no longer auto-installed during collection, do not reintroduce install side effects into `collectContextEnvelope()`. Update the test to explicitly install providers through `installContextProviders()` or to use a test-specific registry.

If duplicate-owner validation in `installContextProviders()` throws during app startup, inspect the provider array in `apps/web/src/app-providers.tsx`. The correct fix is to remove or rename the duplicate owner at the feature boundary, not to weaken validation.

## Artifacts and Notes

Initial failure shape:

    Context provider already registered: system-agent

Historical throwing code before this refactor:

    apps/web/src/features/context/context-registry.ts
    registerProvider(provider) {
      if (providers.has(provider.owner)) {
        throw new Error(`Context provider already registered: ${provider.owner}`)
      }
      providers.set(provider.owner, provider)
      return () => {
        providers.delete(provider.owner)
      }
    }

Historical side-effect collection path before this refactor:

    apps/web/src/features/system-agent/use-context-snapshot.ts
    export function collectContextEnvelope(): ContextEnvelope {
      installSystemAgentContextProvider()
      return jarvisContextRegistry.collectEnvelope()
    }

Historical provider install call sites before this refactor:

    apps/web/src/features/system-agent/jarvis-popover.tsx
    apps/web/src/features/chat/ui/use-chat-scroll-runtime.ts
    apps/web/src/features/kanban/index.tsx

The worktree has unrelated modifications outside this plan. Do not revert them. Keep implementation diffs scoped to the files named in this plan unless a compile error reveals a direct dependency.

Validation transcript:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/context/context-registry.test.ts src/features/system-agent/context-registry.test.ts src/features/system-agent/format-context.test.ts src/features/system-agent/explicit-context.test.ts src/features/chat/context/chat-context.test.ts src/features/kanban/kanban-context.test.ts
    Test Files  6 passed (6)
    Tests  11 passed (11)

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    exited 0

    pnpm exec eslint apps/web/src/app-providers.tsx apps/web/src/features/context/context-registry.ts apps/web/src/features/context/context-registry.test.ts apps/web/src/features/system-agent/system-context-provider.ts apps/web/src/features/system-agent/explicit-context.ts apps/web/src/features/system-agent/use-context-snapshot.ts apps/web/src/features/system-agent/context-registry.test.ts apps/web/src/features/system-agent/explicit-context.test.ts apps/web/src/features/system-agent/jarvis-popover.tsx apps/web/src/features/chat/context/chat-context.ts apps/web/src/features/chat/context/chat-context.test.ts apps/web/src/features/chat/ui/use-chat-scroll-runtime.ts apps/web/src/features/kanban/kanban-context.ts apps/web/src/features/kanban/kanban-context.test.ts apps/web/src/features/kanban/index.tsx
    exited 0 with 0 errors and 6 warnings

    rg -n "jarvisContextRegistry|registerProvider\(|installSystemAgentContextProvider|installExplicitContextProvider|installChatContextProvider|installKanbanContextProvider|providerInstalled" apps/web/src
    no matches

    git diff --check -- <touched context lifecycle paths>
    exited 0

## Interfaces and Dependencies

Use React's `useEffect` from `react` for the app-level `RendererContextRuntime` component in `apps/web/src/app-providers.tsx`. Use the existing provider factory functions from feature modules:

    createSystemAgentContextProvider(): ContextProvider
    createExplicitContextProvider(): ContextProvider
    createChatContextProvider(): ContextProvider
    createKanbanContextProvider(): ContextProvider

In `apps/web/src/features/context/context-registry.ts`, keep these existing interfaces unless a direct implementation need appears:

    export interface ContextProviderInput {
      activeSurfaceId: string | null
      activeSurfaceType: string | null
      activeSurfaceParams: Record<string, string | undefined>
      activeSurfaceSearch: Record<string, string | undefined>
      now: number
    }

    export interface ContextProvider {
      owner: string
      readContext: (input: ContextProviderInput) => ContextItem[]
    }

The registry should expose one neutral singleton:

    export const rendererContextRegistry = createContextRegistry()

Do not keep `jarvisContextRegistry` as a compatibility alias. Update imports instead. This avoids preserving the old ownership confusion between System Agent and the generic renderer context runtime.

Revision note, 2026-06-19 15:03 +0800: Initial ExecPlan created to guide the renderer context lifecycle refactor before implementation.

Revision note, 2026-06-19 16:48 +0800: Implementation completed, validation recorded, and current-state orientation updated after replacing feature-local provider installation with app composition.
