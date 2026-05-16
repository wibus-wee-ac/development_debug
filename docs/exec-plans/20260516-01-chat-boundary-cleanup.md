# Chat Boundary Cleanup for Chunk Replay, Session Activity, and Jarvis Integration

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not currently check in a top-level `PLANS.md`. This document is maintained in accordance with `/Users/wibus/.agents/skills/execplan/references/PLANS.md`, whose requirements were reviewed before drafting this plan.

## Purpose / Big Picture

After this change, the web client will have one authoritative chunk-to-message reducer for chat rendering, one authoritative request/query entry for Jarvis preferences and chat response startup, a working unread indicator that is driven by actual session activity, hydration-safe new chat defaults, and layout state that no longer mixes feature ownership. A user will be able to open the app, start chats from the main chat view, the new-chat page, and the workspace detail capsule, see the same assistant/tool rendering behavior in every path, see unread sessions become unread when activity happens elsewhere, and see Jarvis and token usage UI stay aligned with real model/runtime data.

The visible proof is in the web app and test suite. The chat surface should render the same text, reasoning, and tool-call transitions whether the assistant message arrives from live streaming, from a server snapshot, or from a subagent fold. Jarvis settings and Jarvis popover should share one cached preference source. New chat should honor the persisted last profile after store hydration instead of freezing null at module import time. The session token bar should use the current model context window when known and hide or degrade safely when not known.

## Progress

- [x] (2026-05-16 08:00Z) Audited the existing duplication and confirmed three independent chunk replay implementations in `apps/web/src/features/chat/use-chat-session.ts`, `apps/web/src/features/chat/chat-streaming-handler.ts`, and `apps/web/src/features/chat/message-bubble.tsx`.
- [x] (2026-05-16 08:03Z) Confirmed `apps/web/src/store/session-activity.ts` defines `markUnread` but current application code only calls `clearUnread` from `apps/web/src/features/workspace/workspace-sidebar.tsx`.
- [x] (2026-05-16 08:06Z) Confirmed `apps/web/src/features/settings/jarvis-settings.tsx` and `apps/web/src/features/system-agent/jarvis-popover.tsx` bypass generated client/query helpers with raw `fetch()` calls to `/preferences/jarvis`.
- [x] (2026-05-16 08:08Z) Confirmed chat response POST startup is duplicated across `apps/web/src/features/chat/use-chat-session.ts`, `apps/web/src/features/new-chat/new-chat-page.tsx`, and `apps/web/src/features/workspace-detail/workspace-detail-page.tsx`.
- [x] (2026-05-16 08:10Z) Confirmed `apps/web/src/features/new-chat/new-chat-page.tsx` reads `useNewChatStore.getState()` at module evaluation time for initial draft state.
- [x] (2026-05-16 08:12Z) Confirmed `apps/web/src/features/chat/chat-view.tsx` hardcodes a 128K token denominator and `apps/web/src/features/system-agent/jarvis-popover.tsx` uses DOM selectors to discover layout bounds.
- [x] (2026-05-16 09:05Z) Created `apps/web/src/features/chat/chat-chunk-reducer.ts`, migrated hydration/live/subagent consumers, and locked reducer behavior with `chat-chunk-reducer.test.ts`.
- [x] (2026-05-16 09:18Z) Centralized chat response startup in `chat-response-command.ts` and Jarvis preferences in `use-jarvis-preferences.ts`, then rewired chat/new-chat/workspace-detail and Jarvis consumers to those owners.
- [x] (2026-05-16 09:34Z) Replaced unread toggle semantics with `recordActivity` + `setVisibleSession`, removed sidebar-side unread inference, and fixed new-chat hydration-safe initialization.
- [x] (2026-05-16 09:48Z) Split layout-owned state from settings/Jarvis feature UI state and introduced `layout-geometry-context.tsx` so Jarvis positioning no longer depends on DOM selectors.
- [x] (2026-05-16 10:02Z) Exposed session `modelId` from the server, regenerated web API client, switched token progress to real session model capabilities, unified remaining session detail query keys, and added `use-chat-session-binding.test.tsx` to lock the null-cache regression.
- [x] (2026-05-16 10:11Z) Final validation completed: focused server `session.test.ts` passed; web `typecheck`, focused tests (5 files / 17 tests), and `build` passed; empty-context review no longer reported code blockers.

## Surprises & Discoveries

- Observation: the stored chat rows already preserve AI SDK `UIMessageChunk` values; the divergence is not a protocol fork but duplicated app-side materialization logic.
	Evidence: `apps/web/src/features/chat/use-chat-session.ts` replays `group.chunks[].chunk` as `UIMessageChunk`, and `apps/web/src/features/chat/chat-streaming-handler.ts` accepts `StoredChunkEnvelope` whose `chunk` is also `UIMessageChunk`.

- Observation: the repository already generates request clients for both `/preferences/jarvis` and `/chat/sessions/{sessionId}/response`, but the current app layer does not consistently route through those generated boundaries.
	Evidence: `apps/web/src/api-gen/sdk.gen.ts` contains generated request entries for both endpoints, while the feature files still invoke `fetch()` manually.

- Observation: `useLayoutStore` already avoids persisting `settingsTabId`, `settingsSection`, and `jarvisExpanded`, which means the persistence boundary is less wrong than the semantic ownership boundary.
	Evidence: `apps/web/src/store/layout.ts` partializes only size/open state, but the store still defines settings and Jarvis feature fields.

- Observation: the first attempt to rerun only `apps/server/tests/session.test.ts` through the package script actually executed the full server suite and surfaced unrelated baseline failures.
	Evidence: `pnpm --filter @cradle/server test -- tests/session.test.ts` ran the whole Vitest workspace, where `tests/chat-runtime.test.ts`, `tests/issue-agent.test.ts`, and `tests/observability.test.ts` failed while `tests/session.test.ts` still passed.

- Observation: once `modelId` was added to the session HTTP contract, a previously hidden boundary bug surfaced in the web app: several consumers were treating the DB `Session` row type as if it were the HTTP response shape.
	Evidence: `apps/web/src/features/workspace/use-session.ts`, `workspace-detail-page.tsx`, and `workspace-sidebar.tsx` needed to switch to an API-owned `WorkspaceSession` view instead of the raw DB `Session` type.

- Observation: the final empty-context review blocked one extra round not because of code behavior, but because this living ExecPlan had not been updated to reflect the completed state.
	Evidence: the reviewer accepted the implementation after the code fixes, but still returned a documentation nit pointing at stale `Progress`, `Outcomes & Retrospective`, and `Artifacts and Notes` sections.

## Decision Log

- Decision: treat the chat chunk problem as an application adapter ownership issue, not as evidence that stored chunks must be migrated away from AI SDK chunk shape.
	Rationale: the stored `chunk` field already preserves the canonical chunk payload, so the highest-value fix is to unify materialization logic rather than redesign persistence first.
	Date/Author: 2026-05-16 / GitHub Copilot

- Decision: implement one small pure reducer module for chunk replay/application instead of a larger abstraction layer or compatibility bridge.
	Rationale: the repository explicitly favors breaking cleanups over compatibility code, and the reducer is the minimum surface that can serve hydration, live streaming, and subagent replay together.
	Date/Author: 2026-05-16 / GitHub Copilot

- Decision: centralize Jarvis preferences with TanStack Query and centralize chat response startup behind a feature-owned command, but do not force live SSE streaming through Query if streaming ergonomics become worse.
	Rationale: server state should use a single cache/query owner, while streaming POST initiation still benefits from a custom transport path as long as the request shape is centralized.
	Date/Author: 2026-05-16 / GitHub Copilot

- Decision: split the implementation into independently reviewable work nodes, but keep architecture-level merge and final integration in the main agent.
	Rationale: the user explicitly requested multi-work, and the repository guidance assigns architectural responsibility to the main agent.
	Date/Author: 2026-05-16 / GitHub Copilot

## Outcomes & Retrospective

The final implementation did achieve the intended ownership cleanup. Chat chunk materialization now has a single pure owner in `apps/web/src/features/chat/chat-chunk-reducer.ts`, and the three previous consumers (`use-chat-session.ts`, `chat-streaming-handler.ts`, and `message-bubble.tsx`) now consume that reducer instead of each encoding their own replay semantics. This removed the real divergence point without forking away from AI SDK chunk payloads.

Request boundaries are also cleaner. `chat-response-command.ts` now owns startup request building for active chat sends and detached navigation-trigger flows, while `use-jarvis-preferences.ts` owns the Jarvis preferences query/mutation boundary consumed by both Settings and Jarvis popover. The app still uses its custom SSE transport for live streaming, but the POST startup contract is now centralized.

Unread/session activity ownership is now explicit. `apps/web/src/store/session-activity.ts` owns unread derivation through `recordActivity` and `setVisibleSession`, `use-global-event-listeners.ts` owns the app-shell side effects that feed it from global run events and active-tab visibility, and `workspace-sidebar.tsx` is display-only again. The previous temporary sidebar heuristic that guessed unread from `updatedAt` was removed after review because it violated the ownership boundary and could misclassify non-chat metadata changes as unread chat activity.

The token progress bar now depends on real session model capabilities instead of a fake `128_000` denominator or a permanently null fallback. The server session view now exposes `modelId`, the web client was regenerated from the updated OpenAPI contract, `chat-view.tsx` now resolves `contextWindow` from the actual session model, and `use-chat-session.ts` invalidates the shared generated `getSessionsByIdQueryKey(...)` so a previously null binding does not get stuck in cache for an already-open chat tab.

The last cleanup lesson was that architecture review is only satisfied when the living plan stays live. The final reviewer round no longer found code blockers; it only asked that this document catch up to the code. That confirmed the implementation itself had landed correctly and the remaining gap was documentation fidelity.

## Context and Orientation

The relevant application surface is `apps/web`. Chat rendering currently spans several files. `apps/web/src/features/chat/use-chat-session.ts` hydrates server timeline rows into local `UIMessage` objects and owns the main send/stop flow. `apps/web/src/features/chat/chat-streaming-handler.ts` consumes live server-sent event chunks and mutates the Zustand chat store. `apps/web/src/features/chat/message-bubble.tsx` renders chat messages and reconstructs subagent fold output from stored chunks. All three reimplement overlapping parts of the AI SDK chunk state machine.

Session unread state currently lives in `apps/web/src/store/session-activity.ts`, but only `clearUnread` is used from `apps/web/src/features/workspace/workspace-sidebar.tsx`. There is no active owner that records remote session activity when the corresponding session is not visible.

Jarvis preferences are exposed by the generated API client under `apps/web/src/api-gen/`, yet `apps/web/src/features/settings/jarvis-settings.tsx` and `apps/web/src/features/system-agent/jarvis-popover.tsx` fetch the endpoint manually. Chat response startup is also duplicated: `apps/web/src/features/chat/use-chat-session.ts` starts the live SSE response for the active chat view, while `apps/web/src/features/new-chat/new-chat-page.tsx` and `apps/web/src/features/workspace-detail/workspace-detail-page.tsx` POST the same endpoint just long enough for the destination chat tab to take over.

Layout state currently lives in `apps/web/src/store/layout.ts`. That store owns both shell layout concerns such as sidebar size and unrelated feature concerns such as settings overlay state and Jarvis expansion state. `apps/web/src/features/system-agent/jarvis-popover.tsx` currently learns its bounds by querying DOM nodes owned by the layout tree. The desired end state is that layout geometry is exposed intentionally instead of guessed through selectors.

The model capability data already exists in the web type surface. `apps/web/src/lib/types.ts` includes `contextWindow` under model capabilities, and agent-management UI already reads it. The token progress bar in `apps/web/src/features/chat/chat-view.tsx` should therefore be reworked to consume real capabilities instead of a hardcoded `128_000` constant.

The directories likely affected by this plan include `apps/web/src/features/chat/`, `apps/web/src/features/new-chat/`, `apps/web/src/features/workspace-detail/`, `apps/web/src/features/settings/`, `apps/web/src/features/system-agent/`, and `apps/web/src/store/`. The repository instructions require updating the touched directory `README.md` files, so at minimum `apps/web/src/features/chat/README.md`, `apps/web/src/features/new-chat/README.md`, and `apps/web/src/store/README.md` must be reviewed and updated if those directories change. If `apps/web/src/features/system-agent/` gains new files, add a directory `README.md` there as part of the work.

## Plan of Work

First, add a pure chunk reducer module under `apps/web/src/features/chat/` that accepts either a single `UIMessageChunk` or an array of chunks and produces canonical assistant `parts` in the same shape the rest of the chat UI already expects. Keep the reducer ignorant of React, Zustand, timers, and transport. It may track helper state such as the active text part index or tool-call lookup internally, but the public API should remain small and deterministic.

Next, migrate `use-chat-session.ts`, `chat-streaming-handler.ts`, and `message-bubble.tsx` to consume that reducer. Preserve the behavioral differences that are truly view-specific, such as throttling live tool updates in the streaming handler, but stop re-implementing protocol semantics in each file. Add tests for the reducer and update any existing chat tests that assert rendered message parts.

Then centralize request boundaries. Introduce a feature-owned chat response startup module that builds and sends the startup request for both the streaming chat view and detached navigation-then-open flows. Use generated client types or generated endpoint metadata where practical, but keep the live SSE body-reading path intact if the generated client does not support streamed response consumption cleanly. In the same milestone, create `useJarvisPreferencesQuery` and `useUpdateJarvisPreferencesMutation` wrappers so Jarvis settings and the Jarvis popover share a single server-state source.

After the request cleanup, fix ownership bugs in state. Replace the current unread dead code path with a session-activity owner that can record incoming activity and derive whether a session is unread for the current user view. This can be done with timestamps or with a more direct event-driven owner as long as the owner is single and sidebar remains display-only. Also remove the module-scope persisted-store read in `new-chat-page.tsx` by moving initial draft creation into a render-time initializer or hydration-aware hook.

Finally, split the layout store. Move settings overlay state and Jarvis UI state out of `apps/web/src/store/layout.ts` into feature-owned stores or contexts, then wire `JarvisPopover` to an explicit layout contract. A contract can be a lightweight context, a geometry store populated by layout refs and `ResizeObserver`, or an overlay slot owned by the layout tree. Prefer the simplest shape that removes DOM selector dependence. Once session/model capability data is available at the chat surface, change the token progress bar to compute width from the actual context window and hide the percentage bar when the capability is unknown.

## Concrete Steps

All commands run from the repository root `/Users/wibus/dev/Cradle` unless a step says otherwise.

1. Inspect current errors before editing with:

			pnpm --filter @cradle/web typecheck

	 Capture whether the working tree already has unrelated failures before the refactor starts.

2. Implement the chunk reducer and migrate the three chat consumers. After each logical change, run targeted validation such as:

			pnpm --filter @cradle/web typecheck

	 If chat tests exist or are added in `apps/web`, run the relevant Vitest targets as soon as the reducer is wired.

3. Implement the centralized Jarvis query/mutation and chat response startup command, then rerun typecheck and any affected tests.

4. Implement session activity ownership, hydration-safe new-chat initialization, layout-store split, Jarvis geometry contract, and token-capability progress behavior. Run typecheck after each sub-step and run targeted tests for affected store/hook modules.

5. Update the touched directory `README.md` files so the directory-level documentation reflects the new reducer, request boundary modules, and store ownership changes.

6. Run the final verification suite:

			pnpm --filter @cradle/web typecheck
			pnpm --filter @cradle/web build

	 Add any narrower test commands that are introduced during implementation. If a command fails due to a known unrelated baseline issue, record the exact failure in `Surprises & Discoveries` and continue with the remaining validation.

## Validation and Acceptance

Acceptance is behavioral as well as mechanical.

Run `pnpm --filter @cradle/web typecheck` and expect the modified files to typecheck cleanly. Run `pnpm --filter @cradle/web build` and expect the web app bundle to complete. If chat-specific tests are present, run them and expect the new reducer tests to pass.

In the app, verify these scenarios manually or with focused tests:

1. Start a chat from the standard chat page and observe that assistant text, reasoning, and tool calls render correctly during live streaming.
2. Reload the chat page and observe that the hydrated assistant message matches the live-rendered message behavior for the same chunks.
3. Expand a tool call that contains subagent chunks and observe that the fold renders the same text/reasoning/tool semantics as the main message path.
4. Change Jarvis preferences in Settings and observe that Jarvis popover reads the updated preference without a stale duplicate fetch race.
5. Start a new chat from the new-chat page after persisted state hydration and observe that the previously selected profile is restored when available.
6. Trigger session activity for a non-active session and observe that the unread indicator appears; activate that session and observe that the unread indicator clears.
7. Open the token progress UI with a model that reports `contextWindow` and observe that the progress denominator matches the real model capability instead of a fixed 128K value. If the context window is unknown, the bar should degrade gracefully rather than show a false percentage.
8. Open and expand Jarvis, resize the layout, and observe that positioning remains correct without relying on DOM selector coupling.

## Idempotence and Recovery

The file edits in this plan are source-level refactors and can be repeated safely as long as typecheck and tests are rerun after each stage. The plan intentionally avoids schema migrations or destructive data rewrites. If a refactor step fails halfway, revert only the affected files in that stage, restore typecheck, and then reapply the smaller change. When splitting stores, keep old exported names only as long as the migration needs them within the same change; remove compatibility aliases before completion because the repository explicitly prefers clean breaking refactors over compatibility shims.

## Artifacts and Notes

Final implementation artifacts:

		apps/web/src/features/chat/chat-chunk-reducer.ts now owns assistant chunk projection.
		apps/web/src/features/chat/chat-response-command.ts now owns chat response startup request construction.
		apps/web/src/features/system-agent/use-jarvis-preferences.ts now owns Jarvis preference query/mutation boundaries.
		apps/web/src/components/layout/layout-geometry-context.tsx now exposes layout geometry as an explicit contract.
		apps/web/src/features/settings/settings-overlay-store.ts and apps/web/src/features/system-agent/jarvis-ui-store.ts now own feature UI state previously mixed into layout.
		apps/server/src/modules/session/service.ts now returns a session view that includes `modelId` from session bindings.

Final validation log:

		pnpm --filter @cradle/server exec vitest run tests/session.test.ts
		→ passed (1 file / 1 test)

		pnpm --filter @cradle/web typecheck
		→ passed

		pnpm exec vitest run --config apps/web/vite.config.ts --environment jsdom apps/web/src/features/chat/use-chat-session.test.ts apps/web/src/features/chat/use-chat-session-binding.test.tsx apps/web/src/features/chat/chat-chunk-reducer.test.ts apps/web/src/store/session-activity.test.ts apps/web/src/features/workspace/workspace-sidebar.test.tsx
		→ passed (5 files / 17 tests)

		pnpm --filter @cradle/web build
		→ passed

Known unrelated baseline note captured during validation:

		pnpm --filter @cradle/server test -- tests/session.test.ts
		→ package script executed the full server suite instead of a single test file; unrelated failures remained in `tests/chat-runtime.test.ts`, `tests/issue-agent.test.ts`, and `tests/observability.test.ts`, while the session-focused regression itself still passed.

## Interfaces and Dependencies

At the end of the first milestone, `apps/web/src/features/chat/` should contain a new reducer-style module with a public API similar to the following stable surface:

		type AssistantProjection = {
			parts: UIMessage['parts']
			...internal bookkeeping fields needed for replay/apply
		}

		function createAssistantProjection(): AssistantProjection
		function applyAssistantChunk(state: AssistantProjection, chunk: UIMessageChunk): AssistantProjection
		function replayAssistantChunks(chunks: UIMessageChunk[]): UIMessage['parts']

The exact type names may change during implementation, but the module must remain pure and transport-agnostic.

At the end of the request-boundary milestone, `apps/web/src/features/chat/` should expose one chat response startup boundary that all three existing call sites can use. `apps/web/src/features/system-agent/` or `apps/web/src/features/settings/` should expose a shared Jarvis preferences query/mutation boundary on top of `@tanstack/react-query` and the generated client in `apps/web/src/api-gen/`.

At the end of the state/layout milestone, `apps/web/src/store/layout.ts` should no longer own settings overlay state or Jarvis feature state. Those states must move to feature-owned stores or contexts under `apps/web/src/store/` or the relevant feature directory. `JarvisPopover` must depend on an explicit geometry interface supplied by layout code rather than `document.querySelector(...)`. The chat token bar must depend on model capability data exposed through existing type surfaces such as `contextWindow`.

Revision note: created on 2026-05-16 to guide the architecture cleanup requested for duplicate chunk replay logic, unread ownership, raw fetch bypasses, hydration-safe state, token capability rendering, and layout/store boundary separation.
