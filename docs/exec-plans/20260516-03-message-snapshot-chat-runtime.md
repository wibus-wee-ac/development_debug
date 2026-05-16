# Message Snapshot Chat Runtime Rewrite

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document is maintained in accordance with `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

Cradle currently stores every streamed `UIMessageChunk` as a database row and then replays those rows through a custom frontend reducer. After this rewrite, streamed chunks are only an internal backend input. The durable record becomes a complete `UIMessage` snapshot stored on each `messages` row, while live clients receive sequenced part-level deltas such as `part_add`, `text_append`, `tool_input_append`, `tool_output_streaming`, and `tool_output_set`.

The user-visible outcome is that chat still streams text, reasoning, tool input, tool output, and subagent output live, but history hydration loads complete message snapshots directly. Subagent messages live in the same `messages` table as normal chat messages and are routed by `parentToolCallId`; the main chat list is defined by `parentToolCallId IS NULL`.

## Progress

- [x] (2026-05-16 11:22Z) Read the current chunk persistence implementation, frontend chunk reducer, DB schema, session/search/observability readers, and confirmed unrelated working-tree changes are already present.
- [x] (2026-05-16 11:38Z) Added message snapshot and message-level subagent routing columns to `messages`, removed `backendTimelineEvents` from schema and reset helpers, and added the breaking `0015` migration plus Drizzle snapshot.
- [x] (2026-05-16 11:41Z) Replaced backend chunk persistence with `messageJson` snapshot persistence and sequenced part-level SSE events.
- [x] (2026-05-16 11:42Z) Replaced frontend chunk transport/reducer usage with delta transport and delta accumulation in Zustand.
- [x] (2026-05-16 11:43Z) Removed timeline-event readers from session export, search indexing, prompt history, and observability export.
- [x] (2026-05-16 11:45Z) Deleted obsolete chunk codec/reducer files and updated README/spec files.
- [x] (2026-05-16 11:46Z) Ran focused typechecks and tests, then audited explicit routing/protocol requirements.
- [x] (2026-05-16 12:26Z) Tightened snapshot truth-source semantics, fixed the `0015` migration to synthesize valid `message_json` rows during replay, added focused SSE/subagent regression tests, and cleaned stale timeline/useChat/spec wording flagged by multi-work review.

## Surprises & Discoveries

- Observation: The working tree already contains unrelated CLI/TUI and agent runtime edits, including modifications to `packages/db/src/schema/chat.ts`, `apps/server/src/modules/session/service.ts`, and generated migration metadata.
  Evidence: `git status --short` showed `20260516-02-cli-tui-launch-ownership-cleanup.md`, `0014_majestic_living_tribunal.sql`, and many CLI/TUI files modified before this rewrite began.

- Observation: The current profiles service strips `config.model` before saving agent profiles, so openai-compatible tests must pass `modelId` on `/chat/sessions/:sessionId/response`.
  Evidence: Focused chat-runtime tests initially finalized assistant messages as failed with `OpenAI-compatible provider requires baseUrl and model`; adding explicit `modelId` matched the current profile/session contract.

- Observation: Some provider streams can emit reasoning text without an explicit `reasoning-end` chunk before finish.
  Evidence: The Claude Agent focused test produced a reasoning part left in `state: 'streaming'`; the projector now closes active text and reasoning parts on `finish` by emitting `text_done` with the appropriate `partType`.

- Observation: `drizzle-kit check` only validates schema metadata consistency; it does not prove that a migration can replay on a non-empty pre-migration database.
  Evidence: Multi-work review reproduced a `NOT NULL constraint failed: __new_messages.message_json` failure when the original `0015` migration tried to copy legacy `messages` rows while inserting `NULL` into the new non-null `message_json` column.

## Decision Log

- Decision: Do not write compatibility code for old `backend_timeline_events` rows.
  Rationale: The user explicitly stated there are no old users or old data to preserve and asked for a breaking rewrite.
  Date/Author: 2026-05-16 / Codex

- Decision: Use `parentToolCallId IS NULL` as the main timeline filter and `parentToolCallId IS NOT NULL` as the subagent-message discriminator.
  Rationale: This matches the Alma routing semantics: the key question is whether the message is produced under a tool call, not whether it has a parent message pointer.
  Date/Author: 2026-05-16 / Codex

- Decision: Keep `messages.content` as a derived plain-text cache while making `messages.messageJson` the source of truth.
  Rationale: Existing search, export, and prompt-history paths need plain text, but content must be extracted from complete message parts rather than incrementally appended from text chunks.
  Date/Author: 2026-05-16 / Codex

- Decision: Use Alma-style text deltas with `partType: 'text' | 'reasoning'` instead of separate reasoning delta types, and include `tool_input_append`, `tool_output_streaming`, and `seq`.
  Rationale: The user explicitly requested these protocol details so the client has one coherent delta protocol with ordering and streaming tool visibility.
  Date/Author: 2026-05-16 / Codex

- Decision: Keep runtime hydration strict, but let the breaking `0015` migration synthesize minimal valid `message_json` snapshots from legacy `messages.content` so migration replay remains executable on non-empty developer databases.
  Rationale: Runtime must not silently fall back from `messageJson` to `content`, but migration SQL still needs to be internally consistent and replayable under test; translating legacy rows once during migration preserves the new invariant without reintroducing runtime compatibility code.
  Date/Author: 2026-05-16 / GitHub Copilot

## Outcomes & Retrospective

The rewrite now removes chunk-level durable storage from the active chat runtime. `messages.messageJson` stores the full `UIMessage` snapshot, `messages.content` is maintained as a derived plain-text cache from complete parts, and `backend_timeline_events` is dropped by the breaking migration.

Live streaming now uses `message_delta` and `subagent_message_delta` events with monotonically increasing `seq` fields. Reasoning uses the same `text_append` / `text_done` events as text with `partType: 'reasoning'`. Tool input supports streaming append events, and command-style output can stream through `tool_output_streaming`.

The web app no longer imports the old chunk reducer. It hydrates main messages by filtering rows where `parentToolCallId` is null and stores subagent messages separately under the parent assistant message and tool-call ID.

## Context and Orientation

The backend chat runtime lives in `apps/server/src/modules/chat-runtime/service.ts`. Before this rewrite it persisted every `UIMessageChunk` into `backend_timeline_events` through `persistChunk`, then streamed `StoredChunk` envelopes to the web app. The frontend lived under `apps/web/src/features/chat/`; `sse-chat-transport.ts` parsed `StoredChunk`, `chat-streaming-handler.ts` applied chunks, and `chat-chunk-reducer.ts` rebuilt `UIMessage.parts` for hydration and live rendering.

The new design keeps provider output as `UIMessageChunk` inside the backend only because existing providers already produce that type. The backend converts chunks into an in-memory message projection, persists complete message snapshots on `messages.messageJson`, derives `messages.content` from text parts, and broadcasts sequenced part-level delta events. The frontend receives only the delta protocol and never replays AI SDK chunk protocol.

## Plan of Work

First update the DB schema. `packages/db/src/schema/chat.ts` gains `messageJson`, `parentMessageId`, `parentToolCallId`, `taskId`, and `depth` on `messages`. `packages/db/src/schema/backend-control-plane.ts` drops `backendTimelineEvents` and its inferred row types. The test reset module must stop deleting the removed table. Add a breaking migration after the existing `0014` migration.

Next add a backend delta projector under `apps/server/src/modules/chat-runtime/`. It receives `UIMessageChunk`, updates a `UIMessage` snapshot, and returns `ChatPartDelta[]` with monotonically increasing `seq` values. The delta protocol must include `part_add`, `text_append` with `partType`, `text_done` with `partType`, `tool_input_append`, `tool_input_set`, `tool_output_streaming`, and `tool_output_set`.

Then replace the service write path. `createDraftTurn` writes user and assistant `messageJson`. `executeRun` updates a main assistant projection and creates subagent assistant projections when provider metadata indicates a `parentToolUseId`. It persists message snapshots instead of chunks and broadcasts `message_delta` or `subagent_message_delta` events.

Then update server read paths. `/chat/sessions/:sessionId/messages` returns message snapshot rows, not chunk groups. Session export, session timeline helpers, and search index rebuilds read `messages.content`. Observability bundle export no longer reads a chat chunk timeline.

Finally update the web app. The store replaces subagent chunk maps with subagent message maps. The SSE transport parses delta events and emits run status notifications from event types. The streaming handler applies deltas to messages. Hydration reads `messageJson` directly. Delete chunk reducer files and update chat README documentation.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

Use `rg` to confirm no production code imports `backendTimelineEvents`, `StoredChunk`, or `chat-chunk-reducer` after edits:

    rg -n "backendTimelineEvents|StoredChunk|chat-chunk-reducer" apps packages

Run focused verification:

    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/web typecheck
  pnpm exec vitest run --config apps/web/vite.config.ts --environment jsdom apps/web/src/features/chat/use-chat-session.test.ts apps/web/src/features/chat/use-chat-session-binding.test.tsx apps/web/src/features/chat/chat-streaming-handler.test.ts apps/web/src/store/chat.test.ts
    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts tests/session.test.ts tests/search.test.ts tests/acp-chat-runtime.test.ts tests/sdk-providers.test.ts tests/observability.test.ts
  pnpm exec vitest run packages/db/src/message-snapshot-migration.test.ts
    pnpm exec drizzle-kit check --config drizzle.config.ts

If OpenAPI-generated client types change, run:

    pnpm gen:cli

## Validation and Acceptance

The implementation is accepted when a chat response streams through SSE as `message_delta` events with increasing `seq`, the web store shows live text/reasoning/tool updates without importing `chat-chunk-reducer`, a page reload hydrates from `messageJson` rows without reading `backend_timeline_events`, and the `0015` migration replays successfully against a pre-migration database that already contains `messages` rows.

A subagent output must not appear in the main message list. It must be stored as a `messages` row with `parentToolCallId` set, and the tool fold must find it by comparing the tool part's `toolCallId` with the subagent message's `parentToolCallId`.

Search, markdown export, and prompt history must use `messages.content`, and `messages.content` must be derived from complete message parts rather than appended from text deltas.

## Idempotence and Recovery

This is a breaking schema rewrite. There is no runtime compatibility path back to chunk persistence. If a step fails, keep unrelated working-tree changes intact and revert only the files changed for this rewrite. The migration may synthesize minimal valid snapshots from legacy `messages.content` during replay, but the running application must always hydrate from `messageJson` only.

## Artifacts and Notes

Initial evidence:

    git status --short
    A  apps/server/src/helpers/agent-runtime-config.ts
    M  apps/server/src/modules/chat-runtime/service.ts
    M  packages/db/src/schema/chat.ts
    ?? docs/exec-plans/20260516-02-cli-tui-launch-ownership-cleanup.md
    ?? packages/db/drizzle/0014_majestic_living_tribunal.sql

## Interfaces and Dependencies

The backend delta event protocol must be exported from `apps/server/src/modules/chat-runtime/delta-events.ts`.

The final stream event shape is:

    type ChatStreamEvent =
      | { type: 'message_delta'; data: { messageId: string; deltas: ChatPartDelta[] } }
      | { type: 'subagent_message_delta'; data: { context: SubagentMessageContext; deltas: ChatPartDelta[] } }
      | { type: 'run_completed'; data: { messageId: string } }
      | { type: 'run_aborted'; data: { messageId: string } }
      | { type: 'run_failed'; data: { messageId: string; errorText: string } }

    type ChatPartDelta =
      | { seq: number; type: 'part_add'; partIndex: number; part: UIMessage['parts'][number] }
      | { seq: number; type: 'text_append'; partIndex: number; partType: 'text' | 'reasoning'; text: string }
      | { seq: number; type: 'text_done'; partIndex: number; partType: 'text' | 'reasoning' }
      | { seq: number; type: 'tool_input_append'; partIndex: number; inputKey: string; text: string }
      | { seq: number; type: 'tool_input_set'; partIndex: number; input: unknown }
      | { seq: number; type: 'tool_output_streaming'; partIndex: number; stream: 'stdout' | 'stderr'; text: string }
      | { seq: number; type: 'tool_output_set'; partIndex: number; output?: unknown; state: 'output-available' | 'output-error' | 'output-denied'; errorText?: string }

Validation evidence:

    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/web typecheck
    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts tests/session.test.ts tests/search.test.ts tests/acp-chat-runtime.test.ts tests/sdk-providers.test.ts tests/observability.test.ts
  pnpm exec vitest run --config apps/web/vite.config.ts --environment jsdom apps/web/src/features/chat/use-chat-session.test.ts apps/web/src/features/chat/use-chat-session-binding.test.tsx apps/web/src/features/chat/chat-streaming-handler.test.ts apps/web/src/store/chat.test.ts
  pnpm exec vitest run packages/db/src/message-snapshot-migration.test.ts
    pnpm exec drizzle-kit check --config drizzle.config.ts

Revision note: Updated on 2026-05-16 after multi-work review to tighten `messageJson` truth-source semantics, add protocol/migration replay validation, and clean stale timeline/useChat documentation drift.

Revision note: Created on 2026-05-16 to guide the breaking rewrite from chunk persistence to message snapshot persistence and sequenced part-level live deltas.
