# Finish the Cradle Diffs Local User Journey

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the execution plan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained for a contributor who has only the current working tree.

## Purpose / Big Picture

Cradle Diffs currently has many pieces of a review product, but the user journey is not coherent. A user can create an open review, but until this work there was no obvious way to close it; comments could be created only through a detached composer at the top of the diff; agent fix work orders existed in the server but were not visible in the review UI; and Commit Planner looked like a local rule-based grouping tool rather than an agent-assisted workflow. After this work, a user can enter Cradle Diffs intentionally, open a working tree review, close it when finished, add a comment directly inline at the selected diff line, ask an agent to handle a selected range, thread, or whole review, open the backing Chat Session, and use Commit Planner as an agent-first flow with a rule-based fallback.

The goal is a complete local review journey. It does not include GitHub pull request synchronization, AST-level semantic highlighting, or a storage migration that replaces `diff_review_comments` with chat messages. Those are separate product milestones. This work makes the current local review lifecycle usable and honest without moving review-owned data into chat-owned tables.

## Progress

- [x] (2026-06-21 10:18+08:00) Added a server `closeReview` lifecycle operation, a `POST /workspaces/:id/diff-reviews/:reviewId/close` route, generated web and CLI clients, and a Review top bar `Close` action.
- [x] (2026-06-21 10:18+08:00) Changed review list labels so internal `sourceKind · status` strings such as `Commit · open` no longer leak into the UI.
- [x] (2026-06-21 10:23+08:00) Read the ExecPlan rules, current Diffs UI, current server agent-fix routes, current Session creation APIs, and the existing diff renderer integration.
- [x] (2026-06-21 10:27+08:00) Created this ExecPlan to define the local journey closure and constrain the implementation.
- [x] (2026-06-21 10:28+08:00) Made the new comment composer render through CodeView annotations at the selected line instead of as a detached top overlay.
- [x] (2026-06-21 10:29+08:00) Added `useReview` agent-fix mutations for create, start, cancel, and rerun.
- [x] (2026-06-21 10:29+08:00) Added a visible Agent rail in Review detail with selection/review scope, provider/model selection, work-order list, start/cancel/rerun controls, and Open Chat links.
- [x] (2026-06-21 10:29+08:00) Wired inline threads and the Threads rail to create thread-scoped agent work orders and switch to the Agent rail.
- [x] (2026-06-21 10:30+08:00) Made Commit Planner agent-first by adding a primary `Plan with agent` flow that starts a commit-output agent work order and opens the backing Chat Session, while keeping rule-based grouping as fallback.
- [x] (2026-06-21 10:31+08:00) Ran focused validation: server diff-review tests, server typecheck, CLI typecheck, and web typecheck all pass.
- [x] (2026-06-21 10:42+08:00) Fixed inline comment composer refresh by deriving an annotation-aware `CodeView` item version when composer or thread annotations are present.

## Surprises & Discoveries

- Observation: The server already had `status: 'open' | 'merged' | 'closed' | 'abandoned'` for reviews, but no route or UI transition that could set a review to `closed`.
  Evidence: `apps/server/src/modules/diff-review/model.ts` exposed `reviewStatus`, while searches for close/abandon only found enum definitions and no route before adding `/close`.

- Observation: New comment creation was not actually inline even though existing thread display used `renderAnnotation`.
  Evidence: `apps/web/src/features/diff-review/review-detail/diff-stage.tsx` rendered `ThreadComposer` as `absolute inset-x-0 top-0`, outside the selected line's annotation slot.

- Observation: Agent fix execution is already a real Chat Runtime workflow on the server.
  Evidence: `apps/server/src/modules/diff-review/service.ts` creates a `Session`, calls `ChatRuntime.createRun`, records `sessionId` and `runId` on `diff_review_agent_fixes`, and later derives artifacts from the run messages.

- Observation: The web Diffs UI currently has no agent-fix controls even though `review.agentFixes` is returned in every review payload.
  Evidence: searches under `apps/web/src/features/diff-review` found only type/shared labels for agent fixes and no rendered Agent rail or start/cancel/rerun controls.

- Observation: Full web typecheck was blocked by an unrelated dirty composer file before validation could finish.
  Evidence: `pnpm --filter @cradle/web exec tsc --noEmit` initially reported `apps/web/src/features/composer-toolbar/thinking-effort-button.tsx(100,80): error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'number'`. A minimal motion derived-value type fix made the command pass.

- Observation: `@pierre/diffs` treats annotations as versioned item payload and does not resync a reused item record when `item.version` is unchanged.
  Evidence: `CodeView.syncItemRecord` returns early when versions match, while `renderItem` passes `item.item.annotations` into `FileDiff.render`. The synthetic composer annotation existed in React data, but the diff DOM kept the old item snapshot, so only the gutter action was visible.

## Decision Log

- Decision: Treat this plan as local journey closure, not as GitHub PR parity.
  Rationale: The user pain is that the existing local journey cannot be completed. Remote adapters and semantic diffing would expand scope without fixing the broken local path.
  Date/Author: 2026-06-21 / Codex

- Decision: Keep single-file clicks in the Changes panel on the legacy raw BrowserPanel diff viewer.
  Rationale: The user explicitly confirmed that quick file preview should stay raw diff. Review lifecycle should be entered through an intentional Review action.
  Date/Author: 2026-06-21 / Codex

- Decision: Close review means setting `diff_reviews.status` to `closed` and recording `review_closed`, not deleting rows or changing git state.
  Rationale: Closing is a review lifecycle action. It should remove an item from the open workflow while preserving threads, submissions, revisions, events, and future auditability.
  Date/Author: 2026-06-21 / Codex

- Decision: Do not migrate review comments into Chat Session messages in this implementation.
  Rationale: `diff-review` owns anchors, remapping, viewed state, submissions, and local review records. A full transcript migration needs database migration and UX decisions that would delay the journey fix. This plan instead makes Agent actions create real Chat Sessions and keeps review comments as anchored review records.
  Date/Author: 2026-06-21 / Codex

- Decision: Make Commit Planner agent-first in the UI, while keeping rule-based grouping as a fallback.
  Rationale: A rule-based grouping button is useful, but it should not be presented as the primary commit intelligence. Agent-first matches Cradle's product direction and the existing server agent-fix capability.
  Date/Author: 2026-06-21 / Codex

## Outcomes & Retrospective

This section will be updated after implementation. The expected outcome is that a user can start from the Changes panel, intentionally open Cradle Diffs, add an inline comment, ask an agent to work from review context, open the generated Chat Session, generate or fall back to a commit plan, close the review, and see the review leave the open-state journey.

Milestone update 2026-06-21: The local Cradle Diffs journey now has the missing closure points. Existing raw diff file preview remains unchanged. Review detail has a Close action backed by a server lifecycle route. New comments are created inline at the selected diff line through the same annotation mechanism as existing threads, with annotation-aware item versions so CodeView refreshes the selected file when composer or thread state changes. The right rail can show Threads or Agent; Agent can work from a selected range or the whole review, while thread actions create thread-scoped work orders and move the user into the Agent rail. Starting an agent work order opens the backing Chat Session. Commit Planner now presents the agent-assisted flow first and leaves rule-based grouping as a fallback. Remaining product debt is larger architecture: review threads still persist comments in `diff-review` rather than storing transcript content in Chat Session, and this plan intentionally does not implement GitHub PR synchronization or semantic AST diffing.

## Context and Orientation

Cradle is a TypeScript monorepo. The server is under `apps/server`, the React web app is under `apps/web`, generated web API clients live in `apps/web/src/api-gen`, generated CLI commands live in `packages/cli/src/commands/generated`, and database schema lives in `packages/db/src/schema`.

The Cradle Diffs server owner is the `diff-review` module in `apps/server/src/modules/diff-review`. This module owns review lifecycle rows, immutable revisions, file metadata, anchors, review comments, submissions, preferences, events, agent fix work orders, guide generation, and commit plans. It may read git facts through the `git` module and create Chat Runtime sessions through the `session` and `chat-runtime` modules, but review lifecycle records stay in the `diff-review` namespace.

The Cradle Diffs web surface is `apps/web/src/routes/workspaces/$workspaceId/diffs.tsx`. It chooses between `ReviewsListPage`, `ReviewDetailPage`, `GuideView`, and `CommitPlanPage` based on route search parameters. `ReviewDetailPage` owns the local state for selected files, selected diff ranges, rail width, and active composer. The actual diff renderer is `@pierre/diffs/react` `CodeView`, configured in `apps/web/src/features/diff-review/shared/diff-items.ts`.

The existing review comment UI has two pieces. `InlineThread` renders an existing thread through CodeView annotations, which is the correct placement model. `ThreadComposer` currently appears as a detached absolute overlay at the top of the diff stage, which is the wrong placement model. This plan changes the composer to be rendered as an inline annotation for the selected line.

Agent fixes already exist on the server. The relevant routes are `POST /workspaces/:id/diff-reviews/:reviewId/agent-fixes`, `POST /workspaces/:id/diff-reviews/:reviewId/agent-fixes/:agentFixId/start`, `POST /cancel`, `POST /rerun`, and `GET /artifact`. Starting an agent fix creates a Chat Runtime session and run, then stores `sessionId` and `runId` on the review-owned work order. The web should expose this instead of hiding it.

## Plan of Work

First, make inline comment creation use the same annotation mechanism as existing threads. Extend the annotation metadata type in `apps/web/src/features/diff-review/shared/diff-items.ts` so an annotation can represent either an existing thread or the currently selected composer. In `DiffStage`, add one synthetic annotation for `composerAnchor` at its selected start line and have `renderAnnotation` return `ThreadComposer` for that synthetic annotation. Remove the top absolute `ThreadComposer` overlay. Keep the server create-thread route unchanged.

Second, add agent-fix mutations to `apps/web/src/features/diff-review/shared/use-review.ts`. The hook should expose create, start, cancel, and rerun mutations. On successful start or rerun, the returned review contains the updated `agentFixes` row with `sessionId`; the caller can open that session with `openChatSession`.

Third, add a visible Agent rail under `apps/web/src/features/diff-review/review-detail/`. It should show existing agent work orders, their statuses, their backing Chat Session link when present, and actions for Start, Cancel, Rerun, and Open Chat. It should also include a small form that can create a work order for the selected range or whole review. Thread-scoped actions should be exposed from existing inline threads and the open threads rail by passing callbacks through `ReviewDetailPage`.

Fourth, adapt `ReviewTopBar` and `ReviewDetailPage` rail state. The right side should be able to show either Threads or Agent. The user must see an Agent button with a count of agent work orders. Threads remain available as an index and jump rail.

Fifth, make `CommitPlanPage` agent-first. Add a primary section that creates and starts an agent fix with `expectedOutput: 'commit'` and opens the Chat Session when available. Keep the existing rule-based `Grouped commits` and `Single commit` buttons below as fallback generation. This does not require a new server API because agent fixes already support `expectedOutput: 'commit'`.

Sixth, update tests and generated clients as needed. Server tests already cover close lifecycle. Add web type validation and focused server tests only when server behavior changes. Do not add broad frontend tests just for coverage.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

Inspect current files:

    rg -n "ThreadComposer|InlineThread|agentFix|commitPlan|closeReview" apps/web/src/features/diff-review apps/server/src/modules/diff-review -S

Edit these web files:

    apps/web/src/features/diff-review/shared/diff-items.ts
    apps/web/src/features/diff-review/shared/use-review.ts
    apps/web/src/features/diff-review/review-detail/diff-stage.tsx
    apps/web/src/features/diff-review/review-detail/thread-composer.tsx
    apps/web/src/features/diff-review/review-detail/inline-thread.tsx
    apps/web/src/features/diff-review/review-detail/open-threads-rail.tsx
    apps/web/src/features/diff-review/review-detail/review-detail-page.tsx
    apps/web/src/features/diff-review/review-detail/review-top-bar.tsx
    apps/web/src/features/diff-review/commit-plan-page.tsx

Create a new component if needed:

    apps/web/src/features/diff-review/review-detail/agent-rail.tsx

Regenerate clients only when server routes or schemas change:

    pnpm --filter @cradle/web generate
    pnpm gen:cli

Validate:

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/web exec tsc --noEmit
    pnpm --filter @cradle/cli exec tsc --noEmit

Expected result: all commands exit 0. The server test should report one test file passed. Typecheck commands may print existing Node warning lines about color environment variables, but should exit 0.

## Validation and Acceptance

Manual acceptance for the local journey:

1. Open a workspace with git changes. The Changes panel still opens raw BrowserPanel diff previews when clicking individual files.
2. Click the Review entry. Cradle Diffs opens the review surface.
3. Select a changed line or click the gutter plus. The comment composer appears inline at that diff location, not at the top of the diff.
4. Submit a comment. The new thread remains inline at that line and appears in the Threads rail.
5. Open the Agent rail. Create an agent work order for the selected range or whole review. Start it with a selected provider or agent. The work order shows a running status and exposes Open Chat after a session id exists.
6. Open the Chat Session from the Agent rail. The standard chat surface opens for the backing session.
7. Open Commit Planner. The primary action is agent-assisted commit planning. Rule-based grouping remains available as fallback.
8. Close the review from the top bar. The review status becomes `closed`, the view returns to the Reviews list, and the closed review is grouped as closed rather than `open`.

Automated acceptance:

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts

This proves the server lifecycle including close, threads, submissions, agent fix work orders, and commit plans remains functional.

    pnpm --filter @cradle/web exec tsc --noEmit

This proves the new UI wiring uses generated API types correctly.

## Idempotence and Recovery

All UI edits are retryable. If the inline composer does not render correctly, revert only the synthetic annotation changes in `diff-stage.tsx` and `diff-items.ts`, leaving server lifecycle changes intact. Closing a review is idempotent: closing an already closed review returns the existing closed review without creating a second lifecycle transition. Agent fix creation creates durable rows, so repeated manual clicks will create multiple work orders; disable buttons while mutations are pending to avoid accidental duplication.

Generated client files must be regenerated from server OpenAPI rather than hand-edited. If generated files include unrelated changes from existing OpenAPI drift, do not manually edit the generated output; record the drift in this plan and validate the generated code.

## Artifacts and Notes

Close lifecycle validation already passed before this plan was created:

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files  1 passed (1)
    Tests  10 passed (10)

Type validation also passed after adding close:

    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/web exec tsc --noEmit
    pnpm --filter @cradle/cli exec tsc --noEmit

Final validation after inline comments, Agent rail, and agent-first Commit Planner:

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files  1 passed (1)
    Tests  10 passed (10)

    pnpm --filter @cradle/web exec tsc --noEmit
    exit code 0

    pnpm --filter @cradle/server exec tsc --noEmit
    exit code 0

    pnpm --filter @cradle/cli exec tsc --noEmit
    exit code 0

The current git worktree contains unrelated edits in chat-runtime, Claude provider, composer, and Nowledge Mem files. This plan must not revert or normalize those unrelated edits.

## Interfaces and Dependencies

Use `@pierre/diffs/react` `CodeView` and its `renderAnnotation` hook for inline rendering. Do not invent a new diff renderer.

Use generated API functions from `apps/web/src/api-gen/sdk.gen.ts` for all web mutations. The hook `apps/web/src/features/diff-review/shared/use-review.ts` should expose agent fix mutations so components do not call generated APIs directly.

Use `openChatSession(sessionId)` from `apps/web/src/navigation/navigation-commands.ts` to open backing Chat Runtime sessions. Do not manually navigate to `/chat/$sessionId` from Diffs components.

Use `useComposerState`, `RuntimeSelector`, and `ProviderModelSelector` from `apps/web/src/features/composer-toolbar` where the UI needs a provider/model picker. This keeps model selection consistent with Guide generation and the rest of the app.

Use static Tailwind classes and `cn` from `~/lib/cn` for conditional class composition. Do not construct dynamic Tailwind class names.

Revision note 2026-06-21: Initial plan created after identifying that Diffs local lifecycle had server capabilities but lacked a coherent user path for inline comments, visible agent work, agent-backed commit planning, and closing reviews.

Revision note 2026-06-21: Updated after implementation to record inline composer, Agent rail, thread-to-agent work orders, agent-first Commit Planner, and validation results.
