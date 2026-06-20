# Make Chat Run Terminal Facts the UI Streaming Authority

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The file itself is the plan, so it intentionally omits an outer Markdown code fence. A future implementer must be able to start from only this file and complete the change without relying on chat history.

## Purpose / Big Picture

Cradle chat must not show a single assistant run as both finished and still streaming. The web client used to clear message-level streaming state when a polling response said the session was idle, even while the local stream reader was still receiving chunks for the same assistant message. A second failure mode appeared with live steer display splits: Chat Runtime correctly reported the active run against the original assistant source message id, while the visible message still receiving text was the frontend-created `source:steer-tail` bubble. That produced the same user-visible failure: the assistant bubble folded tool output behind `Show execution details` while text continued to append.

The stricter reproduction exposed a third failure mode: passive stream teardown, used when leaving or switching sessions, called `finishGeneration`. That wrote `runDisplayMeta.completedAtMs` even though the backend run was still active. On return, runtime-status reported the same `activeRun`, but `setRunDisplayId` saw the same run id and returned early, leaving the stale completed timestamp in place. The visible bubble could then render the execution fold and a debug `Done 0ms` badge while a newly attached passive stream continued appending text.

After this refactor, the web client ends message-level streaming only when one of the actual run owners proves completion: the local stream reaches EOF, an intentional fail/stop path runs, or Chat Runtime reports the same backend run id as terminal. A terminal state means `complete`, `failed`, or `aborted`. Passive subscription teardown is not terminal. Runtime-status polling may discover active runs and terminal runs, but it cannot by itself end a stream unless the terminal runtime-status run names the same run id. When the active run names a source assistant that has been split for live steer, the chat store resolves that source id through `assistantDisplaySplitMap` and stores streaming refs and run timing metadata on the visible tail bubble.

## Progress

- [x] (2026-06-20 12:03 +0800) Confirmed the prior server-side live projection plan already made `session_events` and `backend_runs.status` the server lifecycle authority.
- [x] (2026-06-20 12:03 +0800) Identified the remaining frontend debt: `useChatSessionDriver` calls `releaseStaleSessionStreamingState` on a bare `runtimeStatus.status === 'idle' && !activeRun`.
- [x] (2026-06-20 12:03 +0800) Created this ExecPlan with the required sections and concrete validation steps.
- [x] (2026-06-20 12:03 +0800) Added `releaseSessionStreamingStateForTerminalRun` and `isTerminalChatRunStatus` in `apps/web/src/features/chat/session/use-chat-session-types.ts`.
- [x] (2026-06-20 12:03 +0800) Replaced the idle-based cleanup effect in `useChatSessionDriver` with terminal-run release and wrote active run ids into `runDisplayMetaMap`.
- [x] (2026-06-20 12:03 +0800) Replaced the steer fallback's broad stale release with terminal-run release.
- [x] (2026-06-20 12:03 +0800) Deleted the unused `releaseStaleSessionStreamingState` helper.
- [x] (2026-06-20 12:03 +0800) Added focused store tests proving non-terminal or different-run projections do not release streaming, while a same-run terminal projection releases source and live-steer tail refs.
- [x] (2026-06-20 12:04 +0800) Updated `useChatSession` so local store streaming remains visible even when runtime-status polling reports idle before the matching terminal projection arrives.
- [x] (2026-06-20 12:04 +0800) Reran focused web store tests and web typecheck successfully.
- [x] (2026-06-20 15:34 +0800) Reopened the investigation after the user reproduced a stricter case: runtime status still had an active run, but the visible assistant bubble had already rendered `Show execution details`.
- [x] (2026-06-20 15:36 +0800) Identified live steer display splitting as the second split-brain source: server active runs name the source assistant id while the visible streaming bubble can be `source:steer-tail`.
- [x] (2026-06-20 15:39 +0800) Updated the chat store so passive streaming refs and run display metadata resolve through existing `assistantDisplaySplitMap` to the visible streaming tail, and updated `ChatStreamingHandler` to migrate streaming refs when streamed source snapshots project to a display tail.
- [x] (2026-06-20 15:42 +0800) Removed the self-invented `RuntimeTerminalRunProjection` type and made the terminal release helper accept the existing runtime-status API type `RuntimeSessionRunStatus`.
- [x] (2026-06-20 15:42 +0800) Added a focused store reproduction for active-run source id plus visible live-steer tail id. The focused store tests now pass with 15 tests, and web typecheck passes.
- [x] (2026-06-20 15:43 +0800) Ran React Doctor on the changed diff. It reported unrelated existing dirty-file issues in agent management, runtime view, git changes, and layout files, but did not identify a regression in the chat store/session files changed for this fix.
- [x] (2026-06-20 16:05 +0800) Reopened the investigation after the user still reproduced fake finish by switching into a still-active run.
- [x] (2026-06-20 16:05 +0800) Identified the third split-brain source: passive subscription detach called `finishGeneration`, marking a still-active backend run as locally completed.
- [x] (2026-06-20 16:05 +0800) Renamed the passive cleanup helper to `detachPassiveSessionStreamingState` and changed it to clear only passive subscription refs and passive status, not run completion metadata.
- [x] (2026-06-20 16:05 +0800) Updated `beginRunDisplayMeta` and `setRunDisplayId` so an observed active run reopens stale completed run metadata by setting `completedAtMs` back to `null`.
- [x] (2026-06-20 16:05 +0800) Updated terminal-run release so it also completes messages that are streaming only by active run metadata after passive refs were detached.
- [x] (2026-06-20 16:05 +0800) Fixed run snapshot completion typing and timing display: running snapshots use `completedAt: null`, and `RunDebugCaption` no longer renders `Done 0ms` for `null`.
- [x] (2026-06-20 16:05 +0800) Added runtime-snapshot telemetry for run display metadata so the next reproduction can be diagnosed without Browser or screenshots.
- [x] (2026-06-20 16:05 +0800) Reran focused web store tests, web typecheck, and server typecheck successfully.

## Surprises & Discoveries

- Observation: The existing server plan `docs/exec-plans/20260619-08-chat-runtime-live-projection-boundary.md` already chose `session_events` as the durable source of terminal facts and `backend_runs.status` as the terminal read model.
  Evidence: That plan's Decision Log says terminal facts in `session_events` win, and its Outcomes section says streaming writes are terminal-fenced through the persisted `backend_runs` row.

- Observation: The frontend still has a separate lifecycle owner.
  Evidence: `apps/web/src/features/chat/session/use-chat-session-driver.ts` lines 204-228 release local streaming state when runtime status is idle and has no active run, without checking a matching `runId` terminal projection.

- Observation: The local stream writer can keep mutating message text after message-level streaming is cleared.
  Evidence: `apps/web/src/features/chat/transport/chat-streaming-handler.ts` flushes pending `UIMessage` snapshots through `store.updateMessage(...)`; a small store script reproduced `visible=false` followed by text growth.

- Observation: Message id alone is not a strict enough release key once the frontend has recorded a run id.
  Evidence: The first focused test run failed because `releaseSessionStreamingStateForTerminalRun` allowed a terminal projection for `run-b` to release `assistant-1` whose `runDisplayMetaMap` said `run-a`. The helper now requires exact `runId` match whenever local run metadata exists, and uses message id only as a fallback bridge when local run metadata has not been recorded.

- Observation: The session facade also trusted runtime-status over local streaming.
  Evidence: `apps/web/src/features/chat/session/use-chat-session.ts` computed `resolvedStreaming` as `serverStreaming || (!runtimeStatus && isStreaming)`, so a transient idle runtime-status response could make composer/global controls stop while the local store still had a streaming message. The expression now keeps local streaming authoritative until terminal release clears it.

- Observation: A still-active run can be split across two frontend ids after live steer.
  Evidence: Chat Runtime reports `activeRun.messageId === "assistant-1"` because the backend run owns the original assistant message. The frontend store can render that same run as `assistant-1`, a steer user message, and `assistant-1:steer-tail`. Before the second fix, `setPassiveStreamingMessageIds(sessionId, ["assistant-1"])` marked the source as passive streaming while `projectStreamingMessageForDisplay(...)` continued writing deltas into `assistant-1:steer-tail`, making the visible tail render as non-streaming while its text kept changing.

- Observation: Run timing metadata could remain stranded on the source id.
  Evidence: `setRunDisplayId("assistant-1", "run-a")` previously returned early when the source already had `run-a`, even if `assistantDisplaySplitMap` now meant the visible streaming bubble was `assistant-1:steer-tail`. The store now migrates `runDisplayMetaMap` to the resolved display id even when the run id is unchanged.

- Observation: The first implementation introduced an unnecessary frontend projection type.
  Evidence: `RuntimeTerminalRunProjection` duplicated the shape already generated for `/chat/sessions/:sessionId/runtime-status`. It has been deleted; `releaseSessionStreamingStateForTerminalRun` now takes `RuntimeSessionRunStatus` from `apps/web/src/features/chat/commands/runtime-session-status-command.ts`.

- Observation: Passive stream teardown was incorrectly treated as terminal run completion.
  Evidence: `releasePassiveSessionStreamingState(sessionId)` called `finishGeneration(messageId)` for passive streaming messages. This path runs when a passive stream is aborted because the session driver is disabled, a held empty snapshot appears, or the subscribed message changes. None of those events proves the backend run is terminal.

- Observation: Once passive teardown wrote `completedAtMs`, an active runtime-status poll could not repair it.
  Evidence: `setRunDisplayId(messageId, runId)` returned early when `c.runId === runId`. If `completedAtMs` was already a number, the message stayed locally completed even while runtime-status still reported the same run as active.

- Observation: A terminal runtime-status projection must finish active run metadata even when passive refs are already gone.
  Evidence: After changing passive detach not to call `finishGeneration`, the store can temporarily have only `runDisplayMeta.completedAtMs === null` as its streaming evidence. `releaseSessionStreamingStateForTerminalRun` now treats that active run metadata as a releasable streaming ref for the matching terminal run.

- Observation: `Done 0ms` had a separate server/API contract bug.
  Evidence: `startRunSnapshot` writes `completedAt: null` for running snapshots, while `ChatRunSnapshot` and `runSnapshotSchema` described `completedAt` as optional number. `readRunSnapshotTimings` only checked `undefined`, so JavaScript evaluated `null - startedAt`, clamped it, and displayed `Done 0ms`.

## Decision Log

- Decision: The frontend must treat a same-run terminal projection as the only polling-based reason to end message-level streaming.
  Rationale: `runtime-status idle` is a session summary. It can be stale, can race with local stream consumption, and does not prove that the message currently rendered by `MessageBubbleById` has reached a terminal run fact. A terminal run projection with the same `runId` does prove that.
  Date/Author: 2026-06-20 / Codex

- Decision: Keep this refactor in the chat session driver and chat store boundary, not in Streamdown or message rendering.
  Rationale: Streamdown only renders Markdown. The rendering component should receive a coherent `isStreaming` boolean; it should not infer lifecycle semantics from text growth, tool parts, or animations.
  Date/Author: 2026-06-20 / Codex

- Decision: Add focused state/session tests, not component tests.
  Rationale: The user explicitly asked to avoid frontend component tests for UI work. The bug is a state ownership bug, so non-component tests around the store/session helper boundary give useful coverage without testing visual rendering.
  Date/Author: 2026-06-20 / Codex

- Decision: Delete `releaseStaleSessionStreamingState` instead of keeping it as a fallback.
  Rationale: The helper encoded the old debt: a session-level summary could clear every streaming ref without naming a terminal run. Keeping it would invite another caller to reintroduce the race. The remaining release helpers now have explicit ownership: passive stream teardown for hidden/unmounted passive sessions, and terminal-run release for lifecycle completion.
  Date/Author: 2026-06-20 / Codex

- Decision: Let `useChatSession` expose local streaming alongside server streaming.
  Rationale: The facade is a UI projection. It should not hide an active local stream merely because polling has a session summary. The terminal-run release helper is now responsible for clearing local streaming when the server proves that exact run is terminal.
  Date/Author: 2026-06-20 / Codex

- Decision: The server runtime-status run remains the run-lifecycle authority, but the chat store owns the mapping from runtime source message id to visible streaming message id.
  Rationale: The server should not know about frontend-only display ids such as `assistant-1:steer-tail`. The frontend already owns `assistantDisplaySplitMap`, so it is the correct place to resolve `activeRun.messageId` into the bubble that React renders as streaming.
  Date/Author: 2026-06-20 / Codex

- Decision: Store streaming refs, passive refs, abort/run metadata, and run timing metadata on the resolved visible message id after a display split.
  Rationale: `MessageBubbleById` asks one question: is this visible message id streaming? If content updates land on one id while streaming refs live on another, rendering will inevitably split. The store boundary must keep those refs together before the renderer sees them.
  Date/Author: 2026-06-20 / Codex

- Decision: Use the generated runtime-status run type instead of a local terminal projection interface.
  Rationale: The repo rule is to avoid invented projections when an existing API type expresses the contract. `RuntimeSessionRunStatus` is the generated type for active/latest runtime runs and keeps the helper aligned with the backend.
  Date/Author: 2026-06-20 / Codex

- Decision: Rename passive stream cleanup to `detachPassiveSessionStreamingState` and forbid it from calling `finishGeneration`.
  Rationale: A passive subscription is a frontend attachment to an active run, not the run lifecycle owner. Detaching that subscription must not write completed run metadata. The new name makes the ownership boundary explicit at call sites.
  Date/Author: 2026-06-20 / Codex

- Decision: Treat active run display metadata with a real `runId` and `completedAtMs === null` as visible streaming evidence.
  Rationale: When passive refs are detached while the backend run remains active, this metadata is the local proof that the bubble belongs to an active run. Metadata without a run id is only pending/debug timing state and must not keep a bubble streaming by itself.
  Date/Author: 2026-06-20 / Codex

- Decision: `setRunDisplayId` reopens stale completed metadata for an observed active run.
  Rationale: Runtime-status `activeRun` is an active lifecycle fact. If local metadata says the same run is completed, the local metadata is stale and must be reset to `completedAtMs: null`.
  Date/Author: 2026-06-20 / Codex

- Decision: Run snapshot API responses expose `completedAt: number | null`.
  Rationale: The database and runtime semantics already use null for running snapshots. Making the API schema match reality avoids UI code relying on optional-number ambiguity and fixes the `Done 0ms` display path.
  Date/Author: 2026-06-20 / Codex

## Outcomes & Retrospective

Implemented. A streaming assistant message now remains streaming until its local stream handler finishes, an explicit fail/stop path runs, or runtime status reports a terminal runtime-status run for the same run id. The frontend no longer has an idle-status cleanup path that can clear local generation ownership by session summary alone, and `useChatSession` no longer hides local streaming when runtime-status polling is present but not terminal. The broad `releaseStaleSessionStreamingState` helper was removed.

The second implementation pass fixed the live steer split case. Runtime status may still name the source assistant message id, but the store resolves that id through `assistantDisplaySplitMap` before writing passive streaming refs, run display ids, first-event timing, and first-content timing. `ChatStreamingHandler` also moves streaming refs when source snapshots project to a tail message, so a visible tail cannot keep receiving text while reporting `isStreaming=false`.

The third implementation pass fixed the session-switch reproduction. Passive subscription teardown no longer marks a run complete. Active runtime-status observations reopen stale completed run metadata, terminal projections close active metadata even when passive refs have been detached, and running run snapshots use `completedAt: null` consistently from server schema through frontend timing display. Runtime-snapshot telemetry now includes `runDisplayMetaMessages`, which records run id, completed timestamp, passive/generating/local refs, and source/tail split ids for non-Browser diagnosis.

Validation completed:

    pnpm --filter @cradle/web exec vitest run src/store/chat.test.ts
    # 1 test file passed, 17 tests passed

    pnpm --filter @cradle/web typecheck
    # tsc --noEmit passed

    pnpm --filter @cradle/server typecheck
    # tsc --noEmit passed

    npx -y react-doctor@latest . --verbose --diff
    # Exit code 1. The scan covered the dirty diff and reported unrelated existing issues in many files. After changing `RunDebugCaption` to destructure only `data` from the query result, the remaining diagnostics on `apps/web/src/features/chat/rendering/message-bubble.tsx` are warnings for pre-existing file patterns such as barrel imports, effect deps, chained array iterations, and inline render helpers. The chat store/session/transport lifecycle files introduced no React Doctor diagnostics.

## Context and Orientation

Chat Runtime server code lives under `apps/server/src/modules/chat-runtime`. The server owns durable run lifecycle facts in `session_events` and projects those facts into `backend_runs.status`. A run is terminal when `backend_runs.status` is `complete`, `failed`, or `aborted`; it is not terminal when the status is `streaming`.

The web chat driver lives under `apps/web/src/features/chat/session`. The hook `useChatSessionDriver` hydrates message snapshots, watches runtime status, and joins passive streams for active sessions. The hook `useChatActions` sends new user input and starts local stream consumption. The transport class `ChatStreamingHandler` reads AI SDK UI message chunks from a `ReadableStream` and writes updated `UIMessage` snapshots into `useChatStore`.

The chat store lives in `apps/web/src/store/chat`. It tracks `messagesMap`, `generatingMessageIds`, `passiveStreamingMessageIds`, `runDisplayMetaMap`, `assistantDisplaySplitMap`, and `sessionMetaMap`. The selector `chatSelectors.isVisibleStreamingMessage(sessionId, messageId)` is what `MessageBubbleById` uses to decide whether the assistant bubble is streaming. If that selector returns false while chunks still update message text, `message-bubble.tsx` can split the message into execution and final text and render `Show execution details`.

`assistantDisplaySplitMap` is a frontend-only display map used when a live steer user message is inserted between a source assistant response and the later assistant tail. The backend still owns the original assistant message id. The frontend may render the later part as `sourceMessageId:steer-tail`, and that tail is the visible message that must carry streaming refs while the run remains active.

`runDisplayMetaMap` is a frontend timing and active-run map keyed by visible message id. `completedAtMs: null` means the frontend currently believes the associated run id is active. A numeric `completedAtMs` means the frontend has observed a terminal local stream or a terminal runtime-status run. A meta entry with `runId: null` is only pending timing data and does not by itself make a bubble visible-streaming.

The old cleanup helper `releaseStaleSessionStreamingState(sessionId)` was too broad for ordinary runtime-status polling. It cleared generation state for every locally streaming message in a session. It has been deleted and replaced with a run-id-aware terminal release plus explicit passive teardown for unmounted passive sessions.

The passive teardown helper is now `detachPassiveSessionStreamingState(sessionId)`. It clears passive subscription refs and sets passive status idle, but it does not call `finishGeneration` and does not write `completedAtMs`. Use it only when detaching a frontend passive stream subscription, such as when the session driver becomes inactive or switches to a different subscribed message.

## Plan of Work

First, introduce small typed helpers in `apps/web/src/features/chat/session/use-chat-session-types.ts`. Define the terminal chat message statuses as `complete`, `failed`, and `aborted` using the existing generated runtime-status run type. Add a helper that receives a session id and a `RuntimeSessionRunStatus`. The helper inspects `useChatStore.getState().runDisplayMetaMap` and only calls `finishGeneration` when the target message, or its split tail, is currently associated with the same `runId`. It must not release anything on a missing run id, a different run id, or a non-terminal status.

Then update `apps/web/src/features/chat/session/use-chat-session-driver.ts`. When runtime status reports an `activeRun`, immediately store the active run id with `setRunDisplayId(activeRun.messageId, activeRun.runId)` so passive streams have a known server run id before the subscription transport returns. Replace the current idle cleanup effect with a terminal projection effect: if runtime status has no active run and its `latestRun` is terminal, call the run-id-aware release helper. Do not call `releaseStaleSessionStreamingState` from this polling effect. The driver can still schedule snapshot refresh and queue refresh after a terminal release.

Then review `apps/web/src/features/chat/session/use-chat-actions.ts`. Keep explicit fallback behavior for `chat_steer_no_active_run`, but avoid broad release unless the fallback has a terminal run projection. If that path still calls `releaseStaleSessionStreamingState`, replace it with a narrower queue/start-new-response decision based on the fresh runtime status. Explicit user cancellation remains outside this plan because stop/cancel is an intentional user action, not a polling race.

Add focused tests in `apps/web/src/store/chat.test.ts` or a small new non-component test under `apps/web/src/features/chat/session`. The tests should prove that a bare idle status cannot clear local generation, that a terminal projection for a different run id cannot clear local generation, and that a terminal projection for the same run id clears both the source assistant and split tail streaming refs. Avoid rendering React components.

Then update `apps/web/src/store/chat/store.ts` and `apps/web/src/features/chat/transport/chat-streaming-handler.ts` for the live steer split case. Store methods that write passive streaming ids or run display metadata must resolve a source message id through `assistantDisplaySplitMap` and write to the final visible tail id. The stream handler must call `moveStreamingMessage` when `projectStreamingMessageForDisplay` projects a source snapshot into a different display message id.

Finally, separate passive stream detach from terminal release. In `apps/web/src/features/chat/session/use-chat-session-types.ts`, `detachPassiveSessionStreamingState` must not call `finishGeneration`. In `apps/web/src/store/chat/store.ts`, `beginRunDisplayMeta` and `setRunDisplayId` must set `completedAtMs: null` for an observed active run. `releaseSessionStreamingStateForTerminalRun` must call `finishGeneration` for a matching run even if the only active evidence is `runDisplayMeta.completedAtMs === null`.

Run focused validation and update this ExecPlan with exact outputs.

## Concrete Steps

Run these commands from the repository root:

    cd /Users/wibus/dev/Cradle
    git status --short

Create or edit only these expected files:

    docs/exec-plans/20260620-02-chat-run-lifecycle-authority.md
    apps/web/src/features/chat/session/use-chat-session-types.ts
    apps/web/src/features/chat/session/use-chat-session-driver.ts
    apps/web/src/features/chat/session/use-chat-session.ts
    apps/web/src/features/chat/session/use-chat-actions.ts
    apps/web/src/features/chat/transport/chat-streaming-handler.ts
    apps/web/src/store/chat/store.ts
    apps/web/src/store/chat/telemetry.ts
    apps/web/src/store/chat.test.ts
    apps/web/src/features/chat/rendering/message-bubble.tsx
    apps/server/src/modules/chat-runtime/run-snapshot.ts
    apps/server/src/modules/chat-runtime/model.ts
    apps/web/src/api-gen/types.gen.ts

After editing, these commands were run:

    pnpm --filter @cradle/web exec vitest run src/store/chat.test.ts
    pnpm --filter @cradle/web typecheck
    pnpm --filter @cradle/server typecheck

Focused test result is one test file passed with 17 tests passed. Web and server typecheck completed with no TypeScript errors.

After the second pass, the focused test command was rerun and one test file passed with 15 tests passed. Typecheck completed again with no TypeScript errors. React Doctor was also run on the dirty diff; it exited non-zero because unrelated dirty files already violate its rules.

After the third pass, the focused test command was rerun and one test file passed with 17 tests passed. Web typecheck and server typecheck completed again with no TypeScript errors.

## Validation and Acceptance

Acceptance is behavioral. A message that is still receiving chunks must not render as completed merely because runtime-status temporarily says the session is idle. The state-level proof is:

1. Start generation for a message and associate it with run id `run-a`.
2. Simulate an idle runtime status with no terminal projection for `run-a`.
3. Observe `chatSelectors.isVisibleStreamingMessage(sessionId, messageId)` remains true.
4. Simulate a terminal projection for `run-b`.
5. Observe the same message remains streaming.
6. Simulate a terminal projection for `run-a`.
7. Observe the message is no longer streaming.

For split assistant messages created by live steer, the same terminal projection for the source run id must clear the tail streaming ref too, because the backend run owns the source assistant message id while the frontend may render the live tail as `messageId:steer-tail`.

A second acceptance case covers the active-run split bug directly:

1. Hydrate a source assistant message `assistant-1` and a steer user message whose metadata splits `assistant-1` into a visible `assistant-1:steer-tail`.
2. Simulate runtime status reporting an active run with `messageId: "assistant-1"` and `runId: "run-a"` by calling `setRunDisplayId("assistant-1", "run-a")` and `setPassiveStreamingMessageIds(sessionId, ["assistant-1"])`.
3. Observe `chatSelectors.isVisibleStreamingMessage(sessionId, "assistant-1")` is false and `chatSelectors.isVisibleStreamingMessage(sessionId, "assistant-1:steer-tail")` is true.
4. Project a later source snapshot through `projectStreamingMessageForDisplay` and update the tail message.
5. Observe the tail text changes while the tail remains streaming.
6. Simulate terminal runtime status for `run-a` and observe the tail streaming ref is cleared.

A third acceptance case covers switching away and back into an active run:

1. Hydrate assistant message `assistant-1`, associate it with active `run-a`, and mark it passive streaming.
2. Call `detachPassiveSessionStreamingState("session-1")` to simulate the passive stream subscription being aborted by driver teardown.
3. Observe `passiveStreamingMessageIds` no longer contains `assistant-1`, but `runDisplayMeta("assistant-1").completedAtMs` remains `null` and `isVisibleStreamingMessage("session-1", "assistant-1")` remains true.
4. Simulate terminal runtime status for `run-a` and observe `isVisibleStreamingMessage` becomes false.
5. Simulate stale local completion by calling `finishGeneration("assistant-1")`, then simulate runtime-status reporting the same run active by calling `setRunDisplayId("assistant-1", "run-a")`; observe `completedAtMs` returns to `null` and the message is visible-streaming again.

## Idempotence and Recovery

The refactor is safe to run repeatedly. The new terminal release helper should be idempotent: calling it again for the same terminal run should leave store state unchanged after the first release. If tests fail partway, rerun the focused test after fixing the helper; no database migration or persistent data mutation is involved.

Do not revert unrelated local changes. If another file in the same area has user changes, read it and adapt to the current code rather than resetting it.

## Artifacts and Notes

The first reproduced failure before this plan can be summarized as:

    start: visible streaming true, text "before"
    stale idle cleanup: visible streaming false, text "before"
    later stream flush: visible streaming false, text "before + still arriving"

That is the impossible state this plan removes. After the refactor, the second line must not occur without a same-run terminal projection.

The second reproduced failure was:

    runtime-status activeRun.messageId: "assistant-1"
    rendered messages: "assistant-1", steer user bubble, "assistant-1:steer-tail"
    passive streaming ref written to: "assistant-1"
    streamed text written to: "assistant-1:steer-tail"
    visible tail selector: false

After the second refactor, the passive streaming ref and run display meta are written to `assistant-1:steer-tail`, which is the visible bubble that receives the projected text.

The third reproduced failure can be summarized as:

    runtime-status activeRun.runId: "run-a"
    passive stream subscription aborted because the session driver detached
    old helper called finishGeneration("assistant-1")
    runDisplayMeta["assistant-1"].completedAtMs: 12345
    user opens the session again
    setRunDisplayId("assistant-1", "run-a") returned early because the run id matched
    MessageBubbleById saw isStreaming=false and rendered Show execution details
    new passive stream continued updating the message text

After the third refactor, passive detach does not call `finishGeneration`, and an active `setRunDisplayId` resets stale `completedAtMs` to `null`.

## Interfaces and Dependencies

In `apps/web/src/features/chat/session/use-chat-session-types.ts`, define a terminal release helper using the existing runtime-status API type:

    import type { RuntimeSessionRunStatus } from '../commands/runtime-session-status-command'

    export function isTerminalChatRunStatus(status: RuntimeSessionRunStatus['status']): boolean

    export function releaseSessionStreamingStateForTerminalRun(
      sessionId: string,
      run: RuntimeSessionRunStatus | null | undefined,
    ): boolean

The helper returns true only when it actually released at least one streaming reference. It uses `useChatStore.getState()` and existing store methods; it must not introduce a new Zustand store or a local projection type that duplicates runtime-status.

In `apps/web/src/store/chat/store.ts`, keep `resolveStreamingDisplayMessageId(state, messageId)` private to the store. It must follow the existing `assistantDisplaySplitMap` chain from a source message id to the final visible tail id, and it must protect against accidental cycles with a `seen` set. Store methods that write passive streaming refs and run display metadata must use this resolver.

In `apps/web/src/features/chat/session/use-chat-session-types.ts`, define:

    export function detachPassiveSessionStreamingState(sessionId: string): void

This helper clears only passive subscription state. It must not call `finishGeneration`.

In `apps/server/src/modules/chat-runtime/run-snapshot.ts`, `ChatRunSnapshot.completedAt` is:

    completedAt: number | null

In `apps/server/src/modules/chat-runtime/model.ts`, `runSnapshotSchema.completedAt` is:

    t.Union([t.Number(), t.Null()])

In `apps/web/src/store/chat/telemetry.ts`, `ChatStoreTelemetrySnapshot` exposes `runDisplayMetaMessages`. Server runtime snapshots lift this into `drilldowns.renderer.runDisplayMetaMessages`. Use `cradle observability runtime-snapshot --format json` and inspect that field when diagnosing another fake-finish reproduction without Browser.

Revision note 2026-06-20 12:03 +0800: Initial plan created to replace idle-based frontend streaming cleanup with run-id terminal authority.

Revision note 2026-06-20 12:03 +0800: Implementation completed. Updated progress, discoveries, decisions, outcomes, and validation evidence after replacing the stale cleanup helper and running focused tests plus typecheck.

Revision note 2026-06-20 12:04 +0800: Added the `useChatSession` facade fix so global chat streaming state follows local streaming until same-run terminal release, then reran validation.

Revision note 2026-06-20 15:43 +0800: Reopened and extended the plan after a user reproduction showed active-run source ids splitting from visible live-steer tail ids. Added store-level source-to-tail streaming ownership, removed the invented terminal projection type, and recorded the 15-test validation result.

Revision note 2026-06-20 16:05 +0800: Reopened and extended the plan after a session-switch reproduction showed passive subscription teardown writing false completion. Separated passive detach from terminal release, made active runtime-status reopen stale completed metadata, fixed run snapshot `completedAt: null`, added run meta telemetry, and recorded the 17-test plus web/server typecheck validation result.
