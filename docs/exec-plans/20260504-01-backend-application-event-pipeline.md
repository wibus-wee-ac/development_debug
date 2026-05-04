# Backend Application Layer and Event Pipeline Foundation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. The plan must remain self-contained and updated at each stop point.

## Purpose / Big Picture

The backend currently works but central orchestration is concentrated in `src/main/lib/chat-engine.ts` and cross-domain delegation still relies on direct singleton coupling. After this plan, the main process will gain an explicit application-layer boundary and a reusable domain event pipeline. The user-visible result is unchanged feature behavior for chat and delegated issues, but with a verifiable architecture seam where IPC services become thin adapters and delegated workflow completion is driven by an event bus instead of hidden direct callbacks.

This is intentionally destructive-friendly work because there are no production users. The goal is to reduce architecture debt immediately instead of preserving compatibility layers.

## Progress

- [x] (2026-05-04 05:38Z) Reviewed architecture audit `docs/backend-architecture-overhaul-2026-05-04.md` and sampled high-risk files (`chat-engine.ts`, `kanban.ts`, `issue-agent-runner.ts`, `agent-runtime.ts`).
- [x] (2026-05-04 05:38Z) Confirmed existing coupling and overlap evidence via static scans (`runtime_sessions` low usage; `turn-finished` callbacks wired directly from `ChatEngine` into `IssueAgentRunner`).
- [x] (2026-05-04 11:52Z) Created `src/main/application` and `src/main/events` with README documentation and file headers on all new TS files.
- [x] (2026-05-04 11:52Z) RED: added failing event-bus tests and observed expected module-missing failure before implementation.
- [x] (2026-05-04 11:52Z) RED: added failing issue delegation application tests and observed expected module-missing failure before implementation.
- [x] (2026-05-04 11:52Z) GREEN: implemented `domain-event-bus`, `domain-events`, and `issue-delegation-application` to satisfy new tests.
- [x] (2026-05-04 11:52Z) Integrated `KanbanService` delegation IPC methods with application service boundary while keeping IPC signatures unchanged.
- [x] (2026-05-04 11:52Z) Wired chat turn-finished lifecycle into the new domain event pipeline via composition-root bridge and runner event subscription.
- [x] (2026-05-04 11:52Z) Verified targeted tests, backend typecheck, and full test suite; all passing.
- [x] (2026-05-04 11:52Z) Updated this plan with implementation evidence and retrospective.

## Surprises & Discoveries

- Observation: `runtime_sessions` appears mostly dormant in runtime flow; most active provider session state already lives on `sessions.providerSessionId/providerStateSnapshot`.
  Evidence: `rg -n "runtimeSessions|runtime_sessions" src/main` shows active runtime writes are not central except profile cleanup and schema tests.

- Observation: `ChatEngine` already emits a turn-finished lifecycle callback, which enables incremental event-pipeline adoption without rewriting stream internals first.
  Evidence: `src/main/lib/chat-engine.ts` exposes `onTurnFinished` and invokes subscribers near finalization.

- Observation: directly importing `IssueAgentRunner` in application service top-level caused unit test failures due to Electron-linked transitive imports in non-Electron test runtime.
  Evidence: initial `vitest` failure showed `Named export 'BrowserWindow' not found` while loading transitive main-process modules.

## Decision Log

- Decision: Start with application/event seams around issue delegation before full `ChatEngine` decomposition.
  Rationale: This creates immediate bounded context separation at a lower risk point while still exercising the event pipeline in production code paths.
  Date/Author: 2026-05-04 / Codex

- Decision: Keep this first slice additive and avoid dropping tables in the same patch.
  Rationale: The selected slice requested by the user is architecture seams and orchestration movement; schema collapse can follow once seams are verified by tests.
  Date/Author: 2026-05-04 / Codex

- Decision: Resolve default runner lazily (`require` inside factory helper) instead of top-level import.
  Rationale: It isolates application-layer unit tests from Electron module loading while preserving runtime behavior in main-process composition.
  Date/Author: 2026-05-04 / Codex

## Outcomes & Retrospective

This slice is complete and verified. The backend now has an explicit application layer for issue delegation and an in-process domain event pipeline for chat turn completion.

Delivered outcomes:

- `KanbanService` delegation methods now call `createIssueDelegationApplicationService()` instead of directly invoking legacy lib-level delegation functions.
- `IssueAgentRunner` no longer subscribes directly to `ChatEngine` singleton lifecycle callbacks. It now consumes `chat.turn-finished` from the domain event bus.
- `src/main/index.ts` composition root now wires ChatEngine turn completion into domain events through a bridge helper.
- New test coverage exists for event bus behavior, bridge publication behavior, and issue-delegation application commands.

Remaining architecture debt (intentionally deferred to next slice):

- `ChatEngine` is still a large orchestrator and has not yet been decomposed into dedicated turn orchestration / repository / event publisher components.
- Legacy `src/main/lib/issue-delegation.ts` still exists and should be retired once no callers remain.
- Session model collapse (`sessions` vs `runtime_sessions` vs `agent_sessions`) is out of this slice.

## Context and Orientation

The relevant backend entrypoint is `src/main/index.ts`, which initializes DB and provider catalog, then registers IPC services. IPC services in `src/main/services/` are intended adapters, but `src/main/services/kanban.ts` still owns substantial orchestration including delegation flow control and cross-table side effects.

`src/main/lib/chat-engine.ts` is the largest orchestration unit and owns chat turn lifecycle and persistence. `src/main/lib/issue-agent-runner.ts` currently subscribes directly to `ChatEngine.onTurnFinished`, which means two domains are coupled through a singleton callback relationship rather than through explicit domain events.

In this plan, “application service” means a module that coordinates domain workflows and infrastructure dependencies behind a narrow interface, and “domain event bus” means an in-process publish/subscribe dispatcher with typed event payloads and metadata (event id and timestamp) so handlers can implement idempotent processing.

## Plan of Work

First, create new directories `src/main/events` and `src/main/application` with README files to satisfy repository documentation constraints. Add a typed event definition module and an in-memory event bus implementation with subscribe and publish behavior.

Second, add tests before implementation. The event-bus tests will specify that subscribers receive published events with stable metadata and that unsubscribed handlers no longer receive events. The issue-delegation application tests will specify state transitions: delegating creates a `created` session and system comment; running transitions to `active` through runner call; stopping sets `stopped`; undelegating clears delegation and appends system comment.

Third, implement `IssueDelegationApplicationService` by moving orchestration currently spread across `src/main/services/kanban.ts` and `src/main/lib/issue-delegation.ts` into application layer commands. Keep DB writes transactional where the current behavior requires consistency between issue assignment and session records.

Fourth, integrate IPC service adaptation by changing `KanbanService` delegation methods to call the new application service. Keep method signatures unchanged to avoid renderer breakage.

Fifth, bridge chat lifecycle into event pipeline: from composition root, subscribe to `ChatEngine.onTurnFinished`, publish a domain event, and let issue-delegation runner consume the event bus rather than direct engine callback coupling.

## Concrete Steps

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. Create application and events modules and corresponding tests.
2. Run targeted RED tests to confirm failures:

    pnpm -s vitest run src/main/events/__tests__/domain-event-bus.test.ts src/main/application/__tests__/issue-delegation-application.test.ts

   Expected initially: at least one failing test per new behavior due to missing implementation.

3. Implement minimal code for GREEN and rerun targeted tests:

    pnpm -s vitest run src/main/events/__tests__/domain-event-bus.test.ts src/main/application/__tests__/issue-delegation-application.test.ts src/main/services/__tests__/agent-runtime.test.ts

   Expected: all selected tests pass.

4. Run backend typecheck:

    pnpm -s tsc --noEmit -p tsconfig.node.json

   Expected: no TypeScript errors.

5. If integration touches shared APIs, run full tests:

    pnpm -s vitest run

   Expected: all tests pass.

## Validation and Acceptance

Acceptance is satisfied when the following observable checks succeed:

- New event bus tests fail before implementation and pass after implementation.
- New issue delegation application tests fail before implementation and pass after implementation.
- `KanbanService` delegation IPC methods still expose the same API surface but now delegate to application service.
- Chat turn completion is routed through event bus publishing (observable by unit tests around subscriber path or direct wiring tests).
- `pnpm -s tsc --noEmit -p tsconfig.node.json` passes.

## Idempotence and Recovery

All file edits are additive/refactor-safe and can be rerun. If a partial change breaks tests, revert only the newly introduced application/events files and reapply step-by-step while keeping RED->GREEN order. No irreversible data migration is part of this slice.

## Artifacts and Notes

Captured command evidence:

- RED (event bus) failure:

    pnpm -s vitest run src/main/events/__tests__/domain-event-bus.test.ts
    -> Error: Cannot find module '../domain-event-bus'

- RED (application service) failure:

    pnpm -s vitest run src/main/application/__tests__/issue-delegation-application.test.ts
    -> Error: Cannot find module '/src/main/application/issue-delegation-application'

- GREEN targeted tests:

    pnpm -s vitest run src/main/events/__tests__/domain-event-bus.test.ts src/main/events/__tests__/chat-turn-finished-bridge.test.ts src/main/application/__tests__/issue-delegation-application.test.ts
    -> Test Files 3 passed, Tests 9 passed

- Node typecheck:

    pnpm -s tsc --noEmit -p tsconfig.node.json
    -> pass (no errors)

- Full test suite:

    pnpm -s vitest run
    -> Test Files 30 passed, Tests 147 passed

- Diff summary snapshot:

    git diff --stat
    -> includes `src/main/application/*`, `src/main/events/*`, `src/main/services/kanban.ts`, `src/main/lib/issue-agent-runner.ts`, `src/main/index.ts`

## Interfaces and Dependencies

The implementation will define and use these interfaces and modules.

In `src/main/events/domain-events.ts`, define typed events including at least one `chat.turnFinished` event carrying `chatSessionId`, `messageId`, `status`, `errorText`, `agentProfileId`, and `finishedAt`.

In `src/main/events/domain-event-bus.ts`, define an in-memory bus API similar to:

    export type DomainEventHandler<TEvent extends DomainEvent> = (event: TEvent) => void | Promise<void>
    export interface DomainEventBus {
      publish<TEvent extends DomainEvent>(event: TEvent): Promise<void>
      subscribe<TEvent extends DomainEvent>(type: TEvent['type'], handler: DomainEventHandler<TEvent>): () => void
    }

In `src/main/application/issue-delegation-application.ts`, define an application service exposing commands:

    delegateIssue(input)
    runDelegatedIssue(input)
    stopAgentSession(input)
    undelegateIssue(input)

`src/main/services/kanban.ts` will depend on this service instance rather than directly orchestrating delegation through lower-level lib functions.

`src/main/index.ts` composition root will wire `ChatEngine` completion callback to event bus publish and wire event consumers.

Revision note (2026-05-04 11:52Z): Updated the plan from initial design-only state to implementation-complete state, including RED/GREEN evidence, runtime wiring decisions, and retrospective of delivered vs deferred architecture work.
