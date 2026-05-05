# Normalized Activity Timeline and Chat Projection

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. It assumes the control-plane foundation described in `docs/exec-plans/20260505-06-backend-control-plane-schema.md` has landed or is implemented together with this slice.

## Purpose / Big Picture

Cradle currently lets transport shape leak into product truth. `ResponseStreamEvent` is still the thing chat and renderer pathways understand, which means backend wire protocols get flattened into product behavior too early. That is the architectural mistake this plan fixes.

This slice is intentionally breaking. It does not preserve a compatibility lane where raw backend transport remains a valid core contract. After this plan, backend-specific raw events exist only at adapter edges. Cradle core owns typed timeline facts, persists them as an append-only activity ledger, derives product state through reducers, and serves chat/devtool/approval surfaces through projections. Chat continues to work, but only as a projection over the canonical timeline. If a path still depends on raw transport when this slice ends, the slice is not complete.

## Progress

- [x] (2026-05-05 07:24Z) Reviewed `src/main/features/chat/chat-provider.ts`, `src/shared/chat-events.ts`, and the current `ResponseStreamEvent` push path.
- [x] (2026-05-05 07:24Z) Confirmed that current domain events model only `chat.turn-finished` and do not represent in-flight activity.
- [x] (2026-05-05 08:33Z) Reframed this plan as a breaking rewrite: no compatibility channel, no transport-shaped core contract, and no class-hierarchy runtime abstraction.
- [ ] Add failing tests for typed timeline events, reducers, projections, runtime validation, and backend-specific mappers.
- [ ] Implement append-only typed timeline persistence plus runtime schemas for external event parsing.
- [ ] Rewrite `ChatEngine` to consume backend mappers and emit only normalized timeline facts plus projections.
- [ ] Remove raw transport contracts from core/shared renderer paths and keep chat + devtool behavior green through projections and E2E coverage.

## Surprises & Discoveries

- Observation: the shared chat event type is still raw `ResponseStreamEvent`.
  Evidence: `src/shared/chat-events.ts` exports `ChatResponseEventPayload` with `event: ResponseStreamEvent`, which binds the renderer-facing contract directly to one transport family.

- Observation: `ChatProvider` is transport-shaped, not product-shaped.
  Evidence: `src/main/features/chat/chat-provider.ts` defines `stream(): AsyncGenerator<ResponseStreamEvent>`, which is valid at the adapter boundary but wrong as the app's canonical activity model.

- Observation: backend lifecycles already differ enough that a single OO runtime hierarchy would be fake abstraction.
  Evidence: the current repository simultaneously targets OpenAI-style streaming, ACP process-backed protocols, and future Codex/Claude-style event families. Those streams do not share one honest superclass lifecycle; they share only the need to be mapped into product-owned facts.

- Observation: the existing event bridge pattern already favors append-only facts over mutable runtime objects.
  Evidence: `src/main/events/domain-events.ts` and `src/main/events/chat-turn-finished-bridge.ts` already turn callbacks into Cradle-owned event records, which matches reducer/projection architecture better than service-manager object graphs.

## Decision Log

- Decision: raw transport types are forbidden outside backend adapter boundaries once this slice lands.
  Rationale: transport is not product truth. Keeping `ResponseStreamEvent` in shared/core contracts would preserve the architecture bug this plan exists to remove.
  Date/Author: 2026-05-05 / Copilot

- Decision: the canonical activity model is a discriminated-union timeline event domain plus pure reducers and projections.
  Rationale: data should be data, behavior should be functions, and state changes should flow from append-only facts. This avoids Java-style abstract runtime hierarchies and stringly typed DTO shells.
  Date/Author: 2026-05-05 / Copilot

- Decision: there is no compatibility projection path in core for this slice.
  Rationale: the repository explicitly prefers breaking cleanup over compatibility scaffolding. Chat and devtool must switch to projections in the same architectural move.
  Date/Author: 2026-05-05 / Copilot

- Decision: capabilities, not backend names, drive renderer and workflow behavior.
  Rationale: the UI should react to what a backend can do, not branch forever on `backendKind === ...` checks leaking out of adapter code.
  Date/Author: 2026-05-05 / Copilot

- Decision: backend-specific mappers live with backend owners, not in the timeline core.
  Rationale: Cradle's ownership rule says backend quirks belong at adapter boundaries. The timeline core should not accumulate Codex/Claude/ACP/OpenAI-compatible switch statements.
  Date/Author: 2026-05-05 / Copilot

## Outcomes & Retrospective

Not started yet. When implementation lands, update this section with which typed timeline event families were introduced, which raw transport contracts were deleted, and whether any backend-specific metadata remained intentionally exposed through controlled projections.

## Context and Orientation

`src/main/features/chat/chat-provider.ts` currently defines a transport contract that yields `ResponseStreamEvent`. That is acceptable only at the edge where Cradle talks to a backend. Once an event crosses into Cradle core, it should already have been parsed and mapped into a typed product fact.

The term “timeline” in this plan means an append-only ledger of typed activity facts for one run. A timeline event is not a backend SDK object and not a rendered chat bubble. It is a Cradle-owned fact with stable identity, sequence ordering, schema version, event type, and typed payload.

The term “reducer” means a pure function that turns prior timeline-derived state plus one event into the next product state. The term “projection” means a pure function that turns timeline facts or reduced state into one downstream shape such as chat bubbles, devtool rows, or approval queue items.

The control-plane foundation from plan 06 introduces bindings and runs. This plan builds directly on those concepts. Every normalized timeline event belongs to exactly one `backendRun` record, and every user-facing activity surface must consume projections derived from those timeline events rather than raw backend transport.

## Plan of Work

Start by defining the canonical typed timeline domain under the backend control-plane owner. Create a small, explicit event vocabulary with discriminated unions rather than a generic `kind/status/payloadJson` shell. Use runtime schemas at the boundary because backend streams are external input; TypeScript types alone are not enough. Prefer the repository's chosen schema library if one already exists. If none exists, add one lightweight runtime schema tool in this slice rather than pretending transport decoding is compile-time only.

Next, add append-only persistence for timeline facts. Extend `src/main/db/schema/backend-control-plane.ts` with `backendTimelineEvents`, but treat the database row as a persistence encoding of typed events, not as the domain model itself. Store a stable event `type`, schema version, sequence number, run ownership, source metadata, and encoded payload. Do not design the core API around untyped JSON bags.

Then implement backend-specific mappers beside the backend owners. Each adapter family maps its own raw transport into Cradle timeline events. OpenAI-compatible adapters may share mapper helpers where the transport is genuinely the same, but Codex/Claude/ACP differences belong there, not in core reducers. The core should never branch on backend raw event names once mapping is complete.

After mappers exist, rewrite `src/main/features/chat/chat-engine.ts` so the runtime flow is:

- receive raw backend event at the adapter edge
- decode and map into one or more typed timeline events
- append timeline facts to storage
- feed reducers/projections
- publish projected chat/devtool/approval updates

At that point, raw transport must disappear from core/shared renderer contracts. `src/shared/chat-events.ts` should carry projection payloads or be replaced entirely. The renderer should consume chat projection updates and capability-driven projections, never provider-native event shapes.

Finally, expose the same canonical facts to developer tooling and approval flows. Devtools should inspect timeline projections directly. Approval surfaces should read approval projections derived from timeline facts and capability metadata, not special-case backend callbacks.

## Concrete Steps

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. Write the failing tests first.

   Add timeline-domain tests under the backend control-plane owner, for example:

   - `src/main/features/backend-control-plane/__tests__/timeline-events.test.ts`
   - `src/main/features/backend-control-plane/__tests__/timeline-reducer.test.ts`
   - `src/main/features/backend-control-plane/__tests__/timeline-projections.test.ts`

   Cover these behaviors:

   - assistant text start/delta/completion become typed timeline facts
   - reasoning activity is preserved as non-chat activity
   - command/tool lifecycle becomes explicit started/delta/completed facts
   - approval requests and resolutions become explicit typed events
   - run completion and failure become typed facts, not implicit side effects

   Add backend-owner mapper tests next to each real backend family involved in this slice. At minimum, cover one OpenAI-style event stream and one structurally different backend family so the design does not silently overfit one transport.

   Add projection tests such as `src/main/features/chat/__tests__/timeline-chat-projection.test.ts` to prove chat output still matches expected product behavior when driven only from timeline facts.

   Add a schema/storage test, for example `src/main/db/__tests__/backend-timeline-schema.test.ts`, to assert append-only ordering and run ownership.

   Add or extend E2E coverage for the user-visible guarantee: the first chat turn still renders correctly after raw transport is removed from core.

2. Verify RED.

       pnpm -s vitest run src/main/features/backend-control-plane/__tests__/timeline-events.test.ts src/main/features/backend-control-plane/__tests__/timeline-reducer.test.ts src/main/features/chat/__tests__/timeline-chat-projection.test.ts src/main/db/__tests__/backend-timeline-schema.test.ts

   Expected result before implementation: failures point to missing event types, reducers, projections, or mapper modules rather than typo-level problems.

3. Implement the typed timeline domain and runtime schemas.

   Add or update files under the backend control-plane owner, for example:

   - `src/main/features/backend-control-plane/timeline/events.ts`
   - `src/main/features/backend-control-plane/timeline/schemas.ts`
   - `src/main/features/backend-control-plane/timeline/reduce.ts`
   - `src/main/features/backend-control-plane/timeline/project-chat.ts`
   - `src/main/features/backend-control-plane/timeline/project-activity.ts`
   - `src/main/db/schema/backend-control-plane.ts`

   The domain model must be explicit. A representative shape is:

       type TimelineEvent =
         | { type: 'run.started'; id: TimelineEventId; sessionId: SessionId; runId: RunId; sequence: number; at: IsoTime; source: TimelineSource }
         | { type: 'assistant.text.delta'; id: TimelineEventId; sessionId: SessionId; runId: RunId; itemId: ItemId; sequence: number; delta: string; at: IsoTime; source: TimelineSource }
         | { type: 'command.started'; id: TimelineEventId; sessionId: SessionId; runId: RunId; itemId: ItemId; sequence: number; command: CommandInfo; at: IsoTime; source: TimelineSource }
         | { type: 'command.output.delta'; id: TimelineEventId; sessionId: SessionId; runId: RunId; itemId: ItemId; sequence: number; stream: 'stdout' | 'stderr'; delta: string; at: IsoTime; source: TimelineSource }
         | { type: 'approval.requested'; id: TimelineEventId; sessionId: SessionId; runId: RunId; sequence: number; approval: ApprovalRequest; at: IsoTime; source: TimelineSource }
         | { type: 'approval.resolved'; id: TimelineEventId; sessionId: SessionId; runId: RunId; sequence: number; approvalId: ApprovalId; decision: ApprovalDecision; at: IsoTime; source: TimelineSource }
         | { type: 'run.completed'; id: TimelineEventId; sessionId: SessionId; runId: RunId; sequence: number; at: IsoTime; source: TimelineSource }
         | { type: 'run.failed'; id: TimelineEventId; sessionId: SessionId; runId: RunId; sequence: number; error: AgentError; at: IsoTime; source: TimelineSource }

   Use discriminated unions and exhaustive switches. Do not introduce abstract base classes for runtime behavior.

4. Implement backend-specific mapper boundaries.

   For each backend owner participating in this slice, add mapper modules beside the adapter code, for example `map-events.ts` files under the owning backend directory. Each mapper should convert one raw backend event into `TimelineEvent[]` and keep source/backend metadata explicit.

   The important rule is architectural, not path-specific: backend-specific raw event handling stays with the backend owner. The timeline core receives only typed facts.

5. Rewrite `ChatEngine` and shared contracts as projections-only paths.

   Update:

   - `src/main/features/chat/chat-engine.ts`
   - `src/shared/chat-events.ts` or its replacement
   - any preload or renderer bridge still carrying raw transport objects

   At the end of this step:

   - `ChatEngine` no longer fans out raw backend transport
   - chat output is produced from timeline projection functions
   - devtool output is produced from timeline projection functions
   - approvals read projected approval state, not backend callbacks

   If a shared contract still exposes `ResponseStreamEvent`, the slice is incomplete.

6. Run GREEN and broader verification.

       pnpm -s vitest run src/main/features/backend-control-plane/__tests__/timeline-events.test.ts src/main/features/backend-control-plane/__tests__/timeline-reducer.test.ts src/main/features/chat/__tests__/timeline-chat-projection.test.ts src/main/db/__tests__/backend-timeline-schema.test.ts
       pnpm -s tsc --noEmit -p tsconfig.node.json --composite false
       pnpm -s vitest run src/main
       pnpm -s build

   Add targeted E2E verification for the breaking rewrite, for example a chat scenario that proves the first turn still renders and a devtool/inspection path can see non-chat activity after raw transport disappears from core.

## Validation and Acceptance

This plan is complete when all of the following are true.

No core/shared renderer contract exposes raw backend transport types such as `ResponseStreamEvent`.

Timeline event tests prove that backend input becomes typed Cradle-owned facts validated at runtime.

Reducer tests prove that product state is derived from append-only timeline facts rather than mutated runtime objects.

Projection tests prove that chat and activity/devtool surfaces remain correct when driven exclusively from timeline facts.

Storage tests prove timeline rows are append-only, ordered, and bound to one run.

Targeted E2E proves that a real first-turn chat flow still works after the rewrite and that non-chat activity remains inspectable through projections.

`pnpm -s tsc --noEmit -p tsconfig.node.json --composite false`, `pnpm -s vitest run src/main`, and `pnpm -s build` all pass.

## Idempotence and Recovery

This slice is destructive by design, but the rollback rule is still simple: revert the rewrite rather than layering compatibility scaffolding on top of it. If the new projection path fails, fix the mapper/reducer/projection chain and rerun against disposable data. Do not reintroduce raw transport as canonical truth just to get a temporary green build.

## Artifacts and Notes

Capture concise artifacts during implementation:

- the first RED failure for missing typed timeline modules
- the first GREEN pass for reducer/projection tests
- one short transcript showing a raw backend event sequence mapped into normalized timeline facts
- one targeted E2E pass proving chat still renders after raw transport leaves core

A good artifact looks like this:

    raw event                  mapped timeline facts
    response.created           run.started
    response.output_item.added assistant.text.started
    response.output_text.delta assistant.text.delta
    tool.call.started          command.started
    tool.call.delta            command.output.delta
    tool.call.completed        command.completed
    response.completed         run.completed

## Interfaces and Dependencies

At the end of the slice, the codebase must expose three distinct layers:

1. Backend mapper inputs/outputs at the adapter boundary.
2. Typed timeline facts, reducers, and projections in the control-plane owner.
3. Projection payloads for renderer/devtool consumers.

Representative interfaces:

    type AgentBackendPort = {
      readonly id: BackendId
      readonly kind: BackendKind
      readonly capabilities: BackendCapabilities

      start(input: StartRunInput): AsyncIterable<unknown>
      respond(input: BackendApprovalResponse): Promise<void>
      cancel(input: CancelRunInput): Promise<void>
    }

    function mapBackendEvent(raw: unknown, ctx: MappingContext): TimelineEvent[]

    function reduceTimeline(state: TimelineState, event: TimelineEvent): TimelineState

    function projectChat(state: TimelineState): ChatProjection

The important constraint is not the exact filename but the ownership boundary:

- backend-specific raw handling stays with backend owners
- typed timeline facts/reducers/projections live under the backend control-plane owner
- renderer contracts consume projections only

Do not build an abstract runtime class hierarchy. Do not centralize backend-specific switch statements in core. Do not add compatibility-only code paths.

Revision note (2026-05-05 08:33Z): Rewritten from a compatibility-minded normalization plan into a breaking, event-first architecture plan. The canonical model is now explicitly typed timeline facts plus reducers/projections, not raw transport with a sidecar projection layer.
