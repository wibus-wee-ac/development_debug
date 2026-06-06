# Chat session Activity frames

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The goal is to implement a complete, React-correct fix for slow chat session switching without leaving a compatibility path or partial architecture behind.

## Purpose / Big Picture

Switching between chat sessions from the workspace sidebar currently feels slow because the active chat tab changes its `sessionId` parameter and remounts the chat UI. A Chrome trace showed repeated main-thread click interactions around 233-349 ms, with React work and virtual list measurement dominating. After this change, switching back to a recently opened chat session should behave like showing an existing retained frame: the transcript, composer, scroll state, and virtualizer remain mounted, while only the visible session changes.

The user-visible result is that clicking recently used sessions in the sidebar no longer rebuilds the entire chat page. The implementation uses React 19 `Activity` at the chat-session frame layer. React `Activity` keeps hidden UI state but cleans up hidden subtree effects, so streaming and data drivers must live outside hidden Activity trees.

## Progress

- [x] (2026-06-06T10:00:27Z) Read the trace, `tabs-next` renderer, chat tab, chat runtime view, workspace sidebar, and chat session hook to identify the real lifecycle boundary.
- [x] (2026-06-06T10:00:27Z) Decided that `tabs-next` remains the owner of top-level tab frames, while chat owns session frames inside a chat tab.
- [x] (2026-06-06T10:00:27Z) Created this ExecPlan before changing code.
- [x] (2026-06-06T10:38:31Z) Split chat session snapshot hydration and passive stream observation into `useChatSessionDriver`, mounted outside React `Activity`.
- [x] (2026-06-06T10:38:31Z) Added `apps/web/src/features/chat/chat-session-frame-host.tsx` with Activity-wrapped chat UI frames, active frame visibility, bounded recent idle frame retention, and always-retained streaming frames.
- [x] (2026-06-06T10:38:31Z) Wired `ChatTabContent` to render `ChatSessionFrameHost` for normal chat sessions while keeping CLI TUI sessions on the direct TUI path.
- [x] (2026-06-06T10:38:31Z) Removed the forced `key={sessionId}` remount from `ChatRuntimeView` and made provider/model save state frame-local instead of keyed by session inside one reused component.
- [x] (2026-06-06T10:38:31Z) Kept sidebar navigation semantics unchanged and kept chat session retention policy inside the chat feature, not inside `tabs-next`.
- [x] (2026-06-06T10:38:31Z) Added store-level hydrated session state so the visible UI can render readiness from the driver-owned snapshot lifecycle without subscribing to the snapshot query itself.
- [x] (2026-06-06T10:38:31Z) Fixed a misleading Chinese empty-state string that made an empty ready chat session look like it was still loading.
- [x] (2026-06-06T10:38:31Z) Ran `pnpm --filter @cradle/web typecheck`; it passed with `tsc --noEmit`.
- [x] (2026-06-06T11:11:49Z) Fixed a runtime visibility regression risk by keeping chat frame visual hiding under React `Activity` instead of adding a second `visibility/content-visibility` hiding layer inside the Activity subtree.
- [x] (2026-06-06T11:11:49Z) Fixed `ChatTabContent` hook ordering by computing the active session descriptor before the CLI TUI early return.
- [x] (2026-06-06T11:11:49Z) Validated the current web app on `http://127.0.0.1:5185/` because port `5174` was occupied by `apps/landing`, then opened a real chat tab and confirmed the chat frame host, visible frame, and chat view all render with non-zero dimensions and visible styles.
- [x] (2026-06-06T11:11:49Z) Ran `git diff --check` for the touched Activity/chat files and `pnpm --filter @cradle/web typecheck`; both passed.

## Surprises & Discoveries

- Observation: `tabs-next` already uses React `Activity`, but only at the top-level tab frame for `discardable` tabs. The slow path is not top-level tab activation; it is changing the `sessionId` inside the same chat tab.
  Evidence: `packages/tabs-next/src/components/tab-renderer.tsx` wraps `Activity` around `tab:${tab.id}` only when a tab context is `discardable`. Sidebar session clicks navigate `to="chat"` with a different `sessionId`.
- Observation: React `Activity` hidden mode is useful for this problem only if stream/data lifecycles are outside the hidden UI subtree.
  Evidence: `apps/web/src/features/chat/use-chat-session.ts` currently aborts `passiveStreamRef` in an effect cleanup keyed by `chatSessionId`; hidden Activity would clean that effect and cancel passive streaming.
- Observation: `ChatRuntimeView` currently passes `key={sessionId}` to `ChatView`, making session switches explicit remounts.
  Evidence: `apps/web/src/features/chat/chat-runtime-view.tsx` renders `<ChatView key={sessionId} ... />`.
- Observation: The visible chat hook also needed to stop owning snapshot readiness, not only passive streams.
  Evidence: If `useChatSession` kept the message snapshot query in the Activity subtree, hidden Activity would still destroy part of the data lifecycle. The final implementation lets `useChatSessionDriver` own snapshot hydration and writes readiness into `useChatStore.hydratedSessionIds`; `useChatSession` only reads that store state.
- Observation: The screenshot that showed `正在加载` had a second, non-architectural source of confusion.
  Evidence: `apps/web/src/locales/zh-CN/chat.json` translated `empty.startConversation` as `正在加载`, so an empty but ready session looked like a loading session. The string now says `发送一条消息开始对话`.
- Observation: A double-hidden frame can turn a correct Activity architecture into a blank-looking UI.
  Evidence: React `Activity` hidden mode already hides hidden subtrees. The chat frame wrapper now keeps only positioning, containment, stacking, and pointer-event state; it does not add `visibility: hidden` or `content-visibility: hidden` as an additional lifecycle mechanism.
- Observation: Local browser validation must target the actual web app server.
  Evidence: `localhost:5174` was served by `apps/landing` in this workspace, so initial browser checks showed the landing page. A separate Vite dev server on `127.0.0.1:5185` served `apps/web` and exposed the real app shell.

## Decision Log

- Decision: Do not expand `tabs-next` to understand chat session frames.
  Rationale: `tabs-next` owns generic tab semantics. Chat session retention depends on chat-specific policy: session ids, streaming status, runtime metadata, and memory limits. Writing that semantic policy into the generic tab runtime would violate ownership boundaries.
  Date/Author: 2026-06-06 / Codex
- Decision: Use React `Activity` inside the chat feature for retained session UI frames.
  Rationale: The UI state to preserve is chat-specific. `Activity` gives React-correct hidden UI semantics: state is retained, hidden effects are cleaned, and hidden work can be deprioritized.
  Date/Author: 2026-06-06 / Codex
- Decision: Move server snapshot hydration and passive stream subscription into a driver outside the Activity subtree.
  Rationale: Hidden Activity cleans effects. Streaming and snapshot synchronization must continue for hidden sessions, especially if a user switches away while a session is running.
  Date/Author: 2026-06-06 / Codex
- Decision: Retain only a bounded set of session frames per chat tab and always keep the active or streaming sessions.
  Rationale: Unlimited retained frames would trade CPU jank for memory growth. Bounded retention keeps the fast path for recent sessions without unbounded resource use.
  Date/Author: 2026-06-06 / Codex
- Decision: Add a chat-store hydration marker rather than keeping the snapshot query inside the visible UI hook.
  Rationale: React `Activity` hidden mode cleans effects in the hidden UI subtree. The snapshot query and passive stream observer are part of the session data lifecycle, so they must be driven from outside Activity. The visible UI needs only a derived readiness signal.
  Date/Author: 2026-06-06 / Codex
- Decision: Keep CLI TUI sessions out of the new chat Activity frame host for now.
  Rationale: The TUI path has different terminal lifecycle assumptions. The slow trace concerned normal chat session switching, and retaining terminal UI through chat session Activity frames would mix separate lifecycle models.
  Date/Author: 2026-06-06 / Codex

## Outcomes & Retrospective

Implemented the chat-session frame architecture. Normal chat tabs now render a `ChatSessionFrameHost`, which keeps recent session UI frames mounted behind React `Activity` and flips only the active frame to visible. `useChatSessionDriver` is mounted next to those frames, outside Activity, and owns snapshot hydration, runtime status checks, and passive stream subscription. This means hiding a retained chat session cleans UI effects as React expects, while the session data and stream observer continue outside the hidden subtree.

The old forced remount path was removed from `ChatRuntimeView`. The provider/model save queue is now frame-local, which matches the new one-session-per-frame model. `tabs-next` was not changed; it still owns only top-level tab lifecycle. The chat feature owns chat session retention.

Automated validation passed with:

    pnpm --filter @cradle/web typecheck
    $ tsc --noEmit

Whitespace validation passed with:

    git diff --check -- apps/web/src/features/chat/chat-session-frame-host.tsx apps/web/src/features/chat/use-chat-session.ts apps/web/src/store/chat.ts apps/web/src/tabs/chat.tab.tsx apps/web/src/features/chat/chat-runtime-view.tsx apps/web/src/locales/zh-CN/chat.json apps/web/src/features/browser/subagent-output-panel.tsx apps/web/src/features/chat/composer.tsx apps/web/src/features/chat/use-quick-question.tsx docs/exec-plans/20260606-01-chat-session-activity-frames.md

Runtime validation on `http://127.0.0.1:5185/#/chat/993f3d70-f70d-4ecf-b67c-f358b1c83b23` confirmed:

    [data-chat-session-frame-host]: display=block, visibility=visible, width=1008, height=257
    [data-chat-session-frame]: display=block, visibility=visible, pointer-events=auto, width=1008, height=257
    [data-testid="chat-view"]: display=flex, visibility=visible, data-chat-ready=true, data-chat-status=streaming, width=1008, height=257

`npx -y react-doctor@latest . --verbose --diff` completed and reported the dirty full workspace at 55/100. The report includes many pre-existing and unrelated issues across onboarding, landing, design-system showcase, workspace sidebar, composer, browser, and agent-management files. It did not identify `chat-session-frame-host.tsx` as a blocker. The directly relevant `ChatRuntimeView` session-reset effect was removed after the scan because the new architecture gives each retained frame a single session.

Manual behavioral validation is still recommended in the running Electron app: switch between two already opened normal chat sessions, then switch back and verify that transcript scroll/composer state are retained; start a stream, switch away, and return to verify the stream was not aborted.

## Context and Orientation

`tabs-next` is the local tab framework under `packages/tabs-next`. Its `TabRenderer` renders each top-level tab as a frame and already has a `useTabFrameActive()` context. A chat tab is defined in `apps/web/src/tabs/chat.tab.tsx`. The chat UI is rendered through `apps/web/src/features/chat/chat-runtime-view.tsx`, which currently constructs composer state and renders `ChatView`. `ChatView` in `apps/web/src/features/chat/chat-view.tsx` owns the visible chat UI and calls `useChatSession` from `apps/web/src/features/chat/use-chat-session.ts`.

The term "frame" means a mounted React subtree plus its DOM and state. A "chat session frame" is one mounted chat UI for one `sessionId`. "Activity" means React 19's `Activity` component. In hidden mode, it retains component state but cleans the subtree's effects. That is why stream subscriptions must not be owned by hidden UI frames.

The current `useChatSession` hook does too much: it hydrates messages from server snapshots, starts or joins passive streams, exposes send/approval/stop actions, and provides UI-derived values. This plan separates the ongoing data driver from the visible UI hook while keeping the existing public UI surface stable for `ChatView`.

## Plan of Work

First, refactor `apps/web/src/features/chat/use-chat-session.ts` so data synchronization can be mounted outside Activity. Introduce a driver hook or component that owns snapshot query hydration, passive stream subscription, queue refresh, runtime status polling, and cleanup for a single `sessionId`. Keep user actions such as `sendMessage`, `respondToToolApproval`, `stop`, queue cancellation, and reorder available to the visible `ChatView` through a separate view hook. The view hook should subscribe to `useChatStore` and query cache but must not own passive stream lifetime.

Second, create `apps/web/src/features/chat/chat-session-frame-host.tsx`. This host receives an active session descriptor from `ChatTabContent`, keeps a bounded list of retained session ids, renders one non-Activity driver per retained session, and renders one Activity-wrapped UI frame per retained session. The active frame uses `mode="visible"` and hidden retained frames use `mode="hidden"`. The host must always retain active sessions and locally/passively streaming sessions; non-active non-streaming frames are least-recently-used evicted when above the limit.

Third, update `apps/web/src/tabs/chat.tab.tsx`. `ChatTabContent` still reads session metadata for the active `sessionId`, updates tab labels, and registers active layout slots. It renders `ChatSessionFrameHost` instead of directly rendering `ChatRuntimeView` or TUI. CLI TUI sessions should not be retained through chat Activity frames unless their UI is React-safe for hidden Activity; the initial implementation should render CLI TUI directly for correctness and use Activity frames for normal chat runtime sessions.

Fourth, remove forced `key={sessionId}` remounting from `ChatRuntimeView` and, if needed, split it into reusable `ChatRuntimeFrame` props that are stable per retained frame. The composer reset key can remain session-specific inside each retained frame; it will initialize once per frame and update only when the session's runtime metadata changes.

Fifth, adjust navigation surfaces only where necessary. The workspace sidebar may keep using `Link to="chat" params={{ sessionId }}` because the active chat tab still changes URL and tab params; the frame host converts that param change into frame activation instead of remount. This preserves deep links and history while fixing the internal lifecycle.

## Concrete Steps

Run commands from `/Users/wibus/dev/Cradle`.

1. Edit `apps/web/src/features/chat/use-chat-session.ts` to expose a driver component or hook and a view hook. Keep all identifiers and comments in English.
2. Add `apps/web/src/features/chat/chat-session-frame-host.tsx` with the Activity host and retention policy.
3. Update `apps/web/src/tabs/chat.tab.tsx` to render the frame host for non-CLI chat sessions.
4. Update `apps/web/src/features/chat/chat-runtime-view.tsx` to remove forced remounting and to accept stable frame props.
5. Extend `apps/web/src/features/chat/chat-session-prefetch.ts` if new driver query keys require prefetch.
6. Run focused checks:
   - `pnpm --filter @cradle/web typecheck`
   - The command must complete with `tsc --noEmit` and exit code 0.

## Validation and Acceptance

The minimum automated acceptance is that TypeScript passes for the web app and existing chat/session tests pass. The behavioral acceptance is:

1. Start the web app in development.
2. Open a normal chat session with a long transcript.
3. Switch to another chat session from the workspace sidebar.
4. Switch back to the first session.
5. Observe that transcript scroll state and composer state are retained for recently used sessions.
6. Record a DevTools trace of five warm switches and verify that the interaction no longer repeatedly remounts `ChatView` and no longer shows the 120-140 ms React click handler pattern caused by full session remount.

Hidden streaming acceptance:

1. Start a response in one session.
2. Switch to another retained session while the first is streaming.
3. Return to the streaming session.
4. Observe that the stream continued and was not aborted by hiding the UI frame.

## Idempotence and Recovery

The code edits are safe to repeat because they replace the single-session chat rendering path with a bounded frame host. No database migration or destructive command is involved. If validation fails, inspect TypeScript errors first; most likely failures will come from the split of `useChatSession` exports or stale imports. The working tree already contains unrelated user changes, so do not use `git reset` or checkout commands to recover. Instead, apply targeted patches to the files touched by this plan.

## Artifacts and Notes

Trace summary from `/Users/wibus/Desktop/Trace-20260606T170250.json.gz`:

    Five slow session clicks navigate to /chat/{sessionId}.
    EventDispatch click duration: 127-141 ms.
    Full interaction duration: 233-349 ms.
    Layout and paint are small; JavaScript and React work dominate.
    The current render path includes ChatView remount and virtua measurement.

Validation transcript:

    $ pnpm --filter @cradle/web typecheck
    $ tsc --noEmit

    $ git diff --check -- apps/web/src/features/chat/chat-session-frame-host.tsx apps/web/src/features/chat/use-chat-session.ts apps/web/src/store/chat.ts apps/web/src/tabs/chat.tab.tsx apps/web/src/features/chat/chat-runtime-view.tsx apps/web/src/locales/zh-CN/chat.json apps/web/src/features/browser/subagent-output-panel.tsx apps/web/src/features/chat/composer.tsx apps/web/src/features/chat/use-quick-question.tsx docs/exec-plans/20260606-01-chat-session-activity-frames.md

    $ npx -y react-doctor@latest . --verbose --diff
    React Doctor v0.4.0
    Scanned 94 files in 27.4s
    Score: 55 / 100 Critical

    Runtime DOM check on the current apps/web dev server:
    [data-chat-session-frame-host] visible, 1008x257
    [data-chat-session-frame] visible, 1008x257
    [data-testid="chat-view"] ready=true, status=streaming, 1008x257

During implementation, three pre-existing TypeScript blockers in the dirty web workspace prevented validation from completing: `subagent-output-panel.tsx` used `useShallow` as an equality function, `composer.tsx` dispatched an obsolete `input` action, and `use-quick-question.tsx` returned `JSX.Element` in a React 19 TypeScript setup. These were fixed with minimal type-only changes so the web typecheck could prove the Activity work.

## Interfaces and Dependencies

At the end of this work:

`apps/web/src/features/chat/use-chat-session.ts` must export a data driver that can be mounted outside Activity and a UI hook that `ChatView` can call without owning passive stream lifetime.

`apps/web/src/features/chat/chat-session-frame-host.tsx` must export:

    export interface ChatSessionFrameDescriptor {
      sessionId: string
      sessionProviderTargetId: string | null
      sessionModelId: string | null
      runtimeKind: RuntimeKind | undefined
      workspaceId: string | null
      agentId: string | null
    }

    export function ChatSessionFrameHost(props: {
      activeSession: ChatSessionFrameDescriptor
    }): React.ReactElement

The implementation deliberately does not accept `workspacePath` because layout slots and terminal panels are already registered by `ChatTabContent` for the active session only. The ownership rule stays the same: chat owns session frame retention and tabs-next owns top-level tabs.

Revision note 2026-06-06T10:00:27Z: Initial plan created after trace analysis and source inspection. The plan records the no-debt architecture and the Activity hidden effect constraint that drives the implementation.

Revision note 2026-06-06T10:38:31Z: Implementation completed. Updated progress, decisions, discoveries, validation evidence, and final interface to reflect the Activity frame host, outside-Activity driver, store hydration marker, and successful web typecheck.

Revision note 2026-06-06T11:11:49Z: Follow-up runtime validation found `5174` serving the landing app, so apps/web was served on `5185`. The chat Activity frame host rendered visibly with non-zero dimensions. Removed the extra frame hiding layer and the obsolete `ChatRuntimeView` session reset effect, fixed `ChatTabContent` hook ordering, and recorded React Doctor output.
