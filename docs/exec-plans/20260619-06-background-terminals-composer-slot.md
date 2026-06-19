# Add Background Terminal Controls to the Composer Slot

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The plan is self-contained: a reader should be able to start with this file, inspect the named repository files, and implement the feature without relying on prior chat context.

## Purpose / Big Picture

Codex can leave long-running background terminal processes attached to a chat thread. Today Cradle can show a coarse terminal summary in the Right Aside runtime panel, but the Composer area does not expose the concrete background terminal list or a way to terminate an individual process. After this change, a user looking at an active Codex chat can see running background terminals above the composer, inspect each command, working directory, process id, CPU, and memory, and click a terminate button for a specific process.

The important ownership rule is that Codex owns the native terminal lifecycle and Cradle Chat Runtime owns the session-scoped API boundary. The Composer must not call raw Codex JSON-RPC methods directly. The Composer should consume Cradle-owned HTTP endpoints and provider-owned UI slot state, while the Codex provider adapter maps those calls to Codex app-server methods.

## Progress

- [x] (2026-06-19 15:19 +0800) Investigated existing Codex app-server capabilities and found `thread/backgroundTerminals/list`, `thread/backgroundTerminals/terminate`, and `thread/backgroundTerminals/clean`.
- [x] (2026-06-19 15:19 +0800) Confirmed current Cradle `codex:terminal` UI slot only projects a summary from notification snapshots and defaults to the `runtimePanel` surface.
- [x] (2026-06-19 15:19 +0800) Confirmed `ComposerSlotStates` does not currently render terminal state.
- [x] (2026-06-19 15:19 +0800) Created this ExecPlan.
- [x] (2026-06-19 15:50 +0800) Extended the Chat Runtime provider contract, TypeBox schemas, Elysia routes, and service exports for background terminal list/terminate.
- [x] (2026-06-19 15:50 +0800) Implemented the Codex provider adapter by calling `thread/backgroundTerminals/list` and `thread/backgroundTerminals/terminate`.
- [x] (2026-06-19 15:50 +0800) Extended terminal UI slot state with JSON-safe background terminal rows and exposed `codex:terminal` on `composerState`.
- [x] (2026-06-19 15:50 +0800) Added the Composer terminal slot component and terminate action.
- [x] (2026-06-19 15:50 +0800) Updated Chat Runtime, Codex provider, and web Chat README documentation.
- [x] (2026-06-19 15:50 +0800) Focused Codex provider test passed with 73 tests.
- [x] (2026-06-19 15:58 +0800) Re-ran `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/provider.test.ts`; it passed 73 tests.
- [x] (2026-06-19 15:58 +0800) Re-ran `pnpm --filter @cradle/server typecheck`; it passed.
- [x] (2026-06-19 16:04 +0800) Cleared unrelated web typecheck blockers encountered during validation and re-ran `pnpm --filter @cradle/web typecheck`; it passed.
- [x] (2026-06-19 16:07 +0800) Started `pnpm dev:fullstack`; Vite is serving the web app at `http://localhost:5174/` and the server is listening at `http://127.0.0.1:21423`.
- [x] (2026-06-19 16:10 +0800) Completion audit found that the Composer terminal slot truncated background terminal rows to three; updated it to render every background terminal in a bounded scroll area.
- [x] (2026-06-19 16:11 +0800) Re-ran final validation after the audit fix: focused Codex provider test passed 73 tests, server typecheck passed, and web typecheck passed.
- [x] (2026-06-19 16:12 +0800) Confirmed the server health endpoint responds at `http://127.0.0.1:21423/health` and restarted the web dev server at `http://localhost:5174/`.

## Surprises & Discoveries

- Observation: Codex app-server already exposes the exact native operations needed for this feature.
  Evidence: `apps/server/src/modules/chat-runtime-providers/codex/app-server/capabilities.ts` declares `thread/backgroundTerminals/list`, `thread/backgroundTerminals/terminate`, and `thread/backgroundTerminals/clean`.

- Observation: The generated Codex background terminal item includes `rssKb: bigint | null`, which cannot be JSON serialized directly.
  Evidence: `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2/ThreadBackgroundTerminal.ts` defines `rssKb` as `bigint | null`. The Cradle HTTP DTO must normalize this to a JSON-safe value, preferably `rssKb: number | null` when the value is within `Number.MAX_SAFE_INTEGER`, or a string if precision must be preserved.

- Observation: The current terminal slot does not specify `surfaces`, so `projectCodexUiSlots` defaults it to `['runtimePanel']`.
  Evidence: `apps/server/src/modules/chat-runtime-providers/codex/projection/ui-slot-projector.ts` maps missing surfaces to `['runtimePanel']`.

- Observation: The package script form `pnpm --filter @cradle/server test -- apps/server/src/modules/chat-runtime-providers/codex/provider.test.ts` did not narrow to the intended test file because Vitest ran inside `apps/server` and the path was repository-root relative. It executed the full server test suite instead, which is currently blocked by a missing DB migration file unrelated to this feature.
  Evidence: The command output showed 77 test files and repeated `No file /Users/wibus/dev/Cradle/packages/db/drizzle/0003_nifty_xorn.sql found`. The package-local command `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/provider.test.ts` ran the intended file and passed 73 tests.

- Observation: Typecheck validation exposed unrelated in-flight edits outside the background-terminal feature before the final green run.
  Evidence: Server typecheck first reported `src/modules/chat-runtime-providers/codex/app-server/account-diagnostics.ts` discriminant errors. Web typecheck then surfaced a sequence of unrelated blockers in `diff-review/review-detail/guide-view.tsx`, the surface navigation migration, and `kanban/issue-aside-panel.tsx`. After those local type issues were resolved, `pnpm --filter @cradle/server typecheck` and `pnpm --filter @cradle/web typecheck` both passed.

## Decision Log

- Decision: Implement this as a Chat Runtime capability and Codex provider adapter, not as a raw Composer call to `/chat/sessions/:sessionId/codex/app-server/invoke`.
  Rationale: Cradle already treats Codex app-server methods as provider-owned. A raw invoke from Composer would leak Codex protocol strings and native parameter shapes into UI code, making the UI own lifecycle details it should only display and command through a session-scoped interface.
  Date/Author: 2026-06-19 / Codex

- Decision: Extend the existing terminal UI slot state instead of creating a separate terminal projection.
  Rationale: The repository already has `RuntimeTerminalUiSlotState` and `ChatRuntimeTerminalUiSlotState`. Reusing that state keeps ownership and rendering aligned with existing runtime UI slot architecture and avoids a parallel concept for the same provider-owned feature.
  Date/Author: 2026-06-19 / Codex

- Decision: Add focused server/provider tests and rely on TypeScript plus manual UI observation for the Composer rendering.
  Rationale: The repository instructions explicitly avoid adding frontend component tests unless requested. Server behavior and DTO normalization carry the main correctness risk; UI acceptance can be verified by running the app and observing the slot.
  Date/Author: 2026-06-19 / Codex

- Decision: Reuse the existing Codex provider client acquisition helper for background terminals instead of creating a new app-server client abstraction in this change.
  Rationale: The helper already resolves the runtime session, profile, workspace, auth, app-server host lease, and skill roots needed by this session-scoped capability. Renaming or extracting it would be a broader provider refactor that is not required for the user-visible terminal control.
  Date/Author: 2026-06-19 / Codex

- Decision: Convert Codex `rssKb: bigint | null` directly to `number | null` at the provider boundary.
  Rationale: The Cradle HTTP and UI slot contracts are JSON payloads, so `bigint` cannot cross the boundary. The user explicitly requested no defensive code; this change keeps the DTO direct instead of adding range guards or alternate string encodings.
  Date/Author: 2026-06-19 / Codex

- Decision: Key the Composer terminal slot by thread id instead of `updatedAt`.
  Rationale: When the terminal slot is backed only by live background terminal rows, the provider projection may update `updatedAt` on each poll. A stable thread-level key lets the row content update without remounting the whole Composer slot every poll.
  Date/Author: 2026-06-19 / Codex

- Decision: Render every background terminal row in the Composer slot and constrain the row list with a fixed maximum height.
  Rationale: The feature promise is list and terminate for background terminals, so truncating to the first three rows hides valid processes and leaves no Composer control for them. A bounded scroll area preserves the compact Composer layout without dropping rows.
  Date/Author: 2026-06-19 / Codex

## Outcomes & Retrospective

Implemented the feature path across Chat Runtime, Codex provider, and Composer UI. A Codex terminal slot can now carry concrete background terminal rows, the Composer renders all rows with process metadata in a bounded list, and terminate actions call a Cradle session-scoped route rather than raw Codex JSON-RPC. Focused provider coverage passes, server typecheck passes, web typecheck passes, the server health endpoint responds, and the web dev server is available. Manual UI browser observation was not run because the user explicitly discourages unsolicited browser testing for frontend work.

## Context and Orientation

Cradle has a Chat Runtime module under `apps/server/src/modules/chat-runtime`. A runtime is a backend adapter that knows how to talk to a provider such as Codex or Claude Agent. A UI slot is a provider-owned piece of state that Cradle can render in places such as the slash command panel, Composer area, Right Aside runtime panel, toolbar picker, or message stream evidence. The server exposes UI slot state through `GET /chat/sessions/:sessionId/ui-slot-states`, and the web app reads that endpoint in `apps/web/src/features/chat/composer/use-chat-composer-runtime.ts`.

The Codex provider lives under `apps/server/src/modules/chat-runtime-providers/codex`. The generated Codex app-server protocol types live under `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2`. Do not edit generated files by hand. The generated types already define:

    ThreadBackgroundTerminal = {
      itemId: string
      processId: string
      command: string
      cwd: AbsolutePathBuf
      osPid: number | null
      cpuPercent: number | null
      rssKb: bigint | null
    }

    ThreadBackgroundTerminalsListParams = {
      threadId: string
      cursor?: string | null
      limit?: number | null
    }

    ThreadBackgroundTerminalsTerminateParams = {
      threadId: string
      processId: string
    }

The current terminal UI slot is declared in `apps/server/src/modules/chat-runtime-providers/codex/projection/ui-slot-projector.ts` with id `codex:terminal`. Its current state is projected by `projectCodexTerminalState`, which uses a bounded notification snapshot and returns only counts plus the latest command/output preview. The shared server contract is `RuntimeTerminalUiSlotState` in `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`. The web mirror type is `ChatRuntimeTerminalUiSlotState` in `apps/web/src/features/chat/capabilities/chat-capabilities.ts`.

The Composer slot renderer is `apps/web/src/features/chat/composer/composer-slot-states.tsx`. It currently renders usage, goal, plan, progress, user input, quick question, and review slot states. New Composer-specific UI components live under `apps/web/src/features/chat/composer/composer-slots/`. Use static Tailwind classes and the existing `cn()` helper from `~/lib/utils` when combining classes. Use existing design-system conventions and lucide icons for buttons.

## Plan of Work

First, add the server-side contract. In `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`, extend the terminal slot model with a JSON-safe background terminal item. Prefer a small interface named close to the existing feature, such as `RuntimeBackgroundTerminal`, with fields `itemId`, `processId`, `command`, `cwd`, `osPid`, `cpuPercent`, and `rssKb`. Use `number | null` for `rssKb` after normalization at the provider boundary. Add `backgroundTerminals: RuntimeBackgroundTerminal[]` to `RuntimeTerminalUiSlotState`. Also add provider methods to the runtime provider interface near existing session-scoped optional hooks: `listBackgroundTerminals` and `terminateBackgroundTerminal`. These methods should accept the same contextual input pattern as other runtime methods: a resolved `RuntimeSession`, profile, workspace id/path, agent id, model id, and system prompt where the existing helper already supplies them. They should not accept a raw `threadId` from the browser because the provider session binding already owns the native thread identity.

Second, update the HTTP schema and route surface. In `apps/server/src/modules/chat-runtime/model.ts`, add TypeBox schemas for a background terminal item, list response, terminate body or params, and terminate response. In `apps/server/src/modules/chat-runtime/index.ts`, add routes under the existing chat session namespace, for example `GET /chat/sessions/:sessionId/background-terminals` and `POST /chat/sessions/:sessionId/background-terminals/:processId/terminate`. In `apps/server/src/modules/chat-runtime/capabilities-api.ts`, add functions that resolve the current session context, validate that the runtime supports the new provider methods, and return a stable empty list or a 501-style `AppError` consistently with nearby provider-thread and UI-slot helpers. The route should not expose Codex method names.

Third, implement the Codex provider methods. In `apps/server/src/modules/chat-runtime-providers/codex/provider.ts`, reuse the same app-server host acquisition path used by `getUiSlotStates`. Resolve workspace path, runtime context, auth, and skill extra roots the same way this file already does. For listing, call `client.request('thread/backgroundTerminals/list', { threadId: runtimeSession.providerSessionId, limit })` and normalize each returned item. For termination, call `client.request('thread/backgroundTerminals/terminate', { threadId: runtimeSession.providerSessionId, processId })`. If termination succeeds, refresh the slot state by invalidating on the web side; the provider does not need to invent local lifecycle state. If the native response includes `{ terminated: false }`, return that truthfully instead of treating it as a thrown error. Consider calling `thread/backgroundTerminals/clean` only after terminate or list if native behavior leaves dead entries visible; record that decision in this plan before implementing it.

Fourth, thread the background terminal list into the UI slot state. In `apps/server/src/modules/chat-runtime-providers/codex/projection/ui-slot-projector.ts`, add `backgroundTerminals` to the projection input, pass it into `projectCodexTerminalState`, and include it in the returned `RuntimeTerminalUiSlotState`. Keep the existing notification-derived counts so Right Aside and slash command behavior remain useful even when list fails. Update the `codex:terminal` slot definition to include `surfaces: ['slashCommand', 'composerState', 'runtimePanel']` so Composer can see it. Update `apps/server/src/modules/chat-runtime-providers/codex/provider.ts` so `getUiSlotStates` performs the background terminal list request in the existing `Promise.allSettled` batch. If the list request fails, pass `null` and keep the old summary state instead of hiding the whole terminal slot.

Fifth, update web types and data access. In `apps/web/src/features/chat/capabilities/chat-capabilities.ts`, mirror the extended terminal state shape and add two small fetch helpers for list and terminate routes if the Composer action needs direct refresh beyond slot state. Prefer using the slot state's `backgroundTerminals` rows for rendering and call the terminate endpoint only for the button action. Invalidate `runtimeUiSlotStatesQueryKey(sessionId, runtimeKind)` after successful termination so the Composer and Right Aside refresh from the canonical provider state.

Sixth, render the Composer slot. Add `apps/web/src/features/chat/composer/composer-slots/terminal-slot-state.tsx`. The component should receive `ChatRuntimeTerminalUiSlotState`, `sessionId`, and a callback or local mutation for terminate. Render only when `backgroundTerminals.length > 0` or `activeCount > 0`; avoid showing a noisy empty terminal card. Each row should show the command, a compact cwd, pid/process id, CPU, memory, and an icon button with a tooltip or accessible label such as `Terminate background terminal`. Use a terminal icon for the header and a stop/ban/x icon for termination. Do not add user-facing instructional copy. Keep the layout compact because Composer-adjacent UI should not push the transcript too far away.

Seventh, wire the component into `apps/web/src/features/chat/composer/composer-slot-states.tsx`. Import `ChatRuntimeTerminalUiSlotState`, find `state.kind === 'terminal' && composerSlotIds.has(state.slotId)`, and add it to `entryCandidates` with the stable key `terminal:${terminalState.threadId}`. The key should not include `updatedAt` because background-terminal polling can update that timestamp without changing the identity of the Composer slot. If the slot has terminal rows but no active processes, the component may render a brief collapsed summary or return null; choose the least noisy behavior and document the choice in the Decision Log.

Finally, update documentation. In `apps/server/src/modules/chat-runtime/README.md`, mention the new background terminal list/terminate routes and explain that Chat Runtime owns the session-scoped API while Codex owns native terminal lifecycle. In `apps/server/src/modules/chat-runtime-providers/codex/README.md`, mention that `terminal` now uses `thread/backgroundTerminals/list` for live background process details and `thread/backgroundTerminals/terminate` for actions. In `apps/web/src/features/chat/README.md`, mention the Composer terminal slot as a provider-owned runtime UI slot.

## Concrete Steps

Run all commands from the repository root `/Users/wibus/dev/Cradle`.

1. Inspect the relevant files before editing:

    rg -n "RuntimeTerminalUiSlotState|codex:terminal|ComposerSlotStates|backgroundTerminals" apps/server/src apps/web/src

   Expected result: matches in `runtime-provider-types.ts`, `ui-slot-projector.ts`, `composer-slot-states.tsx`, and generated Codex protocol files.

2. Edit the server contracts and schemas:

    apps/server/src/modules/chat-runtime/runtime-provider-types.ts
    apps/server/src/modules/chat-runtime/model.ts
    apps/server/src/modules/chat-runtime/capabilities-api.ts
    apps/server/src/modules/chat-runtime/index.ts

   Keep the route names under `/chat/sessions/:sessionId/` and do not expose `/codex/app-server/invoke` from the Composer path.

3. Implement the Codex provider mapping:

    apps/server/src/modules/chat-runtime-providers/codex/provider.ts
    apps/server/src/modules/chat-runtime-providers/codex/projection/ui-slot-projector.ts

   Reuse generated Codex protocol types when importing response shapes. Normalize `rssKb` before it crosses the HTTP/JSON boundary.

4. Update web state and rendering:

    apps/web/src/features/chat/capabilities/chat-capabilities.ts
    apps/web/src/features/chat/composer/composer-slot-states.tsx
    apps/web/src/features/chat/composer/composer-slots/terminal-slot-state.tsx

   Use static Tailwind classes and `cn()` for conditional classes. Use existing formatting helpers from `apps/web/src/lib/number-format.ts`, such as `formatCpuPercent` and `formatMegabytes`, rather than creating ad hoc formatters.

5. Add or update focused server tests. Start with existing Codex provider tests:

    apps/server/src/modules/chat-runtime-providers/codex/provider.test.ts

   Add coverage that proves a background terminal list is projected into `RuntimeTerminalUiSlotState.backgroundTerminals`, and that `rssKb` is JSON-safe. Add API route coverage in an existing chat-runtime test file if route tests are already nearby; otherwise keep the provider test focused and rely on typecheck for route wiring.

6. Run validation:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/provider.test.ts
    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/web typecheck

   If the focused test path filter is not accepted by Vitest in this workspace, run:

    pnpm --filter @cradle/server test

7. Manually observe the UI only after the code compiles. Start the local app with:

    pnpm dev:fullstack

   Open the web UI, select a Codex chat session that has a long-running background terminal, and confirm the Composer slot shows the process. Click terminate and confirm the row disappears or changes on the next slot-state refresh. Do not add Browser automation unless explicitly requested.

## Validation and Acceptance

The feature is accepted when a Codex chat session with a background terminal shows a Composer-adjacent terminal slot with at least the command, cwd, process id, CPU, and memory for each active terminal. The terminate icon button must call the Cradle session-scoped terminate route and refresh the slot state after success. The user should not see raw Codex method names, JSON-RPC parameters, or implementation language in the UI.

Server acceptance:

- Running `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/provider.test.ts` passes, including a test where a fake Codex app-server client returns a `thread/backgroundTerminals/list` response and the resulting slot state includes normalized background terminal rows.
- Running `pnpm --filter @cradle/server typecheck` passes.
- The server does not throw during JSON serialization when a native terminal item includes `rssKb: 1024n`.

Web acceptance:

- Running `pnpm --filter @cradle/web typecheck` passes.
- In the UI, the terminal slot appears only when a Codex terminal slot has background terminal rows or active terminal state.
- Clicking the terminate button disables or shows pending state for that row, calls the terminate route with the process id, and invalidates runtime slot state after success.

Documentation acceptance:

- The Chat Runtime README explains the new session-scoped background terminal endpoints and the ownership boundary.
- The Codex provider README explains the native app-server methods used.
- The Chat feature README mentions the Composer terminal slot.

## Idempotence and Recovery

The implementation is additive and should be safe to retry. Re-running typecheck and tests has no side effects. Re-running the manual UI observation may terminate a real background process, so only click terminate on a process that is safe to stop. If a terminate call returns `terminated: false`, keep the UI honest by refreshing the list and leaving the row visible if the provider still reports it.

If route design needs to change during implementation, update this ExecPlan first: record the new route shape in the Decision Log, update the Concrete Steps, and keep the old route out of the code rather than carrying compatibility aliases. This repository is not yet constrained by released API compatibility, so prefer a clean route over a compatibility wrapper.

If the Codex native list method fails because the provider target lacks a new app-server capability, keep existing terminal summary behavior working. The UI should render summary state from notifications if available and simply omit detailed process rows. Do not synthesize fake process ids from item ids for termination.

## Artifacts and Notes

Investigation evidence gathered before writing this plan:

    apps/server/src/modules/chat-runtime-providers/codex/app-server/capabilities.ts:53
      thread/backgroundTerminals/clean

    apps/server/src/modules/chat-runtime-providers/codex/app-server/capabilities.ts:54
      thread/backgroundTerminals/list

    apps/server/src/modules/chat-runtime-providers/codex/app-server/capabilities.ts:55
      thread/backgroundTerminals/terminate

    apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2/ThreadBackgroundTerminal.ts:6
      itemId, processId, command, cwd, osPid, cpuPercent, rssKb

    apps/server/src/modules/chat-runtime-providers/codex/projection/ui-slot-projector.ts:452
      missing slot surfaces default to ['runtimePanel']

    apps/web/src/features/chat/composer/composer-slot-states.tsx:84
      Composer currently selects usage, goal, plan, and user input states, but not terminal state.

Expected final route shape, subject to implementation update if the existing route style requires a minor adjustment:

    GET /chat/sessions/:sessionId/background-terminals
      returns { runtimeKind: "codex", terminals: RuntimeBackgroundTerminal[] }

    POST /chat/sessions/:sessionId/background-terminals/:processId/terminate
      returns { runtimeKind: "codex", processId: string, terminated: boolean }

Expected extended terminal slot state:

    RuntimeTerminalUiSlotState {
      kind: 'terminal'
      slotId: string
      threadId: string
      turnId: string | null
      activeCount: number
      completedCount: number
      failedCount: number
      lastCommand: string | null
      lastOutputPreview: string | null
      backgroundTerminals: RuntimeBackgroundTerminal[]
      updatedAt: number
    }

## Interfaces and Dependencies

Use the existing Codex app-server generated protocol as the native dependency. Do not edit files under `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2`; import their types or mirror their structure at the provider boundary only when necessary.

In `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`, define or extend:

    export interface RuntimeBackgroundTerminal {
      itemId: string
      processId: string
      command: string
      cwd: string
      osPid: number | null
      cpuPercent: number | null
      rssKb: number | null
    }

    export interface RuntimeTerminalUiSlotState {
      ...
      backgroundTerminals: RuntimeBackgroundTerminal[]
    }

    export interface ChatRuntimeProvider {
      ...
      listBackgroundTerminals?: (input: ListBackgroundTerminalsInput) => Promise<RuntimeBackgroundTerminalListResult>
      terminateBackgroundTerminal?: (input: TerminateBackgroundTerminalInput) => Promise<RuntimeBackgroundTerminalTerminateResult>
    }

Name the input/result interfaces consistently with nearby provider-thread and context-usage input types in the same file. Use the existing `RuntimeSession`, `RuntimeKind`, profile, workspace path, and model id types rather than introducing `unknown` or local inline helper parsing.

In `apps/server/src/modules/chat-runtime-providers/codex/provider.ts`, the implementation should call:

    client.request('thread/backgroundTerminals/list', {
      threadId: runtimeSession.providerSessionId,
      limit: input.limit ?? 20,
      cursor: input.cursor ?? null
    })

    client.request('thread/backgroundTerminals/terminate', {
      threadId: runtimeSession.providerSessionId,
      processId: input.processId
    })

In `apps/web/src/features/chat/composer/composer-slots/terminal-slot-state.tsx`, the component should expose:

    export function TerminalSlotState(props: {
      state: ChatRuntimeTerminalUiSlotState
      sessionId: string
      runtimeKind?: string
      className?: string
    }): JSX.Element | null

The component may own its TanStack Query mutation if that matches nearby Composer slot patterns. After termination, invalidate the runtime UI slot state query using the existing query key from `apps/web/src/features/chat/capabilities/chat-capabilities.ts`.

Revision note, 2026-06-19 15:19 +0800: Initial ExecPlan created from repository investigation. It defines ownership, file targets, route shape, validation, and recovery rules before implementation begins.

Revision note, 2026-06-19 15:50 +0800: Updated after implementation. Progress now records server/provider/web/docs completion, focused provider validation, the corrected Vitest command, and unrelated repo-wide typecheck blockers.

Revision note, 2026-06-19 16:04 +0800: Updated after final validation. Progress now records passing focused provider tests, passing server typecheck, passing web typecheck, the unrelated validation blockers encountered and cleared, and the stable Composer terminal slot key decision.

Revision note, 2026-06-19 16:07 +0800: Updated after starting the local fullstack dev server. Progress now records the web and server URLs available for manual inspection.

Revision note, 2026-06-19 16:12 +0800: Updated after completion audit. Progress now records the fix to render all background terminal rows, final repeated validation, and the current running web/server endpoints.
