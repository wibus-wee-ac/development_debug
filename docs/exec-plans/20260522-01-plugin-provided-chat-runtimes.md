# Make Chat runtimes plugin-provided so Bub can replace jar-core

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the repository ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is intentionally a design and implementation plan only. It does not implement Bub or change runtime code by itself.

## Purpose / Big Picture

Cradle currently treats chat runtimes such as `standard`, `codex`, `acp-chat`, `cli-tui`, and `jar-core` as a closed built-in set. That shape blocks the product direction where a framework such as Bub can replace `jar-core` as the system-agent runtime while still being delivered through Cradle's plugin layer. After this plan is implemented, a trusted server plugin can register a first-class chat runtime, sessions can persist and dispatch to that plugin runtime through the existing `/chat` APIs, and Jarvis can choose Bub or `jar-core` without hardcoding either framework in the Jarvis UI.

The user-visible behavior is: an operator enables a Bub plugin, selects Bub as the Jarvis runtime or creates a session using the Bub runtime id, sends a message through the normal Cradle chat surface, observes the same message snapshot and SSE stream behavior as built-in runtimes, and can cancel or resume that session according to Bub's actual capabilities. Existing `jar-core` sessions must continue to run during the transition.

## Progress

- [x] (2026-05-21 17:10Z) Read the current chat runtime registry, runtime contract, provider type definitions, plugin context, plugin SDK server context, plugin descriptor registry, session service, session model, preferences model, DB schema, plugin loader, and Jarvis popover.
- [x] (2026-05-21 17:10Z) Ran three independent reviewer rounds: architecture boundary, compatibility/data model, and Bub runtime semantics.
- [x] (2026-05-21 17:10Z) Decided that Bub must be modeled as a plugin-provided `ChatRuntime`, not as a tool, MCP server, skill, or plugin route that bypasses `/chat`.
- [x] (2026-05-21 17:10Z) Drafted this ExecPlan as the implementation specification.
- [ ] Open the persisted and API runtime id contract from closed built-in enum to validated string id with reserved built-in constants.
- [ ] Add a plugin-facing chat runtime registration API with disposable lifecycle cleanup.
- [ ] Bridge plugin-registered runtimes into the existing `ChatRuntimeService` dispatch path.
- [ ] Make Jarvis runtime-selectable without hardcoding `jar-core`.
- [ ] Add a first-party Bub runtime plugin using fake transport tests first, then real Bub transport wiring.
- [ ] Preserve `jar-core` compatibility and prepare a later milestone where `jar-core` itself can become a first-party plugin.

## Surprises & Discoveries

- Observation: The SQLite database is less restrictive than the TypeScript and HTTP layers. Drizzle `text(..., { enum })` in `packages/db/src/schema/chat.ts`, `packages/db/src/schema/identity.ts`, and `packages/db/src/schema/backend-control-plane.ts` narrows TypeScript types, but the checked migration SQL does not show a SQLite `CHECK` constraint for runtime ids. The practical blocker is type/API validation, not raw storage.
  Evidence: `packages/db/src/schema/chat.ts` defines `sessions.runtimeKind` with a closed enum, while `packages/db/drizzle/0008_youthful_rocket_raccoon.sql` updates runtime strings without adding a visible runtime-kind check constraint.

- Observation: `apps/server/src/plugins/runtime-registry.ts` is named like a runtime registry, but it tracks plugin descriptors and declared/registered plugin capabilities. It must not become the owner of chat runtime semantics.
  Evidence: it exposes `registerPluginDescriptor`, `registerPluginCapability`, and `listPluginDescriptors`, while the executable chat runtime map lives in `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts`.

- Observation: Jarvis currently means both a product surface and a specific implementation id. The frontend creates Jarvis sessions with `runtimeKind: 'jar-core'`, and the server names default `jar-core` agents `Jarvis`.
  Evidence: `apps/web/src/features/system-agent/jarvis-popover.tsx` hardcodes `runtimeKind: 'jar-core'`; `apps/server/src/modules/session/service.ts` special-cases `runtimeKind === 'jar-core'` in default agent name and avatar seed.

- Observation: The existing `ChatRuntime` contract is close to the correct host/plugin boundary because the host already owns session persistence, message snapshots, SSE deltas, run terminal state, and cancel flow. The contract needs metadata and lifecycle semantics, not a separate Bub-specific chat API.
  Evidence: `apps/server/src/modules/chat-runtime/service.ts` calls `startChatSession`, `resumeChatSession`, `streamTurn`, `getCapabilities`, and `cancelTurn` while keeping DB writes in the host service.

## Decision Log

- Decision: Bub is a chat runtime framework, not a tool, MCP server, skill, or provider source.
  Rationale: Bub replaces the agent loop currently supplied by `jar-core`: session lifecycle, streaming, model mediation, resume, and cancel. Tools, MCP servers, and skills are subordinate capabilities used by runtimes, not the runtime boundary itself.
  Date/Author: 2026-05-21 / Codex with reviewer round 1.

- Decision: The public plugin API should be `ctx.runtimes.chat.register(...)`, while the semantic owner remains `apps/server/src/modules/chat-runtime`.
  Rationale: `packages/plugin-sdk` should expose the host capability, and `apps/server/src/plugins/context.ts` should track disposable lifecycle, but the chat runtime module must own validation, dispatch, duplicate id rules, and the `ChatRuntime` contract.
  Date/Author: 2026-05-21 / Codex with reviewer round 1.

- Decision: Persisted runtime ids must become open strings with reserved built-in constants.
  Rationale: A plugin-provided runtime cannot be known at compile time by `runtimeKinds = [...] as const`. Keeping a built-in constant list is useful for labels, icons, defaults, and compatibility, but it must not reject plugin-owned ids at HTTP, OpenAPI, generated CLI, web types, or DB typing boundaries.
  Date/Author: 2026-05-21 / Codex with reviewer round 2.

- Decision: Keep `jar-core` as a compatibility id during Bub adoption.
  Rationale: Existing sessions, backend bindings, default agent ids, issue comments, approval policy keys, and capability snapshots may already reference `jar-core`. Removing that id would turn old sessions into `chat_runtime_not_available` and split stable default agent identity.
  Date/Author: 2026-05-21 / Codex with reviewer round 2.

- Decision: Bub transport modes must be explicit. Do not silently fall back from gateway/channel mode to CLI mode.
  Rationale: Gateway or channel mode can preserve native session ids, resume, cancel, and command discovery. CLI mode may only replay Cradle history and kill a child process. Mixing these modes without recording the selected mode would create false resume semantics.
  Date/Author: 2026-05-21 / Codex with reviewer round 3.

- Decision: Jarvis is a product surface or persona, not a runtime id.
  Rationale: Jarvis should select a runtime binding such as Bub or `jar-core`. The UI and default agent presentation should not encode the assumption that Jarvis always means `jar-core`.
  Date/Author: 2026-05-21 / Codex with reviewer rounds 1 and 2.

## Outcomes & Retrospective

No implementation has started. The expected outcome after executing this plan is a plugin-provided runtime layer where Bub can be installed as a first-party server plugin and used through the normal Cradle chat APIs. The main architectural lesson from the planning phase is that the work must start by opening the runtime id contract; adding a Bub adapter first would repeat the wrong design by hiding a framework-level runtime behind a hardcoded built-in path.

## Context and Orientation

A chat runtime is the Cradle host abstraction that knows how to start a backend conversation, resume it, stream one user turn, report available commands or skills, and cancel an active turn. The current TypeScript interface is `ChatRuntime` in `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`. The host service in `apps/server/src/modules/chat-runtime/service.ts` uses this interface to keep all Cradle-owned persistence and streaming behavior centralized.

The current runtime registry is `RuntimeRegistry` in `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts`. It hardcodes built-in providers: ACP Chat, OpenAI-compatible standard chat, Claude Agent SDK, Codex, and `SystemAgentProvider` for `jar-core`. It has a `registerRuntime(runtime)` helper, but that helper is internal to server code and is not exposed to plugins.

The current runtime id type is defined in `apps/server/src/modules/providers/types.ts` as `runtimeKinds = ['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'] as const`. That makes `RuntimeKind` a closed union. The same closed set appears in `apps/server/src/modules/session/model.ts`, `apps/server/src/modules/agent-identity/model.ts`, `apps/server/src/modules/automation/model.ts`, `apps/web/src/lib/types.ts`, generated CLI command metadata under `packages/cli/src/commands/generated/`, and Drizzle schemas in `packages/db/src/schema/chat.ts`, `packages/db/src/schema/identity.ts`, and `packages/db/src/schema/backend-control-plane.ts`.

The current plugin server context is declared in `packages/plugin-sdk/src/server.ts` and constructed in `apps/server/src/plugins/context.ts`. It exposes `routes`, `mcp`, `skills`, `providers.externalSources`, `storage`, `logger`, `sharedConfig`, `hooks.chat`, and `events`. It does not expose a runtime registration namespace. The plugin loader in `apps/server/src/plugins/loader.ts` activates server plugins and tracks returned `Disposable` objects in `ctx.subscriptions`; this is the correct lifecycle mechanism for plugin runtime unregistration.

The plugin descriptor registry in `apps/server/src/plugins/runtime-registry.ts` is a metadata registry for plugin descriptors and capabilities. It is useful for displaying that a plugin registered a `chat-runtime` capability, but it should not own the executable runtime map.

Jarvis is currently implemented as a UI surface under `apps/web/src/features/system-agent/`. `apps/web/src/features/system-agent/jarvis-popover.tsx` creates a session with `runtimeKind: 'jar-core'`. Preferences are modeled in `apps/server/src/modules/preferences/model.ts` and `apps/web/src/features/system-agent/use-jarvis-preferences.ts`; they currently store profile, model, and thinking level, not runtime selection.

Bub, in this plan, means an external or first-party agent framework that can own the agent loop currently owned by `jar-core`. A Bub plugin may use a gateway, channel, or CLI transport internally, but it must expose Cradle's `ChatRuntime` contract to the host.

## Plan of Work

Start by moving runtime id ownership out of the provider module. Create or extend a chat-runtime-owned type module, for example `apps/server/src/modules/chat-runtime/runtime-kind.ts`, with `BuiltinRuntimeKind`, `builtinRuntimeKinds`, and `RuntimeKind = string`. Keep helper predicates such as `isBuiltinRuntimeKind(value: string): value is BuiltinRuntimeKind`, but stop using the built-in list as a global admission control. Update imports from `../providers/types` to the new chat-runtime-owned type where the value is actually a runtime id.

Open the server HTTP schemas next. In `apps/server/src/modules/session/model.ts`, `apps/server/src/modules/agent-identity/model.ts`, and `apps/server/src/modules/automation/model.ts`, replace closed runtime literal unions with a `runtimeKindSchema` that accepts a non-empty string. Validation that a runtime exists should happen in service code close to runtime dispatch or agent/session creation, not in a static schema generated before plugins are loaded. For user-friendly errors, return `runtime_kind_not_registered` or the existing `chat_runtime_not_available` with the selected id in `details`.

Open the Drizzle schema typing without requiring a destructive data migration. In `packages/db/src/schema/chat.ts`, `packages/db/src/schema/identity.ts`, and `packages/db/src/schema/backend-control-plane.ts`, change `text('runtime_kind', { enum: [...] })` to plain `text('runtime_kind')` with the same defaults. If drizzle-kit produces a no-op or type-only migration, record that in this plan during implementation. If it produces SQL, inspect it before applying and avoid any table rebuild that could lose data. Existing stored values must remain unchanged.

Open frontend and generated client expectations. In `apps/web/src/lib/types.ts`, change `RuntimeKind` to `string` and keep built-in metadata maps as `Record<BuiltinRuntimeKind, ...>` plus fallback behavior for unknown plugin ids. Any parser such as `parseRuntimeKind()` must preserve unknown non-empty strings instead of returning `undefined`. Runtime selectors should combine built-in defaults with a future server-provided runtime list; until that list exists, unknown plugin runtimes should render a generic runtime label and icon rather than breaking.

Add a chat-runtime-owned registration contract. In `apps/server/src/modules/chat-runtime`, define a `ChatRuntimeRegistration` type with a stable `runtimeKind`, human label, owner plugin name when applicable, optional description, optional configuration metadata, optional default presentation metadata, and the executable `ChatRuntime`. Extend `RuntimeRegistry` so it stores registrations, not only raw runtimes. It must reject duplicate ids unless the caller is registering an explicit alias owned by the host. It must support unregistering a runtime by owner and id. Built-in runtimes should be registered through the same internal registration method.

Expose the registration contract to plugins. In `packages/plugin-sdk/src/server.ts`, add `runtimes: ServerPluginRuntimeRegistries` to `ServerPluginContext`. Add `ServerPluginChatRuntimeRegistry` with `register(registration): Disposable`. The SDK type should not import private server files; define a public plugin-side runtime shape that is structurally compatible with the host `ChatRuntime` contract, or export a shared type from a package that both host and plugin SDK can depend on without creating a circular app dependency. In `apps/server/src/plugins/context.ts`, implement `ctx.runtimes.chat.register` by normalizing the plugin-owned runtime id, registering it with the chat-runtime registry, registering a plugin capability of type `chat-runtime`, and tracking a disposable that unregisters both the executable runtime and capability.

Use owner-scoped ids for plugin runtimes. For a first-party plugin named `@cradle/bub`, prefer a stable id such as `@cradle/bub:bub` or `plugin:@cradle/bub:bub`. The host may also register the legacy alias `jar-core` to Bub during migration, but external plugins must not be allowed to claim built-in ids or another plugin's namespace. The exact string format can be finalized during implementation, but the rule must be enforced in one helper and covered by tests.

Bridge plugin runtimes into existing chat dispatch. `apps/server/src/modules/chat-runtime/service.ts` should continue to call `getRuntimeRegistry().get(runtimeKind)`, but `get` should now return the registered runtime for either built-in or plugin ids. If a session references a plugin runtime that is not currently loaded, the service should return `chat_runtime_not_available` and should not mutate the session or delete bindings.

Make Jarvis runtime-selectable. Extend `PreferencesModel.jarvisPreferences` in `apps/server/src/modules/preferences/model.ts` and `JarvisPreferences` in `apps/web/src/features/system-agent/use-jarvis-preferences.ts` with a nullable or optional `runtimeKind`. Default it to `jar-core` for compatibility until Bub is enabled and selected. Update `apps/web/src/features/system-agent/jarvis-popover.tsx` so session creation uses `prefs.runtimeKind ?? 'jar-core'` rather than hardcoding `jar-core`. Move default Jarvis presentation out of runtime-id special cases in `apps/server/src/modules/session/service.ts`; the default agent name/avatar should come from a Jarvis-specific creation path, a runtime registration default presentation, or a compatibility helper that can handle both `jar-core` and Bub.

Create the first-party Bub plugin after the host contract exists. Add a `plugins/bub` package with server entry `plugins/bub/src/server.ts`. Its `activate(ctx)` should call `ctx.runtimes.chat.register(...)`. The Bub runtime implementation should live under the plugin package, not under `apps/server/src/modules/chat-runtime/providers`, so the plugin owns Bub-specific configuration, transport selection, and lifecycle. The runtime must not write Cradle sessions, messages, backend runs, capability snapshots, or skills directly; it only returns runtime sessions and streams AI SDK-compatible chunks or snapshots.

Implement Bub transport modes behind a small internal adapter. Gateway or channel mode is the primary path and should preserve a real Bub session or channel id in `providerSessionId` and `providerStateSnapshot`. CLI mode is an explicit degraded mode, suitable for local smoke tests and environments without a gateway; if it cannot resume natively, it must rely on `StreamTurnInput.history` and set `providerSessionId` to `null` or to a real id returned by the CLI. The `providerStateSnapshot` must remain JSON-serializable and must satisfy `ProviderStateSnapshotJsonSchema` expectations used by the host, including a `models.currentModelId` field when available.

Keep `jar-core` compatible. In the first migration phase, keep the current `SystemAgentProvider` registered under `jar-core`, or register a Bub-backed alias for `jar-core` only after Bub reaches parity. Do not rewrite stored `runtime_kind` values in this phase. A later cleanup can move `jar-core` into its own first-party plugin once plugin runtimes are proven and the compatibility alias behavior is covered.

## Concrete Steps

All commands in this plan assume the repository root is `/Users/wibus/dev/Cradle`.

First, inspect the current runtime and plugin boundaries:

    rg -n "runtimeKinds|RuntimeKind|runtimeKindSchema|jar-core|ServerPluginContext|registerRuntime" apps packages plugins

Expect to see matches in `apps/server/src/modules/providers/types.ts`, `apps/server/src/modules/session/model.ts`, `apps/server/src/modules/agent-identity/model.ts`, `apps/server/src/modules/automation/model.ts`, `apps/web/src/lib/types.ts`, `packages/db/src/schema/*`, `packages/plugin-sdk/src/server.ts`, and `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts`.

Implement Milestone 1 by opening the runtime id contract. Edit:

- `apps/server/src/modules/providers/types.ts` to remove runtime ownership or re-export from the new chat-runtime-owned module temporarily.
- `apps/server/src/modules/chat-runtime/runtime-kind.ts` to define `RuntimeKind = string`, `BuiltinRuntimeKind`, `builtinRuntimeKinds`, and helper predicates.
- `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` to import `RuntimeKind` from the new owner.
- All server imports that currently import `RuntimeKind` from `../providers/types`.
- `apps/server/src/modules/session/model.ts`, `apps/server/src/modules/agent-identity/model.ts`, and `apps/server/src/modules/automation/model.ts` to accept non-empty runtime strings.
- `packages/db/src/schema/chat.ts`, `packages/db/src/schema/identity.ts`, and `packages/db/src/schema/backend-control-plane.ts` to stop narrowing runtime id columns to the built-in enum.

Run:

    pnpm --filter @cradle/db check
    pnpm --filter apps-server test session

If package names differ, use the repository's existing package scripts from `package.json` and record the exact command in this plan before continuing.

Implement Milestone 2 by adding plugin runtime registration. Edit:

- `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` so `RuntimeRegistry` stores registration metadata, supports plugin owner and disposable unregister, and still registers built-ins during lazy initialization.
- `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` or a new adjacent file to define host-side registration metadata.
- `packages/plugin-sdk/src/server.ts` to add `ServerPluginContext.runtimes.chat.register`.
- `apps/server/src/plugins/context.ts` to implement plugin registration, disposable cleanup, and capability registration.
- `apps/server/src/plugins/runtime-registry.ts` only if capability display metadata needs an additional type value; do not move executable runtime dispatch there.
- `apps/server/src/plugins/context.test.ts` or a new focused test to assert that plugin runtime registration is disposed on plugin unload.

Run:

    pnpm --filter @cradle/plugin-sdk typecheck
    pnpm --filter apps-server test plugins
    pnpm --filter apps-server test chat-runtime

Implement Milestone 3 by preserving unknown plugin runtime ids through clients and UI. Edit:

- `apps/web/src/lib/types.ts` so `RuntimeKind` is `string` and built-in UI metadata handles unknown ids with a fallback.
- Runtime selectors under `apps/web/src/features/composer-toolbar/`, `apps/web/src/features/new-chat/`, and `apps/web/src/features/workspace-detail/` so they do not discard unknown runtime strings.
- Generated CLI and generated web SDK outputs only through the repository's generation command, not by hand, after OpenAPI schemas accept strings.

Run:

    pnpm --filter apps-server openapi
    pnpm --filter @cradle/cli test
    pnpm --filter apps-web test new-chat

If the actual generation script has a different name, inspect `apps/server/package.json`, `packages/cli/package.json`, and root `package.json`, then update this step with the exact command used.

Implement Milestone 4 by decoupling Jarvis from `jar-core`. Edit:

- `apps/server/src/modules/preferences/model.ts` to add `runtimeKind` to Jarvis preferences with compatibility default `jar-core`.
- `apps/web/src/features/system-agent/use-jarvis-preferences.ts` to expose the same field.
- `apps/web/src/features/settings/jarvis-settings.tsx` to let the user choose an available Jarvis runtime once the runtime list endpoint exists; until then, keep a minimal string-preserving select or hidden default.
- `apps/web/src/features/system-agent/jarvis-popover.tsx` to create sessions with the preference runtime.
- `apps/server/src/modules/session/service.ts` to remove or narrow `runtimeKind === 'jar-core'` presentation coupling.

Run:

    pnpm --filter apps-server test preferences session
    pnpm --filter apps-web test system-agent settings

Implement Milestone 5 by adding the first-party Bub plugin. Create:

- `plugins/bub/package.json`
- `plugins/bub/src/server.ts`
- `plugins/bub/src/bub-runtime.ts`
- `plugins/bub/src/bub-transport.ts`
- `plugins/bub/src/bub-runtime.test.ts`
- `plugins/bub/README.md`

The plugin activation should register the Bub chat runtime through `ctx.runtimes.chat.register`. Use fake transport tests first. The fake gateway transport should start a session, stream at least two text chunks, record cancel calls, and support a resume call. The fake CLI transport should simulate output frames and a nonzero exit failure. Do not require a real Bub binary, gateway, token, or network connection for unit tests.

Run:

    pnpm --filter @cradle/plugin-bub test
    pnpm --filter apps-server test chat-runtime

Implement Milestone 6 by proving end-to-end behavior. Add or update tests that create a session with a plugin runtime id, stream a response through `/chat/sessions/:id/response`, read messages, cancel a hanging run, and resume a session using the stored backend binding. Also add a compatibility test that inserts or creates a `jar-core` session and verifies it still runs or returns an intentional availability error only when the compatible runtime is genuinely disabled.

Run:

    pnpm --filter apps-server test
    pnpm --filter apps-web test
    pnpm --filter @cradle/cli test

## Validation and Acceptance

The implementation is accepted when a plugin runtime can be registered, selected, persisted, dispatched, streamed, cancelled, and unregistered without bypassing Cradle's chat service.

For server behavior, create a test plugin or activate `plugins/bub` with a fake transport. Create a session with the Bub runtime id. Send a message through the normal chat response endpoint. Expect the SSE stream to include message delta events and a terminal run completion event. Then call the messages endpoint and expect the assistant message status to be `complete` with streamed content present.

For cancel behavior, configure the fake Bub stream to hang after its first chunk. Start a run, call the normal cancel endpoint, and expect the backend run and assistant message to become `aborted`. The fake transport must record that its abort or kill path was invoked exactly once or at least once with idempotent behavior.

For resume behavior, complete one run, verify `backend_session_bindings.backendSessionId` and `backendStateSnapshot` are written according to the selected Bub mode, then send a second message. In gateway or channel mode, expect the fake transport's resume path to receive the stored Bub id. In CLI mode, expect the runtime to use Cradle-provided `history` and not claim native resume if no native id exists.

For plugin lifecycle behavior, activate a plugin runtime, verify `getRuntimeRegistry().get(runtimeId)` returns it, dispose the plugin subscription or deactivate plugins, and verify new runs for that runtime return `chat_runtime_not_available` without deleting sessions or bindings.

For Jarvis behavior, set Jarvis preferences to use Bub, open the Jarvis popover, send a message, and verify the created session has the Bub runtime id. Set preferences back to `jar-core` and verify the same UI path creates a `jar-core` session. The UI code should not hardcode either id inside `JarvisPopover`.

For compatibility, existing rows with `runtime_kind = 'jar-core'` in `sessions`, `agents`, and `backend_session_bindings` must continue to work. No implementation step should rewrite those rows unless a later ExecPlan explicitly covers a migration.

For generated clients, inspect the generated OpenAPI and CLI metadata. `runtimeKind` should be documented as a string, not as the closed enum of built-ins. Generated commands such as session create and agent create should accept a plugin runtime id string.

## Idempotence and Recovery

Most steps are additive and can be repeated. Type changes from closed enum to open string are safe to re-run because they widen accepted values. Plugin runtime registration must return a disposable and unregister by owner/id, so repeated plugin activation during tests must not leave stale runtimes behind.

Do not run destructive database commands. If drizzle-kit proposes a migration that rebuilds tables for runtime id columns, inspect the SQL before applying it. A type-only widening should not require data rewriting. If a table rebuild is unavoidable, stop and update this plan with a backup and verification procedure before running it.

If a plugin runtime fails during activation, `apps/server/src/plugins/loader.ts` should mark the plugin layer as failed and dispose any registrations collected before the failure. A failed Bub plugin must not poison built-in runtime registration.

If a session references a runtime id that is currently unavailable because its plugin is disabled or missing, do not mutate or delete the session. Return a clear availability error. This keeps recovery simple: re-enable the plugin and retry the run.

If a Bub CLI child process hangs or exits nonzero, the runtime should surface a normal stream failure to the host and let `ChatRuntimeService` mark the run failed. The runtime should clean up child processes during `cancelTurn` and plugin deactivation.

## Artifacts and Notes

Reviewer round 1, architecture boundary:

    Finding: Bub belongs at ChatRuntime level because it replaces the agent loop and session semantics currently owned by jar-core.
    Risk: Putting runtime registration under providers or plugin descriptor registry would blur ownership.
    Revision: Add ctx.runtimes.chat.register, backed by chat-runtime-owned registry, with plugin host only managing lifecycle and capability projection.

Reviewer round 2, compatibility and data:

    Finding: RuntimeKind is closed across server types, TypeBox, DB typing, generated CLI, and web types.
    Risk: A plugin runtime id could register successfully but still be rejected by POST /sessions or generated clients.
    Revision: Make persisted runtimeKind an open string; keep builtinRuntimeKinds only for built-in metadata and compatibility.

Reviewer round 3, Bub runtime semantics:

    Finding: Gateway/channel and CLI modes have different resume and cancel guarantees.
    Risk: A CLI fallback could fake providerSessionId and make Cradle believe native resume exists.
    Revision: Record mode in providerStateSnapshot; make CLI mode explicit; never silently cross-fallback without visible state.

Important source files read during planning:

    apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts
    apps/server/src/modules/chat-runtime/runtime-provider-types.ts
    apps/server/src/modules/chat-runtime/service.ts
    apps/server/src/modules/providers/types.ts
    apps/server/src/modules/session/model.ts
    apps/server/src/modules/session/service.ts
    apps/server/src/modules/preferences/model.ts
    apps/server/src/plugins/context.ts
    apps/server/src/plugins/loader.ts
    apps/server/src/plugins/runtime-registry.ts
    packages/plugin-sdk/src/server.ts
    packages/db/src/schema/chat.ts
    packages/db/src/schema/identity.ts
    packages/db/src/schema/backend-control-plane.ts
    apps/web/src/features/system-agent/jarvis-popover.tsx
    apps/web/src/features/system-agent/use-jarvis-preferences.ts
    apps/web/src/lib/types.ts

## Interfaces and Dependencies

The end state should include a chat-runtime-owned id module with these concepts:

    export const builtinRuntimeKinds = ['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'] as const
    export type BuiltinRuntimeKind = (typeof builtinRuntimeKinds)[number]
    export type RuntimeKind = string
    export function isBuiltinRuntimeKind(value: string): value is BuiltinRuntimeKind

The host runtime registration should be conceptually equivalent to:

    export interface ChatRuntimeRegistration {
      runtimeKind: RuntimeKind
      label: string
      description?: string
      owner?: string
      runtime: ChatRuntime
      aliases?: RuntimeKind[]
      metadata?: Record<string, unknown>
      defaultPresentation?: {
        name?: string
        avatarSeed?: string
        avatarStyle?: string
      }
    }

The exact field names may change during implementation, but the contract must express id, label, owner, executable runtime, optional aliases, and optional presentation metadata. Duplicate id policy must be explicit: built-in ids are reserved, plugin ids must be owner-scoped, and aliases must be host-approved.

The plugin SDK should expose a server context shape conceptually equivalent to:

    export interface ServerPluginContext {
      runtimes: ServerPluginRuntimeRegistries
    }

    export interface ServerPluginRuntimeRegistries {
      chat: ServerPluginChatRuntimeRegistry
    }

    export interface ServerPluginChatRuntimeRegistry {
      register(registration: ServerPluginChatRuntimeRegistration): Disposable
    }

The plugin-side registration type must be structurally compatible with the host runtime interface without importing private app modules from `apps/server`. If sharing the exact `ChatRuntime` type requires a circular dependency, extract the public runtime contract to a shared package or define a public SDK mirror and adapt it in `apps/server/src/plugins/context.ts`.

Bub plugin internals should define a transport interface conceptually equivalent to:

    interface BubTransport {
      start(input: BubStartInput): Promise<BubSession>
      resume(input: BubResumeInput): Promise<BubSession>
      stream(input: BubStreamInput): AsyncGenerator<BubEvent, void, void>
      cancel(input: BubCancelInput): Promise<void>
      getCapabilities?(input: BubCapabilitiesInput): Promise<BubCapabilities>
    }

The runtime adapter maps `BubEvent` values to AI SDK `UIMessageChunk` values or progressive `UIMessage` snapshots. It must consume `StreamTurnInput.history`, `StreamTurnInput.systemPrompt`, `StreamTurnInput.modelId`, and `StreamTurnInput.workspacePath` when the selected Bub mode supports them. It must not write Cradle-owned tables or plugin-unowned namespaces such as global `.agents/skills`.

Revision note, 2026-05-21: Initial plan created after three reviewer rounds. The plan intentionally starts with runtime id and plugin registration boundaries before adding Bub, because the current closed runtime enum would otherwise force Bub back into a hardcoded built-in path.
