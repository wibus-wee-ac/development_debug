# Singleton Elimination + Directory Dehydration + Frontend Projection

> Historical note (2026-05-16): this plan describes an earlier timeline-event / `chat:timeline-event` projection stage. The current chat runtime has since been superseded by `docs/exec-plans/20260516-03-message-snapshot-chat-runtime.md`, where durable history comes from `messages.messageJson` snapshots and live updates stream as sequenced SSE delta events.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. The plan must remain self-contained and updated at each stop point.

## Purpose / Big Picture

Three interlocking architecture changes that shed "Java architect writing TypeScript" patterns in favor of explicit data flow on module functions:

1. **Kill `getInstance()` singletons** — Replace class-based singletons (`ChatEngine.getInstance()`, `PtyManager.getInstance()`, `WindowManager.getInstance()`) with plain module exports or factory functions. ESM already guarantees single-evaluation; abusing class singletons adds ceremony without value.

2. **Directory dehydration** — Flatten the current `features/chat/subscribers/broadcast-subscriber.ts` style deep nesting into `chat/broadcast.ts`. A single-binary Electron app does not benefit from DDD-style `application/infrastructure/domain` layering. Target: `src/main/{context}/service.ts + schema.ts + broadcast.ts`.

3. **Renderer-side TimelineEvent projection** — Stop materializing `UIMessage` JSON in the backend. Stream raw `TimelineEvent` to the renderer (via the new Unified Signal Bridge), let a renderer-side projector build `UIMessage[]` on the fly. Removes the read-modify-write UIMessage JSON from the hot path entirely.

## Context & Dependencies

- **Prerequisite (Done):** Unified Signal Bridge (`src/main/platform/signal-broadcaster.ts`, `src/shared/push-events.ts`, `window.cradle.subscribe`) — completed in the same session as this plan.
- **Prerequisite (Done):** Context-owned directories (`src/main/contexts/kanban/`, `src/main/contexts/issue-agent/`) — established in exec-plan 20260505-02.
- **Affected systems:** ChatEngine, PtyManager, WindowManager, broadcast-subscriber, turn-coordinator, ipc-chat-transport, use-chat-events hooks.

## Scope

### Phase 1: Kill Singletons (mechanical, low risk)

| Current | Target |
|---------|--------|
| `ChatEngine.getInstance()` | `export const chatEngine = createChatEngine(deps)` in composition root |
| `PtyManager.getInstance()` | `export const ptyManager = createPtyManager(deps)` |
| `WindowManager.getInstance()` | `export const windowManager = createWindowManager(deps)` |
| `ThreadSearchEngine.getInstance()` | `export const threadSearch = createThreadSearchEngine(deps)` |

All consumers import form composition root or receive via injection. Tests can create fresh instances without `.destroy()` hacks.

### Phase 2: Directory Dehydration

Target layout (after rename):
```
src/main/
  chat/
    engine.ts           (was features/chat/chat-engine.ts)
    broadcast.ts        (was features/chat/subscribers/broadcast-subscriber.ts)
    turn-coordinator.ts (unchanged logic)
    transport.ts        (was chat-turn-context.ts)
    thread-search.ts
    schema.ts           (if chat owns tables)
  approval/
    service.ts
    broadcast.ts
  pty/
    manager.ts
    schema.ts (none — PTY is stateless)
  agent-runtime/
    service.ts
    providers/
  signal/
    broadcaster.ts      (was platform/signal-broadcaster.ts)
  window/
    manager.ts
    activation.ts
  db/
    schema/
    migrations/
  app/
    main.ts             (composition root)
    ipc/                (IPC adapters — thin, just forward)
```

Key rules:
- Max 2 levels below `src/main/`. No `features/X/subscribers/Y.ts`.
- **Merge "over-split" files:** Prefer a single 500-line `chat/engine.ts` over five 100-line fragments. Co-located data flow > tab-switching archaeology.
- **Delete Interface redundancy:** If an Interface has exactly one implementation (e.g. `KanbanWriteApplicationService` ↔ `DrizzleKanbanWriteStore`), delete the Interface. In TS, the implementing function/class IS the type. Use `typeof service` or `ReturnType<typeof createXxx>` for injection sites.

### Phase 3: Renderer-Side Projection

**Current:** Backend materializes UIMessage JSON per turn → stores in DB → pushes projected chunks to renderer.

**Target:**
1. Backend stores only raw `TimelineEvent[]` per run (already partially done via `backend_timeline_events` table).
2. Push raw events to renderer (already wired via `chat:timeline-event` signal).
3. Renderer builds `UIMessage[]` from the event stream using a pure projector function.
4. On reconnect/reload: renderer fetches `TimelineEvent[]` from DB via IPC, re-projects locally.
5. Remove backend UIMessage projection, remove `messages.content` JSON column (or deprecate).

**Why this works:**
- The event stream IS the source of truth. UIMessage is a view.
- React 19's streaming + Suspense pattern means we can project incrementally without blocking.
- AI SDK's `useChat` already expects a `ReadableStream<UIMessageChunk>` — we can feed projected chunks directly.
- Eliminates the read-modify-write on `messages.content` which currently happens on every tool-call delta.

## Milestones

1. **Phase 1 complete:** All singletons replaced with factory exports. Tests pass without `.destroy()` hacking.
2. **Phase 2 complete:** Directory tree matches the target layout above. All imports updated. Tests + typecheck clean.
3. **Phase 3 POC:** Renderer can render a chat session from raw TimelineEvents without touching `messages.content`.
4. **Phase 3 complete:** Backend no longer materializes UIMessage JSON. `messages.content` is either removed or retained only as a search-indexed text cache.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Phase 1 might break lazy initialization order | Startup crash | Factory deps are explicit; composition root controls order |
| Phase 2 import churn | Merge conflicts | Do in one atomic commit; run `pnpm typecheck && pnpm test` |
| Phase 3 projection correctness | UI regression | Keep old projection path behind a feature flag initially; A/B test rendering output |
| Phase 3 reconnect latency | Large event streams slow on reload | Pagination + DB-side projection as fallback for sessions > 10K events |

## Progress

- [ ] Phase 1: Replace ChatEngine singleton
- [ ] Phase 1: Replace PtyManager singleton
- [ ] Phase 1: Replace WindowManager singleton
- [ ] Phase 1: Replace ThreadSearchEngine singleton
- [ ] Phase 2: Flatten chat/ directory
- [ ] Phase 2: Flatten approval/ directory
- [ ] Phase 2: Flatten platform/ → signal/, window/, pty/ at top level
- [ ] Phase 3: Create renderer-side TimelineEvent projector
- [ ] Phase 3: Wire projector into ipc-chat-transport
- [ ] Phase 3: Remove backend UIMessage materialization
- [ ] Phase 3: Update reconnect flow to fetch raw events

## Surprises & Discoveries

(To be filled during execution)

## Decision Log

- Decision: Write the plan before touching code.
  Rationale: Phases 1 and 2 are mechanical but span many files; Phase 3 is a data-flow redesign. Planning prevents half-baked moves.
  Date: 2026-05-05

- Decision: Phase 3 keeps `backend_timeline_events` schema unchanged.
  Rationale: The table already stores the exact events we need. The change is about where projection happens, not what gets stored.
  Date: 2026-05-05

## Outcomes & Retrospective

(To be filled on completion)
