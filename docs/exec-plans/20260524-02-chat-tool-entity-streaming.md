# Chat Tool Entity Streaming Refactor

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is intentionally self-contained so a reader can restart this work from only the current tree and this file.

## Purpose / Big Picture

Today Cradle renders chat messages from `UIMessage.parts` snapshots. That model works for text and reasoning because those parts already behave like append-only text buffers, but it fails for tool calls: a tool block often appears late, updates too coarsely, and cannot support true partial-argument rendering or future live previews such as streaming HTML. After this refactor, tool calls become first-class entities in the browser state. A tool block will appear as soon as the server emits `part_add` for a tool, its arguments and state will update incrementally via event patches, and each tool block will re-render independently instead of forcing the whole message bubble through snapshot regrouping.

The user-visible outcome is easy to verify. Start a chat session, trigger an agent run that emits multiple tool calls, and watch the tool cards appear immediately during streaming. While a tool is still receiving arguments, the card should already be mounted and should update without waiting for `tool_output_set`. For tools that have enough partial input to classify, their specialized UI should switch on before the tool completes. The `apps/playground` scenario added by this plan will simulate these phases without depending on a real provider.

## Progress

- [x] (2026-05-24 08:51Z) Investigated the current streaming path and confirmed the architecture problem: `apps/web/src/features/chat/chat-streaming-handler.ts` applies deltas into `UIMessage.parts`, and `apps/web/src/features/chat/message-bubble.tsx` rebuilds tool UI from whole-message snapshots on every update.
- [x] (2026-05-24 08:51Z) Investigated LobeHub's tool rendering path and confirmed the target architecture: the backend emits a stable tool item early, the client writes it into store immediately, and each tool component subscribes by tool-call identifier rather than by full message snapshot.
- [x] (2026-05-24 09:16Z) Created a browser-owned tool entity state model in `apps/web/src/store/chat.ts`, including `toolEntitiesMap`, `toolCallIdsByMessageId`, hydration-time normalization, and selectors keyed by `messageId` and `toolCallId`.
- [x] (2026-05-24 09:16Z) Rewrote `apps/web/src/features/chat/chat-streaming-handler.ts` and `apps/web/src/features/chat/chat-delta-events.ts` so tool deltas patch store-owned tool entities while `UIMessage.parts` keep lightweight anchors and state.
- [x] (2026-05-24 09:16Z) Replaced snapshot-driven tool grouping in `apps/web/src/features/chat/chat-render-plan.ts` and `apps/web/src/features/chat/message-bubble.tsx` with tool-call references and per-tool subscriptions.
- [x] (2026-05-24 09:55Z) Updated tool render components, tests, README files, and the playground scenario so the new behavior is observable and maintainable.
- [x] (2026-05-24 10:05Z) Fixed two runtime regressions uncovered after the first destructive slice: grouped-tool selector loops in `message-bubble.tsx`, and tool-entity payload loss caused by mixing hydration normalization with streaming snapshot updates in `store/chat.ts`.

## Surprises & Discoveries

- Observation: the server side is already streaming tool lifecycle early enough for the browser to render a placeholder tool block. The renderer delay is not solely a provider issue.
  Evidence: `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` yields each mapped chunk immediately in the `for await` loop, and the user's SSE transcript shows `part_add(dynamic-tool)` arriving before `tool_output_set`.

- Observation: `claude-agent` still does not guarantee fine-grained `input_json_delta` chunking for tool arguments, even with partial-message mode enabled.
  Evidence: the local SDK package at `node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.126_zod@4.4.3/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` includes `--include-partial-messages`, but the user's captured SSE still showed a single `tool_arguments_append` containing the entire JSON payload.

- Observation: the current Cradle browser store has no place to hold a tool independently of `UIMessage.parts`, so even a perfect delta stream still flows through whole-message reconciliation.
  Evidence: `apps/web/src/store/chat.ts` stores only `messagesMap` and `subagentMessagesMap`; `apps/web/src/features/chat/chat-render-plan.ts` derives every tool block from `message.parts`.

- Observation: once tool payload leaves `UIMessage.parts`, direct `MessageBubble` tests must seed `toolEntitiesMap` and `toolCallIdsByMessageId`; otherwise the execution-detail fold renders with no tool body.
  Evidence: `src/features/chat/message-bubble.test.tsx` failed until the fixture seeded tool entity state for `tool-1`.

- Observation: a Zustand selector that allocates a fresh grouped-tool array on every read will trip React's cached snapshot invariant and can cause a maximum update depth failure.
  Evidence: runtime debugging surfaced `The result of getSnapshot should be cached to avoid an infinite loop` and `Maximum update depth exceeded` from `apps/web/src/features/chat/message-bubble.tsx`; the fix was to subscribe to stable maps and derive grouped tool items with `useMemo`.

- Observation: hydration-time normalization and streaming-time message updates cannot share the same store write path without losing tool argument patches.
  Evidence: `apps/web/src/store/chat.ts` originally normalized messages inside both `setMessages` and `updateMessage`/`upsertSubagentMessage`. When `chat-streaming-handler.ts` wrote an already-normalized anchor snapshot, the store regenerated an empty tool entity and overwrote streamed `argumentsText`. Splitting hydration writes from streaming snapshot writes fixed the regression and made `chat-streaming-handler.test.ts` pass.

## Decision Log

- Decision: perform a destructive browser-side refactor that treats streamed tool calls as stateful entities, not as fully-owned `UIMessage.parts`.
  Rationale: this is the minimum change that unlocks immediate tool block mounting, per-tool subscriptions, partial-argument rendering, and future live artifact previews. Smaller fixes would preserve snapshot ownership and keep reintroducing the same lag.
  Date/Author: 2026-05-24 / Codex

- Decision: keep `UIMessage.parts` for text, reasoning, and file attachments, but reduce tool parts to lightweight anchors that point at store-owned tool entities.
  Rationale: text and reasoning already match the append-only snapshot model and are used by existing markdown rendering. Tool calls are the only part type that needs mutable entity semantics.
  Date/Author: 2026-05-24 / Codex

- Decision: preserve the existing SSE protocol shape for now (`part_add`, `tool_arguments_append`, `tool_input_set`, `tool_output_set`) and change only the browser projection and rendering layers in this plan.
  Rationale: the protocol already carries enough information to create a stable tool entity early. Changing the wire format is unnecessary for the first destructive pass and would broaden the blast radius into server persistence.
  Date/Author: 2026-05-24 / Codex

## Outcomes & Retrospective

The destructive browser-side refactor is complete for the streaming tool-call path covered by this plan. The browser now stores tool state independently from `UIMessage.parts`, hydration normalizes snapshot payloads into anchors plus entities, and `MessageBubble` renders tools through per-tool subscriptions instead of carrying mutable tool payload through render items. The runtime follow-up fixes mattered: grouped tool blocks now subscribe through stable store snapshots, and streaming message updates no longer re-run hydration normalization and wipe partial tool payload. The playground reproducer, targeted tests, and README updates now all describe the event-driven entity model rather than the old snapshot-driven reducer model.

## Context and Orientation

The relevant browser feature lives under `apps/web/src/features/chat`. The current data path has four important pieces.

`apps/web/src/features/chat/chat-delta-events.ts` defines renderer-side SSE deltas and applies them directly into `UIMessage.parts`. A `dynamic-tool` part currently stores mutable fields such as `argumentsText`, `input`, `output`, and `errorText`.

`apps/web/src/features/chat/chat-streaming-handler.ts` receives `message_delta` and `subagent_message_delta` events from SSE, deduplicates them by sequence number, and updates the Zustand store by calling `applyChatPartDeltas`.

`apps/web/src/store/chat.ts` stores message snapshots in `messagesMap` and subagent snapshots in `subagentMessagesMap`. There is no separate tool entity state. Because of that, a tool update can only be represented by replacing a whole `UIMessage` in the session array.

`apps/web/src/features/chat/message-bubble.tsx` calls `groupMessageParts` from `apps/web/src/features/chat/chat-render-plan.ts`. That helper loops over every `message.parts` entry, classifies any tool-looking part, groups consecutive tool calls, and produces render items. This means the render tree for tool calls is re-derived from the whole message snapshot on every change.

For this plan, a “tool entity” means a browser-owned record keyed by `toolCallId` that stores tool metadata (`toolName`, `state`), partial arguments text, structured input, result, error text, and subagent children. A “tool anchor part” means a lightweight `UIMessage.part` that exists only to preserve ordering relative to text and reasoning. The anchor does not own mutable tool payload. It only tells the renderer that a tool entity with a given `toolCallId` exists at this position in the message.

## Plan of Work

First, extend `apps/web/src/store/chat.ts` with a `toolStateMap`. The top-level shape must support:

- lookup by `messageId` to recover ordered tool anchors for a message;
- lookup by `toolCallId` to recover the latest tool entity data;
- lookup of subagent messages by parent tool call without forcing those messages back through `message.parts`.

The store will gain selectors such as `tool(messageId, toolCallId)`, `toolsForMessage(messageId)`, and `toolSubagents(messageId, toolCallId)`. Message snapshots remain in `messagesMap`, but their tool parts become lightweight anchors instead of fully mutable payload containers.

Second, rewrite the delta projection path. `apps/web/src/features/chat/chat-delta-events.ts` will stop mutating `argumentsText`, `input`, `output`, and `errorText` inside `dynamic-tool` parts. Instead, it will expose helpers that can:

- create or preserve a tool anchor part in `UIMessage.parts`;
- extract the tool patch implied by a delta;
- apply that patch to the store-owned tool entity.

`apps/web/src/features/chat/chat-streaming-handler.ts` will call both sides: it will update the message snapshot when text/reasoning/file content changes and separately patch the tool entity store when a tool delta arrives.

Third, replace the render plan. `apps/web/src/features/chat/chat-render-plan.ts` will no longer carry full tool payloads through render items. Its tool-related items will become references like `{ kind: 'tool-call', toolCallId, messageId }` and `{ kind: 'tool-group', toolCallIds, messageId, uiKind }`. `groupMessageParts` will classify tool groups by reading store-owned entities instead of reading mutable tool payload from `message.parts`.

Fourth, update `apps/web/src/features/chat/message-bubble.tsx`, `apps/web/src/features/chat/blocks/tool-call-block.tsx`, and `apps/web/src/features/chat/blocks/grouped-tool-call-block.tsx` so they subscribe to tool entities by identifier. The `MessageBubble` will only decide ordering and execution-phase folding. Each tool component will read the latest entity state directly from the store, so a single tool update does not invalidate siblings or require whole-message regrouping.

Fifth, update tests and documentation. The delta-event tests will verify that tool deltas create anchors plus independent tool-state patches. The message-bubble tests will verify that a tool block can render before `tool_output_set`. The chat README and store README will document that browser-owned tool entity state now owns tool streaming semantics. The playground scenario will simulate immediate tool appearance, incremental argument updates, and delayed result delivery.

## Concrete Steps

All commands below are run from the repository root `/Users/wibus/dev/Cradle`.

1. Create the plan file and keep it updated while implementing:

       ls docs/exec-plans
       open docs/exec-plans/20260524-02-chat-tool-entity-streaming.md

2. Implement the store/data-model changes and run targeted browser tests after each meaningful slice:

       pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom \
         src/features/chat/chat-delta-events.test.ts \
         src/features/chat/message-bubble.test.tsx \
         src/features/chat/tool-ui-classifier.test.ts

   Expected result after the refactor stabilizes:

       ✓ src/features/chat/chat-delta-events.test.ts
       ✓ src/features/chat/message-bubble.test.tsx
       ✓ src/features/chat/tool-ui-classifier.test.ts

3. Rebuild the playground to verify the synthetic stream scenarios still compile:

       pnpm --filter @cradle/playground build

   Expected result:

       ... build completed successfully ...

4. If browser-only TypeScript is clean enough to run locally, verify with:

       pnpm --filter @cradle/web exec tsc --noEmit

   This repository currently has unrelated pre-existing type failures in other files. If those remain, record them in `Surprises & Discoveries` and do not treat them as regressions unless this refactor adds new failures.

## Validation and Acceptance

Acceptance is behavior, not just code shape.

In the playground or a live chat session, start a tool-heavy run. As soon as the first `part_add` for a tool arrives, a tool card must appear in the message bubble even if the tool has not finished and even if its structured `input` is still incomplete. If the stream sends more `tool_arguments_append` deltas, the same card must update in place rather than disappearing and reappearing. When `tool_output_set` arrives, the same card must switch to the completed or error state without requiring a full message rerender.

For the execution-detail fold, acceptance means the final assistant text can remain folded away from tool execution details, but the presence or absence of the fold must no longer determine whether a tool block exists in the render tree. The tool block must already exist while streaming; the fold only controls visibility of the execution section.

For tests, acceptance means:

- `chat-delta-events.test.ts` proves tool arguments can stream independently of committed structured input and that tool state is retained across deltas.
- `message-bubble.test.tsx` proves a tool block can render before final output.
- the playground build succeeds with the new event-driven renderer.

## Idempotence and Recovery

This refactor is safe to apply incrementally. Message snapshots and tool entities will coexist during the transition, so a partial implementation can be retried without corrupting persisted server state. If a step fails midway, restore only the touched files in the current patch and rerun the targeted tests above; there is no database migration or server-side persistence change in this plan.

If the render plan becomes unstable during the migration, keep the message snapshot path authoritative for text and reasoning and temporarily route tool rendering through a compatibility selector from the new `toolStateMap`. Do not roll back to embedding mutable tool payload in `UIMessage.parts`, because that would reintroduce the architecture being removed.

## Artifacts and Notes

Important evidence already collected before implementation:

    apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts
      for await (const message of activeQuery) { ... yield chunk }

    apps/web/src/features/chat/chat-streaming-handler.ts
      useChatStore.getState().updateMessage(... applyChatPartDeltas(...))

    apps/web/src/features/chat/chat-render-plan.ts
      else if (part.type === 'dynamic-tool' ...) { items.push({ kind: 'tool-call', part: toolPart, ... }) }

These excerpts show that the current renderer still owns tool payload inside `message.parts`.

Evidence from the first completed slice:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom \
      src/features/chat/chat-delta-events.test.ts \
      src/features/chat/message-bubble.test.tsx

    Test Files  2 passed (2)
    Tests       4 passed (4)

Evidence after the runtime follow-up fixes:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom \
      src/features/chat/chat-delta-events.test.ts \
      src/features/chat/chat-streaming-handler.test.ts \
      src/features/chat/message-bubble.test.tsx \
      src/store/chat.test.ts

    Test Files  4 passed (4)
    Tests       6 passed (6)

    pnpm --filter @cradle/playground build

    ✓ built in 1.91s

## Interfaces and Dependencies

In `apps/web/src/store/chat.ts`, define a browser-owned tool state shape similar to:

    export interface ChatToolEntity {
      toolCallId: string
      messageId: string
      toolName: string
      state: ToolState
      argumentsText?: string
      input?: unknown
      output?: unknown
      errorText?: string
    }

    export interface ToolAnchorPart {
      type: 'dynamic-tool'
      toolCallId: string
      toolName: string
      state: ToolState
    }

The exact names may vary, but the final code must expose selectors that let a component subscribe by `toolCallId` without reading the full `UIMessage`.

In `apps/web/src/features/chat/chat-delta-events.ts`, keep the existing `ChatPartDelta` wire type but add browser helpers that separate message-snapshot patches from tool-entity patches.

In `apps/web/src/features/chat/chat-render-plan.ts`, tool render items must become references to store-owned entities rather than carrying full `RenderableToolPart` payloads by value.

In `apps/web/src/features/chat/blocks/tool-call-block.tsx` and `grouped-tool-call-block.tsx`, continue using the existing classifier and UI descriptor logic from `tool-ui-classifier.ts`, but feed them from store-owned tool entities.

Revision note: updated on 2026-05-24 after landing the first destructive slice (tool entity store, dual delta projection, and per-tool message bubble subscriptions). The update records completed work, the new test seeding requirement, and the current remaining scope.
