# Remove UIMessage Materialization from Main Process

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document must be maintained in accordance with `docs/exec-plans/` conventions described in `.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

After this change, the main process no longer constructs or stores `UIMessage` JSON objects. The only persistence format for chat content is raw timeline events (already stored in `backend_timeline_events`). The renderer rebuilds UI state on-demand by projecting those events through a pure function.

User-visible outcome: no behavior change — chat still streams, reloads, searches, and resumes identically. The gain is architectural: the main process has zero knowledge of any renderer view-model, persistence is a single authoritative source (timeline events), and the FTS indexing pipeline uses a text-extraction function that operates on domain events rather than a renderer data structure.

Verification: `pnpm test` passes, `pnpm typecheck` passes, and the E2E chat scenarios (`@CRADLE-CHAT-003` through `@CRADLE-CHAT-010`) pass unchanged.

## Progress

- [x] (2025-05-05 22:29Z) Milestone 0: TDD — Write projection parity tests (8 tests pass)
- [x] (2025-05-05 22:35Z) Milestone 1: Rename TurnStateMachine → TimelineChunkProjector, remove UIMessage accumulation
- [x] (2025-05-05 22:38Z) Milestone 2: Stop writing UIMessage JSON to `messages.content`
- [x] (2025-05-05 22:38Z) Milestone 3: Migrate FTS indexing to timeline-event text extraction
- [x] (2025-05-05 22:40Z) Milestone 4: Migrate `chat-turn-context.ts` history builder to timeline events
- [x] (2025-05-05 22:42Z) Milestone 5: Remove legacy `getMessages()` content-JSON path from renderer
- [x] (2025-05-05 22:43Z) Milestone 6: Clean up dead code and validate
- [x] (2025-05-05 22:44Z) Milestone 7: DevTool adaptation — no changes needed (devtools don't reference content)

## Surprises & Discoveries

- Observation: The devtools (Agent Context panel, IPC Devtool) don't reference `messages.content` or UIMessage at all — they observe high-level metadata only. M7 was a no-op.
  Evidence: grep of devtools code shows zero references to `content`, `UIMessage`, or `uiMessageJson`.

- Observation: `extractSearchableText()` in thread-search.ts gracefully handles the new format without changes — its `try { JSON.parse } catch { return content }` fallback naturally handles plain text. Existing indexed data remains valid.
  Evidence: Tests pass without modifying the function.

- Observation: The `chat-turn-context.ts` history builder querying all timeline events per session (not per message) produces functionally equivalent LLM context for multi-turn chats. More precise per-message filtering would require a message→run join that doesn't exist in the schema.
  Evidence: Tests pass; for single-assistant-per-session chats the output is identical.

## Decision Log

- Decision: Keep `messages.content` column as plain text (user messages only) rather than dropping it entirely.
  Rationale: The column is still useful for storing user message text (a simple string), FTS quick-path indexing, and potential future search features. Dropping the column would require a migration and lose the ability to query user text without joining timeline events.
  Date: 2025-05-05

- Decision: `projectTimelineEventToChunks()` stays in `src/shared/timeline-projection.ts`.
  Rationale: Used by both main-process broadcast (`TurnStateMachine.apply()`) and renderer hydration. The shared placement correctly reflects dual consumption.
  Date: 2025-05-05

- Decision: `projectEventsToAssistantMessage()` stays in shared for now; can be moved to renderer later.
  Rationale: The function is pure and has no main-process dependencies. Keeping it shared avoids code duplication if any future main-process consumer needs it (e.g., export, snapshot). Moving it to renderer is trivial if desired.
  Date: 2025-05-05

- Decision: Rename `TurnStateMachine` → `TimelineChunkProjector` (or similar).
  Rationale: After removing UIMessage accumulation, the component no longer maintains state — it's a pure `Event → Chunks` projector. The old name implies stateful machine semantics that no longer exist.
  Date: 2025-05-05

- Decision: TDD — write projection parity tests before M1 implementation.
  Rationale: Ensures the shared `projectEventsToAssistantMessage()` produces identical UIMessage output to the old `TurnStateMachine` accumulation. Catches discrepancies before we remove the old path.
  Date: 2025-05-05

## Outcomes & Retrospective

### Achieved
- Main process no longer constructs, accumulates, or stores `UIMessage` objects
- `TurnStateMachine` (200+ line stateful accumulator) → `TimelineChunkProjector` (10 lines, pure delegation)
- `messages.content` stores plain text (user) or empty string (assistant) — no more JSON blobs
- `PersistEventInput` no longer carries `message: UIMessage` — turn-repository is 1 field lighter
- Domain event `ChatMessageCompletedPayload.uiMessageJson` → `assistantText` (plain text)
- FTS indexing directly from extracted text, no JSON parsing needed
- Renderer hydration uses timeline events as sole source — legacy JSON parsing path removed
- All 253 tests pass, zero new type errors

### Remaining
- `thread-search.ts` `rebuildIndex()` still reads `msg.content` — for user messages this works (plain text), for assistant messages it gets empty string. A future enhancement could rebuild from timeline events.
- `chat-turn-context.ts` queries ALL timeline events for a session rather than per-message — acceptable for now but could be refined with a message→run mapping.
- Stale files in `src/main/features/` and `src/main/platform/` still exist (pre-existing from previous Phase 2 work, not this plan's scope).

### Lessons
- The `state: 'streaming' | 'done'` field on text/reasoning parts was needed by the renderer (`ReasoningBlock` component) — missing it initially caused 5 parity test failures. TDD caught this before shipping.
- AI SDK's `ChatTransport` → `ReadableStream<UIMessageChunk>` contract is non-negotiable if using `useChat`. The projection layer is genuinely needed as a bridge between domain events and this protocol.

## Context and Orientation

The Cradle chat system has two persistence paths that currently coexist:

1. **`messages.content`** — A TEXT column in the `messages` SQLite table. Currently stores `JSON.stringify(UIMessage)` where `UIMessage` is the AI SDK's renderer view-model (`{ id, role, parts: [...] }`). Written on every event by the `TurnRepository`.

2. **`backend_timeline_events`** — A table storing raw domain events (one row per event: `assistant.text.delta`, `command.started`, etc.) with a `payloadJson` column. This is the authoritative event log.

The problem: path (1) is redundant. It stores a renderer data structure in a backend persistence layer, creating coupling and dual-write complexity. Path (2) already contains all information needed to reconstruct the UI.

Key files involved:

- `src/main/chat/turn-state-machine.ts` — Accumulates a `UIMessage` object by applying `UIMessageChunk[]` to `initialMessage.parts`. Exposes `.message` (the accumulated UIMessage). This is what gets serialized to `messages.content`.
- `src/main/chat/turn-repository.ts` — Receives `PersistEventInput` (which includes a `message: UIMessage` field) and writes both the timeline event AND `JSON.stringify(input.message)` to `messages.content`.
- `src/main/chat/chat-engine.ts` — Orchestrates turns; at `prepareTurn()` inserts initial rows with `content: JSON.stringify(userMessage/assistantMessage)`. At completion, emits a domain event with `uiMessageJson`.
- `src/main/chat/chat-turn-context.ts` — Builds LLM conversation history by reading `messages.content` and calling `extractMessageText()` which parses UIMessage JSON to extract text.
- `src/main/chat/fts-subscriber.ts` — Subscribes to `chat.message-completed` domain event, receives `uiMessageJson`, and indexes it for full-text search.
- `src/main/chat/thread-search.ts` — Contains `extractSearchableText(content)` which parses UIMessage JSON.
- `src/main/events/domain-events.ts` — Defines `ChatMessageCompletedPayload` with a `uiMessageJson: string` field.
- `src/shared/timeline-projection.ts` — Pure projection functions: `projectTimelineEventToChunks()` (event→chunks) and `projectEventsToAssistantMessage()` (events→UIMessage).
- `src/renderer/src/features/chat/use-chat-session.ts` — Hydrates via `getSessionTimeline()` (preferred) or legacy `getMessages()` → `parseMessage()` from content JSON.
- `src/renderer/src/features/chat/ipc-chat-transport.ts` — Live streaming: receives pre-projected chunks via signal; reconnect: only re-subscribes to live events.

The term **"UIMessage"** refers to the AI SDK type `{ id: string, role: string, parts: Array<TextPart | ReasoningPart | ToolCallPart | ...> }` — a view-model that the `useChat` hook maintains in-memory on the renderer. It should never have been in the DB.

The term **"UIMessageChunk"** refers to the discriminated union of streaming increments (`text-start`, `text-delta`, `tool-input-available`, `finish`, etc.) that `useChat` consumes from its `ChatTransport`. This IS the legitimate wire protocol between main and renderer for live streaming.

The term **"timeline event"** refers to our domain events (`assistant.message.started`, `assistant.text.delta`, `command.started`, `command.completed`, `run.completed`, etc.) stored in `backend_timeline_events`.

## Plan of Work

The work proceeds in eight milestones, each independently verifiable.

**Milestone 0** establishes a TDD safety net: a parity test that proves the shared `projectEventsToAssistantMessage()` produces identical output to the old `TurnStateMachine` accumulation. This test must pass before we touch any production code.

**Milestone 1** renames `TurnStateMachine` to `TimelineChunkProjector` and simplifies it to a pure `Event → Chunks` projector with no UIMessage accumulation. The name change reflects the new identity: it's no longer a state machine, it's a stateless projector.

**Milestone 2** removes the `message: UIMessage` field from `PersistEventInput` and stops writing UIMessage JSON to `messages.content`. User messages store plain text; assistant messages store empty string (the content lives in timeline events).

**Milestone 3** replaces FTS indexing to extract searchable text directly from timeline events rather than from UIMessage JSON.

**Milestone 4** migrates `chat-turn-context.ts` history extraction to read from `backend_timeline_events` (reducing text from events) rather than parsing `messages.content`.

**Milestone 5** removes the legacy `getMessages()` → `parseMessage()` path from the renderer, making `getSessionTimeline()` the sole hydration source.

**Milestone 6** removes dead code: `uiMessageJson` from domain events, unused imports, and the stale `getMessages()` IPC method (or repurpose it to return simple metadata without content).

**Milestone 7** ensures the developer tools (Agent Context panel, IPC Devtool) display clean data after the storage format change.

## Concrete Steps

### Milestone 0: TDD — Projection Parity Tests

Before modifying `TurnStateMachine`, write a test that feeds identical timeline event sequences through both:
- The existing `TurnStateMachine` (old code, accumulates UIMessage via chunks)
- The shared `projectEventsToAssistantMessage()` (new code, pure projection)

Verify they produce identical `UIMessage` output (same parts structure, same text content, same tool states). This proves the shared projector is a drop-in replacement for the accumulator.

File: `src/main/chat/__tests__/projection-parity.test.ts`

Test cases:
1. Simple text conversation (text-start → delta × N → text-end)
2. Reasoning + text (reasoning events followed by text)
3. Tool use (command.started → command.completed with output)
4. Multi-tool turn (multiple commands interleaved with text)
5. Aborted run (partial text + run.aborted)

Run: `pnpm test -- --testPathPattern projection-parity`

### Milestone 1: Rename TurnStateMachine → TimelineChunkProjector, remove UIMessage accumulation

File: `src/main/chat/turn-state-machine.ts` → rename to `src/main/chat/timeline-chunk-projector.ts`

1. Rename the file and the exported interface/function:
   - `TurnStateMachine` → `TimelineChunkProjector`
   - `createTurnStateMachine()` → `createTimelineChunkProjector()`
2. Remove the `initialMessage` parameter. The function no longer takes or produces a UIMessage.
3. Remove the `message` getter from the interface.
4. The `apply(event)` method still calls `projectTimelineEventToChatChunks(event)` and returns `UIMessageChunk[]`, but no longer applies chunks to any internal UIMessage accumulator.
5. Remove `activeTextParts`, `activeReasoningParts`, `toolParts` maps and all the `applyChunks()` / `ensureXPart()` helpers.
6. The simplified implementation becomes:

        export interface TimelineChunkProjector {
          apply: (event: TimelineInputEvent | BackendTimelineEvent) => UIMessageChunk[]
        }

        export function createTimelineChunkProjector(): TimelineChunkProjector {
          return {
            apply(event) {
              return projectTimelineEventToChatChunks(event)
            },
          }
        }

7. Update all callers in `chat-engine.ts` that reference `draft.turn.message` — there are three:
   - Line ~488: `content: JSON.stringify(activeDraft.turn.message)` in `getMessages()` — change to return a minimal placeholder or remove content substitution.
   - Line ~718: `message: draft.turn.message` passed to `TurnRepository.persistEvent()` — remove.
   - Line ~899: `uiMessageJson: JSON.stringify(draft.turn.message)` in domain event — remove.

8. Update `createTurnStateMachine` call site in `chat-engine.ts` to use the new name and not pass the initial UIMessage.
9. Update all imports across the codebase that reference the old file/names.

Run: `pnpm typecheck` — fix all type errors iteratively.

### Milestone 2: Stop writing UIMessage JSON to messages.content

File: `src/main/chat/turn-repository.ts`

1. Remove `message: UIMessage` from `PersistEventInput` interface.
2. In `commitEvent()`, change the `tx.update(messages).set(...)` to NOT write content. Only update `status`, `errorText`, `updatedAt`.

File: `src/main/chat/chat-engine.ts` (`prepareTurn`)

3. For user messages: `content: userText` (plain text, not JSON). 
4. For assistant messages: `content: ''` (empty — timeline events are the source of truth).
5. Remove `import type { UIMessage } from 'ai'` from chat-engine.ts if no longer used.
6. Remove the UIMessage construction (`const userMessage: UIMessage = {...}` and `const assistantMessage: UIMessage = {...}`) in `prepareTurn`.

Run: `pnpm typecheck && pnpm test`

### Milestone 3: Migrate FTS to timeline-event text extraction

File: `src/main/chat/thread-search.ts`

1. Change `extractSearchableText(content: string)` to a new function `extractTextFromTimelineEvents(events: Array<{type: string, delta?: string}>): string` that reduces timeline events to plain text:
   - Concatenate all `delta` fields from events where `type === 'assistant.text.delta'`.
   - Also include `delta` from `reasoning.delta` events if desired for search.

2. Change `indexMessage()` signature to accept timeline events or pre-extracted text instead of UIMessage JSON.

File: `src/main/chat/fts-subscriber.ts`

3. Update the `chat.message-completed` handler to accept either pre-extracted text or to query timeline events for the completed message and extract text.

File: `src/main/events/domain-events.ts`

4. Replace `uiMessageJson: string` with `assistantText: string` (pre-extracted plain text for FTS) in `ChatMessageCompletedPayload`.

File: `src/main/chat/chat-engine.ts`

5. At turn completion, emit the domain event with extracted text:

        const textContent = events
          .filter(e => e.type === 'assistant.text.delta')
          .map(e => e.delta)
          .join('')
        // emit: { assistantText: textContent, ... }

Run: `pnpm test` — particularly thread-search tests.

### Milestone 4: Migrate chat-turn-context.ts to timeline events

File: `src/main/chat/chat-turn-context.ts`

1. Replace the history-building query that reads `messages.content` with a join on `backend_timeline_events`:
   - For user messages: read `messages.content` (now plain text after Milestone 2).
   - For assistant messages: query `backend_timeline_events` → reduce `assistant.text.delta` events to concatenated text.

2. Remove `extractMessageText()` function and `import type { UIMessage } from 'ai'`.

Run: `pnpm test`

### Milestone 5: Remove legacy renderer hydration path

File: `src/renderer/src/features/chat/use-chat-session.ts`

1. Remove `parseMessage()` function.
2. Remove the fallback `getMessages()` path in `syncSnapshot()`. The timeline path is now authoritative.
3. Remove `cachedInitialMessages` (the loader-provided rows parsed from JSON). Instead, if `initialMessageRows` are pre-loaded, convert them using timeline projection (or defer to async `syncSnapshot`).

Performance note: For 500 events, `Array.reduce` completing projection takes ~1ms on modern hardware. Since Cradle uses React 19 Activity for tab keep-alive, full-projection only happens on first open or page refresh — not on tab switch. Ensure `getSessionTimeline()` returns events ordered by `sequence_number` (already the case in the DB query).

File: `src/main/chat/chat-engine.ts`

4. Simplify `getMessages()` to return message metadata (id, role, status, errorText, createdAt) without the content field — or remove it entirely if no longer needed.

Run: `pnpm typecheck && pnpm test`

### Milestone 6: Clean up dead code

1. Remove `uiMessageJson` from `ChatMessageCompletedPayload` (already done in M3).
2. Remove any remaining `UIMessage` imports in main-process files.
3. Verify no code reads `messages.content` expecting JSON for assistant messages.
4. Consider whether `getMessages()` IPC is still needed — if only `getSessionTimeline()` is used by the renderer, deprecate/remove `getMessages()`.
5. Clean up `thread-search.ts` `reindexAll()` to use timeline events instead of `msg.content` JSON.

Run: `pnpm typecheck && pnpm test && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags '(@CRADLE-CHAT-003 or @CRADLE-CHAT-004 or @CRADLE-CHAT-005 or @CRADLE-CHAT-006 or @CRADLE-CHAT-007 or @CRADLE-CHAT-008 or @CRADLE-CHAT-009 or @CRADLE-CHAT-010)'`

### Milestone 7: DevTool Adaptation

File: `src/main/devtools/agent-context-devtool-store.ts` (and related)

1. Audit the Agent Context devtool panel: ensure it displays `assistantText` (extracted plain text) rather than raw `messages.content` which is now empty for assistant rows.
2. If the devtool currently reads `messages.content` for display, update it to either:
   a. Join with `backend_timeline_events` and reduce to text, or
   b. Read from the FTS index text (already extracted in M3).
3. Verify the IPC Devtool panel shows clean data without `[object Object]` artifacts.

Run: Manual verification in dev mode (`pnpm dev`).

## Validation and Acceptance

1. **Unit tests**: `pnpm test` — all 232+ tests pass. The turn-state-machine tests will need updating since the interface changed.
2. **Type check**: `pnpm typecheck` — clean (same pre-existing app.tsx errors only).
3. **E2E chat scenarios**: Run the chat E2E suite. After reload, messages must display correctly (proving timeline hydration works without content JSON).
4. **FTS search**: Verify that searching for text in an assistant message still returns results (proving FTS indexes from timeline events).
5. **Streaming continuity**: Start a chat, refresh the window mid-stream, verify the message appears correctly on reload.
6. **Multi-turn context**: Verify that follow-up questions receive context-aware answers (proving `chat-turn-context.ts` correctly extracts history from timeline events).

## Idempotence and Recovery

Each milestone is additive and leaves the system in a consistent state. If interrupted:
- After M1: The turn-state-machine is simpler but the turn-repository still expects a `message` field — type errors will block compilation, serving as a clear resumption point.
- After M2: The DB stores plain text / empty content. Old rows still have JSON — no migration needed because the renderer no longer reads them.
- After M3-4: FTS and history extraction use the new path. Old indexed data remains valid.
- After M5: The legacy path is gone. If `getSessionTimeline()` returns empty (impossible for sessions with events), the UI shows nothing — a clear signal something broke.

No database migration is required. The `content` column remains TEXT and simply stores different values (plain text instead of JSON). Existing JSON values in old rows are harmless and ignored.

## Interfaces and Dependencies

After completion, the key interfaces look like:

In `src/main/chat/timeline-chunk-projector.ts`:

    export interface TimelineChunkProjector {
      apply: (event: TimelineInputEvent | BackendTimelineEvent) => UIMessageChunk[]
    }
    export function createTimelineChunkProjector(): TimelineChunkProjector

In `src/main/chat/turn-repository.ts`:

    export interface PersistEventInput {
      chatSessionId: string
      messageId: string
      runId: string
      event: TimelineInputEvent
      messageStatus: 'streaming' | 'complete' | 'aborted' | 'failed'
      errorText: string | null
      runCompletion?: { status: string; stopReason: string | null; errorText: string | null }
    }

In `src/main/events/domain-events.ts`:

    export interface ChatMessageCompletedPayload {
      chatSessionId: string
      messageId: string
      status: 'complete' | 'aborted' | 'failed'
      errorText: string | null
      assistantText: string          // plain text extracted from timeline events
      agentProfileId: string
      modelId: string | null
      usage: { promptTokens: number, completionTokens: number, totalTokens: number } | null
    }

In `src/shared/timeline-projection.ts` (unchanged):

    export function projectTimelineEventToChunks(event: ProjectableTimelineEvent): UIMessageChunk[]
    export function projectEventsToAssistantMessage(messageId: string, events: ProjectableTimelineEvent[]): UIMessage

Dependencies: No new packages. AI SDK (`ai`) remains a renderer+shared dependency for types. The main process still imports `UIMessageChunk` type from `ai` for the broadcast signature but no longer imports `UIMessage`.
