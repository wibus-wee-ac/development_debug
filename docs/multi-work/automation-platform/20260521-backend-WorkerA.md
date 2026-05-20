# Automation Platform Backend Handoff - WorkerA

## Changed Files

- `packages/db/src/schema/automation.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/schema/README.md`
- `packages/db/drizzle/0022_automation_platform.sql`
- `packages/db/drizzle/meta/_journal.json`
- `apps/server/src/modules/automation/index.ts`
- `apps/server/src/modules/automation/model.ts`
- `apps/server/src/modules/automation/service.ts`
- `apps/server/src/modules/automation/scheduler.ts`
- `apps/server/src/modules/automation/poller.ts`
- `apps/server/src/modules/automation/README.md`
- `apps/server/src/app.ts`
- `apps/server/README.md`
- `apps/server/tests/automation.test.ts`
- `apps/server/src/modules/test-reset/index.ts`

## Behavior

- Added automation-owned DB tables for definitions, runs, artifacts, and events.
- Added additive SQL migration `0022_automation_platform.sql` and appended the Drizzle journal entry.
- Added `/automations` Elysia routes for create, list, get, update, delete, enable, disable, run-now, list/get runs, list run artifacts, list definition artifacts, and get artifact.
- Added `x-cradle-cli` metadata for the Agent-facing automation routes.
- Added RRULE helper functions using `rrule` with timezone passed through `tzid`.
- Added scheduled enqueue and a lightweight poller seam with duplicate occurrence prevention through a unique index.
- Implemented v0 `run-now` by creating a normal chat session through `Session.create`, starting a backend run through `ChatRuntime.createRun`, waiting for completion, and storing a Markdown automation artifact from the exported chat session.
- If core chat-runtime startup or execution fails, the automation run is marked `failed` and preserves any linked `chatSessionId` / `backendRunId` that were created before the failure.
- Updated test reset cleanup to delete automation tables before referenced chat/workspace/profile tables.

## Tests Run

- `pnpm typecheck:server`
  - Passed.
- `pnpm --filter @cradle/server test automation`
  - Blocked before automation assertions by local native module ABI mismatch:
    `better-sqlite3.node` was compiled with `NODE_MODULE_VERSION 140`, while the current Node runtime requires `NODE_MODULE_VERSION 137`.

## Unresolved Blockers

- Focused automation integration tests need to be rerun after rebuilding or reinstalling `better-sqlite3` for the active Node runtime.
- RRULE timezone handling uses `rrule` `tzid` support. The current test covers due occurrence shape and duplicate prevention intent, but full DST/wall-clock cross-timezone regression should be added after the native SQLite test environment is healthy.

## Architecture Escalation

- No separate executor was added.
- The run-now path uses the existing session and chat-runtime core. This is the correct v0 seam, but production-grade scheduled execution still needs a lifecycle owner to start/stop `pollDueAutomations` and a retry/stale-claim policy before enabling background automation dispatch by default.
