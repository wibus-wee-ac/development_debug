# Agent Steer and Queue Support

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained and describes the current repository state, the target behavior, the implementation steps, and the validation evidence needed to prove the feature works.

## Purpose / Big Picture

Users can currently delegate an issue to an agent and then mostly wait until the long-running agent session finishes. After this change, when an issue agent is active, the user can send a follow-up as either a steer message or a queued prompt. A steer message records immediate guidance for the active run and is carried into the next provider turn without cancelling the current run. A queued prompt is persisted, visible in the Agent Session panel, cancellable, reorderable, and automatically processed after the current agent work finishes.

The visible outcome is in the issue detail Agent Session panel. While the agent is running, the prompt box says `Send steer...` or `Add to queue...` based on a dedicated settings option. The panel shows queued prompts with drag handles and remove buttons. The session status line shows `Executing`, `Steered`, or `Queued N items`. Settings includes `Continuation behavior`, with `Queue` and `Steer` choices plus text explaining that `Shift+Cmd+Enter` sends the opposite behavior for one message.

## Progress

- [x] (2026-05-23 12:10Z) Read the ExecPlan rules and confirmed non-negotiables: the plan must be self-contained, live-updated, behavior-focused, and stored under `docs/exec-plans/`.
- [x] (2026-05-23 12:18Z) Inspected `apps/server/src/modules/issue-agent/*`, `apps/server/src/modules/chat-runtime/*`, `apps/server/src/modules/preferences/*`, `packages/db/src/schema/issue-agent.ts`, and the current Agent Session UI under `apps/web/src/features/kanban/issue-detail/`.
- [x] (2026-05-23 12:24Z) Identified the current gap: `AgentPromptInput` posts to `/issue-agent-sessions/:agentSessionId/prompt`, but no server route currently exists, and the input is disabled while the agent is busy.
- [x] (2026-05-23 12:38Z) Added persistent issue-agent queue schema and migration stub for `agent_session_queue_items`.
- [x] (2026-05-23 16:00Z) Added issue-agent prompt, queue list, queue reorder, and queue cancellation server APIs under the issue-agent namespace.
- [x] (2026-05-23 16:05Z) Extended chat preferences with `continuationBehavior`, defaulting to `queue`, and preserved compatibility for old JSON preference files.
- [x] (2026-05-23 16:13Z) Regenerated web and CLI clients; generated CLI exposes `issue-agent-session prompt`, `queue`, `queue cancel`, and `queue reorder`.
- [x] (2026-05-23 16:23Z) Updated the Agent Session panel with enabled continuation input, queue list, status labels, cancellation, pointer drag sorting, and keyboard drag sorting.
- [x] (2026-05-23 16:34Z) Added focused server tests for queue/steer/reorder/cancel/drain, stop cancellation, prompt rejection after stop, createRun failure recovery, and chat preference persistence.
- [x] (2026-05-23 16:35Z) Completed 5 reviewer -> fix rounds and applied fixes for server race semantics, DB migration snapshot/FK, web accessibility, generated preference schema compatibility, and ExecPlan record completeness.

## Surprises & Discoveries

- Observation: The web component `apps/web/src/features/kanban/issue-detail/agent-prompt-input.tsx` already assumes a prompt endpoint exists, but `apps/server/src/modules/issue-agent/index.ts` exposes only delegation, list activities, rerun, and stop routes.
  Evidence: `rg "/prompt" apps/server apps/web` only found the frontend fetch call.

- Observation: The current `ChatRuntime` contract permits only one active run per chat session and exposes no provider-neutral live side channel for injecting new user text into an already-streaming turn.
  Evidence: `apps/server/src/modules/chat-runtime/service.ts` throws `chat_run_in_progress` when `activeRunIdsBySession` or `pendingRunSessionIds` contains the session id, and `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` defines `streamTurn` and `cancelTurn` but no `steerTurn` or `appendInput` method.

- Observation: `issue-agent` is the correct owner for queue semantics because it already owns issue delegation, agent sessions, and agent activity timeline records.
  Evidence: `apps/server/src/modules/issue-agent/README.md` and `service.ts` keep delegation state and activity creation under that module; the chat runtime remains the owner of chat message execution.

- Observation: Queue item lifecycle needs a `failed` state even though the first draft only listed `queued`, `running`, `completed`, and `cancelled`.
  Evidence: `ChatRuntime.createRun` can throw before returning a run id, and provider turns can finish with `failed`; marking such items `completed` would make the queue history misleading.

- Observation: `ChatRuntime` published terminal run events before releasing its per-session active-run lock.
  Evidence: A regression test that queued two prompts and forced the first queued `createRun` to fail exposed a `chat_run_in_progress` race when issue-agent drained immediately from the terminal event. The fix releases the chat-runtime active run before publishing the terminal event and keeps issue-agent retry handling for transient run-reservation errors.

- Observation: Drizzle generated a duplicate `0039_agent_session_queue_items.sql` when asked to create the missing snapshot because `0038` had been hand-authored without a snapshot.
  Evidence: `pnpm exec drizzle-kit generate --config drizzle.config.ts --name agent_session_queue_items` produced a duplicate create-table migration plus `0039_snapshot.json`. The duplicate SQL and journal entry were removed, and the generated snapshot was retained as `packages/db/drizzle/meta/0038_snapshot.json`.

- Observation: React Doctor initially flagged the new prompt textarea as missing an accessible name.
  Evidence: `npx -y react-doctor@latest . --verbose --diff` reported `control-has-associated-label` for `agent-prompt-input.tsx`; adding `aria-label="Agent prompt"` removed that finding from the later `apps/web` diff scan.

## Decision Log

- Decision: Store queue items in a new Cradle-owned issue-agent table instead of encoding them in `agent_activities.signalMetadata`.
  Rationale: Queue items need stable ids, ordering, cancellation, and automatic dispatch. A normalized table gives these semantics without parsing activity history and keeps activity rows append-only.
  Date/Author: 2026-05-23 / Codex

- Decision: Add `continuationBehavior` to chat preferences rather than creating a new settings namespace.
  Rationale: The setting controls what happens when the user sends another chat-like prompt during an existing agent run, and the existing `/preferences/chat` file already owns default chat behavior.
  Date/Author: 2026-05-23 / Codex

- Decision: Implement provider-neutral steer as an issue-agent intervention record plus an automatic follow-up turn after the active run completes, while leaving the API shape open for future provider-native live steering.
  Rationale: The current runtime provider interface has no live input method. Recording steer immediately preserves user intent, shows it in the activity timeline, and keeps context/progress without aborting the run. A later provider-native capability can consume the same route with a stronger dispatch path.
  Date/Author: 2026-05-23 / Codex

- Decision: Queue dispatch should run in `watchRunCompletion` after every terminal state, not only after successful completion.
  Rationale: Users expect queued prompts to continue after the current work is no longer running. If a run fails, the next queued item should still be visible and eligible to run unless the session has been stopped or undelegated.
  Date/Author: 2026-05-23 / Codex

- Decision: Add `failed` to queue item status.
  Rationale: Queue items represent durable user prompts, so failed dispatch or failed provider execution must be distinguishable from cancellation and successful completion.
  Date/Author: 2026-05-23 / Codex

- Decision: Add a per-session issue-agent queue drain reservation and release chat-runtime run locks before terminal event publication.
  Rationale: Queue drain can be triggered by prompt submission and run completion. Without a reservation, two callers can race between marking an item `running` and receiving the chat-runtime run id. Also, if chat-runtime publishes terminal events before clearing its active-run map, issue-agent can immediately try to drain the next item and hit `chat_run_in_progress`.
  Date/Author: 2026-05-23 / Codex

- Decision: Stop and undelegation cancel still-queued prompts and stopped or undelegated sessions reject new prompts.
  Rationale: A user stop means queued follow-ups must not later restart the old session. Durable queue history is retained through cancelled rows, but the visible queue hides non-active items.
  Date/Author: 2026-05-23 / Codex

- Decision: Keep `continuationBehavior` required in GET responses but optional in PUT request bodies.
  Rationale: Existing preference writers and generated CLI calls should remain source-compatible. The server normalizes omitted values to `queue` before writing the JSON preference file.
  Date/Author: 2026-05-23 / Codex

## Outcomes & Retrospective

Implemented the feature end to end. The server owns durable issue-agent queue rows, prompt submission, cancellation, reorder, automatic drain, steer-derived priority follow-ups, and Activity Timeline signals. Preferences owns the default continuation behavior. The web Agent Session panel now reads the preference, sends the selected or one-message opposite mode, displays active queue rows, supports cancelling queued prompts, and supports pointer and keyboard sorting.

Validation completed successfully for focused server behavior, server typecheck, generated CLI typecheck, and generated CLI help. The focused server command passed with 3 files and 14 tests. `pnpm typecheck:apps-web` remains blocked by pre-existing unrelated TypeScript diagnostics in `agent-management`, `chronicle`, and chat store files; none of the diagnostics mention the newly added queue/settings files. React Doctor still reports unrelated diff findings in other web files, but the issue-agent prompt accessibility finding introduced during this work was fixed.

The remaining product risk is manual UI verification: opening a real issue detail panel, changing Settings > 对话, sending `Shift+Cmd+Enter`, dragging queued rows, and watching a real long-running provider drain the queue after completion.

## Context and Orientation

The server is an Elysia application assembled in `apps/server/src/app.ts`. Feature modules live under `apps/server/src/modules`. The `issue-agent` module owns issue delegation to agents, the `agent_sessions` table, and the `agent_activities` activity timeline. The `chat-runtime` module owns execution of chat turns against provider runtimes and persists chat messages. The `preferences` module stores JSON preference files under the Cradle data directory.

The database schema is in `packages/db/src/schema`. The relevant current file is `packages/db/src/schema/issue-agent.ts`, which defines `agentSessions` and `agentActivities`. Migrations are SQL files under `packages/db/drizzle`; the latest visible migration is `0037_sweet_paibok.sql`, so the new migration should use `0038_...sql`. This repository uses Drizzle ORM for database access and raw SQL migrations generated or authored under the migration directory.

The issue-agent server routes are in `apps/server/src/modules/issue-agent/index.ts`. Schemas are in `model.ts`; service semantics are in `service.ts`. The current public routes include `/issues/:id/delegation`, `/issues/:id/agent-sessions`, `/issue-agent-sessions/:agentSessionId/activities`, `/issue-agent-sessions/:agentSessionId/rerun`, and `DELETE /issue-agent-sessions/:agentSessionId`.

The web issue detail agent UI lives under `apps/web/src/features/kanban/issue-detail`. `agent-session-panel.tsx` shows the session status, stop/rerun/open-chat actions, activity feed, and prompt input. `agent-prompt-input.tsx` currently posts to a missing endpoint and disables itself while the agent is busy. `apps/web/src/features/kanban/use-kanban.ts` is the TanStack Query boundary for issue-agent sessions and activities.

Settings UI lives under `apps/web/src/features/settings`. `settings-content.tsx` maps section ids to settings components, and `settings-row.tsx` contains shared row primitives. `JarvisSettings` is a compact example of server-backed settings with query and mutation hooks.

The generated web API client lives under `apps/web/src/api-gen` and is regenerated by running `pnpm generate:web`. The generated CLI lives under `packages/cli/src/commands/generated` and is regenerated by running `pnpm gen:cli`. Generated files should not be edited manually.

## Plan of Work

First, extend the issue-agent database model. Add `agentSessionQueueItems` to `packages/db/src/schema/issue-agent.ts` with fields for `id`, `agentSessionId`, `text`, `status`, `position`, and timestamps. The status enum should include `queued`, `running`, `completed`, and `cancelled`. Add an index by `agentSessionId` and a compound index by `agentSessionId` and `position`. Add migration `packages/db/drizzle/0038_agent_session_queue_items.sql` to create the table and indexes. Exported types should follow the existing `AgentSession` and `AgentActivity` pattern.

Second, extend `apps/server/src/modules/issue-agent/model.ts` and `service.ts`. Add response schemas for queue items, prompt submissions, reorder requests, and delete responses. Add service functions: list queued items, submit continuation, cancel queue item, and reorder queue items. `submit continuation` accepts text and mode. Mode is `queue` or `steer`. Queue mode inserts a queue item and creates an activity with signal `queue.enqueued`. Steer mode creates an activity with signal `steer.received` and, if a run is active, records a high-priority queued follow-up with metadata marking it as steer-derived. If no run is active, it starts a new run immediately with the steer text. When a run finishes, the watcher drains the next queued item by position, marks it running, creates an activity with signal `queue.started`, starts `ChatRuntime.createRun`, and then marks the item completed when that run finishes. This must avoid concurrent runs by checking the issue-agent `activeRuns` map and chat-runtime errors.

Third, add Elysia routes under issue-agent ownership. Add `GET /issue-agent-sessions/:agentSessionId/queue`, `POST /issue-agent-sessions/:agentSessionId/prompt`, `POST /issue-agent-sessions/:agentSessionId/queue/reorder`, and `DELETE /issue-agent-sessions/:agentSessionId/queue/:queueItemId`. Add `x-cradle-cli` metadata for non-streaming commands where useful: listing the queue, sending a prompt, reordering queue items, and cancelling a queued item. Keep handlers thin and service-owned.

Fourth, extend chat preferences. In `apps/server/src/modules/preferences/model.ts`, add `continuationBehavior` with allowed values `queue` and `steer`, defaulting to `queue`. Existing preference files without the field must still parse and return the default. Update server tests for `/preferences/chat` to prove the new field persists.

Fifth, regenerate API clients. Run `pnpm generate:web` and `pnpm gen:cli`. Use generated functions in the web code instead of hand-written fetches. If generator output changes unrelated files, keep it only if caused by route/schema metadata changes.

Sixth, update the web UI. Create a small chat preferences hook, for example `apps/web/src/features/settings/use-chat-preferences.ts`, or place it in a more fitting feature-owned module if one already exists during implementation. Add a `Continuation behavior` row to settings with a segmented `Queue` / `Steer` control and the copy requested by the user. Update `AgentPromptInput` so it remains enabled during active sessions, uses the saved default mode, and treats `Shift+Cmd+Enter` as a one-message opposite mode. The placeholder should be `Send steer...` for steer mode and `Add to queue...` for queue mode while busy. Update `AgentSessionPanel` to fetch queue items, display a queue list with drag sorting via the existing `@dnd-kit` dependency, cancel buttons, and a status line that can show `Executing`, `Steered`, or `Queued N items`.

Seventh, update docs and tests. Update `apps/server/src/modules/issue-agent/README.md`, `apps/server/src/modules/preferences/README.md`, `apps/web/src/features/kanban/issue-detail/README.md`, and `apps/web/src/features/settings/README.md` so file inventories and ownership notes stay accurate. Add server tests in `apps/server/tests/issue-agent.test.ts` for enqueue, cancel, reorder, automatic drain, and activity signals. Add or update web tests if existing test harness can cover the prompt input mode and settings control cheaply. If web tests are too broad for this turn, rely on typecheck plus focused component inspection and record the gap.

Finally, run 5 reviewer -> fix rounds. Each round must review a different risk axis: server behavior and race conditions, database migration and ownership, web UX and accessibility, generated clients and CLI exposure, and final acceptance against the original requirements. After each review, either apply a fix or record that no fix was needed with evidence.

## Concrete Steps

From repository root `/Users/wibus/dev/Cradle`, run these commands as implementation proceeds:

    pnpm --filter @cradle/server test -- issue-agent.test.ts preferences.test.ts
    pnpm typecheck:server
    pnpm generate:web
    pnpm gen:cli
    pnpm typecheck:apps-web
    pnpm --filter @cradle/cli typecheck
    npx -y react-doctor@latest . --verbose --diff

Expected successful server test output should include passing tests for issue-agent and preferences. Exact test counts may change as tests are added. Expected typecheck output is no TypeScript diagnostics.

If code generation fails because unrelated worktree changes already broke OpenAPI export, record the exact failure and still run the focused server tests and typechecks covering the touched files.

Actual validation evidence from this implementation:

    pnpm --filter @cradle/server exec vitest run tests/issue-agent.test.ts tests/preferences.test.ts tests/elysia-skeleton.test.ts
    Test Files  3 passed (3)
    Tests  14 passed (14)

    pnpm typecheck:server
    completed with exit code 0

    pnpm generate:web
    @hey-api/openapi-ts completed; output written to ./apps/web/src/api-gen

    pnpm gen:cli
    Generated 192 CLI commands

    pnpm --filter @cradle/cli typecheck
    completed with exit code 0

    pnpm --filter @cradle/cli cradle --help
    output includes issue-agent-session under Commands

    npx -y react-doctor@latest apps/web --verbose --diff
    completed with remaining findings only in other changed web files; no issue-agent queue/settings files were reported after fixes

    pnpm typecheck:apps-web
    failed on unrelated existing diagnostics in agent-management, agent-runtime schema, chat JSON schema, chronicle defaults, and chat store JSON schema

## Validation and Acceptance

Server acceptance is proven when a test can create a delegated issue agent session, submit a queue prompt while the session is active, see a queue item returned by `GET /issue-agent-sessions/:id/queue`, cancel a queued item, reorder two queued items, and observe that the next queued item automatically starts after the active run finishes. The activity list must include signals for `queue.enqueued`, `queue.cancelled`, `queue.reordered`, `queue.started`, and `queue.completed` where relevant.

Steer acceptance is proven when a test submits a steer prompt while a run is active, receives a response with mode `steer`, sees an activity with signal `steer.received`, and verifies the session remains active rather than stopped or aborted. Because the current chat-runtime provider interface has no live side channel, the provider execution proof is that the steer text is preserved and carried into the next server-started turn without cancelling the active run.

Settings acceptance is proven when `GET /preferences/chat` returns `continuationBehavior: "queue"` by default, `PUT /preferences/chat` can save `"steer"`, and a later `GET` returns `"steer"` while still preserving `modelId` and `configSelections`.

Web acceptance is proven when the Agent Session panel input is enabled while the agent is active, shows the correct placeholder from the saved setting, sends the opposite mode when `Shift+Cmd+Enter` is used, displays queued items with cancel buttons, supports drag reordering, and shows `Queued N items` or `Steered` in the status line when the data indicates those states.

Generated client acceptance is proven when regenerated web and CLI command files include the new issue-agent queue/prompt operations and both `pnpm typecheck:apps-web` and `pnpm --filter @cradle/cli typecheck` pass.

## Idempotence and Recovery

The migration is additive. Re-running tests against a fresh temporary database should create the queue table once through the existing migration runner. If a generated client step produces unexpected unrelated changes, inspect `git diff` and keep only changes caused by the new OpenAPI routes. Do not revert unrelated dirty worktree changes from other ongoing work.

Queue dispatch must be safe to retry. If a process crashes after a queue item is marked `running`, the next service operation should be able to leave it visible or return it to `queued` based on implementation details chosen during coding. The first implementation should prefer conservative behavior: do not delete queue rows, and keep completed/cancelled rows for audit unless the UI filters them out.

Stopping or undelegating a session must not delete queue history. It may cancel queued items if necessary, but activity records should explain what happened.

## Artifacts and Notes

Key current evidence:

    apps/web/src/features/kanban/issue-detail/agent-prompt-input.tsx posts to /issue-agent-sessions/:agentSessionId/prompt.
    apps/server/src/modules/issue-agent/index.ts does not expose that route yet.
    apps/server/src/modules/chat-runtime/service.ts rejects concurrent createRun calls for a session with chat_run_in_progress.
    apps/server/src/modules/chat-runtime/runtime-provider-types.ts has streamTurn and cancelTurn, but no steerTurn.

Review workflow requested by the user:

    Round 1: server behavior and race-condition review -> fix.
    Round 2: database migration and namespace ownership review -> fix.
    Round 3: web UX, keyboard behavior, accessibility, and design-system review -> fix.
    Round 4: generated client and CLI exposure review -> fix.
    Round 5: final requirement-by-requirement acceptance review -> fix.

Actual reviewer -> fix record:

    Round 1 found that queue drain was not atomically reserved, stop/undelegate left queued prompts alive, createRun failures could strand later queued prompts, and in-memory active run loss remains a recovery risk. Fixes added queue drain reservations, stop/undelegate queue cancellation, prompt rejection on stopped/undelegated sessions, createRun failure continuation, and tests for stop cancellation plus createRun failure recovery. Full process restart recovery remains a future hardening item.

    Round 2 found a missing Drizzle snapshot, a weak runId reference, and a compatibility concern for required continuationBehavior writes. Fixes added packages/db/drizzle/meta/0038_snapshot.json, added a run_id foreign key to backend_runs with ON DELETE SET NULL, and later made continuationBehavior optional in PUT bodies.

    Round 3 found missing keyboard DnD support, missing textarea accessible name, unchecked preferences mutation errors, and non-announced submit errors. Fixes added KeyboardSensor with sortableKeyboardCoordinates, aria-label on the textarea, throwOnError for putPreferencesChat, and role="alert" on submit errors.

    Round 4 found generated preferences chat set made continuationBehavior required, and noted promptSubmission.queueItem generated as a wider nullable type than queue list responses. Fixes made the PUT body optional and regenerated web/CLI clients. The wider promptSubmission generated type remains low risk because UI code narrows queue rows through Zod schemas and does not depend on that inline response type.

    Round 5 found acceptance failed because the living ExecPlan did not record implementation, outcomes, validation, or review/fix evidence. Fixes are this revision of the ExecPlan.

## Interfaces and Dependencies

In `packages/db/src/schema/issue-agent.ts`, define `agentSessionQueueItems`:

    id: text primary key
    agentSessionId: text references agent_sessions(id) on delete cascade
    text: text not null
    status: text enum queued | running | completed | cancelled | failed
    position: integer not null
    source: text enum queue | steer
    createdAt, updatedAt timestamps

In `apps/server/src/modules/issue-agent/model.ts`, expose TypeBox schemas for:

    queueItem
    queueItemList
    promptBody with text and mode
    promptResponse with accepted, mode, queueItem, activity
    reorderQueueBody with orderedIds
    queueItemIdParams with agentSessionId and queueItemId

In `apps/server/src/modules/issue-agent/service.ts`, expose:

    listQueue(agentSessionId: string): AgentSessionQueueItem[]
    submitPrompt(input: { agentSessionId: string, text: string, mode: 'queue' | 'steer' }): Promise<PromptSubmissionResult>
    cancelQueueItem(input: { agentSessionId: string, queueItemId: string }): AgentSessionQueueItem
    reorderQueue(input: { agentSessionId: string, orderedIds: string[] }): AgentSessionQueueItem[]

In `apps/web/src/features/kanban/use-kanban.ts`, expose hooks:

    useAgentQueue(agentSessionId: string | null)
    useSubmitAgentPrompt()
    useCancelAgentQueueItem()
    useReorderAgentQueue()

In settings, expose a chat preferences hook that reads and writes `/preferences/chat` and a settings control that writes `continuationBehavior`.

Revision note 2026-05-23: Initial plan created after reading current issue-agent, chat-runtime, preferences, database schema, and Agent Session UI code. The plan records the provider-neutral steer limitation discovered in the current runtime contract.

Revision note 2026-05-23: Updated after implementation, validation, and 5 reviewer -> fix rounds. The revision records server race fixes, DB snapshot/FK fixes, web accessibility fixes, generated API compatibility fixes, passing focused validation commands, and remaining unrelated web typecheck/react-doctor blockers.
