# Implement Cradle Diffs End To End

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the repository's ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained for a contributor who has only the current working tree. The authoritative product specs are under `docs/specs/linear-diffs/`, especially `cradle-diff-review-spec.md` and `feature-coverage-matrix.md`.

## Purpose / Big Picture

Cradle Diffs should be a real review product surface, not only a patch viewer migrated out of the Changes tab. After this plan, a user can open local workspace changes as a review, navigate changed files, mark files viewed, create and reply to anchored review threads, submit a local review decision, keep review display preferences, see review activity, and create an agent fix work order from review context. A pending agent fix can now be started as a real chat-runtime session/run and linked back to the review revision produced after the run finishes. Remote GitHub review operations remain represented by explicit readiness state; the UI must not pretend those external side effects happened.

The first observable end-to-end path is local and workspace-scoped: open a workspace with changes, click Review in the Changes tab, inspect the Cradle Diffs surface, mark a file viewed, add a comment thread, submit "comment" or "request changes", and refresh the source without losing review lifecycle records. All review lifecycle rows live in the `diff-review` namespace, while `git` remains only the source of repository facts and patch materialization.

## Progress

- [x] (2026-06-17 05:03Z) Re-read the Linear Diffs specs, feature coverage matrix, source research, current `diff-review` schema, server module, and web viewer before expanding scope.
- [x] (2026-06-17 05:03Z) Created this end-to-end ExecPlan with a local acceptance definition that does not fake GitHub sync or actual agent execution.
- [x] (2026-06-17 05:10Z) Extended the Drizzle `diff-review` schema for sources, threads, comments, reactions, submissions, file view state, preferences, events, agent fixes, source operations, and readiness cache.
- [x] (2026-06-17 05:11Z) Extended server `diff-review` models and service APIs for list, refresh, viewed files, threads/comments/reactions/resolve, submit decisions, preferences, events, guide, source readiness, and agent fix work orders.
- [x] (2026-06-17 05:10Z) Regenerated database migrations and web API clients with `pnpm --filter @cradle/db generate` and `pnpm --filter @cradle/web generate`.
- [x] (2026-06-17 05:16Z) Replaced the single patch-only Cradle Diffs page with a review detail layout containing a file rail, main diff, right rail for guide/activity/threads/agent fixes, and decision/preference controls.
- [x] (2026-06-17 05:16Z) Added a minimal review list in the Cradle Diffs left rail for workspace local reviews.
- [x] (2026-06-17 05:12Z) Added focused server lifecycle tests for viewed files, threads, comments, reactions, resolve, submit, preferences, agent fix work orders, source readiness, and event persistence.
- [x] (2026-06-17 05:16Z) Ran focused server/web validation and recorded the transcripts in Artifacts and Notes.
- [x] (2026-06-17 13:24Z) Added rule-based draft Commit Planner persistence, API, generated client usage, server test coverage, and a Cradle Diffs Commit rail for grouped or single draft plans.
- [x] (2026-06-17 13:31Z) Added typed review range anchors, server-side line anchor normalization, exact/context anchor remapping on local refresh, stale fallback, generated API types, a basic head-line thread composer, and focused remap/stale tests.
- [x] (2026-06-17 13:37Z) Added read-only git branch compare materialization, `local-branch-compare` review source creation/refresh, source-based review identity, branch compare readiness, generated migration/API client, minimal Cradle Diffs compare opener, and focused server coverage.
- [x] (2026-06-17 13:50Z) Exposed diff-review lifecycle operations through generated Cradle CLI commands under `workspace diffs`, regenerated CLI artifacts, and verified CLI help/typecheck plus focused server checks.
- [x] (2026-06-17 14:02Z) Wired `@pierre/diffs` controlled line selection into Cradle Diffs so click/drag same-side base/head ranges can prefill thread anchors, with manual line fallback retained.
- [x] (2026-06-17 14:08Z) Made the persisted `hideWhitespaceOnly` display preference functional in Cradle Diffs by classifying parsed `@pierre/diffs` file metadata and filtering whitespace-only files from the rail and code view.
- [x] (2026-06-17 07:59Z) Made the persisted `collapseGeneratedFiles` display preference functional by classifying deterministic generated paths during revision file creation and filtering generated files from the Cradle Diffs rail and code view.
- [x] (2026-06-17 14:14Z) Added conservative fuzzy intra-file anchor remapping after exact hash and hunk/context matching, with focused coverage proving edited lines remap and deleted lines still become stale.
- [x] (2026-06-17 14:48Z) Added editable commit-plan updates with server-side group/file/dependency validation, generated web/CLI clients, focused server coverage, and an in-place Cradle Diffs Commit rail edit flow.
- [x] (2026-06-17 15:08Z) Added explicit local working-tree commit-plan application: accepted plans create ordered native git commits through the git service, persist idempotent `diff_review_source_operations`, mark plans applied, clear the working-tree review after refresh, expose generated web/CLI clients, and render an Apply action in the Commit rail.
- [x] (2026-06-17 15:26Z) Upgraded the Cradle Diffs left rail from a flat review list to an inbox with attention/authored/participated/all tabs, source/status grouping, counts, and review metadata derived from existing `diff-review` lifecycle rows.
- [x] (2026-06-17 07:37Z) Added explicit agent-fix start execution: pending review work orders can create a chat-runtime session/run, store session/run links, watch completion, refresh the review source, link `resultRevisionId`, emit start/completed/failed events, expose generated web/CLI start surfaces, and pass focused server coverage with a fake runtime.
- [x] (2026-06-17 07:50Z) Added agent-fix run controls: running work orders can be cancelled through Chat Runtime, terminal work orders can be rerun with fresh session/run links, the Cradle Diffs agent rail exposes Start/Cancel/Rerun actions, generated CLI commands cover cancel/rerun, and focused fake-runtime coverage proves cancellation and rerun completion.
- [x] (2026-06-17 09:57Z) Added agent-fix artifact recording and retrieval: completed runs derive a content-addressed artifact id from final chat output, store it on the review work order, expose a workspace-scoped artifact endpoint with generated web/CLI clients, show artifact previews in the Agent rail, and prove retrieval with fake-runtime server coverage.
- [x] (2026-06-17 10:30Z) Removed the path-based deterministic guide step generator instead of presenting it as semantic guided review, and split `diff-review` server internals into typed, patch, anchor, guide, commit-plan, artifact, and utility modules.
- [ ] Remaining: semantic guided review, cross-side range review UX, GitHub PR adapter, issue/requester/check-aware inbox grouping, AST/semantic structural highlighting beyond whitespace-only suppression, LLM-assisted commit grouping, remote/source-adapter commit application, richer staging controls, provider-native non-text artifact extraction, and richer agent selection.

## Surprises & Discoveries

- Observation: The current implementation has only three database tables: `diff_reviews`, `diff_review_revisions`, and `diff_review_files`.
  Evidence: `packages/db/src/schema/diff-review.ts` currently defines only those tables and has no threads, comments, submissions, viewed-state, preferences, events, or agent-fix tables.

- Observation: The current server API only creates or refreshes a local working tree review and fetches one review.
  Evidence: `apps/server/src/modules/diff-review/index.ts` has `POST /workspaces/:id/diff-reviews/local-working-tree` and `GET /workspaces/:id/diff-reviews/:reviewId` only.

- Observation: The current web surface is a review-owned patch renderer, not a review lifecycle UI.
  Evidence: `apps/web/src/features/diff-review/cradle-diffs-viewer.tsx` fetches local working tree data, renders `CodeView`, and exposes split/unified plus refresh. It has no file rail, viewed state, comments, submissions, activity, or agent fix controls.

- Observation: The generated API client picked up the new review lifecycle routes cleanly.
  Evidence: `apps/web/src/api-gen/sdk.gen.ts` now includes functions such as `postWorkspacesByIdDiffReviewsByReviewIdThreads`, `postWorkspacesByIdDiffReviewsByReviewIdSubmit`, `putWorkspacesByIdDiffReviewsPreferences`, and `postWorkspacesByIdDiffReviewsByReviewIdAgentFixes`.

- Observation: Focused browser-panel tests still print a late jsdom cleanup warning after passing.
  Evidence: `NODE_ENV=test pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts src/store/browser-panel.test.ts src/features/browser/browser-panel.test.tsx` reports `Test Files 3 passed` and `Tests 35 passed`, then prints `ReferenceError: document is not defined` from an existing MutationObserver cleanup path.

- Observation: Commit planning can be owned by `diff-review` as a durable draft without executing git operations.
  Evidence: `diff_review_commit_plans` stores grouped/single draft plans tied to review and revision, while no staging or commit command is invoked by the planner.

- Observation: The first anchor implementation should use typed anchors and server-derived hashes rather than trusting arbitrary client JSON.
  Evidence: `createThreadBody.anchor` now accepts `{ fileId, side, startLine, endLine }`; the service derives `hunkHeader`, `lineHash`, and context hashes from the immutable revision patch.

- Observation: Review identity must follow source binding, not only repository path and source kind.
  Evidence: `local-branch-compare` needs multiple reviews for the same repository with different `{ baseRef, headRef }`; `diff_reviews` now uses source id uniqueness instead of the earlier repo+kind unique index.

- Observation: Cradle Diffs had a web and server lifecycle surface but no generated CLI projection.
  Evidence: `apps/server/src/modules/diff-review/index.ts` had no `x-cradle-cli` metadata, and `packages/cli/src/commands/generated/workspace/diffs/` did not exist before adding route metadata and running `pnpm gen:cli`.

- Observation: `@pierre/diffs/react` already exposes controlled line selection, so Cradle Diffs can use the renderer's selection model instead of DOM inspection.
  Evidence: `CodeView` accepts `selectedLines` and `onSelectedLinesChange`, and `CodeViewLineSelection` contains the item id plus a `SelectedLineRange` with addition/deletion side data.

- Observation: The existing `hideWhitespaceOnly` preference was persisted but did not affect rendering.
  Evidence: `DiffReviewPreferenceView` included `hideWhitespaceOnly`, but `cradle-diffs-viewer.tsx` rendered every parsed file item before adding whitespace-only classification and filtering.

- Observation: The existing `collapseGeneratedFiles` preference and `diff_review_files.is_generated` column were persisted but generated files were never classified.
  Evidence: local working-tree and branch-compare revision creation inserted every `diff_review_files.is_generated` value as `false`, so the UI could not collapse generated files before adding deterministic path classification.

- Observation: Anchor remapping had no fuzzy fallback after exact hash and hunk/context matching.
  Evidence: `remapAnchorToRevision` returned stale when both exact and context matching failed, even if the same line had only a small textual edit nearby.

- Observation: Commit plan edits need to stay review-owned and must not trust client-provided paths.
  Evidence: `PUT /workspaces/:id/diff-reviews/:reviewId/commit-plans/:commitPlanId` validates group files against the plan revision and derives paths from `diff_review_files`, ignoring submitted paths.

- Observation: Native commit application can be local-only without moving review semantics into `git`.
  Evidence: `diff-review` persists the apply operation and plan status, while `apps/server/src/modules/git/service.ts` only stages path groups and runs `git commit`.

- Observation: The existing review list response already carries enough local lifecycle data for attention/authored/participated grouping.
  Evidence: `GET /workspaces/:id/diff-reviews` returns full `DiffReviewView` rows with files, threads, comments, reactions, submissions, events, agent fixes, and commit plans, so the initial inbox grouping can live in `apps/web/src/features/diff-review/cradle-diffs-viewer.tsx` without a new server projection.

- Observation: Chat Runtime already exposes `createRun()` and `waitForRunCompletion()` for non-SSE server-owned orchestration.
  Evidence: `apps/server/src/modules/issue-agent/service.ts` creates a `Session`, calls `ChatRuntime.createRun`, then watches `ChatRuntime.waitForRunCompletion`; `diff-review` now mirrors that ownership pattern instead of creating chat rows directly.

- Observation: Chat Runtime cancellation is already session-scoped and handles active, pending, and persisted streaming runs.
  Evidence: `apps/server/src/modules/chat-runtime/service.ts` exports `cancelSession(sessionId)`, so `diff-review` can cancel a running agent fix by session id without mutating chat-owned run rows directly.

- Observation: Chat Runtime already exposes a read API for run assistant output, so `diff-review` does not need to read or write chat-owned message rows directly to produce a review artifact.
  Evidence: `apps/server/src/modules/session/service.ts` exports `getRunMessageContents(runIds)`, and the agent-fix artifact endpoint derives its content from that service.

## Decision Log

- Decision: Treat "end to end" for this implementation as a complete local review lifecycle, plus explicit non-ready/readiness state for remote GitHub and recorded work orders for agent fixes.
  Rationale: The specs intentionally defer full GitHub replacement and merge. Implementing fake GitHub sync or fake agent execution would violate namespace ownership and user trust. A local workflow with durable review lifecycle records is the correct next architecture step.
  Date/Author: 2026-06-17 / Codex

- Decision: Keep `diff-review` as the owner for lifecycle rows and keep `git` as a read-only source for local repository facts.
  Rationale: This matches `AGENTS.md` ownership rules and the Linear Diffs spec. `git` may provide status and patch materialization, but comments, decisions, preferences, viewed state, and agent fix records belong to `diff-review`.
  Date/Author: 2026-06-17 / Codex

- Decision: Persist file viewed state in `diff_review_file_view_state` keyed by review, revision, file, and local user id, instead of mutating `diff_review_files.is_viewed` as the authoritative state.
  Rationale: The spec says user-specific preferences and viewed state are scoped by user/local identity. The existing `isViewed` on file rows can remain a denormalized view field for API compatibility, but the owner of user state should be a separate table.
  Date/Author: 2026-06-17 / Codex

- Decision: Implement Commit Planner first as a rule-based draft planner under `diff-review`, not as an immediate `git commit` executor.
  Rationale: The user asked for git-native usage, but the current product boundary has no explicit review-owned staging/apply operation or user confirmation model. Persisting a draft plan provides the needed grouping/dependency surface while keeping repository mutation for a later explicit operation.
  Date/Author: 2026-06-17 / Codex

- Decision: Mark anchored threads stale when exact line hash and hunk/context remap both fail.
  Rationale: A weak same-line fallback would hide broken anchors when code changed. Stale state is more honest and matches the spec's requirement that comments either remap or visibly require human attention.
  Date/Author: 2026-06-17 / Codex

- Decision: Implement local branch comparison as a first-class `diff-review` source backed by a read-only `git` branch compare fact API.
  Rationale: `git` owns branch facts, merge-base, and patch materialization, while `diff-review` owns review identity, revisions, comments, and lifecycle. This satisfies the multi-source architecture without pulling GitHub auth into the first local source expansion.
  Date/Author: 2026-06-17 / Codex

- Decision: Expose Cradle Diffs to agents through generated `workspace diffs` CLI commands rather than hand-written CLI wrappers.
  Rationale: The server route contract remains the source of truth, which matches the generated CLI architecture and keeps all review lifecycle semantics in `diff-review`.
  Date/Author: 2026-06-17 / Codex

- Decision: Treat click/drag same-side base/head selection as the supported first inline range UX and reject mixed-side selections in the composer.
  Rationale: The server anchor model intentionally stores one side per range. Supporting mixed base/head selections would require a broader anchor model, so the UI should make the unsupported case visible instead of inventing a lossy projection.
  Date/Author: 2026-06-17 / Codex

- Decision: Implement the first structural-diff behavior as reversible whitespace-only file suppression in the renderer, not a new persisted low-level diff projection.
  Rationale: `@pierre/diffs` already provides parsed old/new line metadata, and the existing preference can hide formatting-only noise without altering immutable raw patches or review lifecycle rows.
  Date/Author: 2026-06-17 / Codex

- Decision: Make fuzzy anchor remap conservative: same file, same side, original line text recovered from the previous immutable revision, strong textual similarity, and bounded line distance.
  Rationale: Weak remap is worse than stale because it silently attaches review feedback to the wrong code. The fallback should only save clear nearby edits and preserve stale state for deletes or ambiguous moves.
  Date/Author: 2026-06-17 / Codex

- Decision: Keep commit plan editing as durable `diff-review` state and mark edited groups as `manual`, without staging or creating commits.
  Rationale: Editing messages/rationale/status is review lifecycle state. Repository mutation needs a separate explicit apply operation, so this slice keeps git untouched while making the plan useful and auditable.
  Date/Author: 2026-06-17 / Codex

- Decision: Restrict native commit-plan application to accepted `local-working-tree` plans and require the current patch hash to match the plan revision before staging files.
  Rationale: Branch comparison and remote PR application require source-adapter semantics and permissions that do not exist yet. Patch-hash matching prevents applying a plan to a changed working tree, and the clean-index check in `git` avoids mixing Cradle-planned commits with user-staged work.
  Date/Author: 2026-06-17 / Codex

- Decision: Implement the first inbox grouping in the review-owned UI using existing lifecycle data instead of adding a separate inbox API.
  Rationale: The current local review list is small and already returns the lifecycle facts needed for local tabs. A separate summary projection becomes useful when GitHub/check/issue metadata exists or when list payload size becomes a measured problem.
  Date/Author: 2026-06-17 / Codex

- Decision: Start agent fixes through an explicit `POST /workspaces/:id/diff-reviews/:reviewId/agent-fixes/:agentFixId/start` operation instead of making creation secretly execute a run.
  Rationale: Work-order creation and run execution are different lifecycle transitions. Keeping them separate makes retries and failures auditable, lets the CLI start existing work orders with explicit agent/provider flags, and avoids pretending a pending work order has executed before Chat Runtime accepts the run.
  Date/Author: 2026-06-17 / Codex

- Decision: Add `diff_review_agent_fixes.result_revision_id` as a review-owned link to the revision observed after agent completion.
  Rationale: `artifactId` should remain available for future provider/session artifacts. A completed local working-tree fix needs a direct review-revision relation, and that relation belongs in the `diff-review` namespace.
  Date/Author: 2026-06-17 / Codex

- Decision: Rerun an agent fix by reusing the same review-owned work-order id while replacing `sessionId` and `runId`.
  Rationale: The work order is the stable relation to the review thread/range. Each execution attempt belongs to Chat Runtime, but the review should keep one lifecycle object whose latest session/run/result revision are visible and auditable through events.
  Date/Author: 2026-06-17 / Codex

- Decision: Treat cancellation as a first-class `agent_fix_cancelled` event instead of overloading `agent_fix_failed`.
  Rationale: User cancellation is not provider failure. Separate event semantics keep attention/inbox grouping and future notifications honest.
  Date/Author: 2026-06-17 / Codex

- Decision: Classify generated files inside `diff-review` from deterministic review paths rather than in `git` or a new analysis projection.
  Rationale: `git` owns repository facts and patch materialization, while `diff-review` owns review guidance and display categorization. A path-based classifier covers generated artifacts already visible in this repo, such as `api-gen`, `drizzle`, `dist`, lockfiles, snapshots, and `.gen.*` files, without mutating raw patches or adding a speculative semantic analysis layer.
  Date/Author: 2026-06-17 / Codex

- Decision: Treat the first agent-fix artifact as a computed, content-addressed `diff-review` artifact derived from the final Chat Runtime assistant output, not as an automation artifact or a chat-owned lifecycle row.
  Rationale: `diff-review` owns the relation between review feedback and produced output, while chat/session owns transcript storage. Storing a deterministic artifact id on `diff_review_agent_fixes` and recomputing content through `Session.getRunMessageContents()` gives review/API/CLI users an inspectable artifact without writing into automation or chat namespaces.
  Date/Author: 2026-06-17 / Codex

## Outcomes & Retrospective

The previous local foundation was useful but insufficient: it proved the owner boundary and renderer reuse, but it did not satisfy the review lifecycle acceptance criteria in `docs/specs/linear-diffs/cradle-diff-review-spec.md`.

Milestone update 2026-06-17: The local review lifecycle is now implemented end to end for local working-tree reviews and local branch-compare reviews. A user can open Cradle Diffs, see an inbox-style review rail with attention/authored/participated/all tabs, create a base/head compare review, mark files viewed, create/reply/resolve local threads, create same-side base/head anchored threads from selected diff lines, submit local review decisions, persist display preferences, hide whitespace-only file changes, collapse generated files, see activity events, create pending agent fix work orders, start pending agent fixes as chat-runtime sessions/runs when an agent id is supplied, cancel running agent fixes, rerun terminal agent fixes, inspect the content-addressed artifact derived from a completed agent fix, generate or edit draft commit plans, and apply accepted local working-tree commit plans as native git commits. Agents can also reach these lifecycle operations through generated `cradle workspace diffs ...` commands. Anchored comments remap by exact line hash, hunk/context match, or conservative fuzzy same-file matching and become stale when remap fails. The previous path-based deterministic guide generator has been removed because it was not semantic guided review. This does not complete semantic guided review, GitHub PR sync, AST/semantic structural analysis beyond whitespace-only suppression and generated-file collapse, LLM commit planning, issue/requester/check-aware inbox grouping, remote/source-adapter commit application, richer agent selection, or rich provider-native non-text artifact extraction.

## Context and Orientation

Cradle is a TypeScript monorepo with an Elysia server, Drizzle SQLite schema, generated OpenAPI web client, React/TanStack Router web app, Zustand stores, and Electron desktop shell. The user-facing product name is "Cradle Diffs"; the implementation owner namespace is `diff-review`.

The existing local foundation lives in these files:

- `packages/db/src/schema/diff-review.ts` defines review, revision, and file tables.
- `apps/server/src/modules/diff-review/` defines the server API and service.
- `apps/web/src/features/diff-review/cradle-diffs-viewer.tsx` renders a local review patch with `@pierre/diffs`.
- `apps/web/src/routes/workspaces_.$workspaceId.diffs.tsx` hosts Cradle Diffs as a non-nested workspace surface at `/workspaces/$workspaceId/diffs`.
- `apps/web/src/features/git/changes-panel.tsx` opens Cradle Diffs through `openWorkspaceDiffs`.

The specs require more than this. A review is the stable object a user interacts with. A revision is an immutable snapshot of the source patch at one point in time. A thread is a conversation anchored to either a diff range or the whole review. A submission is a local review decision such as approve, request changes, or comment. An event is an append-only activity record used by the UI and future notifications. An agent fix work order records a request from review context to an agent; `diff-review` now starts that work order by creating a chat-runtime session/run through existing service APIs and stores only the session/run/result revision links it owns.

## Plan of Work

First, expand the database schema within `packages/db/src/schema/diff-review.ts`. Add `diffReviewSources`, `diffReviewThreads`, `diffReviewComments`, `diffReviewSubmissions`, `diffReviewFileViewState`, `diffReviewAgentFixes`, `diffReviewSourceOperations`, `diffReviewSourceReadinessCache`, `diffReviewPreferences`, and `diffReviewEvents`. Keep names in `diff_review_*`. Use Drizzle and generate migrations with `pnpm --filter @cradle/db generate`; do not hand-write SQL without snapshot metadata.

Second, expand `apps/server/src/modules/diff-review/model.ts` and `service.ts`. The server must expose a local workflow: list reviews, refresh a review, fetch revisions/files/patch, set viewed state, list/create/resolve threads, add comments and reactions, submit review decisions, read/update preferences, list events, read guide, list source readiness, and create/list agent fix work orders. For local-only submissions, set `sourceSyncState` to `local-only`. For GitHub readiness, return explicit not-ready states without performing external calls.

Third, regenerate the web API client with `pnpm --filter @cradle/web generate`.

Fourth, replace the current patch-only page with a real review detail layout. Keep using `@pierre/diffs` for the main renderer. Add a left file rail using `review.files`, a right rail with tabs for Guide, Threads, Activity, and Agent. Add controls for marking a file viewed, creating a review-level comment thread, replying, resolving, submitting a decision, and changing display preferences. Keep UI in `apps/web/src/features/diff-review/` and do not move lifecycle state into BrowserPanel or git.

Fifth, add a review list surface or a navigable list within Cradle Diffs. The minimal acceptable version lists open local reviews for the workspace, grouped by source/status, and opens the selected review. It does not need GitHub PR grouping until the GitHub adapter exists.

Sixth, validate with focused server tests for local review lifecycle and focused web typecheck/tests. Use existing tests when they cover changed behavior. Do not add broad frontend tests just to chase coverage.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Inspect current implementation before edits:

    sed -n '1,260p' packages/db/src/schema/diff-review.ts
    sed -n '1,360p' apps/server/src/modules/diff-review/service.ts
    sed -n '1,260p' apps/server/src/modules/diff-review/model.ts
    sed -n '1,220p' apps/web/src/features/diff-review/cradle-diffs-viewer.tsx

After schema changes:

    pnpm --filter @cradle/db generate

After server API changes:

    pnpm --filter @cradle/web generate
    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts

After web UI changes:

    pnpm --filter @cradle/web exec tsc --noEmit
    NODE_ENV=test pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts src/store/browser-panel.test.ts src/features/browser/browser-panel.test.tsx

Update this plan after each milestone with the command outputs and any changes in scope.

## Validation and Acceptance

The local end-to-end acceptance scenario is:

1. Open a workspace that has local git changes.
2. Open the Changes tab and click Review.
3. The Cradle Diffs surface opens at `/workspaces/$workspaceId/diffs`.
4. The page shows a file rail, patch viewer, and right-side review rail.
5. Mark a changed file viewed; navigate away and back; the file remains viewed for the current local user.
6. Create a review-level or file-level thread with a comment; it appears in the Threads rail and Activity rail.
7. Reply to and resolve the thread; state persists after refresh.
8. Submit a local review decision such as "comment" or "request changes"; review state updates and an event is recorded.
9. Change display preferences such as split/unified, font size, line height, whitespace-only hiding, or generated-file collapse; the preference persists.
10. Create an agent fix work order from review context; it appears as a pending local work order.
11. Start a pending agent fix with an agent id. The work order moves to running, records session/run ids, then completes after Chat Runtime finishes, links to the resulting review revision after source refresh, and exposes a content-addressed artifact derived from the final assistant output.
12. Cancel a running agent fix or rerun a completed, failed, or cancelled fix. Cancellation records `agent_fix_cancelled`; rerun reuses the same review-owned work-order id with fresh session/run links.

Server tests should prove that refreshing the same local patch is idempotent, refreshing a changed patch creates a new revision, file viewed state is per local user, comments survive refresh, submissions update review state, agent fix completion stores and serves an artifact, and event rows are emitted for lifecycle actions.

## Idempotence and Recovery

All local review operations must be safe to retry. Refreshing an unchanged source must not duplicate revisions. Creating a thread or submission should use server-generated ids and append events once per request. Viewed state should upsert by `(reviewId, revisionId, fileId, userId)`. Preferences should upsert by `(workspaceId, userId)`.

Migrations are generated by Drizzle Kit. If migration generation produces an unexpected diff, inspect `packages/db/drizzle/meta/_journal.json` and the latest snapshot before editing. Because the app is unreleased, destructive schema cleanup is allowed when it keeps ownership cleaner, but do not delete unrelated user data manually.

If the web UI fails to load after route changes, verify `apps/web/src/routeTree.gen.ts` maps `/workspaces/$workspaceId/diffs` as a root child through the non-nested `workspaces_.$workspaceId.diffs.tsx` route file.

## Artifacts and Notes

Initial evidence:

    packages/db/src/schema/diff-review.ts
      Currently defines diffReviews, diffReviewRevisions, and diffReviewFiles only.

    apps/server/src/modules/diff-review/index.ts
      Currently exposes POST local-working-tree and GET review only.

    docs/specs/linear-diffs/feature-coverage-matrix.md
      Marks only the foundation slice as done/partial; most review lifecycle features are not done.

Validation transcripts:

    pnpm --filter @cradle/db generate
    85 tables
    [✓] Your SQL migration file ➜ drizzle/0002_even_black_tom.sql

    pnpm --filter @cradle/web generate
    @hey-api/openapi-ts v0.97.1
    Done! Your output is in ./apps/web/src/api-gen

    pnpm --filter @cradle/db generate
    86 tables
    [✓] Your SQL migration file ➜ drizzle/0004_yellow_miek.sql

    pnpm --filter @cradle/web generate
    @hey-api/openapi-ts v0.97.1
    Done! Your output is in ./apps/web/src/api-gen

    pnpm --filter @cradle/server exec tsc --noEmit
    exit code 0

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files 1 passed
    Tests 2 passed

    pnpm --filter @cradle/db generate
    85 tables
    [✓] Your SQL migration file ➜ drizzle/0003_sleepy_bedlam.sql

    pnpm --filter @cradle/web generate
    @hey-api/openapi-ts v0.97.1
    Done! Your output is in ./apps/web/src/api-gen

    pnpm --filter @cradle/web exec tsc --noEmit
    exit code 0

    NODE_ENV=test pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts src/store/browser-panel.test.ts src/features/browser/browser-panel.test.tsx
    Test Files 3 passed
    Tests 35 passed
    Note: this command still prints the existing late jsdom `document is not defined` MutationObserver cleanup warning after passing.

    pnpm --filter @cradle/db generate
    86 tables
    [✓] Your SQL migration file ➜ drizzle/0005_stale_harrier.sql

    pnpm --filter @cradle/web generate
    @hey-api/openapi-ts v0.97.1
    Done! Your output is in ./apps/web/src/api-gen

    pnpm gen:cli
    Generated 239 CLI commands
    Updated SKILL.md with 21 modules

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files 1 passed
    Tests 6 passed
    Note: this command still prints existing duplicate `browser-use` plugin registration log noise during repeated test app creation.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/cli typecheck
    exit code 0

    pnpm --filter @cradle/cli cradle workspace diffs agent-fix start --help
    Shows `<id> <reviewId> <agentFixId>` path arguments plus `--agent-id`, `--provider-target-id`, and `--model-id`.

    pnpm --filter @cradle/cli cradle --help
    exit code 0

    pnpm --filter @cradle/db generate
    No schema changes, nothing to migrate

    pnpm --filter @cradle/web generate
    @hey-api/openapi-ts v0.97.1
    Done! Your output is in ./apps/web/src/api-gen

    pnpm gen:cli
    Generated 241 CLI commands
    Updated SKILL.md with 21 modules

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/cli typecheck
    exit code 0

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files 1 passed
    Tests 7 passed
    Note: this command still prints existing duplicate `browser-use` plugin registration log noise during repeated test app creation.

    pnpm --filter @cradle/cli cradle workspace diffs agent-fix cancel --help
    Shows `<id> <reviewId> <agentFixId>` path arguments.

    pnpm --filter @cradle/cli cradle workspace diffs agent-fix rerun --help
    Shows `<id> <reviewId> <agentFixId>` path arguments plus `--agent-id`, `--provider-target-id`, and `--model-id`.

    pnpm --filter @cradle/cli cradle --help
    exit code 0

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files 1 passed
    Tests 7 passed
    Note: this command still prints existing duplicate `browser-use` plugin registration log noise during repeated test app creation.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files 1 passed
    Tests 5 passed
    Note: this command still prints existing duplicate `browser-use` plugin registration log noise during repeated test app creation.

    pnpm --filter @cradle/web generate
    @hey-api/openapi-ts v0.97.1
    Done! Your output is in ./apps/web/src/api-gen

    pnpm gen:cli
    Generated 238 CLI commands
    Updated SKILL.md with 21 modules

    pnpm --filter @cradle/db generate
    No schema changes, nothing to migrate

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/cli typecheck
    exit code 0

    pnpm --filter @cradle/cli cradle workspace diffs commit-plan apply --help
    Shows `<id> <reviewId> <commitPlanId>` path arguments plus `--idempotency-key`.

    pnpm --filter @cradle/cli cradle --help
    exit code 0

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files 1 passed
    Tests 4 passed
    Note: this command still prints existing duplicate `browser-use` plugin registration log noise during repeated test app creation.

    pnpm --filter @cradle/web exec tsc --noEmit
    exit code 0

    NODE_ENV=test pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts src/store/browser-panel.test.ts src/features/browser/browser-panel.test.tsx
    Test Files 3 passed
    Tests 35 passed
    Note: this command still prints the existing late jsdom `document is not defined` MutationObserver cleanup warning after passing.

    NODE_ENV=test pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts src/store/browser-panel.test.ts src/features/browser/browser-panel.test.tsx
    Test Files 3 passed
    Tests 35 passed

    pnpm --filter @cradle/server exec tsc --noEmit
    exit code 0

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files 1 passed
    Tests 4 passed

    pnpm gen:cli
    Generated 236 CLI commands
    Updated SKILL.md with 21 modules

    pnpm --filter @cradle/cli typecheck
    exit code 0

    pnpm --filter @cradle/cli cradle --help
    exit code 0

    pnpm --filter @cradle/cli cradle workspace diffs --help
    Shows `workspace diffs` commands for agent-fix, branch-compare, commit-plan, file viewed state, get, list, local-working-tree, preferences, readiness, refresh, submit, and thread actions.

    pnpm --filter @cradle/cli cradle workspace diffs thread create --help
    Shows `<id> <reviewId>` path arguments plus `--file-id`, `--anchor`, and required `--body-markdown`.

    pnpm --filter @cradle/cli cradle workspace diffs branch-compare --help
    Shows `<id>` path argument plus `--repo`, required `--base-ref`, and required `--head-ref`.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/web exec tsc --noEmit
    exit code 0

    pnpm --filter @cradle/web exec tsc --noEmit
    exit code 0

    NODE_ENV=test pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts src/store/browser-panel.test.ts src/features/browser/browser-panel.test.tsx
    Test Files 3 passed
    Tests 35 passed
    Note: this command still prints the existing late jsdom `document is not defined` MutationObserver cleanup warning after passing.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files 1 passed
    Tests 7 passed
    Note: this command still prints existing duplicate `browser-use` plugin registration log noise during repeated test app creation.

    pnpm --filter @cradle/web generate
    @hey-api/openapi-ts v0.97.1
    Done! Your output is in ./apps/web/src/api-gen

    pnpm gen:cli
    Generated 242 CLI commands
    Updated SKILL.md with 21 modules

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    exit code 0

    pnpm --filter @cradle/cli typecheck
    exit code 0

    pnpm --filter @cradle/cli cradle workspace diffs agent-fix artifact --help
    Shows `<id> <reviewId> <agentFixId>` path arguments.

    pnpm --filter @cradle/cli cradle --help
    exit code 0

## Interfaces and Dependencies

Use `@pierre/diffs` and `@pierre/diffs/react` for parsing and rendering. Use Drizzle ORM for all database access. Use existing `apps/server/src/modules/git/service.ts` for local repository facts and patches. Use generated API client functions under `apps/web/src/api-gen/` after running the generator.

At the end of the server milestone, `DiffReviewView` should include the current revision, file list with viewed state, threads with comments/reactions, submissions, recent events, preferences, guide steps, and agent fixes or load those through adjacent workspace-scoped endpoints. Agent fixes include `sessionId`, `runId`, `artifactId`, and `resultRevisionId`; `resultRevisionId` is the review-owned link to the revision observed after Chat Runtime completion and source refresh. `GET /workspaces/:id/diff-reviews/:reviewId/agent-fixes/:agentFixId/artifact` returns the content-addressed artifact derived from the final assistant output for completed agent fixes. The exact shape may be split across endpoints to keep responses manageable, but all APIs must be workspace-scoped and must not expose absolute paths.

Revision Note:

- 2026-06-17 05:03Z: Initial end-to-end plan created after confirming the previous implementation only completed the local foundation and route migration.
- 2026-06-17 05:16Z: Updated after implementing the local review lifecycle, generated migrations/API client, and validating focused server/web behavior. Remaining work is now explicitly scoped to remote adapters, precise anchors, real agent execution, full inbox semantics, structural analysis, and Commit Planner.
- 2026-06-17 13:24Z: Updated after adding rule-based draft Commit Planner schema/API/server tests/UI and revalidating focused server/web behavior. At that time remaining Commit Planner work was LLM grouping, editing, staging, and native commit execution.
- 2026-06-17 13:31Z: Updated after adding typed line anchors, refresh remap/stale behavior, generated client types, basic head-line thread creation UI, and focused server coverage.
- 2026-06-17 13:37Z: Updated after adding local branch compare source support, source-id review identity, generated Drizzle/API artifacts, minimal compare UI, and focused validation.
- 2026-06-17 13:50Z: Updated after adding generated CLI exposure for Cradle Diffs lifecycle routes and validating CLI/server behavior.
- 2026-06-17 14:02Z: Updated after adding controlled click/drag diff line selection for same-side base/head thread anchors and validating web typecheck.
- 2026-06-17 14:08Z: Updated after making whitespace-only suppression functional through the existing review display preference and validating focused web checks.
- 2026-06-17 14:14Z: Updated after adding conservative fuzzy anchor remapping and focused server coverage.
- 2026-06-17 15:08Z: Updated after adding accepted local working-tree commit-plan application, idempotent source operation records, generated web/CLI apply surfaces, focused server coverage, and validation transcripts.
- 2026-06-17 15:26Z: Updated after adding attention/authored/participated/all inbox tabs and source/status grouping to the Cradle Diffs review rail, with focused web typecheck validation.
- 2026-06-17 07:37Z: Updated after adding explicit agent-fix start execution through Chat Runtime, result revision linking, generated web/CLI start surfaces, fake-runtime server coverage, and validation transcripts.
- 2026-06-17 07:50Z: Updated after adding agent-fix cancel/rerun controls, generated web/CLI command surfaces, fake-runtime cancellation/rerun coverage, and validation transcripts.
- 2026-06-17 07:59Z: Updated after adding deterministic generated-file classification, making the generated-file collapse preference functional in the Cradle Diffs rail and renderer, and validating focused server/web checks.
- 2026-06-17 09:57Z: Updated after adding content-addressed agent-fix artifact recording/retrieval from final Chat Runtime output, generated web/CLI artifact surfaces, Agent rail artifact previews, and focused validation transcripts.
