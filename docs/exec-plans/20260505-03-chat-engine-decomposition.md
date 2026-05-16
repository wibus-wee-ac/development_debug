# Chat Engine Decomposition — From God Object to Pipeline

> Historical note (2026-05-16): this plan captures a pre-snapshot chat architecture centered on timeline events, `UIMessageChunk` projection, and renderer broadcast. The current canonical runtime contract is defined by `docs/exec-plans/20260516-03-message-snapshot-chat-runtime.md`.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. The plan must remain self-contained and updated at each stop point.

## Purpose / Big Picture

The `ChatEngine` class (~960 lines) currently holds too many responsibilities: provider lifecycle management, turn streaming orchestration, in-memory projection, transactional persistence, FTS indexing, renderer broadcast, usage logging, and crash recovery. This makes it a textbook "God Object" — any change to streaming logic, DB schema, search indexing, or broadcast protocol requires opening and modifying the same file.

After this plan:

1. **ChatEngine shrinks to a thin coordinator** (~150 lines) that only wires together independent collaborators.
2. **TurnCoordinator** owns the streaming lifecycle: driving the provider `AsyncGenerator`, handling cancellation/timeout, and emitting `TimelineInputEvent` downstream.
3. **TurnRepository** owns atomic persistence: writing timeline events, message snapshots, and run completion in a single transaction.
4. **Domain Event Bus expansion** — instead of ChatEngine manually calling FTS, usage logging, and broadcasts as imperative side-effects at the end of `runStream`, these become event subscribers that react to published domain events (`chat.timeline-event-persisted`, `chat.turn-finished`, `chat.message-completed`).
5. **Projection unification** — the Projector and TimelineState reducer are unified into a single state-machine fed by `TimelineInputEvent`. The Projector output (UIMessage) is just one view computed from this state machine; the persistence snapshot is the same state serialized differently.

User-visible behavior is unchanged. The verification signal is: same E2E tests pass, same IPC contracts, same renderer behavior — but internally the system is now testable in isolation and extensible by subscription rather than modification.

## Progress

- [x] (2026-05-05 18:30 local) Research complete — architecture mapped and exec plan written.
- [x] (2026-05-05 18:34 local) Milestone 1: Extract TurnCoordinator — implemented `turn-coordinator.ts` as pure async generator, 6 unit tests passing, wired into ChatEngine replacing manual stream loop and `cancelled` flag with `AbortController`.
- [x] (2026-05-05 18:37 local) Milestone 1 validation: 231 unit tests pass, 0 type errors, electron-vite build succeeds, 8 chat E2E scenarios (85 steps) all pass.
- [x] (2026-05-05 18:47 local) Milestone 2: TurnRepository — created `turn-repository.ts` with debounce buffer (150ms batch for delta events, immediate flush for structural events), crash recovery moved from ChatEngine.initialize() to repository.recoverStrandedRuns(). Lazy init pattern for test compatibility.
- [x] (2026-05-05 18:48 local) Milestone 2 validation: 231 tests pass, 0 type errors, 8 E2E scenarios pass.
- [x] (2026-05-05 18:50 local) Milestone 3: Expanded domain events — added `chat.timeline-event-persisted` and `chat.message-completed` event types to domain-events.ts.
- [x] (2026-05-05 18:52 local) Milestone 4 (partial): Created subscriber infrastructure (`subscribers/broadcast-subscriber.ts`, `fts-subscriber.ts`, `usage-subscriber.ts`). Added event publishing to ChatEngine (`chat.timeline-event-persisted` per event, `chat.message-completed` at turn end). Wired event bus in main.ts via `chatEngine.bindEventBus(domainEventBus)`. Inline side-effects preserved for now.
- [x] (2026-05-05 18:53 local) Milestone 4 validation: 231 tests pass, 0 type errors, 8 E2E scenarios pass.
- [ ] Milestone 5: Unify Projector and TimelineState into single state machine.
- [ ] Milestone 6: Shrink ChatEngine to coordinator shell.
- [ ] Final validation: typecheck + unit tests + E2E pass.

## Surprises & Discoveries

_(To be populated during implementation.)_

## Decision Log

- Decision: This is a multi-milestone incremental plan, not a single big-bang rewrite.
  Rationale: Each milestone produces a testable, runnable state. If any milestone fails or needs redesign, the previous state is viable.
  Date/Author: 2026-05-05 / GitHub Copilot

- Decision: Keep the existing `TimelineInputEvent` union as the canonical event model; do NOT introduce a new parallel event type.
  Rationale: The timeline event model is well-defined, covers all streaming primitives, providers already emit it natively, and persistence relies on it. Adding another event layer would duplicate exactly the problem we're trying to solve.
  Date/Author: 2026-05-05 / GitHub Copilot

- Decision: TurnCoordinator will be a pure function factory (not a class) — `createTurnCoordinator(deps)` returns an `AsyncGenerator<TimelineInputEvent>` or a `runTurn()` async function.
  Rationale: Avoids class-based singleton trap. Functional composition is idiomatic TS and testable without a DI container.
  Date/Author: 2026-05-05 / GitHub Copilot

- Decision: Broadcast to renderer is moved entirely to an event subscriber rather than being inlined.
  Rationale: Decouples the "what happened" (timeline event persisted) from "who needs to know" (UI watchers). Enables adding new subscribers (e.g., real-time translation, audit log) without touching the core turn loop.
  Date/Author: 2026-05-05 / GitHub Copilot

- Decision: TurnRepository uses debounced batch persistence for delta events, with force-flush on critical events (run.completed, tool_call completion).
  Rationale: At 30 tokens/sec, individual transactions per delta would hammer SQLite. Batch delta events every 100-200ms, flush on structural boundaries.
  Date/Author: 2026-05-05 / Architecture Review

- Decision: Event bus distinguishes "critical" (sync: broadcast, persist) vs "non-critical" (async: FTS, usage, audit) subscribers. Non-critical subscribers execute via `setImmediate`.
  Rationale: Jieba tokenization in FTSSubscriber would block the event loop if awaited synchronously during the stream.
  Date/Author: 2026-05-05 / Architecture Review

- Decision: TurnStateMachine is scoped to a single turn only. It does NOT hold conversation history — only the current assistant message being constructed.
  Rationale: Prevents linear memory growth in long conversations. History is hydrated from DB when needed, not maintained in the state machine.
  Date/Author: 2026-05-05 / Architecture Review

- Decision: Crash recovery logic moves from ChatCoordinator.initialize() to TurnRepository.recoverStrandedRuns().
  Rationale: Repository owns the data, so it should own the cleanup. ChatCoordinator should not manually scan DB tables.
  Date/Author: 2026-05-05 / Architecture Review

## Outcomes & Retrospective

_(To be populated at completion.)_

## Context and Orientation

### Current Architecture (As-Is)

The chat system lives under `src/main/features/chat/` with these key files:

- `chat-engine.ts` — The God Object. Singleton via `ChatEngine.getInstance()`. Orchestrates everything from provider startup to FTS indexing.
- `chat-turn-projector.ts` — Converts `TimelineInputEvent` into `UIMessage` parts in memory. Used during streaming to project each chunk into the evolving assistant message.
- `chat-turn-persistence.ts` — Transactional DB write helper. Already extracted but still called imperatively from within ChatEngine's loop.
- `chat-turn-context.ts` — Assembles system prompt and history for a turn.
- `thread-search.ts` — FTS5 + jieba search engine. ChatEngine calls it after turn completion.

Supporting infrastructure:

- `src/main/features/backend-control-plane/timeline-events.ts` — Defines `TimelineInputEvent` union, `TimelineState` reducer, and `projectTimelineEventToChatChunks()` which maps timeline events to AI SDK `UIMessageChunk[]`.
- `src/main/events/` — Already has `DomainEventBus`, `ChatTurnFinishedDomainEvent`, and a bridge from ChatEngine's `onTurnFinished` callback.
- `src/main/app/main.ts` — Composition root. Creates ChatEngine singleton, wires event bus, registers IPC services.

### The Core Problem: Duplicated State Transition Logic

The same "stream delta → update state" logic exists in three forms:

1. **`reduceTimelineState()`** in timeline-events.ts — Pure reducer that builds `TimelineState` from events.
2. **`applyTimelineEventToChatTurn()`** in chat-turn-projector.ts — Builds `UIMessage` parts (text/reasoning/tool) from the same events.
3. **`projectTimelineEventToChatChunks()`** in timeline-events.ts — Maps events to `UIMessageChunk[]` for the renderer transport.

These three are conceptually the same operation with different output shapes. If a new event type (e.g., `file.created`, `thinking.step`) is added, all three must be updated in lockstep.

### The Core Problem: Imperative Side-Effects in the Loop

ChatEngine's `runStream` method does this inline:

    for await (event of provider.streamTurn(...)) {
      project(event)          // update in-memory UIMessage
      persist(event)          // DB transaction
      broadcast(event)        // IPC push to renderer
    }
    // after loop:
    indexFTS(message)         // search
    logUsage(provider.lastUsage)  // cost tracking
    notifySubscribers()       // turn-finished callbacks

Every subscriber is hardcoded. To add a new reaction (e.g., "log to audit trail"), you must edit ChatEngine. This violates the Open/Closed Principle.

### Target Architecture (To-Be)

    ┌─────────────────────────────────────────────────────────────┐
    │                     ChatCoordinator                          │
    │  (thin shell: prepareTurn → TurnCoordinator → finalize)     │
    └──────┬──────────────────────────────────────────────────────┘
           │ creates
           v
    ┌─────────────────────────────────────────────────────────────┐
    │                     TurnCoordinator                          │
    │  - Drives provider.streamTurn() AsyncGenerator              │
    │  - Handles cancellation, timeout, error serialization       │
    │  - Yields TimelineInputEvent stream                         │
    │  - NO DB, NO broadcast, NO search                           │
    └──────┬──────────────────────────────────────────────────────┘
           │ each event
           v
    ┌─────────────────────────────────────────────────────────────┐
    │             TurnPipeline (event processing)                  │
    │  For each TimelineInputEvent:                                │
    │    1. stateMachine.apply(event) → updated TurnState          │
    │    2. TurnRepository.persist(event, snapshot)                │
    │    3. eventBus.publish('chat.timeline-event-persisted')      │
    └──────┬──────────────────────────────────────────────────────┘
           │ domain events
           v
    ┌─────────────────────────────────────────────────────────────┐
    │                    Event Subscribers                          │
    │  - BroadcastSubscriber → push to renderer WebContents       │
    │  - FTSSubscriber → index on turn-finished (status=complete) │
    │  - UsageSubscriber → log tokens on turn-finished            │
    │  - (future) AuditSubscriber, TranslationSubscriber, etc.    │
    └─────────────────────────────────────────────────────────────┘

### Key Design Principles

1. **Single state machine** — `TurnStateMachine` replaces both `ChatTurnProjector` and `reduceTimelineState`. It holds the canonical turn state. Views (UIMessage, UIMessageChunk[], TimelineState) are derived from it.

2. **Event-driven side-effects** — After each event is persisted, a domain event is published. Subscribers react independently.

3. **No hidden singletons in the domain** — TurnCoordinator receives its dependencies via arguments, not via `getDb()` / `getProviderCatalog()`. The composition root (main.ts) wires everything.

4. **Explicit concurrency boundary** — The `drafts` Map becomes a proper per-session lock with clear semantics, rather than relying on "JS is single-threaded" comments.

## Plan of Work

### Milestone 1: Extract TurnCoordinator

Create `src/main/features/chat/turn-coordinator.ts`. Move the streaming loop logic out of ChatEngine:

- Accept injected `provider.streamTurn(...)` params
- Drive the AsyncGenerator
- Handle cancellation semantics (checking `draft.cancelled`)
- Serialize errors into `SerializedChatError`
- Return a final status (`complete` | `aborted` | `failed`) and optional error text
- Yield `TimelineInputEvent` for each provider event, plus synthetic `run.started` / `run.completed|aborted|failed` bookend events

The TurnCoordinator does NOT:
- Access the database
- Project UIMessage parts
- Broadcast to renderer
- Know about FTS or usage logging

Testing: unit test TurnCoordinator with a mock provider that yields a known event sequence. Assert correct event ordering and cancellation behavior.

### Milestone 2: Consolidate TurnRepository

`chat-turn-persistence.ts` already exists but is scoped narrowly. Broaden it to be the single write-path:

- Rename/restructure to `turn-repository.ts`
- Accept `TurnState` (the unified state machine output) alongside the event
- Ensure the transaction also derives the `UIMessage` JSON from the state machine rather than receiving it pre-serialized
- Expose a `finalize()` method for terminal events (run.completed/aborted/failed) that also marks the run and message rows

### Milestone 3: Expand Domain Events

Add new event types to `src/main/events/domain-events.ts`:

    chat.timeline-event-persisted  — fired after each event is committed to DB
    chat.message-completed         — fired when assistant message reaches terminal status

The existing `chat.turn-finished` stays but becomes a consumer of `chat.message-completed` (or is unified with it).

### Milestone 4: Convert Side-Effects to Subscribers

Create subscriber files under `src/main/features/chat/subscribers/`:

- `broadcast-subscriber.ts` — listens to `chat.timeline-event-persisted`, pushes to session watchers + global subscribers
- `fts-subscriber.ts` — listens to `chat.turn-finished` (status=complete), indexes the message
- `usage-subscriber.ts` — listens to `chat.turn-finished`, persists token usage

Wire them in `src/main/app/main.ts` composition root.

### Milestone 5: Unify State Machine

Create `src/main/features/chat/turn-state-machine.ts`:

- Absorbs logic from `ChatTurnProjector.applyProjectedChunks` and `reduceTimelineState`
- Maintains a single `TurnState` that includes:
  - `uiMessage: UIMessage` (the projected assistant message)
  - `timelineState: TimelineState` (run status, text accumulators, commands, approvals)
  - `chunks: UIMessageChunk[]` (transient per-event output for broadcast)
- Single `apply(event: TimelineInputEvent)` method that updates all views atomically

Delete `chat-turn-projector.ts` after migration. The `projectTimelineEventToChatChunks` function in timeline-events.ts can remain as a utility but the Projector abstraction is eliminated.

### Milestone 6: Shrink ChatEngine → ChatCoordinator

Rename or rewrite `chat-engine.ts` to `chat-coordinator.ts` (~150 lines):

- `createAndSend` / `send` — prepare turn, create TurnCoordinator, wire pipeline, fire & forget
- `abort` — signal cancellation to TurnCoordinator
- `getMessages` — delegated to a read-query helper
- Session watcher management stays here (it's IPC plumbing, not domain logic)
- All singleton access (`getDb`, `getProviderCatalog`) is injected via constructor or factory deps

The IPC adapter (`ChatService`) continues to delegate to this coordinator.

## Concrete Steps

All commands run from repository root: `/Users/wibus/dev/Cradle`

### Step 1: Create TurnCoordinator

Create file: `src/main/features/chat/turn-coordinator.ts`

    pnpm exec vitest run src/main/features/chat/__tests__/turn-coordinator.test.ts

Expected: new tests written TDD-style. Initially fail, then pass after implementation.

### Step 2: Refactor TurnRepository

Edit: `src/main/features/chat/chat-turn-persistence.ts` → rename to `turn-repository.ts`

    pnpm typecheck
    pnpm test

### Step 3: Add domain events

Edit: `src/main/events/domain-events.ts`

    pnpm typecheck

### Step 4: Create subscribers

Create files under `src/main/features/chat/subscribers/`

    pnpm test
    pnpm typecheck

### Step 5: Create TurnStateMachine

Create: `src/main/features/chat/turn-state-machine.ts`
Delete: `src/main/features/chat/chat-turn-projector.ts` (after all references migrated)

    pnpm test
    pnpm typecheck

### Step 6: Rewrite ChatEngine

Edit: `src/main/features/chat/chat-engine.ts` → slim to coordinator

    pnpm test
    pnpm typecheck
    pnpm build

### Final validation:

    pnpm test
    pnpm typecheck
    pnpm build
    pnpm exec cucumber-js --config e2e/cucumber.mjs --tags '@CRADLE-CHAT-003 or @CRADLE-CHAT-004 or @CRADLE-CHAT-005 or @CRADLE-CHAT-006 or @CRADLE-CHAT-007 or @CRADLE-CHAT-008 or @CRADLE-CHAT-009 or @CRADLE-CHAT-010'

## Validation and Acceptance

1. **Unit tests**: TurnCoordinator can be tested without DB or Electron imports. Feed it a mock provider, assert correct event stream.
2. **Integration**: TurnRepository writes are verified with Drizzle's in-memory SQLite (vitest).
3. **Typecheck**: `pnpm typecheck` passes with zero errors.
4. **Build**: `pnpm build` produces electron bundle without warnings.
5. **E2E**: Chat scenarios (send message, receive streaming response, abort, error handling) all pass unchanged.
6. **Extensibility proof**: adding a new subscriber (e.g. `audit-log-subscriber.ts`) requires zero changes to ChatCoordinator or TurnCoordinator — only a new file + composition root wiring.

## Idempotence and Recovery

Each milestone is independently runnable and leaves the codebase in a passing state. If a milestone fails mid-way:
- Milestone 1-4: new files are additive; ChatEngine still works untouched until Milestone 6.
- Milestone 5: the old projector is kept alive until all consumers are migrated.
- Milestone 6: can be done as a git branch swap — the old ChatEngine continues working if this step is reverted.

Safe to run `pnpm test && pnpm typecheck && pnpm build` after every milestone to confirm green state.

## Artifacts and Notes

### Current ChatEngine responsibilities decomposed:

| Responsibility | Current Owner | Target Owner |
|---|---|---|
| Turn streaming loop | ChatEngine.runStream | TurnCoordinator |
| Cancellation | ChatEngine.abort | TurnCoordinator.cancel() |
| UIMessage projection | ChatTurnProjector | TurnStateMachine |
| Timeline state | reduceTimelineState | TurnStateMachine |
| DB persistence | ChatEngine → persistProjectedTimelineEvent | TurnRepository |
| Renderer broadcast | ChatEngine.broadcastSession | BroadcastSubscriber |
| FTS indexing | ChatEngine (post-loop) | FTSSubscriber |
| Usage logging | ChatEngine (post-loop) | UsageSubscriber |
| Crash recovery | ChatEngine.initialize | ChatCoordinator.initialize (stays) |
| Session watcher mgmt | ChatEngine.watchSession | ChatCoordinator (stays, it's IPC plumbing) |
| Provider selection | ChatEngine.getChatProvider | ChatCoordinator (stays, it's composition) |
| Turn-finished callbacks | ChatEngine.turnFinishedSubscribers | Removed — replaced by domain event |

### Domain Event Flow (Post-Refactor):

    Provider.streamTurn()
        → TurnCoordinator yields TimelineInputEvent
            → TurnStateMachine.apply(event) updates TurnState
                → TurnRepository.persist(event, state.uiMessage)
                    → eventBus.publish('chat.timeline-event-persisted', { event, chunks, chatSessionId, messageId })
                        → BroadcastSubscriber pushes to renderer
            (on terminal event)
                → eventBus.publish('chat.turn-finished', { status, chatSessionId, ... })
                    → FTSSubscriber indexes message
                    → UsageSubscriber logs tokens
                    → IssueAgentRunner reacts to delegation completion

## Interfaces and Dependencies

### TurnCoordinator (`src/main/features/chat/turn-coordinator.ts`)

    interface TurnCoordinatorDeps {
      provider: ChatRuntimeProvider
      profile: AgentProfile
      runtimeSession: RuntimeSession
      message: string
      modelId?: string
      thinkingEffort?: 'low' | 'medium' | 'high'
      systemPrompt?: string
      history?: CoreMessage[]
      signal: AbortSignal  // cancellation
    }

    async function* coordinateTurn(deps: TurnCoordinatorDeps): AsyncGenerator<TimelineInputEvent>

### TurnStateMachine (`src/main/features/chat/turn-state-machine.ts`)

    interface TurnState {
      uiMessage: UIMessage
      timeline: TimelineState
      lastChunks: UIMessageChunk[]  // transient: from most recent event
    }

    interface TurnStateMachine {
      state: TurnState
      apply(event: TimelineInputEvent): UIMessageChunk[]  // returns chunks for broadcast
    }

    function createTurnStateMachine(initialMessage: UIMessage): TurnStateMachine

### TurnRepository (`src/main/features/chat/turn-repository.ts`)

    interface TurnRepositoryDeps {
      db: () => DrizzleDB
    }

    interface TurnRepository {
      persistEvent(input: PersistEventInput): BackendTimelineEvent
      finalize(input: FinalizeInput): void
    }

    function createTurnRepository(deps: TurnRepositoryDeps): TurnRepository

### New Domain Events (`src/main/events/domain-events.ts`)

    interface ChatTimelineEventPersistedPayload {
      chatSessionId: string
      messageId: string
      runId: string
      event: BackendTimelineEvent
      chunks: UIMessageChunk[]
    }

    type ChatTimelineEventPersistedDomainEvent = DomainEventBase<'chat.timeline-event-persisted', ChatTimelineEventPersistedPayload>

    interface ChatMessageCompletedPayload {
      chatSessionId: string
      messageId: string
      status: 'complete' | 'aborted' | 'failed'
      errorText: string | null
      uiMessageJson: string
    }

    type ChatMessageCompletedDomainEvent = DomainEventBase<'chat.message-completed', ChatMessageCompletedPayload>

### BroadcastSubscriber (`src/main/features/chat/subscribers/broadcast-subscriber.ts`)

    interface BroadcastSubscriberDeps {
      sessionWatchers: Map<string, Map<WebContents, number>>
      globalSubscribers: Set<WebContents>
    }

    function createBroadcastSubscriber(deps: BroadcastSubscriberDeps, eventBus: DomainEventBus): () => void

---

_Revision: Initial plan drafted 2026-05-05. Based on full architecture exploration of ChatEngine, timeline events, projector, persistence, and event bus._
