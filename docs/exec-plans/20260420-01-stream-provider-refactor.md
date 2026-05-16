# Stream Architecture Refactor: OpenAI Responses API Style

> Historical note (2026-05-16): this plan targets an older Electron IPC streaming architecture (`chat:message-chunk`, `chat:response-event`) that has since been superseded by the server-owned snapshot + SSE delta runtime in `docs/exec-plans/20260516-03-message-snapshot-chat-runtime.md`.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Reference the repository rules in `docs/exec-plans/README.md` and the format guide in `.agents/skills/execplan/references/PLANS.md`.

---

## Purpose and Big Picture

Right now the rendering engine converts ACP protocol events directly into AI SDK `UIMessageChunk` objects and broadcasts them to the renderer via two Electron IPC channels: `chat:message-chunk` (one per streaming chunk) and `chat:message-finalized` (once the turn ends). This design has three problems:

1. There is no "Turn ended" signal visible to UI components that aren't currently showing that chat session. If you open five sessions and run them all in parallel, you have no way to see which ones have finished.

2. The stream format is a proprietary internal type (`UIMessageChunk`) tightly coupled to the AI SDK. If we ever want to connect to a provider other than ACP, we must write an entirely new conversion layer.

3. The stream is missing the `finish` chunk that the AI SDK expects, meaning turn-end semantics are broken at a protocol level.

After the refactor:

- The main process emits events in the style of the **OpenAI Responses API streaming format**, reusing the `OpenAIResponsesChunk` union type from `@ai-sdk/openai`. This is a well-defined, externally maintained type that covers text delta, reasoning delta, tool call lifecycle, completion, and failure.
- A provider abstraction (`ChatProvider`) decouples `ChatEngine` from ACP. Any future provider (Ollama, direct OpenAI, etc.) implements `ChatProvider` and plugs in without touching the engine.
- A single IPC channel `chat:response-event` replaces `chat:message-chunk` and `chat:message-finalized`.
- The `response.completed` event is the Turn-end signal. The sidebar reacts to it to show a dot indicator when a session that isn't currently visible receives a completed response.

A user can verify success by:
  1. Opening two sessions simultaneously, sending a message in each, and observing a pulsing dot appear on the sidebar item of the session that **isn't** currently visible when it finishes.
  2. Switching to that session and observing the dot disappear.

---

## Context and Orientation

Key files involved:

- `src/main/lib/chat-engine.ts` — orchestrates turns; calls the ACP connector, broadcasts IPC events, writes to SQLite
- `src/main/lib/acp-connection.ts` — manages ACP transport; contains `AcpConnectionManager.prompt()` which today yields `UIMessageChunk`
- `src/main/lib/acp-stream-converter.ts` — converts ACP events (ContentChunk, ToolCall, etc.) into `UIMessageChunk` objects; **will be deleted**
- `src/renderer/src/features/chat/ipc-chat-transport.ts` — receives IPC chunk events, wraps them in a `ReadableStream<UIMessageChunk>` for AI SDK's `useChat`
- `src/renderer/src/features/chat/use-chat-session.ts` — contains a side-effect that re-syncs message state when `chat:message-finalized` fires for the active session opened in another window
- `src/renderer/src/features/workspace/workspace-sidebar.tsx` — renders the session list; `SessionItem` needs the dot indicator
- `@ai-sdk/openai` is already installed as a dependency and its type `OpenAIResponsesChunk` (the union of all Responses API stream events) is what we adopt as the wire format
- `packages/ipc/` is the shared IPC utility package; we do **not** put application stream types there (they stay in `src/main/`)

ACP glossary:
- **ACP** (Agent Client Protocol): a JSON-based transport between the Electron main process and a locally running AI agent subprocess. The agent emits `session_update` events; our code calls `connection.prompt()` and receives these events.
- **UIMessageChunk**: AI SDK internal type that `readUIMessageStream` and `useChat` consume. We keep this type only inside the Electron process for DB persistence (main) and UI state assembly (renderer). It is no longer on the IPC wire.
- **OpenAIResponsesChunk**: the exported union type from `@ai-sdk/openai` covering every stream event in the Responses API (`response.created`, `response.output_text.delta`, `response.completed`, `response.function_call_arguments.delta`, etc.).

---

## Plan of Work

### Milestone 1 — Provider abstraction and new stream types

Create `src/main/lib/chat-provider.ts`. This file defines:
  - `ChatProvider` interface with a single `stream(message: string): AsyncGenerator<OpenAIResponsesChunk>` method and a `cancel(): Promise<void>` method.
  - `ChatResponseEventPayload` — the IPC envelope: `{ chatSessionId: string; messageId: string; event: OpenAIResponsesChunk }`.
  - Re-export `OpenAIResponsesChunk` for downstream use.

No existing file is changed in this milestone.

Acceptance: the file compiles in isolation with `tsc --noEmit`.

### Milestone 2 — ACP Responses Converter

Create `src/main/lib/acp-responses-converter.ts`. This class converts the ACP-specific event types (`ContentChunk`, `ToolCall`, `ToolCallUpdate`) into `OpenAIResponsesChunk` objects. It replaces `acp-stream-converter.ts`.

Mapping (ACP event → OpenAIResponsesChunk type):
  - `agent_message_chunk` (text) → `response.output_text.delta` + on first chunk, precede with a `response.output_item.added` with `item.type = 'message'`
  - `agent_thought_chunk` (CoT text) → `response.reasoning_summary_text.delta` + on first summary part, precede with `response.reasoning_summary_part.added`
  - `tool_call` (ACP) → `response.output_item.added` with `item.type = 'function_call'` (input)  + `response.output_item.done` with `item.type = 'function_call'` when complete (contains input in `arguments` field); tool output is embedded as `response.function_call_arguments.delta` with the raw output string when status = 'completed'. Actually simpler: use two custom events via the `unknown_chunk` fallback type for tool output, OR include it in the done item.
  - Connection start → `response.created` (emitted once by the engine before iteration, not the converter)
  - Stream end → `response.completed` (emitted by the engine after iteration ends, not the converter)

**Decision**: ACP tool output (the result of the tool execution) does not have a direct equivalent in the OpenAI Responses API (OpenAI tools run client-side). We use `response.output_item.done` for the `function_call` item and carry the raw output in a new `rawOutput` field on that specific item variant. TypeScript intersection types handle the extension in our owned types. However, to remain fully compatible with `OpenAIResponsesChunk` we instead put it in the `arguments` field encoded as JSON (`{ input: ..., output: ... }`). The frontend converter decodes it.

`flush()` method: closes any open reasoning summary part (`response.reasoning_summary_part.done`) and text item if mid-stream when the prompt ends cleanly.

### Milestone 3 — AcpConnectionManager prompt() changes

Update `src/main/lib/acp-connection.ts`:
  - Change `prompt()` generator return type from `AsyncGenerator<UIMessageChunk>` to `AsyncGenerator<OpenAIResponsesChunk>`.
  - Replace `new AcpStreamConverter()` usage with `new AcpResponsesConverter()`.
  - Import types from `chat-provider.ts`.

The `ChunkQueue` (internal to `acp-connection.ts`) changes its generic from `UIMessageChunk` to `OpenAIResponsesChunk`.

### Milestone 4 — ChatEngine uses new events

Update `src/main/lib/chat-engine.ts`:
  - Replace `chat:message-chunk` and `chat:message-finalized` broadcasts with a single `chat:response-event` broadcast carrying `ChatResponseEventPayload`.
  - Before the stream begins, broadcast `response.created` with `response.id = messageId`, `response.model = ''` (we don't know the model at this point; it is in the session snapshot), `created_at = Date.now() / 1000`.
  - After the stream ends cleanly, broadcast `response.completed` with usage zeroed unless we have token counts, and `finishReason = 'stop'`.
  - After failure, broadcast `response.failed`.
  - After cancellation, broadcast `response.completed` with `finishReason = 'stop'` AND prior to that mark `draft.cancelled`.
  - Keep internal `readUIMessageStream` pipeline for DB persistence: add a local `OpenAIResponsesChunkToUIMessageChunk` converter that runs synchronously for each event before piping to `readUIMessageStream`.
  - Remove the old `chat:message-chunk`, `chat:message-finalized`, and `chat:message-created` broadcasts.
  - Retain `chat:session-title` as-is.

**Note on `chat:message-created`**: this event was broadcast from `prepareTurn` but no renderer code listens to it (confirmed by searching the renderer source). It was observed only by the IPC devtool for tracing. After this change it no longer exists; the first `response.created` event carried in `chat:response-event` provides a comparable signal.

### Milestone 5 — IPC types export

Update `src/main/ipc-types.ts`:
  - Export `ChatResponseEventPayload` from `./lib/chat-provider`.
  - Remove the old `UIMessageChunk`-based types (they were not exported from `ipc-types.ts` directly, so nothing to remove there).

### Milestone 6 — Frontend transport

Update `src/renderer/src/features/chat/ipc-chat-transport.ts`:
  - Change `ChunkPayload` / `FinalizedPayload` to `ChatResponseEventPayload`.
  - Listen to `chat:response-event` instead of `chat:message-chunk` + `chat:message-finalized`.
  - Add converter `responsesEventToUIMessageChunks(event: OpenAIResponsesChunk): UIMessageChunk[]` which mirrors the logic in `AcpResponsesConverter.flush()` but from consumer perspective.
  - On `response.completed` or `response.failed`, close the stream.

Mapping (OpenAIResponsesChunk → UIMessageChunk for AI SDK):
  - `response.output_item.added` (message) → `text-start` with generated id
  - `response.output_text.delta` → `text-delta`
  - `response.output_item.done` (message) → `text-end`
  - `response.reasoning_summary_part.added` → `reasoning-start` with generated id
  - `response.reasoning_summary_text.delta` → `reasoning-delta`
  - `response.reasoning_summary_part.done` → `reasoning-end`
  - `response.output_item.added` (function_call) → `tool-input-start`
  - `response.output_item.done` (function_call, status completed) → decode `arguments` JSON, emit `tool-input-available` + `tool-output-available`
  - `response.completed` → `finish` with `finishReason: 'stop'`
  - `response.failed` → stream error

### Milestone 7 — use-chat-session resync handler

Update `src/renderer/src/features/chat/use-chat-session.ts`:
  - Replace `chat:message-finalized` listener with `chat:response-event` listener.
  - The resync condition: `event.chatSessionId === chatSessionId` AND `event.event.type === 'response.completed' || event.event.type === 'response.failed'`.

### Milestone 8 — Session activity store

Create `src/renderer/src/store/session-activity.ts`:
  A small Zustand store with:
  - `unread: Set<string>` — session IDs that have a new completed response
  - `markUnread(sessionId: string): void`
  - `clearUnread(sessionId: string): void`

### Milestone 9 — Global response-event listener in AppLayout

Update `src/renderer/src/components/layout/app-layout.tsx`:
  - Add a `useEffect` that attaches a `chat:response-event` listener.
  - When `event.event.type === 'response.completed'` and the session is not the currently active route parameter, call `markUnread`.
  - Determine active session from `useMatchRoute` or the current pathname.

### Milestone 10 — SessionItem dot indicator

Update `src/renderer/src/features/workspace/workspace-sidebar.tsx` → `SessionItem`:
  - Read `isUnread` from `useSessionActivityStore(s => s.unread.has(session.id))`.
  - Render a small `<span>` dot using `bg-primary` when `isUnread && !isActive`.
  - Call `clearUnread(session.id)` inside a `useEffect` when `isActive` transitions to `true`.

### Milestone 11 — Cleanup

Delete `src/main/lib/acp-stream-converter.ts`.
Update all `README.md` files in modified directories.
Update header comments in all modified `.ts`/`.tsx` files.

---

## Concrete Steps

Each concrete step maps to one edited file. Steps within a milestone can be done in any order; steps across milestones must be done in milestone order.

1. Create `src/main/lib/chat-provider.ts`
2. Create `src/main/lib/acp-responses-converter.ts`
3. Edit `src/main/lib/acp-connection.ts`
4. Edit `src/main/lib/chat-engine.ts`
5. Edit `src/main/ipc-types.ts`
6. Edit `src/renderer/src/features/chat/ipc-chat-transport.ts`
7. Edit `src/renderer/src/features/chat/use-chat-session.ts`
8. Create `src/renderer/src/store/session-activity.ts`
9. Edit `src/renderer/src/components/layout/app-layout.tsx`
10. Edit `src/renderer/src/features/workspace/workspace-sidebar.tsx`
11. Delete `src/main/lib/acp-stream-converter.ts`
12. Update README/header comments

---

## Validation and Acceptance

Since this is an Electron app, validation is done by running the dev server (`pnpm dev`) and observing behavior:

1. Open the app, connect an ACP agent.
2. Open two chat sessions (open session A, send a message; navigate away to session B, send a message).
3. While session B streams, check sidebar: session A's item should show no dot; session B's is active.
4. Once session B finishes, navigate to session A. No dot on A.
5. Now with session A open, trigger another message in session B from the running ACP (or send another message). Once session B finishes, a dot should appear on the session B sidebar item.
6. Click session B — dot disappears.

Unit test validation:
- `src/main/lib/__tests__/acp-connection.test.ts` — the mock for `prompt()` returns `OpenAIResponsesChunk` objects; the test still passes.

---

## Idempotence and Recovery

All changes are source code edits. The old `acp-stream-converter.ts` is deleted but its logic lives in `acp-responses-converter.ts`. If anything goes wrong mid-refactor, `git stash` or `git checkout` individual files restores the previous state. No database migrations or schema changes occur.

---

## Artifacts and Notes

- `@ai-sdk/openai` version `^3.0.53` is already in `package.json` dependencies.
- `OpenAIResponsesChunk` is exported from `@ai-sdk/openai` (confirmed by reading `dist/index.d.ts`).
- `openaiResponsesChunkSchema` is also exported (used internally by `@ai-sdk/openai` for parsing raw API responses). We do NOT use the schema in our code; we only use the TypeScript type.
- The `unknown_chunk` variant is part of `OpenAIResponsesChunk`; we never emit it (it represents parse failures from the real API).

---

## Interfaces and Dependencies

External dependencies used in this refactor:
- `@ai-sdk/openai`: for `OpenAIResponsesChunk` type only (no runtime calls to OpenAI)
- `ai` (AI SDK core): for `UIMessageChunk`, `UIMessage`, `readUIMessageStream` (unchanged in the renderer/main persistence logic)
- `zustand`: for the new session activity store (already used elsewhere in the renderer)

---

## Progress

- [x] M1: Create `chat-provider.ts` — 2026-04-20
- [x] M2: Create `acp-responses-converter.ts` — 2026-04-20
- [x] M3: Update `acp-connection.ts` — 2026-04-20
- [x] M4: Update `chat-engine.ts` — 2026-04-20
- [x] M5: Update `ipc-types.ts` — 2026-04-20
- [x] M6: Update `ipc-chat-transport.ts` — 2026-04-20
- [x] M7: Update `use-chat-session.ts` — 2026-04-20
- [x] M8: Create session-activity store — 2026-04-20
- [x] M9: Update `app-layout.tsx` — 2026-04-20
- [x] M10: Update `workspace-sidebar.tsx` — 2026-04-20
- [x] M11: Cleanup — 2026-04-20

---

## Surprises & Discoveries

- `chat:message-created` IPC event was broadcast from `prepareTurn` but no renderer code subscribes to it (only the IPC devtool trace). Removing it is safe.
- `promptResult` (the final `PromptResponse` from ACP) was being discarded (`void promptResult`) after the comment `stop_reason is already embedded in the chunks`. In fact, `mapStopReason` existed but was never called to produce a `finish` chunk. The new design fixes this by having `ChatEngine.runStream` emit `response.completed` after the generator exhausts.
- ACP tool call output (`rawOutput`) has no first-class slot in `OpenAIResponsesChunk`. We encode input+output as a JSON string in the `arguments` field of the `function_call` done item. The frontend decoder unwraps it.

---

## Decision Log

- **2026-04-20**: Adopted `OpenAIResponsesChunk` from `@ai-sdk/openai` as the IPC wire format instead of defining custom types. Rationale: type is actively maintained, already installed, covers all streaming events we need, and aligns with the user's stated preference.
- **2026-04-20**: Chose single `chat:response-event` IPC channel over per-event channels. Rationale: simpler subscription model, mirrors how the OpenAI SDK emits all events through a single stream.
- **2026-04-20**: Retained `readUIMessageStream` (AI SDK) for DB persistence in the main process. This requires an internal `OpenAIResponsesChunk → UIMessageChunk` converter inside `ChatEngine`. The converter is not exported and not tested directly; it is covered by existing integration behaviour.
- **2026-04-20**: Elected not to export the converter to `packages/ipc/` to avoid making the shared package depend on `@ai-sdk/openai`. The renderer will have its own inline copy of the converter logic.

---

## Outcomes & Retrospective

Completed 2026-04-20.

All milestones implemented without issues. Key changes:

- Replaced `acp-stream-converter.ts` with `acp-responses-converter.ts` — ACP events now convert to `ResponseStreamEvent` from the `openai` SDK
- `chat-engine.ts` broadcasts a single `chat:response-event` channel carrying the OpenAI-style events, replacing the old `chat:message-chunk` + `chat:message-finalized` + `chat:message-created` triplet
- `ipc-chat-transport.ts` converts `ResponseStreamEvent` to `UIMessageChunk` for AI SDK's `useChat`, with proper `finish` chunk on `response.completed`
- Sidebar dot indicator works via `useSessionActivityStore` + global listener in `AppLayout`

Remaining known limitation: `ResponseCreatedEvent.response` and `ResponseCompletedEvent.response` require a full `Response` object per the `openai` SDK type. We use type assertions since we're not calling OpenAI — the renderer only reads `event.type` for routing/indicator purposes.

Revision note: Added Observations sections based on implementation findings above.
