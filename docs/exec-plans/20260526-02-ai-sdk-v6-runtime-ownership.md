# Move Chat Runtime Streaming to AI SDK v6 Ownership

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The plan is self-contained: a reader with only this file and the repository can understand the target architecture, implement it, and validate the result.

## Purpose / Big Picture

Cradle currently converts provider events into AI SDK `UIMessageChunk` objects, but then converts those chunks again into Cradle-owned `ChatPartDelta` events before sending them to the web client. That second projection layer duplicates AI SDK v6's own message projection work and makes streaming harder to maintain. Cradle also has an older independent approval system that wraps AI SDK tools, blocks inside tool execution, and emits approval requests over a separate `/approvals/stream` SSE channel. After this change, all chat providers, including the Claude Agent SDK provider, will stream through AI SDK v6-native `UIMessageChunk` SSE, and AI SDK will own chunk parsing, message projection, tool part lifecycle, native `needsApproval` approval flow, subagent progress, and client-side state replacement.

The user-visible result is that chat streaming still shows assistant text, reasoning, tool calls, tool approval requests, tool approval responses, tool results, subagent progress, cancellation, and final persisted messages, but the data path no longer includes Cradle-owned `ChatPartDelta`, `ChatStreamEvent`, `applyChunkToProjection`, `wrapToolsWithApproval`, or custom client reducers for message parts. A developer can verify this by starting a chat response, inspecting the SSE frames, and seeing AI SDK `UIMessageChunk` objects such as `start`, `text-start`, `text-delta`, `tool-input-available`, `tool-approval-request`, `tool-output-available`, and `finish`, not Cradle `message_delta`, `subagent_message_delta`, or `approval.requested` events for AI SDK tool approvals.

## Progress

- [x] (2026-05-26 10:20Z) Verified the installed AI SDK version from the repository: `node -p "require('./node_modules/ai/package.json').version"` returns `6.0.168`.
- [x] (2026-05-26 10:24Z) Verified local AI SDK v6 APIs in `node_modules/ai/src`: `readUIMessageStream`, `processUIMessageStream`, `createUIMessageStream`, `createUIMessageStreamResponse`, `pipeUIMessageStreamToResponse`, `DefaultChatTransport`, `uiMessageChunkSchema`, and `JsonToSseTransformStream` exist.
- [x] (2026-05-26 10:30Z) Verified that `readUIMessageStream` outputs full `UIMessage` snapshots after each state update, while AI SDK HTTP/SSE transport uses `UIMessageChunk` as the wire format.
- [x] (2026-05-26 10:35Z) Verified current Cradle behavior: `ClaudeAgentProvider.streamTurn` yields `UIMessageChunk`, but `apps/server/src/modules/chat-runtime/service.ts` converts it to `ChatPartDelta` via `applyChunkToProjection` before SSE emission.
- [x] (2026-05-26 10:42Z) Created this ExecPlan to record the migration target and implementation sequence.
- [x] (2026-05-26 11:05Z) Verified AI SDK v6 native tool approval APIs: tool `needsApproval`, `tool-approval-request` chunks, client `addToolApprovalResponse`, `lastAssistantMessageIsCompleteWithApprovalResponses`, `convertToModelMessages`, and `collectToolApprovals`.
- [x] (2026-05-26 11:10Z) Recorded the hard design constraint that AI SDK tool approvals must not use Cradle `wrapToolsWithApproval` or the separate approval SSE system.
- [ ] Implement an AI SDK-owned stream writer for `POST /chat/sessions/:sessionId/response` and `GET /chat/sessions/:sessionId/stream`.
- [ ] Migrate the web client from `buildEventStreamFromResponse` and `ChatStreamingHandler` delta reducers to AI SDK v6 `DefaultChatTransport` or a thin transport that returns `ReadableStream<UIMessageChunk>`.
- [ ] Replace Cradle's AI SDK tool approval wrapper with native AI SDK `needsApproval` policy functions and chat-message-local approval response UI.
- [ ] Convert subagent progress to AI SDK's preliminary tool result pattern, so subagent streaming is represented inside tool outputs rather than Cradle `subagent_message_delta` routing.
- [ ] Remove Cradle-owned delta projection files and update route OpenAPI descriptions, README files, and references.
- [ ] Validate all providers and run typecheck plus focused tests.

## Surprises & Discoveries

- Observation: AI SDK v6's default HTTP/SSE wire format is `UIMessageChunk`, not full `UIMessage` snapshot.
  Evidence: `node_modules/ai/src/ui-message-stream/pipe-ui-message-stream-to-response.ts` pipes a `ReadableStream<UIMessageChunk>` through `JsonToSseTransformStream`, and `node_modules/ai/src/ui/default-chat-transport.ts` parses SSE frames using `uiMessageChunkSchema`.

- Observation: `readUIMessageStream` is still important, but its role is local projection from chunk stream to complete `UIMessage` snapshots, not the default client/server wire protocol.
  Evidence: `node_modules/ai/src/ui-message-stream/read-ui-message-stream.ts` calls `processUIMessageStream` and enqueues `structuredClone(state.message)` on every write.

- Observation: The current hot path is not always snapshot diffing. The main Cradle stream path calls `applyChunkToProjection`; snapshot diffing through `applySnapshotToProjection` is a separate path.
  Evidence: `apps/server/src/modules/chat-runtime/service.ts` calls `applyChunkToProjection` inside `applyAndPublishChunk`, while `applySnapshotToProjection` is used by `applyAndPublishSnapshot`.

- Observation: The Claude Agent SDK provider is already close to the target boundary because it yields `UIMessageChunk`.
  Evidence: `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` maps each Claude SDK message with `mapClaudeAgentMessageToChunks` and then `yield chunk` for each mapped chunk.

- Observation: Subagent routing must not be solved by mixing multiple independent assistant messages into one AI SDK chunk stream and expecting `processUIMessageStream` to split them automatically.
  Evidence: `node_modules/ai/src/ui/process-ui-message-stream.ts` maintains one `StreamingUIMessageState` with one `state.message`; it does not route chunks by arbitrary Cradle metadata.

- Observation: AI SDK v6 has a native approval flow that should replace Cradle's blocking tool wrapper. Tool definitions can declare `needsApproval`; `streamText` emits a `tool-approval-request` chunk instead of executing the tool; the client calls `addToolApprovalResponse`; the next request includes a `tool-approval-response` in model history; then `collectToolApprovals` executes approved tools or records denied execution.
  Evidence: `node_modules/ai/src/generate-text/is-approval-needed.ts`, `node_modules/ai/src/generate-text/run-tools-transformation.ts`, `node_modules/ai/src/ui/process-ui-message-stream.ts`, `node_modules/ai/src/ui/chat.ts`, `node_modules/ai/src/ui/convert-to-model-messages.ts`, and `node_modules/ai/src/generate-text/collect-tool-approvals.ts`.

- Observation: The docs table for `tool().needsApproval` is less precise than the local source call site. The source invokes a function-valued `needsApproval` as `tool.needsApproval(toolCall.input, { toolCallId, messages, experimental_context })`.
  Evidence: `node_modules/ai/src/generate-text/is-approval-needed.ts` lines for the runtime call.

- Observation: Cradle's current AI SDK approval wrapper blocks inside tool `execute`, which is the inverse of AI SDK's native flow.
  Evidence: `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts` wraps `execute`, calls `ApprovalService.requestApproval`, waits for a response, and only then calls the original tool.

## Decision Log

- Decision: AI SDK v6 owns chat streaming semantics end to end. Cradle providers may adapt external provider events into AI SDK `UIMessageChunk`, but Cradle must not own a second message projection protocol.
  Rationale: AI SDK v6 already provides the chunk schema, SSE encoding, client parsing, message projection, tool part lifecycle, metadata handling, and subagent progress pattern. Duplicating those semantics in Cradle adds CPU cost and maintenance burden without meaningful product value.
  Date/Author: 2026-05-26 / Codex

- Decision: The target server wire format is AI SDK `UIMessageChunk` SSE, not Cradle `ChatStreamEvent` SSE and not custom `UIMessage` snapshot SSE.
  Rationale: `DefaultChatTransport` expects `UIMessageChunk` frames and AI SDK's own response helpers emit that format. Sending snapshots would require another custom transport and would still bypass AI SDK's primary client-side streaming path.
  Date/Author: 2026-05-26 / Codex

- Decision: Subagent streaming should follow AI SDK's preliminary tool result pattern wherever possible.
  Rationale: AI SDK v6 documents subagent progress as a tool whose async generator yields accumulated `UIMessage` outputs. This keeps the subagent lifecycle attached to the parent tool part and avoids Cradle-specific `subagent_message_delta` routing.
  Date/Author: 2026-05-26 / Codex

- Decision: Cradle may keep ownership of provider selection, session lifecycle, authorization, queueing, persistence, observability, and provider-specific adapters, but not chunk-to-message projection.
  Rationale: These are Cradle product responsibilities. AI SDK does not know Cradle sessions, SQLite persistence, profile selection, or queueing. The boundary is clean only if Cradle owns orchestration and AI SDK owns streaming/message semantics.
  Date/Author: 2026-05-26 / Codex

- Decision: All providers must end at the same AI SDK-owned runtime boundary.
  Rationale: Provider-specific streaming protocols are allowed only behind adapters. By the time data leaves a provider runtime and enters `chat-runtime/service.ts`, the stream must be AI SDK `UIMessageChunk` or an AI SDK `UIMessageStream`. OpenAI-compatible, Claude Agent SDK, Codex SDK, ACP, mock, and system-agent providers must not introduce provider-specific client stream protocols.
  Date/Author: 2026-05-26 / Codex

- Decision: AI SDK native `needsApproval` is the only approval mechanism for AI SDK tool execution.
  Rationale: AI SDK v6 already models tool approval as part of the `UIMessageChunk` stream and message history. Keeping `wrapToolsWithApproval` would block server execution, bypass `tool-approval-request`, duplicate UI state, and break the goal that AI SDK owns tool lifecycle semantics.
  Date/Author: 2026-05-26 / Codex

- Decision: The independent Cradle `/approvals/stream` SSE system must not carry AI SDK chat tool approvals after this migration.
  Rationale: Approval requests for AI SDK tools must appear in the chat message as tool parts with `state: 'approval-requested'`. The user's response must call `addToolApprovalResponse`, which updates the `UIMessage` and sends the next request with `tool-approval-response` in history. A separate approval SSE path would create a second source of truth.
  Date/Author: 2026-05-26 / Codex

- Decision: Cradle approval preferences and "always allow" policy may survive only as inputs to AI SDK `needsApproval` policy functions, not as an execution wrapper or separate stream.
  Rationale: Cradle can own product policy, audit, and user preference storage, but the execution decision must be expressed to AI SDK by returning `true` or `false` from `needsApproval`. If a user chooses "always allow" in the UI, Cradle may persist that policy before calling `addToolApprovalResponse({ approved: true })`; future calls then return `false` from `needsApproval`.
  Date/Author: 2026-05-26 / Codex

## Outcomes & Retrospective

This plan has captured the investigation and target architecture. No implementation has been performed yet. The expected final outcome is a smaller chat streaming system where AI SDK v6 is the only owner of `UIMessageChunk` parsing, `UIMessage` projection, tool lifecycle, approval request/response state, and subagent streaming shape, while Cradle keeps only orchestration, persistence, queueing, provider adaptation, product policy, and optional approval audit records.

## Context and Orientation

The repository root is `/Users/wibus/dev/Cradle`. The package manager is `pnpm@11.2.2`, and the installed AI SDK package is `ai@6.0.168`. The relevant local source of truth for AI SDK behavior is inside `node_modules/ai/src` and `node_modules/ai/docs`.

An AI SDK `UIMessageChunk` is a small streaming event such as `text-start`, `text-delta`, `text-end`, `tool-input-available`, `tool-output-available`, `start`, or `finish`. AI SDK uses these chunks to build a full `UIMessage`, which is a chat message with an `id`, `role`, optional `metadata`, and a `parts` array. Projection means updating the current full `UIMessage` as chunks arrive.

Current server provider flow is split across these files:

- `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` defines the provider interface. `streamTurn` returns `AsyncGenerator<UIMessageChunk, void, void>`.
- `apps/server/src/modules/chat-runtime/providers/claude-agent/mapper.ts` adapts Claude Agent SDK messages into AI SDK `UIMessageChunk[]`.
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` reads Claude Agent SDK messages and yields mapped chunks.
- `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts` uses `streamText().toUIMessageStream()` for AI SDK-native model providers and also contains `executeAiSdkTurnSnapshots`, which should be retired unless a local-only snapshot use remains.
- `apps/server/src/modules/chat-runtime/service.ts` currently receives provider chunks, applies Cradle projection with `applyChunkToProjection`, persists snapshots per chunk, and emits Cradle `ChatStreamEvent` SSE.
- `apps/server/src/modules/chat-runtime/delta-events.ts` contains the Cradle-owned projection engine and delta types that must be removed or reduced to migration-only tests.
- `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts` contains the legacy AI SDK tool approval wrapper. It must be removed from the AI SDK path because it blocks inside `execute` instead of emitting AI SDK `tool-approval-request` chunks.
- `apps/server/src/modules/approval/index.ts` and `apps/server/src/modules/approval/service.ts` implement a separate Cradle approval HTTP/SSE system. After this migration, that system must not be used for AI SDK chat tool approvals. If it remains for non-AI-SDK provider protocols or audit, it must be clearly outside the AI SDK tool execution path.

Current web client flow is split across these files:

- `apps/web/src/features/chat/sse-chat-transport.ts` parses Cradle `ChatStreamEvent` SSE with Zod and emits run lifecycle events.
- `apps/web/src/features/chat/chat-streaming-handler.ts` applies `ChatPartDelta[]` into Zustand messages.
- `apps/web/src/features/chat/chat-delta-events.ts` contains the client reducer for Cradle deltas.
- `apps/web/src/features/chat/chat-chunk-reducer.ts` contains another Cradle-owned chunk reducer and should be audited for removal.
- `apps/web/src/features/chat/use-chat-session.ts` creates optimistic user messages, starts response streams, parses Cradle events, and drives `ChatStreamingHandler`.
- `apps/web/src/store/chat.ts` owns Cradle's current Zustand chat state and will remain the app state owner, but should receive full `UIMessage` updates from AI SDK projection rather than `ChatPartDelta`.
- `apps/web/src/features/approval/use-approval.ts`, `apps/web/src/features/approval/approval-card.tsx`, and `apps/web/src/features/approval/approval-inbox.tsx` subscribe to and render the old approval SSE system. They must not be used for AI SDK tool approvals after migration. AI SDK tool approvals must render from chat message parts whose state is `approval-requested`.

The AI SDK v6 APIs to use are:

- `streamText().toUIMessageStream()` for providers backed by AI SDK language models.
- `createUIMessageStream()` when Cradle needs to create a stream by writing AI SDK chunks manually or merging streams.
- `createUIMessageStreamResponse()` or `pipeUIMessageStreamToResponse()` when a route can directly return or pipe an AI SDK chunk stream.
- `DefaultChatTransport` when the web client can let AI SDK fetch and parse the response.
- `uiMessageChunkSchema` and `parseJsonEventStream` only when a thin custom transport is needed.
- `readUIMessageStream()` for local aggregation to full `UIMessage` snapshots, especially for persistence or preliminary tool outputs, not as the default server-to-client wire format.
- `needsApproval` on AI SDK tools to request user confirmation before execution.
- `addToolApprovalResponse({ id, approved, reason?, options? })` on the AI SDK chat client to record approval responses.
- `lastAssistantMessageIsCompleteWithApprovalResponses` as the `sendAutomaticallyWhen` predicate when the UI should automatically continue after all approval requests in the latest assistant step have responses.
- `convertToModelMessages()` to serialize `approval-responded` UI parts into model history as `tool-approval-response`.

## Plan of Work

Milestone 1 establishes the AI SDK stream contract at the server boundary. Update `apps/server/src/modules/chat-runtime/service.ts` so an active run stores and publishes AI SDK `UIMessageChunk` frames instead of Cradle `ChatStreamEvent` delta frames. Replace `RunSubscriber = (event: ChatStreamEvent, terminal: boolean) => void` with a stream item type that can represent an AI SDK chunk plus terminal status. The emitted SSE data must be exactly the AI SDK JSON chunk object accepted by `uiMessageChunkSchema`. For `POST /chat/sessions/:sessionId/response`, return a `ReadableStream<Uint8Array>` that writes `data: ${JSON.stringify(chunk)}\n\n` for each chunk, with headers compatible with AI SDK UI message streams. Keep Cradle headers such as `x-cradle-run-id`, `x-cradle-assistant-message-id`, and `x-cradle-user-message-id` because they are Cradle session metadata, not message projection.

Milestone 2 removes server-side Cradle projection from the hot path. In `service.ts`, replace `applyAndPublishChunk` with a function that records the raw provider chunk, publishes the raw AI SDK chunk, and updates a local AI SDK projection only for final persistence. The projection for persistence should use AI SDK's `readUIMessageStream` or `processUIMessageStream`, not `applyChunkToProjection`. Do not write SQLite on every chunk. Persist the final assistant `UIMessage` once when a run reaches `finish`, `abort`, or `error`. Persist intermediate snapshots only if a crash recovery requirement is explicitly reintroduced later; it is not part of this plan.

Milestone 3 makes the web client consume AI SDK v6 streams. Prefer `DefaultChatTransport` if it can fit the current `startChatResponse` and `subscribeChatSessionStream` endpoints without losing Cradle headers. If headers such as `x-cradle-run-id` must be read before streaming, implement a thin local transport in `apps/web/src/features/chat` whose `sendMessages` returns `ReadableStream<UIMessageChunk>` and uses AI SDK's `parseJsonEventStream` plus `uiMessageChunkSchema` instead of Cradle Zod schemas. The client-side projection must be AI SDK's `processUIMessageStream` through `AbstractChat`, `useChat`, or a tiny adapter that uses the same AI SDK API. The Zustand store should receive full `UIMessage` replacement updates, matching AI SDK's own `AbstractChat` behavior.

Milestone 4 migrates AI SDK tool approvals to native `needsApproval`. Remove `approvalContext` and `wrapToolsWithApproval` from `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts`. Delete or retire `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts` after all imports are gone. Configure tools with `needsApproval` at the point where the AI SDK `ToolSet` is created. A tool should return `false` from `needsApproval` when Cradle policy says the operation is safe or already allowed, and `true` when the user must approve it. The tool `execute` function must not block on Cradle approval. On the web side, render approval controls from tool parts with `state: 'approval-requested'`; approve or deny by calling `addToolApprovalResponse({ id: part.approval.id, approved, reason })`. Configure automatic continuation with `lastAssistantMessageIsCompleteWithApprovalResponses` unless the UI intentionally requires a manual continue action.

Milestone 5 removes the old approval stream from the AI SDK tool path. Stop using `/approvals/stream`, `approval.requested`, and `approval.resolved` for AI SDK chat tool approval requests. Remove references from chat UI flows and generated CLI flows that only existed to answer AI SDK tool approvals. If `apps/server/src/modules/approval` remains for non-AI-SDK provider protocols, document that it is not part of AI SDK chat tool approval. If it is no longer used anywhere, delete it and update generated CLI commands and README inventories in the affected directories.

Milestone 6 converts subagent progress to AI SDK's preliminary tool result pattern. A preliminary tool result is an intermediate tool output yielded by an async generator before the final tool output. For subagents, the yielded output should be a complete accumulated `UIMessage` snapshot generated by `readUIMessageStream({ stream: subagentResult.toUIMessageStream() })` or by the equivalent provider adapter. Each yield replaces the previous tool output. The UI should render the subagent inside the parent tool part. This removes the need for `subagent_message_delta`, `parentToolCallId` routing events, and per-subagent `partIndex` deltas.

Milestone 7 aligns all providers. Each provider may adapt its external protocol into AI SDK chunks internally, but the exported `streamTurn` boundary must stay AI SDK-native. `ClaudeAgentProvider` should keep `mapClaudeAgentMessageToChunks`, but remove Cradle-only routing metadata unless it is displayed as ordinary UI metadata. `OpenAICompatibleProvider` should use `executeAiSdkTurn`, not `executeAiSdkTurnSnapshots`, unless a local-only test proves snapshots are still required. `Codex`, `ACP`, `mock-claude-agent`, and `system-agent` providers should be audited so no provider emits Cradle stream events, depends on `ChatPartDelta`, or uses a Cradle-owned approval stream for AI SDK tool approval semantics.

Milestone 8 removes obsolete code and updates documentation. Delete `apps/server/src/modules/chat-runtime/delta-events.ts` after all imports are gone. Delete or rewrite `apps/web/src/features/chat/chat-delta-events.ts`, `apps/web/src/features/chat/chat-streaming-handler.ts`, `apps/web/src/features/chat/sse-chat-transport.ts`, and `apps/web/src/features/chat/chat-chunk-reducer.ts` according to remaining responsibilities. Delete `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts` after native `needsApproval` is in place. Update `apps/server/src/modules/chat-runtime/index.ts` route descriptions so they describe AI SDK UI message stream SSE, not `message_delta`, `subagent_message_delta`, or approval side-channel events. Update `apps/server/src/modules/chat-runtime/README.md`, `apps/server/src/modules/approval/README.md`, and affected `apps/web/src/features/chat/README.md` or `apps/web/src/features/approval/README.md` if present.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle` unless a step explicitly says otherwise.

First, confirm the AI SDK version and API availability before coding:

    node -p "require('./node_modules/ai/package.json').version"
    rg -n "readUIMessageStream|processUIMessageStream|pipeUIMessageStreamToResponse|DefaultChatTransport|uiMessageChunkSchema" node_modules/ai/src

Expected output includes version `6.0.168` and matches in `node_modules/ai/src/ui-message-stream`, `node_modules/ai/src/ui`, and `node_modules/ai/src/index.ts`.

Next, map current Cradle-owned projection entry points:

    rg -n "ChatPartDelta|ChatStreamEvent|applyChunkToProjection|applyChatPartDeltas|buildEventStreamFromResponse|chat-chunk-reducer|subagent_message_delta" apps/server/src apps/web/src

Expected output lists the files named in the orientation section. During implementation, this command should shrink until only migration notes or no matches remain.

Map the current legacy approval entry points:

    rg -n "wrapToolsWithApproval|ToolApprovalContext|approvalContext|/approvals/stream|approval.requested|approval.resolved|addToolApprovalResponse|needsApproval" apps/server/src apps/web/src node_modules/ai/src

Expected output initially includes `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts`, `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts`, `apps/server/src/modules/approval`, `apps/web/src/features/approval`, and AI SDK source files. During implementation, production code in the AI SDK chat path should keep `needsApproval` and `addToolApprovalResponse` references but lose `wrapToolsWithApproval`, `ToolApprovalContext`, and `/approvals/stream` dependencies.

Implement Milestone 1 and Milestone 2 in `apps/server/src/modules/chat-runtime/service.ts`. Keep route function names stable unless a cleaner rename is clearly worth the blast radius. Add a small server-side helper that converts `UIMessageChunk` to SSE by JSON-stringifying the chunk exactly once. Do not wrap the chunk in a Cradle event object.

Implement Milestone 3 in the web chat feature. If using `DefaultChatTransport`, configure it to call the existing Cradle endpoint and pass the same request body shape currently sent by `startChatResponse`. If a thin custom transport is needed, it must expose the same shape as AI SDK's `ChatTransport` and return parsed `UIMessageChunk` objects. Do not recreate `applyChatPartDeltas`.

Implement Milestone 4 by moving approval decisions into tool definitions. A minimal approved shape is:

    const sensitiveTool = tool({
      description: 'Run a sensitive operation',
      inputSchema,
      needsApproval: async (input, options) => {
        return shouldRequestApproval({ input, toolCallId: options.toolCallId })
      },
      execute: async (input, options) => {
        return runSensitiveOperation(input, options)
      },
    })

Do not call `ApprovalService.requestApproval` from `execute`. Do not add an EventSource subscription to answer AI SDK tool approvals.

Implement Milestone 6 by changing subagent handling so parent tool outputs carry subagent progress snapshots. The implementation should follow the AI SDK docs pattern already present in `node_modules/ai/docs/03-agents/06-subagents.mdx`: the subagent stream is read through `readUIMessageStream`, and each yielded complete `UIMessage` replaces the previous tool output.

After each milestone, run:

    pnpm typecheck

For focused test coverage, run existing tests first:

    pnpm test -- apps/web/src/features/chat/chat-streaming-handler.test.ts apps/web/src/features/chat/chat-delta-events.test.ts

These two tests are expected to be deleted or rewritten when the delta reducer is removed. Their replacement should verify AI SDK chunk streaming and full message replacement behavior. If a route-level test suite exists for `apps/server/src/modules/chat-runtime`, add or update tests there so a stream emits AI SDK chunk frames and final persistence writes one assistant message.

Before completion, run:

    pnpm lint
    pnpm typecheck
    pnpm test

## Validation and Acceptance

Acceptance is based on observable behavior, not only compilation.

For server SSE format, start a chat response against a provider that can produce streaming text. Inspect the response body. The stream must contain frames like:

    data: {"type":"start","messageId":"assistant-..."}

    data: {"type":"text-start","id":"..."}

    data: {"type":"text-delta","id":"...","delta":"Hello"}

    data: {"type":"text-end","id":"..."}

    data: {"type":"tool-approval-request","approvalId":"...","toolCallId":"..."}

    data: {"type":"finish","finishReason":"stop"}

The stream must not contain:

    data: {"type":"message_delta",...}
    data: {"type":"subagent_message_delta",...}
    "deltas":[...]
    "partIndex"
    data: {"type":"approval.requested",...}

For the web client, send a normal message from the chat UI. The assistant response should stream progressively. The store should replace or append full `UIMessage` snapshots as AI SDK projection updates them. Text, reasoning, tool calls, and tool results should render with the same or better behavior than before.

For native tool approval, trigger a tool whose `needsApproval` returns `true`. The network stream should contain a `tool-approval-request` AI SDK chunk. The chat UI should render the corresponding tool part with `state: 'approval-requested'`. Approving should call `addToolApprovalResponse({ id, approved: true })`, update the tool part to `approval-responded`, and then send the next request. The next request's model history must include a `tool-approval-response`; the server should execute the approved tool and stream a `tool-output-available` chunk. Denying should call `addToolApprovalResponse({ id, approved: false, reason })` and produce AI SDK's denied execution behavior. No request should be sent to `/approvals/{approvalId}/respond` for this AI SDK tool approval.

For approval cleanup, run:

    rg -n "wrapToolsWithApproval|ToolApprovalContext|approvalContext|approval.requested|approval.resolved|/approvals/stream" apps/server/src apps/web/src

At completion, this should return no references in the AI SDK chat path. If the approval module remains for non-AI-SDK provider protocols, remaining references must be isolated to those protocols and documented as outside AI SDK tool approval.

For subagent progress, trigger a provider flow that starts a subagent. The UI should show subagent progress inside the parent tool part as preliminary tool output. The stream should remain AI SDK chunk SSE. There should be no Cradle `subagent_message_delta` event in the network response.

For persistence, inspect the chat session after the run completes and reload the page. The final assistant message should be present with the complete `parts` array. SQLite writes should occur at terminal persistence points, not once per chunk. If logging is available, the number of final message persistence calls for one assistant response should be one in the non-error happy path.

For cleanup, run:

    rg -n "ChatPartDelta|ChatStreamEvent|applyChunkToProjection|applyChatPartDeltas|subagent_message_delta|message_delta" apps/server/src apps/web/src

At completion, this should return no production-code references. If tests or historical docs still mention these names, they must clearly mark them as removed legacy behavior or be deleted.

## Idempotence and Recovery

Most steps are code edits and can be repeated safely. The migration should be implemented in small milestones so `pnpm typecheck` can be run after each major edit. Avoid destructive Git commands. Do not use `git reset --hard` or force pushes as part of this plan.

If the server stream conversion breaks the web client, keep the server route compiling and temporarily add a focused parser test that consumes AI SDK chunk SSE directly. Then repair the client transport against that test. Do not reintroduce `ChatPartDelta` as a compatibility layer.

If subagent preliminary tool output cannot represent one of Cradle's current UI states, add the missing state as AI SDK-compatible tool output data. Do not add a second message projection protocol. If truly separate concurrent subagent messages are required later, the only acceptable fallback is a minimal route envelope around `UIMessageChunk`, not `partIndex` deltas; this fallback must be recorded as a new decision before implementation.

If final-only persistence loses necessary recovery behavior, add a documented recovery checkpoint mechanism based on AI SDK `UIMessage` snapshots. The checkpoint must be a persistence concern only and must not become the client streaming protocol.

If native AI SDK approval does not cover a non-AI-SDK provider protocol, do not route that provider's approval through AI SDK unless the provider is actually represented as AI SDK tools. Keep any non-AI-SDK approval system explicitly outside the AI SDK chat tool approval path and document the ownership boundary. For AI SDK tools, falling back to `wrapToolsWithApproval` is not allowed.

## Artifacts and Notes

Current AI SDK v6 source evidence:

    node_modules/ai/src/ui-message-stream/read-ui-message-stream.ts
      readUIMessageStream consumes UIMessageChunk and enqueues structuredClone(state.message).

    node_modules/ai/src/ui/process-ui-message-stream.ts
      processUIMessageStream maintains activeTextParts, activeReasoningParts, partialToolCalls, message.metadata, and tool part state.

    node_modules/ai/src/ui-message-stream/pipe-ui-message-stream-to-response.ts
      pipeUIMessageStreamToResponse accepts ReadableStream<UIMessageChunk> and serializes it as SSE.

    node_modules/ai/src/ui/default-chat-transport.ts
      DefaultChatTransport parses SSE using uiMessageChunkSchema and returns ReadableStream<UIMessageChunk>.

    node_modules/ai/docs/03-agents/06-subagents.mdx
      The documented subagent streaming pattern uses readUIMessageStream and async generator preliminary tool results.

    node_modules/ai/src/generate-text/is-approval-needed.ts
      Runtime source for needsApproval. Function-valued needsApproval receives the tool input and an options object with toolCallId, messages, and experimental_context.

    node_modules/ai/src/generate-text/run-tools-transformation.ts
      Emits tool-approval-request instead of executing a tool when approval is needed during streaming.

    node_modules/ai/src/ui/process-ui-message-stream.ts
      Converts tool-approval-request chunks into tool UI parts with state approval-requested and approval id.

    node_modules/ai/src/ui/chat.ts
      Defines addToolApprovalResponse and updates the latest assistant message to approval-responded.

    node_modules/ai/src/ui/convert-to-model-messages.ts
      Converts approval-responded tool UI parts into tool-approval-response content in model history.

    node_modules/ai/src/generate-text/collect-tool-approvals.ts
      Reads tool-approval-response content from the latest tool message and decides which tool calls are approved or denied.

Current Cradle source evidence:

    apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts
      ClaudeAgentProvider.streamTurn yields UIMessageChunk objects after mapping Claude SDK messages.

    apps/server/src/modules/chat-runtime/providers/claude-agent/mapper.ts
      mapClaudeAgentMessageToChunks converts Claude SDK messages to UIMessageChunk[].

    apps/server/src/modules/chat-runtime/service.ts
      applyAndPublishChunk converts UIMessageChunk to ChatPartDelta and publishStreamEvent wraps deltas in ChatStreamEvent.

    apps/web/src/features/chat/sse-chat-transport.ts
      buildEventStreamFromResponse parses ChatStreamEvent, not AI SDK UIMessageChunk.

    apps/web/src/features/chat/chat-streaming-handler.ts
      ChatStreamingHandler applies ChatPartDelta[] to UIMessage snapshots in Zustand.

    apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts
      Legacy wrapper blocks inside tool execute and calls the Cradle approval service. This is incompatible with native AI SDK needsApproval ownership.

    apps/server/src/modules/approval/index.ts
      Legacy approval SSE endpoint emits approval.requested and approval.resolved. This must not carry AI SDK tool approvals after migration.

## Interfaces and Dependencies

The repository must use `ai@6.0.168` or a later AI SDK v6 version whose local source exposes the same APIs. Before relying on newer behavior, re-run the API search in `node_modules/ai/src` and update this plan with any differences.

The provider boundary remains:

    streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void>

This is defined in `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`. All providers must implement this AI SDK-native boundary. Providers may internally adapt non-AI-SDK protocols, such as Claude Agent SDK `SDKMessage`, ACP updates, Codex SDK events, or mock data, but must not return Cradle stream events.

The server stream boundary should become:

    type AiSdkRunStreamItem =
      | { type: 'chunk'; chunk: UIMessageChunk }
      | { type: 'terminal'; status: 'complete' | 'aborted' | 'failed'; errorText?: string }

The exact type name may change during implementation, but the concept must remain: subscribers receive AI SDK chunks for the client stream and terminal status for Cradle orchestration. Terminal status must not be encoded as a Cradle message delta. Where possible, terminal status should correspond to AI SDK chunks such as `finish`, `abort`, or `error`.

The web client stream boundary should become a `ReadableStream<UIMessageChunk>`. It may be produced by AI SDK `DefaultChatTransport` or by a thin custom transport that uses AI SDK parsing primitives. It must not parse `ChatStreamEvent`.

The store update boundary should become full message replacement:

    updateMessage(sessionId: string, messageId: string, updater: (message: UIMessage) => UIMessage): void

or an equivalent operation that replaces the complete `UIMessage` snapshot produced by AI SDK projection. It must not apply `ChatPartDelta`.

The subagent output shape should be an AI SDK tool output containing an accumulated `UIMessage` snapshot or a small typed object that includes that snapshot. The parent tool part owns the display location. Cradle should not route subagent chunks by `parentToolCallId` in the client stream.

The approval boundary for AI SDK tools is:

    needsApproval?: boolean | ((input: unknown, options: { toolCallId: string; messages: ModelMessage[]; experimental_context: unknown }) => boolean | Promise<boolean>)

The exact generic type is provided by AI SDK's `Tool` type. Implementers should let TypeScript infer it from `tool({ ... })`; the signature above describes the runtime call shape observed in `ai@6.0.168`. `needsApproval` is the only place where Cradle policy can decide whether an AI SDK tool call should pause for user approval.

The web approval response boundary for AI SDK tools is:

    addToolApprovalResponse({ id, approved, reason, options })

The `id` must be `part.approval.id` from a tool UI part whose state is `approval-requested`. The response must update the `UIMessage` to `approval-responded` and continue by using AI SDK's automatic send predicate or an explicit AI SDK chat send. It must not call `/approvals/:approvalId/respond`.

Revision note 2026-05-26: Initial plan created after local investigation of `ai@6.0.168` and current Cradle chat runtime. The plan records the architectural decision that all providers end at an AI SDK v6-owned streaming and projection boundary, with Cradle retaining only orchestration, persistence, provider adaptation, and product-specific state.

Revision note 2026-05-26: Added native AI SDK tool approval constraints after investigating `needsApproval`, `tool-approval-request`, `addToolApprovalResponse`, `convertToModelMessages`, and `collectToolApprovals`. The plan now explicitly forbids `wrapToolsWithApproval` and the independent Cradle approval SSE system for AI SDK chat tool approvals.
