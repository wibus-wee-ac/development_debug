# Agent Interaction Runtime Foundation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so a new contributor can continue from this file alone.

## Purpose / Big Picture

Cradle currently lets a user delegate an issue to an agent and inspect the resulting agent session and activity feed. The behavior works, but the ownership is muddled: `issue-agent` both understands issue delegation and directly owns the generic agent session/activity table operations. That makes the product feel task-based even though Cradle's core model is an Agent Runtime Studio built around sessions, runs, activities, and observable intervention.

After this change, the generic interaction protocol has its own server owner named `agent-interaction-runtime`. Issue Agent remains the bridge from issues to agent work, while the new runtime owns agent session records, append-only activity records, lifecycle status writes, and read APIs. A user-visible issue delegation flow should behave the same, but the code and docs will make it clear that "Task" is a capability expressed through issues, sessions, automations, and activities, not the central aggregate.

## Progress

- [x] (2026-06-07 18:30+08:00) Read PLANS.md, server module instructions, current `issue-agent` service/routes/models, DB schema, OpenAPI test, and issue-agent integration tests.
- [x] (2026-06-07 18:30+08:00) Decided this slice should migrate internal ownership first while preserving the current issue delegation user journey.
- [x] (2026-06-07 21:51+08:00) Added `packages/db/src/schema/agent-interaction.ts`, removed the old schema owner file, registered `apps/server/src/modules/agent-interaction-runtime`, and exposed generic `/agent-sessions/:agentSessionId` plus `/agent-sessions/:agentSessionId/activities` reads.
- [x] (2026-06-07 21:51+08:00) Refactored Issue Agent so it no longer imports or writes `agentSessions` / `agentActivities` directly. It now calls `AgentInteraction` service functions for session status and activity writes.
- [x] (2026-06-07 21:51+08:00) Updated Issue Agent models to reuse Agent Interaction Runtime schemas, updated module/capability docs, and added focused test assertions for the generic activity route and generic missing-session error.
- [x] (2026-06-07 21:52+08:00) Ran focused server verification. `pnpm --filter @cradle/server exec vitest run tests/issue-agent.test.ts tests/openapi.test.ts` passed with 2 files / 5 tests, `pnpm --filter @cradle/server typecheck` passed, and `git diff --check` passed for touched files.

## Surprises & Discoveries

- Observation: The current database table names are already generic: `agent_sessions` and `agent_activities`.
  Evidence: `packages/db/src/schema/issue-agent.ts` declares generic physical table names even though the schema file is currently issue-agent-owned.
- Observation: Chat Runtime, not Issue Agent, already owns busy follow-up queue semantics.
  Evidence: `apps/server/src/modules/issue-agent/README.md` states that queue state is owned by Chat Runtime in `chat_session_queue_items`, and Issue Agent only projects continuation status into agent activities.
- Observation: The public frontend and generated CLI currently use `/issue-agent-sessions/:agentSessionId/...` paths.
  Evidence: `apps/server/tests/openapi.test.ts` expects `/issue-agent-sessions/{agentSessionId}/activities`, and generated web/CLI files contain the same path. This slice keeps user behavior stable while moving service ownership.
- Observation: Focused server tests log plugin duplicate-registration errors while still passing.
  Evidence: The focused Vitest run printed `Duplicate MCP server registration: browser-use` from plugin activation in repeated test app creation, then completed with `Test Files 2 passed (2), Tests 5 passed (5)`.

## Decision Log

- Decision: Do not introduce a global `task-runtime` in this slice.
  Rationale: Current Cradle product and schema are session/run/activity-oriented. A task runtime would be a larger future architecture for daemon/cloud execution, not the next product-aligned step.
  Date/Author: 2026-06-07 / Codex
- Decision: Move table ownership to an `agent-interaction` schema module without renaming physical tables.
  Rationale: The table names are already generic, and renaming physical SQLite tables would add migration risk without changing the product behavior. The owner namespace should change in code and docs first.
  Date/Author: 2026-06-07 / Codex
- Decision: Keep issue delegation routes under `/issues/:id/delegation` and `/issues/:id/agent-sessions`.
  Rationale: Those routes express issue-owned entry points and read projections. The generic session/activity mechanics move to the new owner module behind them.
  Date/Author: 2026-06-07 / Codex
- Decision: Keep existing `/issue-agent-sessions/*` route paths for this slice but implement their handlers through Agent Interaction Runtime.
  Rationale: The repo has a dirty frontend/API generated worktree. Breaking the external route namespace now would force a broad frontend regeneration unrelated to proving the ownership split. The code owner still moves; a later route cleanup can delete the old path once web callers are migrated.
  Date/Author: 2026-06-07 / Codex
- Decision: Do not add `x-cradle-cli` metadata to the new `/agent-sessions/*` routes in this slice.
  Rationale: Existing `issue-agent-session` generated CLI commands remain the stable Agent-facing shell surface today. Adding new CLI metadata would require regenerating CLI files and changing command names before the frontend/API route migration is ready.
  Date/Author: 2026-06-07 / Codex

## Outcomes & Retrospective

Completed the foundation slice. Agent Interaction Runtime now owns the generic `agent_sessions` / `agent_activities` schema module, service functions, schemas, README, and generic HTTP read routes. Issue Agent still owns issue delegation and linked Chat Runtime orchestration, but all session/activity writes go through Agent Interaction Runtime. Existing issue delegation behavior, old UI/CLI route paths, and focused tests continue to work.

This does not yet implement the full Linear-style protocol (`awaitingInput`, `stale`, plans, signal-specific typed payloads, first-response timers, external URLs). Those are now cleanly scoped as future Agent Interaction Runtime work rather than Issue Agent work.

## Context and Orientation

The server app is assembled in `apps/server/src/app.ts`. Each server capability is a module under `apps/server/src/modules/{domain}` with `index.ts` for Elysia HTTP routes, `model.ts` for TypeBox schemas, `service.ts` for business behavior, and `README.md` for ownership notes.

`apps/server/src/modules/issue-agent/service.ts` currently does too much. It validates issue delegation, creates `agent_sessions`, appends `agent_activities`, starts linked Chat Runtime runs, watches completion, projects continuation progress, and handles stop/undelegate. The generic session/activity database functions inside that file should move to a new owner.

`packages/db/src/schema/issue-agent.ts` currently declares two generic tables: `agent_sessions` and `agent_activities`. Those tables should become owned by a new `packages/db/src/schema/agent-interaction.ts` file. The physical SQLite table names can stay unchanged.

`apps/server/src/modules/chat-runtime/service.ts` owns actual provider run lifecycle through `backend_runs`, `messages`, snapshots, queue, steer, and cancellation. Agent Interaction Runtime must read or be notified about Chat Runtime runs but must not replace Chat Runtime execution ownership.

`apps/server/src/modules/issue-agent/index.ts` exposes current routes used by tests and generated clients: `/issues/:id/delegation`, `/issues/:id/agent-sessions`, `/issue-agent-sessions/:agentSessionId/activities`, `/issue-agent-sessions/:agentSessionId/continuation`, `/issue-agent-sessions/:agentSessionId/rerun`, and `DELETE /issue-agent-sessions/:agentSessionId`.

## Plan of Work

First, move DB schema ownership. Add `packages/db/src/schema/agent-interaction.ts` containing the existing `agentSessions` and `agentActivities` table definitions and export types. Update `packages/db/src/schema/index.ts` to export the new file. Delete `packages/db/src/schema/issue-agent.ts` and update `packages/db/src/schema/README.md` so new contributors see the correct owner.

Second, create `apps/server/src/modules/agent-interaction-runtime`. Its service should own generic session and activity operations: get session, require session, list by issue, create session, attach chat session, update status, create activity, and list activities. It should also expose a helper that marks the latest session as current for an issue so Issue Agent can keep its issue-specific projection without owning writes. Its model should define the session/activity response schemas currently duplicated in Issue Agent. Its README should explain that it owns the interaction protocol but not issue fields or Chat Runtime runs.

Third, register the new module in `apps/server/src/app.ts` before `issueAgent`. The route surface in the new module should include at least `GET /agent-sessions/:agentSessionId/activities` for the new owner namespace. To avoid breaking the current product path in this slice, the old `/issue-agent-sessions/*` routes remain in the Issue Agent module, but their handlers delegate to the new service.

Fourth, refactor `apps/server/src/modules/issue-agent/service.ts`. Remove direct DB imports of `agentSessions` and `agentActivities`; import the new Agent Interaction service instead. `delegateIssue` should call `AgentInteraction.createSession` and `AgentInteraction.createActivity`. `runSession`, completion watchers, continuation watcher, rerun, stop, and undelegate should call the new owner for session and activity state changes. Issue Agent should continue to call Issue service for issue delegation fields and Chat Runtime for execution.

Fifth, update `apps/server/src/modules/issue-agent/model.ts` and `index.ts` to reuse the new model schemas where possible. Keep issue-specific schemas such as delegation state in Issue Agent. Update `apps/server/src/modules/issue-agent/README.md` to say it is a delegation bridge. Add or update capability specs under `apps/server/specs/capabilities`.

Sixth, update tests. Adjust `apps/server/tests/openapi.test.ts` to assert that the new `/agent-sessions/{agentSessionId}/activities` route exists while the existing `/issue-agent-sessions/{agentSessionId}/activities` route remains for the current UI. Add focused assertions in `apps/server/tests/issue-agent.test.ts` that the new route returns the same activity records after delegation. If a new dedicated test file is warranted, keep it small and server-only.

## Concrete Steps

Run commands from `/Users/wibus/dev/Cradle`.

After editing, run:

    pnpm --filter @cradle/server exec vitest run tests/issue-agent.test.ts tests/openapi.test.ts
    pnpm --filter @cradle/server typecheck

Expected result for the focused test command is both test files passing. If server typecheck fails because of unrelated dirty worktree files, record the exact diagnostics in this plan and run a narrower command that proves the new files typecheck through the focused tests.

Observed results on 2026-06-07:

    $ pnpm --filter @cradle/server exec vitest run tests/issue-agent.test.ts tests/openapi.test.ts
    Test Files  2 passed (2)
    Tests       5 passed (5)

    $ pnpm --filter @cradle/server typecheck
    $ tsc --noEmit

    $ git diff --check -- docs/exec-plans/20260607-01-agent-interaction-runtime.md packages/db/src/schema/agent-interaction.ts packages/db/src/schema/index.ts packages/db/src/schema/README.md apps/server/src/app.ts apps/server/src/modules/agent-interaction-runtime apps/server/src/modules/issue-agent apps/server/tests/issue-agent.test.ts apps/server/tests/openapi.test.ts apps/server/specs/capabilities/agent-interaction-runtime.md apps/server/specs/capabilities/issue-agent.md apps/server/specs/capabilities/index.md
    No output; exit code 0.

## Validation and Acceptance

Acceptance is behavior-based:

1. Delegating an issue with `POST /issues/:id/delegation` still creates an agent session, starts a linked Chat Runtime run, records activities, and completes.
2. `GET /issues/:id/agent-sessions` still returns the current issue's agent sessions with `isCurrentDelegation`.
3. `GET /agent-sessions/:agentSessionId/activities` returns the same append-only activity rows as the current UI route.
4. Stop, rerun, continuation, and undelegate still work through the existing issue delegation flow.
5. Source code ownership is clear: Issue Agent no longer imports or writes `agentSessions` or `agentActivities` directly.

## Idempotence and Recovery

The schema ownership move does not rename SQLite tables and does not require a migration. If a refactor step fails, restore by re-reading `apps/server/src/modules/issue-agent/service.ts` and replacing only the direct DB helper calls with Agent Interaction service calls. Do not use `git reset` or checkout commands because the working tree contains unrelated user changes.

The new module registration is safe to repeat. If route conflicts appear, keep only one route owner for each new `/agent-sessions/*` path and leave the old issue-agent session paths until the frontend API migration is performed in a later plan.

## Artifacts and Notes

Initial evidence from repository search:

    packages/db/src/schema/issue-agent.ts declares agent_sessions and agent_activities.
    apps/server/src/modules/issue-agent/service.ts imports agentSessions and agentActivities directly.

Final verification evidence:

    apps/server/src/modules/issue-agent/service.ts imports ../agent-interaction-runtime/service and no longer imports agentSessions or agentActivities.
    apps/server/tests/openapi.test.ts asserts /agent-sessions/{agentSessionId}/activities exists.
    apps/server/tests/issue-agent.test.ts proves /agent-sessions/:id/activities returns the same rows as the current issue-agent-session activity route.
    apps/server/tests/openapi.test.ts expects /issue-agent-sessions/{agentSessionId}/activities.
    apps/server/src/modules/issue-agent/README.md already says queue state is owned by Chat Runtime.

## Interfaces and Dependencies

At the end of this slice, the new module must provide these files:

    apps/server/src/modules/agent-interaction-runtime/index.ts
    apps/server/src/modules/agent-interaction-runtime/model.ts
    apps/server/src/modules/agent-interaction-runtime/service.ts
    apps/server/src/modules/agent-interaction-runtime/README.md

The service should export these stable functions:

    getSession(agentSessionId: string): AgentSession | undefined
    requireSession(agentSessionId: string): AgentSession
    listSessionsForIssue(issueId: string): AgentSession[]
    createSession(input: { issueId: string, providerTargetId: string, agentId: string }): AgentSession
    attachChatSession(input: { agentSessionId: string, chatSessionId: string }): AgentSession | undefined
    updateSessionStatus(agentSessionId: string, status: AgentSession['status']): AgentSession | undefined
    createActivity(input: { agentSessionId: string, type: AgentActivity['type'], body: string, signal?: string | null, signalMetadata?: Record<string, unknown> | null }): AgentActivity
    listActivities(agentSessionId: string): AgentActivity[]

Issue Agent may add issue-specific helpers around these functions, but it must not import `agentSessions` or `agentActivities` from `@cradle/db`.

Revision note 2026-06-07 18:30+08:00: Initial plan created after reading current server modules, tests, DB schema, and product docs. The plan intentionally implements the Agent Interaction Runtime foundation without introducing a global task runtime.

Revision note 2026-06-07 21:52+08:00: Implementation completed. Updated progress, decisions, discoveries, validation evidence, and outcomes to reflect the new Agent Interaction Runtime module, Issue Agent service refactor, focused tests, and typecheck results.
