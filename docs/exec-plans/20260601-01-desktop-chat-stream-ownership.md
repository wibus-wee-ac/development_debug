# Desktop-Owned Chat Stream Transport

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a reader should be able to understand the current multi-window chat streaming problem, which code owns each layer, what to change, and how to verify the finished behavior without relying on prior conversation.

## Purpose / Big Picture

Cradle Desktop can open multiple Electron `BrowserWindow` instances, including the main window and detached chat windows. Those windows have independent JavaScript state, but they currently share Electron's Chromium network session and therefore share the per-origin HTTP/1.1 connection limit. Chat streaming uses long-lived server-sent event responses, so multiple windows looking at the same active chat session can consume most or all available local server connections and leave ordinary requests stuck in pending or stalled state.

After this change, Electron Desktop owns long-lived chat transport in the main process. Renderer windows no longer open their own chat SSE connections in desktop mode. The main process opens at most one upstream server stream for a chat session or active run, then fans accepted AI SDK `UIMessageChunk` frames out to renderer windows over IPC. A user can verify the result by opening the main chat view and a detached window for the same session, starting a streaming response, and observing that the desktop broker reports one upstream chat stream while both windows continue to render the same live assistant response.

## Progress

- [x] (2026-06-01 00:22 +0800) Read the ExecPlan rules and confirmed this plan must be self-contained, living, and validation-focused.
- [x] (2026-06-01 00:22 +0800) Statically inspected the current chat streaming flow in `apps/web/src/features/chat/use-chat-session.ts`, `apps/web/src/features/chat/chat-response-command.ts`, `apps/web/src/features/chat/sse-chat-transport.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/main-app.ts`, `apps/desktop/src/main/window-manager.ts`, and `apps/server/src/modules/chat-runtime/service.ts`.
- [x] (2026-06-01 00:22 +0800) Confirmed that the existing working tree already contains unrelated uncommitted chat runtime and provider changes. This plan must not revert or rewrite those changes.
- [x] (2026-06-01 00:22 +0800) Created this ExecPlan as `docs/exec-plans/20260601-01-desktop-chat-stream-ownership.md`.
- [x] (2026-06-01 12:20 +0800) Implemented `apps/desktop/src/main/chat-stream-broker.ts` with one upstream stream per session, renderer subscriber fanout, done/error/abort cleanup, passive final-unsubscribe abort, response-stream no-subscriber retention, and diagnostics.
- [x] (2026-06-01 12:20 +0800) Exposed the broker through `chatStream.*` IPC methods in `apps/desktop/src/main/native-services.ts` and preload methods/events in `apps/desktop/src/preload/index.ts`.
- [x] (2026-06-01 12:20 +0800) Added `apps/web/src/features/chat/chat-stream-transport.ts`, preserving HTTP SSE fallback and using Electron IPC when `window.cradle.chatStream` is available.
- [x] (2026-06-01 12:20 +0800) Routed `useChatSession` send, passive join, and approval continuation through the new transport abstraction.
- [x] (2026-06-01 12:20 +0800) Added focused tests for broker fanout/cleanup/retention and renderer Electron/error/HTTP fallback transport behavior.
- [x] (2026-06-01 12:20 +0800) Ran focused desktop and web validation and recorded results below.
- [x] (2026-06-01 12:27 +0800) Tightened broker reuse rules so a `POST /response` request cannot accidentally reuse a passive `GET /stream` upstream entry, and added regression coverage for that edge case.
- [x] (2026-06-01 12:32 +0800) Added main-process replay buffering so renderer windows that subscribe after an upstream has already emitted initial AI SDK chunks receive the full accepted chunk prefix before live chunks.
- [x] (2026-06-01 12:36 +0800) Added per-subscriber replay cursors so a fast upstream cannot cause an early subscriber to receive live chunks and then receive the same chunks again during handle resolution replay.
- [x] (2026-06-01 13:44 +0800) Started Electron Desktop with `--remoteDebuggingPort 9222`, connected through CDP, confirmed `window.cradle.chatStream` is exposed in the renderer, opened a tear-off window for the same session, and confirmed idle broker diagnostics can be queried. The full real-stream two-window diagnostic run was intentionally stopped after the user said it was no longer needed.

## Surprises & Discoveries

- Observation: Independent Electron `BrowserWindow` instances do not automatically imply independent socket pools for local HTTP requests.
  Evidence: `apps/desktop/src/main/main-app.ts` and `apps/desktop/src/main/window-manager.ts` create windows without a `webPreferences.partition`, so the windows use Electron's default session unless changed.
- Observation: Cradle already has a server-owned canonical active-run model and replay buffer; the current problem is not that the server permits duplicate active runs.
  Evidence: `apps/server/src/modules/chat-runtime/service.ts` uses `activeRunIdsBySession`, `pendingRunSessions`, `runSubscribers`, and `chunkBuffer` to ensure only one active run per session and to replay live AI SDK chunks to late subscribers.
- Observation: The current renderer has two long-lived chat stream entry points, not one.
  Evidence: `apps/web/src/features/chat/use-chat-session.ts` calls `startChatResponse` for `POST /chat/sessions/:id/response` when sending or continuing after tool approval, and calls `subscribeChatSessionStream` for `GET /chat/sessions/:id/stream` when passively joining an already-streaming session.
- Observation: The existing IPC proxy is request/response oriented and should not be forced to carry a `ReadableStream`.
  Evidence: `packages/ipc/src/client.ts` exposes `createIpcProxy` over `ipc.invoke`, while existing desktop push flows such as desktop update status use `webContents.send` plus preload event listeners.
- Observation: `@cradle/web`'s package `test` script ignores the extra path after `--` and runs the full `src` suite.
  Evidence: `pnpm --filter @cradle/web test -- src/features/chat/chat-stream-transport.test.ts` ran 55 files and failed on pre-existing `agent-management` and `kanban` tests. The focused command that works for this plan is `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chat/chat-stream-transport.test.ts`.
- Observation: Broad `@cradle/web` typecheck is currently blocked by unrelated worktree errors outside this stream ownership change.
  Evidence: `pnpm --filter @cradle/web exec tsc --noEmit` still fails after the chat transport errors were fixed, with errors in `src/features/agent-management`, `src/features/chronicle`, `src/features/system-agent/jarvis-popover.tsx`, `src/features/workspace-detail`, `src/features/workspace`, `src/tabs/chat.tab.tsx`, and `../../packages/streamdown/src/plugins/remark-incomplete.ts`.
- Observation: A response-start request must not reuse an existing passive session subscription entry, even when both target the same session.
  Evidence: During completion audit, `ChatStreamBroker.readOrCreateEntry` originally reused any non-closed session entry. The new `canReuseEntry` logic reuses all entries for passive subscriptions but only reuses response entries for response-start requests. `chat-stream-broker.test.ts` now proves `POST /response` opens a new upstream request when a passive entry exists.
- Observation: Moving late-join ownership from server SSE to main-process fanout requires preserving server replay semantics in the broker.
  Evidence: The server's `openRunEventStream` replays `activeRun.chunkBuffer` to late subscribers. Without broker-level replay, a second renderer subscribing after `start` and `text-start` chunks would miss the protocol prefix required by AI SDK stream reconstruction. `ChatStreamBroker` now stores accepted chunks in `replayChunks`, diagnostics expose `replayChunkCount`, and `chat-stream-broker.test.ts` proves a late subscriber receives buffered chunks before live chunks without opening a second upstream fetch.
- Observation: Broker replay must be per subscriber, not just per upstream entry.
  Evidence: An early subscriber is added before the upstream handle resolves. If the server body yields chunks immediately, that subscriber can receive live chunks before `attachSubscriber` resumes. The broker now stores `replayCursor` on each subscriber, and `chat-stream-broker.test.ts` proves fast upstream chunks are not duplicated during handle-resolution replay.
- Observation: The Electron runtime smoke path proves preload wiring and tear-off availability, but it does not replace the full manual streaming acceptance scenario.
  Evidence: `pnpm --filter @cradle/desktop dev --remoteDebuggingPort 9222` launched Electron with CDP on port 9222, `window.cradle.chatStream` exposed `abort`, `diagnostics`, `onChunk`, `onClosed`, `onError`, `startResponse`, and `subscribeSession`, and `window.cradle.ipc.invoke('window.tearOffSession', ...)` opened a tear-off target. The user then explicitly stopped further real-stream validation, so no live `subscriberCount: 2` diagnostic sample was recorded.

## Decision Log

- Decision: In the first implementation, keep the server chat-runtime APIs unchanged.
  Rationale: `apps/server/src/modules/chat-runtime` already owns canonical run state, replay, cancellation, queue drain, and persisted snapshots. The immediate problem is renderer-owned long-lived transport in Electron, so the first milestone should move only desktop transport ownership.
  Date/Author: 2026-06-01 / Codex

- Decision: Put the new owner in the Electron main process, not in a renderer shared store and not in the server module.
  Rationale: The HTTP/1.1 connection limit manifests in Chromium renderer network sessions. Electron main can consume the upstream stream outside renderer window fetch pools and can fan out the accepted stream to every `BrowserWindow` through IPC.
  Date/Author: 2026-06-01 / Codex

- Decision: Main process should forward accepted AI SDK chunks, not project them into `UIMessage` snapshots.
  Rationale: `apps/web/src/features/chat/chat-streaming-handler.ts` already owns `UIMessageChunk` to Zustand message projection, rAF-aligned flushing, and passive replay behavior. Moving projection into main would blur ownership and duplicate UI state logic.
  Date/Author: 2026-06-01 / Codex

- Decision: Do not use per-window Electron `partition`, host sharding, or HTTP/2 as the first solution.
  Rationale: Partitions and host sharding only distribute the connection limit while increasing state complexity. HTTP/2 may be valuable later but would still leave every renderer owning its own stream consumption and would require larger server/network replatforming.
  Date/Author: 2026-06-01 / Codex

- Decision: Preserve the non-Electron web path.
  Rationale: The user explicitly identified Electron as the core runtime. Keeping ordinary browser deployments on the current HTTP SSE transport avoids broad web behavior changes while fixing the desktop-specific connection pool problem.
  Date/Author: 2026-06-01 / Codex

- Decision: Response-start requests may replace a passive session entry, but passive subscriptions may reuse any active entry for the same session.
  Rationale: A passive `GET /stream` entry observes an already active run and is safe to share with other observers. A `POST /response` entry creates or continues a run and carries request body semantics, so reusing a passive entry could silently drop the user's intended send.
  Date/Author: 2026-06-01 / Codex

- Decision: The desktop broker buffers accepted upstream chunks and replays them to late renderer subscribers.
  Rationale: Renderer projection intentionally stays in `ChatStreamingHandler`, but late subscribers still need the AI SDK protocol prefix. Buffering accepted chunks in main preserves server replay behavior while keeping UI message projection out of Electron main.
  Date/Author: 2026-06-01 / Codex

- Decision: Track replay progress on each renderer subscriber.
  Rationale: Entry-level replay state is too coarse because a subscriber may receive live chunks before the IPC invoke result returns. A per-subscriber cursor keeps replay idempotent without changing the renderer transport contract.
  Date/Author: 2026-06-01 / Codex

## Outcomes & Retrospective

This section will be updated after implementation. The expected outcome is that Electron Desktop chat streaming uses one main-process upstream stream per active session or run while every open renderer window still sees the live response. The non-Electron web path should continue using the existing HTTP SSE request flow.

As of 2026-06-01 12:20 +0800, the source implementation and focused automated coverage are complete. Electron Desktop now has a main-process broker and preload IPC bridge, and renderer chat starts or joins streams through `chat-stream-transport.ts`. Focused tests prove single-upstream fanout, cleanup, response-stream retention, Electron stream reconstruction, Electron error propagation, and HTTP SSE fallback. The remaining gap is manual two-window Desktop validation against a real streaming run.

As of 2026-06-01 13:44 +0800, Electron runtime smoke validation also confirms the desktop app launches with the new preload bridge, the renderer can call `window.cradle.chatStream.diagnostics()`, and a tear-off window can be opened from the main window. The full real-stream two-window diagnostic scenario was intentionally not completed because the user said no further manual validation was needed. The implementation should be treated as source-complete with focused automated coverage and partial runtime smoke evidence, not as fully manually accepted against a live provider stream.

## Context and Orientation

Cradle has three relevant runtime layers.

The server layer lives under `apps/server/src/modules/chat-runtime`. It owns durable chat semantics: creating runs, ensuring a session has at most one active run, persisting messages, sending AI SDK `UIMessageChunk` frames over server-sent events, replaying buffered chunks to late subscribers, cancelling active runs, and draining continuation queue items. Server-sent events, abbreviated SSE, are ordinary HTTP responses whose body stays open and emits records such as `data: {"type":"text-delta",...}` until a terminal record and `[DONE]` arrive.

The desktop layer lives under `apps/desktop/src/main` and `apps/desktop/src/preload`. Electron main creates `BrowserWindow` instances in `apps/desktop/src/main/main-app.ts` and `apps/desktop/src/main/window-manager.ts`. The preload script `apps/desktop/src/preload/index.ts` exposes a limited `window.cradle` API to renderer code. Existing request/response IPC services are implemented with `@cradle/ipc` in `apps/desktop/src/main/native-services.ts`; existing push events use `webContents.send` in main and `ipcRenderer.on` in preload.

The renderer chat layer lives under `apps/web/src/features/chat` and `apps/web/src/store/chat.ts`. The main hook `apps/web/src/features/chat/use-chat-session.ts` hydrates canonical message snapshots with React Query, starts chat responses, joins existing active streams, handles native tool approvals, queues follow-up messages, and cancels runs. `apps/web/src/features/chat/chat-streaming-handler.ts` consumes a `ReadableStream<UIMessageChunk>` and updates the renderer-local Zustand store. The Zustand store is per renderer window; it is a view projection, not the canonical source of truth.

The current desktop problem occurs because renderer windows independently call `fetch` for chat SSE streams. A single active run can have one `POST /response` SSE in the sending window and one `GET /stream` SSE in every passive window. Those long-lived renderer fetches share the same Electron default network session and can consume the local server connection pool. Moving only long-lived chat transport to Electron main avoids this without forcing all short API requests through IPC.

## Plan of Work

First, add a desktop-owned broker in `apps/desktop/src/main/chat-stream-broker.ts`. A broker is a small owner object that keeps maps of upstream streams and renderer subscriptions. It should accept a `serverUrl` in its constructor. It should open upstream HTTP streams with main-process `fetch`, parse SSE frames from the response body, validate that each `data:` frame is either `[DONE]` or a JSON object, and send those frames to subscribed renderer `webContents`. It should track stream metadata such as `streamId`, `sessionId`, `runId`, `assistantMessageId`, `userMessageId`, `mode`, and subscriber count. It should remove destroyed renderer subscribers and abort upstream fetches when no subscribers remain, unless the upstream stream was started by a sending renderer and must keep running until terminal completion. This retention rule must be explicit in code and tests.

Second, register broker IPC in desktop main. This can be done as a small service class in the new broker file or as a new service in `apps/desktop/src/main/native-services.ts`, whichever keeps ownership clearer. The request/response IPC methods should start or join broker-managed streams and return metadata. Push events should use dedicated channels for chunk, close, and error notifications. `apps/desktop/src/main/main-app.ts` should create the broker after `startServer()` returns the `serverUrl`, pass it into any service context that needs it, and stop it in `shutdownDesktopRuntime()`.

Third, expose the broker in `apps/desktop/src/preload/index.ts`. Add a `chatStream` namespace under `window.cradle`. It should contain methods to start a response stream, subscribe to an active session stream, abort a stream, request broker diagnostics, and register event listeners. The preload API should hide raw `ipcRenderer` details and return unsubscribe functions for all event listeners, following the style already used by `desktopUpdate.onStatusChanged` and `window.onTearoffSessionClosed`.

Fourth, add TypeScript declarations in `apps/web/src/env.d.ts` and typed helpers in `apps/web/src/lib/electron.ts`. The helper types should make renderer code see a stable `DesktopChatStream` interface. This is where the renderer learns whether the desktop chat stream API is available.

Fifth, refactor the chat feature transport boundary. Today `apps/web/src/features/chat/chat-response-command.ts` returns `Response` objects from HTTP `fetch`, and `apps/web/src/features/chat/sse-chat-transport.ts` parses those responses. Introduce a transport module, for example `apps/web/src/features/chat/chat-stream-transport.ts`, that returns a small result object containing `runId`, optional `assistantMessageId`, optional `userMessageId`, and a `ReadableStream<UIMessageChunk>`. In non-Electron mode, it should call the existing HTTP functions and parse the response with the existing SSE parser. In Electron mode, it should call `window.cradle.chatStream`, subscribe to IPC events for the returned `streamId`, and build a renderer-local `ReadableStream<UIMessageChunk>` by enqueueing validated chunk events until close or error.

Sixth, update `apps/web/src/features/chat/use-chat-session.ts` to consume the new transport result instead of raw `Response` objects. The local send path, passive observer path, and approval continuation path must all use the same abstraction. Keep `ChatStreamingHandler` unchanged unless the new transport exposes a missing need. Continue to schedule snapshot refresh and queue invalidation at the same lifecycle points so canonical server state still reconciles after stream completion.

Seventh, add focused tests. For desktop main, add `apps/desktop/src/main/chat-stream-broker.test.ts` or a nearby test file that uses fake `webContents` objects and a fake fetch returning SSE bytes. It should prove that two renderer subscribers for one session share one upstream fetch and both receive the same chunk events. It should prove that terminal completion cleans up the upstream entry. It should prove that unsubscribing one renderer does not kill the stream for the remaining renderer. For renderer code, add tests under `apps/web/src/features/chat` proving the Electron transport builds a `ReadableStream<UIMessageChunk>` from IPC chunk events and that the HTTP fallback still delegates to the existing parser. Existing `use-chat-session` tests should be updated only where the raw `Response` mock shape changes.

Eighth, update documentation. `apps/desktop/src/main/README.md` should list the broker and state that Electron main owns long-lived chat transport. `apps/web/src/features/chat/README.md` should say that renderer chat consumes a transport abstraction: HTTP SSE in web mode, desktop IPC in Electron mode. `apps/web/src/store/README.md` may need a small update if wording says the store owns local abort controllers for all streams; after this change it owns renderer-side stream cancellation handles, while desktop main owns upstream abort. `docs/exec-plans/README.md` should include this plan.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

Inspect current files before editing:

    sed -n '1,220p' apps/desktop/src/preload/index.ts
    sed -n '1,220p' apps/desktop/src/main/main-app.ts
    sed -n '1,240p' apps/desktop/src/main/window-manager.ts
    sed -n '1,680p' apps/web/src/features/chat/use-chat-session.ts
    sed -n '1,220p' apps/web/src/features/chat/chat-response-command.ts
    sed -n '1,140p' apps/web/src/features/chat/sse-chat-transport.ts
    sed -n '1740,2070p' apps/server/src/modules/chat-runtime/service.ts

Create and edit the desktop files:

    apps/desktop/src/main/chat-stream-broker.ts
    apps/desktop/src/main/chat-stream-broker.test.ts
    apps/desktop/src/main/main-app.ts
    apps/desktop/src/main/native-services.ts
    apps/desktop/src/preload/index.ts
    apps/desktop/src/main/README.md

Create and edit the renderer files:

    apps/web/src/features/chat/chat-stream-transport.ts
    apps/web/src/features/chat/chat-stream-transport.test.ts
    apps/web/src/features/chat/chat-response-command.ts
    apps/web/src/features/chat/sse-chat-transport.ts
    apps/web/src/features/chat/use-chat-session.ts
    apps/web/src/features/chat/README.md
    apps/web/src/lib/electron.ts
    apps/web/src/env.d.ts
    apps/web/src/store/README.md

Run focused desktop validation:

    pnpm --filter @cradle/desktop typecheck
    pnpm --filter @cradle/desktop exec vitest run src/main/chat-stream-broker.test.ts

The expected result is TypeScript success and a Vitest run where the broker tests pass. If the desktop package does not currently expose a Vitest script, use the package's existing test convention or add the focused test to the nearest configured desktop test runner; record the exact command and output here.

Recorded result from 2026-06-01 12:20 +0800:

    pnpm --filter @cradle/desktop typecheck
    Result: passed.

    pnpm --filter @cradle/desktop exec vitest run src/main/chat-stream-broker.test.ts
    Result: 1 file passed, 6 tests passed after the response-vs-passive reuse, late-subscriber replay, and replay-cursor regressions were added.

Run focused web validation:

    pnpm --filter @cradle/web test -- src/features/chat/chat-stream-transport.test.ts src/features/chat/use-chat-session.test.ts
    pnpm --filter @cradle/web exec tsc --noEmit

The expected result is that the new transport tests pass. If broad web typecheck fails because of unrelated existing worktree errors, record the failing files and still keep the focused test result.

Recorded result from 2026-06-01 12:20 +0800:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chat/chat-stream-transport.test.ts
    Result: 1 file passed, 3 tests passed.

    pnpm --filter @cradle/web exec tsc --noEmit
    Result: failed on pre-existing unrelated type errors outside the changed chat transport files. The failing areas are `src/features/agent-management`, `src/features/chronicle`, `src/features/system-agent/jarvis-popover.tsx`, `src/features/workspace-detail`, `src/features/workspace`, `src/tabs/chat.tab.tsx`, and `../../packages/streamdown/src/plugins/remark-incomplete.ts`.

Run a manual desktop check in development:

    pnpm --filter @cradle/desktop dev

In the running app, open a chat session in the main window, detach the same session into a tear-off window, start a streaming response, and confirm that both windows render live chunks. Use the new broker diagnostics API or main-process logs to confirm one upstream stream for that active session and two renderer subscribers. The diagnostic output should be shaped like this example:

    chatStream diagnostics:
      session session_123: upstream=1 subscribers=2 mode=response runId=run_456

Recorded partial runtime smoke result from 2026-06-01 13:44 +0800:

    pnpm --filter @cradle/desktop dev --remoteDebuggingPort 9222
    Result: Electron launched, server started on `http://127.0.0.1:21423`, and CDP was available on port 9222.

    agent-browser connect 9222
    Result: connected.

    window.cradle.chatStream
    Result: exposed `abort`, `diagnostics`, `onChunk`, `onClosed`, `onError`, `startResponse`, and `subscribeSession`.

    window.cradle.chatStream.diagnostics()
    Result before starting a stream: `{ "streams": [] }`.

    window.cradle.ipc.invoke('window.tearOffSession', sessionId, 180, 160)
    Result: a `Cradle Tear-Off` target opened for the requested session.

    Full two-window live stream result: intentionally not recorded because the user stopped further manual validation.

## Validation and Acceptance

Acceptance is met when Electron Desktop no longer opens one renderer HTTP SSE connection per chat window. The observable behavior is that one active chat run can be watched from multiple windows while the desktop broker reports a single upstream stream and multiple renderer subscribers.

Automated acceptance requires these behaviors:

The desktop broker fanout test starts two subscribers for the same session and observes one fake upstream fetch. Both subscribers receive the same AI SDK chunk payloads in order. When a terminal chunk or `[DONE]` arrives, the broker sends a close event and removes the upstream entry.

The desktop broker cleanup test unsubscribes or destroys one subscriber while another subscriber remains. The upstream fetch continues, and only the remaining subscriber receives later chunks. When the final subscriber unsubscribes from a passive join stream, the upstream fetch is aborted and the entry is removed.

The renderer Electron transport test creates a stream through a mocked `window.cradle.chatStream`, emits chunk and close events, and verifies that `readUIMessageStream` or direct stream reading receives the expected `UIMessageChunk` objects. The same test suite should prove that error events error the stream rather than silently finishing.

The renderer HTTP fallback test verifies that when `window.cradle.chatStream` is absent, the transport still calls the existing HTTP SSE path and parses frames through `parseJsonEventStream` and `uiMessageChunkSchema`.

Manual acceptance requires opening two Electron windows on the same active chat session and confirming that ordinary short requests such as message snapshot refresh, queue list, cancel, and runtime status no longer stall behind a pile of renderer-owned chat SSE streams.

For this implementation pass, manual acceptance was waived by the user after partial runtime smoke validation. Future release verification should still run the full scenario above and capture a diagnostic sample with `subscriberCount: 2` during an active stream.

## Idempotence and Recovery

This work is source-only and should not require database migrations. Tests and typechecks can be rerun safely. The broker should generate fresh `streamId` values for each renderer-facing stream, so retrying a failed manual scenario should not conflict with stale IDs.

If the broker fails after starting an upstream response, it must emit an error event to every subscriber, clean up its maps, and allow renderer snapshot refresh to recover canonical state from the server. If the renderer window closes, the broker must remove that webContents from subscriber sets. If the app quits, `shutdownDesktopRuntime()` must stop the broker before or during server shutdown so no fetch loops remain.

Do not use destructive git commands. The current working tree has unrelated uncommitted changes in chat runtime and provider files, plus unrelated untracked files. Leave them untouched. Review this task with scoped commands such as:

    git diff -- apps/desktop/src/main apps/desktop/src/preload apps/web/src/features/chat apps/web/src/lib/electron.ts apps/web/src/env.d.ts docs/exec-plans

If a test fails because of unrelated existing changes, record the exact command, failing files, and reason in `Surprises & Discoveries` and in the final response.

## Artifacts and Notes

Important source references for the first implementation:

    apps/desktop/src/main/main-app.ts
    apps/desktop/src/main/window-manager.ts
    apps/desktop/src/main/native-services.ts
    apps/desktop/src/preload/index.ts
    apps/web/src/env.d.ts
    apps/web/src/lib/electron.ts
    apps/web/src/features/chat/use-chat-session.ts
    apps/web/src/features/chat/chat-response-command.ts
    apps/web/src/features/chat/sse-chat-transport.ts
    apps/web/src/features/chat/chat-streaming-handler.ts
    apps/web/src/store/chat.ts
    apps/server/src/modules/chat-runtime/index.ts
    apps/server/src/modules/chat-runtime/service.ts

The current server HTTP routes are:

    POST /chat/sessions/:sessionId/response
      Starts a run and returns an SSE response.
      Response headers include x-cradle-run-id, x-cradle-assistant-message-id, and x-cradle-user-message-id.

    GET /chat/sessions/:sessionId/stream
      Joins the currently active session run and returns an SSE response.
      Response headers include x-cradle-run-id when a run is active.

SSE frame parsing should accept the existing server format:

    data: {"type":"start","messageId":"assistant_1"}

    data: {"type":"text-start","id":"text_1"}

    data: {"type":"text-delta","id":"text_1","delta":"hello"}

    data: {"type":"finish","finishReason":"stop"}

    data: [DONE]

## Interfaces and Dependencies

In `apps/desktop/src/main/chat-stream-broker.ts`, define types and a class similar to:

    export interface DesktopChatStartResponseRequest {
      sessionId: string
      body: {
        text: string
        files?: unknown[]
        messages?: unknown[]
        providerTargetId?: string
        modelId?: string
        thinkingEffort?: 'low' | 'medium' | 'high'
        permissionMode?: 'bypassPermissions' | 'plan'
      }
    }

    export interface DesktopChatSubscribeSessionRequest {
      sessionId: string
    }

    export interface DesktopChatStreamHandle {
      streamId: string
      sessionId: string
      runId: string | null
      assistantMessageId?: string
      userMessageId?: string
    }

    export interface DesktopChatStreamChunkEvent {
      streamId: string
      sessionId: string
      runId: string | null
      chunk: unknown
    }

    export interface DesktopChatStreamClosedEvent {
      streamId: string
      sessionId: string
      runId: string | null
      reason: 'done' | 'aborted' | 'upstream-closed'
    }

    export interface DesktopChatStreamErrorEvent {
      streamId: string
      sessionId: string
      runId: string | null
      message: string
    }

    export class ChatStreamBroker {
      constructor(options: { serverUrl: string })
      startResponse(sender: Electron.WebContents, request: DesktopChatStartResponseRequest): Promise<DesktopChatStreamHandle>
      subscribeSession(sender: Electron.WebContents, request: DesktopChatSubscribeSessionRequest): Promise<DesktopChatStreamHandle>
      abortStream(sender: Electron.WebContents, request: { streamId: string }): void
      diagnostics(): DesktopChatStreamDiagnostics
      stop(): void
    }

The broker should use main-process `fetch`, `AbortController`, `TextDecoder`, and Electron `webContents.send`. It should not import React, Zustand, or web renderer modules.

In `apps/desktop/src/preload/index.ts`, expose:

    chatStream: {
      startResponse: (request: DesktopChatStartResponseRequest) => Promise<DesktopChatStreamHandle>
      subscribeSession: (request: DesktopChatSubscribeSessionRequest) => Promise<DesktopChatStreamHandle>
      abort: (request: { streamId: string }) => Promise<void>
      diagnostics: () => Promise<DesktopChatStreamDiagnostics>
      onChunk: (handler: (event: DesktopChatStreamChunkEvent) => void) => () => void
      onClosed: (handler: (event: DesktopChatStreamClosedEvent) => void) => () => void
      onError: (handler: (event: DesktopChatStreamErrorEvent) => void) => () => void
    }

In `apps/web/src/features/chat/chat-stream-transport.ts`, expose renderer-facing functions:

    export interface ChatStreamTransportResult {
      runId: string | null
      assistantMessageId?: string
      userMessageId?: string
      stream: ReadableStream<UIMessageChunk>
    }

    export function startChatResponseStream(args: {
      sessionId: string
      body: ChatResponseRequestBody
      signal?: AbortSignal
    }): Promise<ChatStreamTransportResult>

    export function subscribeChatSessionStreamForSession(args: {
      sessionId: string
      signal?: AbortSignal
    }): Promise<ChatStreamTransportResult>

These functions should use `window.cradle.chatStream` only when Electron exposes it. Otherwise they should call the existing HTTP fetch functions and parse the `Response` body with the existing SSE parser.

Revision note, 2026-06-01 12:36 +0800: Added per-subscriber replay cursors to prevent duplicate chunks when upstream data arrives before IPC handle resolution, added a focused race regression test, and reran desktop typecheck plus broker and renderer transport focused tests.

Revision note, 2026-06-01 13:44 +0800: Recorded partial Electron runtime smoke validation, the user-requested stop before full real-stream manual acceptance, and the remaining future-release manual diagnostic check.

Revision note, 2026-06-01 12:32 +0800: Added broker-side accepted chunk replay for late renderer subscribers, exposed `replayChunkCount` diagnostics, added focused regression coverage, reran desktop typecheck plus broker and renderer transport focused tests, and reran web typecheck to confirm only unrelated pre-existing errors remain.

Revision note, 2026-06-01 12:27 +0800: Tightened broker entry reuse semantics so response-start requests do not reuse passive session entries, added a focused regression test, reran desktop typecheck plus broker and renderer transport focused tests, and recorded the updated validation count.

Revision note, 2026-06-01 12:20 +0800: Implemented the desktop-owned chat stream transport across Electron main, preload, renderer chat transport, `useChatSession`, tests, and README documentation. Recorded focused validation results and the remaining manual desktop validation gap.

Revision note, 2026-06-01: Initial ExecPlan created after static analysis of Cradle's Electron window creation, preload IPC boundary, renderer chat streaming hook, and server chat-runtime SSE ownership. The plan chooses desktop-owned long-lived chat transport while preserving server canonical run ownership and renderer UI projection ownership.
