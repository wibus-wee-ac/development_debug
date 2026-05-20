# Build Agent-Authored Automation Platform

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so another contributor can resume the work with only this file and the repository checkout.

## Purpose / Big Picture

Cradle needs a generic Automation platform that Jarvis and other agents can create through Cradle's CLI/API. An automation is not a user-built form workflow. It is an agent-authored durable task definition with a title, description, RRULE trigger, prompt recipe, inputs, and artifact requests. When due, Cradle creates an `automation_run`, starts a normal chat session and backend run through the existing chat-runtime core, and stores automation-owned artifacts after the core agent run finishes.

After this change, an agent can create an automation such as "项目周报生成" with an RRULE of every Monday at 09:00, and Cradle will show it in the UI, run it through the same session/profile/workflow-rules/skills/tools/MCP path as normal chat, and keep auditable run and artifact records.

## Progress

- [x] (2026-05-20T17:10:38Z) Confirmed the user-corrected target is a generic `automation` platform, not a weekly-report-specific owner.
- [x] (2026-05-20T17:10:38Z) Read `multi-work`, `execplan`, `elysiajs`, and `server-app-development` skill instructions.
- [x] (2026-05-20T17:10:38Z) Inspected current server composition, DB schema layout, chat-runtime/session seams, package dependencies, and dirty worktree state.
- [x] (2026-05-20T17:10:38Z) Installed `rrule` as a direct `@cradle/server` dependency for recurrence calculation.
- [x] (2026-05-20T17:45:58Z) Created automation schema and SQL migration.
- [x] (2026-05-20T17:45:58Z) Created automation server module with Elysia routes, service, RRULE scheduler, lifecycle poller, and README.
- [x] (2026-05-20T17:45:58Z) Wired automation into server composition and test reset.
- [x] (2026-05-20T17:45:58Z) Added server tests for CRUD, absolute file reference validation, inline file content, RRULE due detection, run-now, core chat-runtime linkage, artifacts, and duplicate prevention.
- [x] (2026-05-20T17:45:58Z) Added web UI for automation definitions, latest run state, runs, artifacts, and Home projection.
- [ ] Regenerate API/CLI clients and verify typecheck/tests. Paused by user because current `gen:cli`/CI behavior is a separate issue they will handle.

## Surprises & Discoveries

- Observation: The existing worktree is already heavily modified by unrelated work across desktop, server, web, chronicle, and DB schema files.
  Evidence: `git status --short` before this plan showed many modified paths unrelated to automation. This work must avoid reverting or rewriting those changes.
- Observation: `rrule` was not a direct dependency before this work.
  Evidence: `rg -n "rrule|cron-parser|node-cron" package.json pnpm-lock.yaml apps packages -S` found no direct RRULE package. `pnpm add rrule --filter @cradle/server` completed successfully with only existing peer warnings.
- Observation: The chat execution core is represented by `sessions`, `backend_session_bindings`, and `backend_runs`, and `Session.create()` already resolves selected agents/profiles into normal runtime config.
  Evidence: `apps/server/src/modules/session/service.ts` creates sessions with `agentId`, `agentProfileId`, and `runtimeKind`; `apps/server/src/modules/chat-runtime/service.ts` owns `backendRuns`.
- Observation: `pnpm gen:cli` currently fails while loading server modules before OpenAPI collection.
  Evidence: the failure is `SyntaxError: The requested module 'rrule' does not provide an export named 'rrulestr'` from `apps/server/src/modules/automation/scheduler.ts`. The user clarified this belongs to the CLI/CI generation path and asked not to change the scheduler import for that issue.
- Observation: Full web typecheck is blocked by unrelated existing files outside automation.
  Evidence: `pnpm --filter @cradle/web typecheck` reports errors in `src/features/chat/use-chat-session-binding.test.tsx`, `src/features/chronicle/chronicle-settings.tsx`, and `src/features/chronicle/use-chronicle.ts`.
- Observation: `rrule` returns floating wall-clock dates; without explicit conversion, `Asia/Shanghai` Monday 09:00 was interpreted as 09:00 UTC.
  Evidence: a direct scheduler probe returned `2026-05-25T09:00:00.000Z` before the fix. After converting wall-clock occurrences back through the trigger timezone, the same rule returns `2026-05-25T01:00:00.000Z`, which is Monday 09:00 in Asia/Shanghai.
- Observation: Scheduled enqueue must not rely only on a short lookback window after downtime.
  Evidence: `apps/server/tests/automation.test.ts` now verifies a server that missed the lookback window still enqueues from persisted `nextRunAt`.

## Decision Log

- Decision: Build a generic `automation` owner now rather than a `weekly-report` owner.
  Rationale: The user clarified that weekly report generation is only an example automation. The platform must be agent-authored and reusable for arbitrary prompt recipes.
  Date/Author: 2026-05-20 / Codex.
- Decision: Use RRULE as the v0 schedule format.
  Rationale: RRULE gives more expressive recurrence than cron while still being a compact string that agents can author. Timezone remains a separate field so wall-clock semantics are explicit.
  Date/Author: 2026-05-20 / Codex.
- Decision: Automation has full access by design; do not add a fake permission gate in v0.
  Rationale: The user explicitly wants automation created by trusted Jarvis/agents and does not want permission constraints to block capability. Audit is still required so definitions, snapshots, runs, and artifacts are traceable.
  Date/Author: 2026-05-20 / Codex.
- Decision: `automation_run` is a separate outer lifecycle record that references the core `chat_session_id` and `backend_run_id`.
  Rationale: Automation owns trigger occurrence, retry, stale claim, recipe snapshot, and artifacts. Chat-runtime owns the actual model/agent execution. Keeping a reference avoids a second execution core while preserving automation lifecycle semantics.
  Date/Author: 2026-05-20 / Codex.
- Decision: Do not implement a separate script executor in automation v0.
  Rationale: The user wants skills, workflow rules, MCP servers, tools, approvals, usage, and message snapshots to flow through the core execution path. Script/code content can be passed as automation input to the normal agent runtime.
  Date/Author: 2026-05-20 / Codex.

## Outcomes & Retrospective

Automation backend and UI implementation is in place and validated with focused checks. Server routes can create/list/get/update/delete definitions, enable/disable them, run now, list/get runs, and list/get artifacts. Runs create normal chat sessions and backend runs through chat-runtime and persist `chatSessionId` plus `backendRunId` on `automation_runs`. Scheduled dispatch has a lifecycle poller, queued-run claim guard, persisted-`nextRunAt` recovery, and timezone-correct wall-clock RRULE calculation. `file_ref` inputs are service-validated as absolute paths; inline files remain content-only inputs.

Validated:

    pnpm --filter @cradle/server test automation
    pnpm --filter @cradle/server test openapi
    pnpm typecheck:server
    pnpm --filter @cradle/web exec eslint src/features/automation src/features/home/home-dashboard.tsx

Known external blockers:

    pnpm gen:cli
    pnpm --filter @cradle/web typecheck

## Context and Orientation

Cradle's server is an Elysia application composed in `apps/server/src/app.ts`. Each capability lives under `apps/server/src/modules/{domain}` with `index.ts` for routes, `model.ts` for TypeBox schemas, `service.ts` for business semantics, and `README.md` for module inventory. Agent-facing routes include `x-cradle-cli` metadata so Cradle's generated CLI can expose them.

Cradle's DB schema lives in `packages/db/src/schema`. Each owner has its own schema file, and `packages/db/src/schema/index.ts` exports the canonical schema surface. Drizzle SQL migrations live under `packages/db/drizzle`. New automation tables should be owned by `packages/db/src/schema/automation.ts` and a new migration file.

The existing chat execution core is not replaced. `apps/server/src/modules/session/service.ts` creates chat sessions and resolves selected agent/profile runtime config. `apps/server/src/modules/chat-runtime/service.ts` starts backend runs and persists messages, usage, and run status. The automation platform must call this core path so skills, workflow rules, tools, MCP, approvals, usage, and snapshots behave exactly like a normal agent session.

An automation definition is the durable thing an agent creates. It has a title, description, RRULE trigger, selected agent/profile, recipe prompt, mutually exclusive inputs, and artifact requests. An automation run is one triggered occurrence of that definition. If the recipe is an agent task, the run creates a new chat session and a backend run, then stores any resulting artifacts in automation-owned tables.

## Plan of Work

First, add persistence. Create `packages/db/src/schema/automation.ts` with `automationDefinitions`, `automationRuns`, `automationArtifacts`, and `automationEvents`, then export it from `packages/db/src/schema/index.ts`. Add a SQL migration that creates the same tables and indexes. Definitions should store `trigger_json`, `recipe_json`, and creator audit fields. Runs should store `trigger_snapshot_json`, `recipe_snapshot_json`, `chat_session_id`, and `backend_run_id`. Artifacts should store generated content and metadata.

Second, add the server module. Create `apps/server/src/modules/automation/index.ts`, `model.ts`, `service.ts`, `scheduler.ts`, `poller.ts`, and `README.md`. Routes should support create/list/get/update/delete, enable/disable, run-now, list runs, get run, list artifacts, and get artifact. Add `x-cradle-cli` metadata to stable Agent-facing routes. Register the module in `apps/server/src/app.ts`.

Third, connect execution to the core chat runtime. The automation runner should create a fresh session for each agent task run, call chat-runtime to create a backend run, store both IDs on `automation_runs`, then persist a Markdown artifact from the final assistant content. The runner must not implement a separate script execution path in v0.

Fourth, add UI. Replace Home's mock scheduled automation data with real automation reads where practical, and add a focused automation feature surface under `apps/web/src/features/automation` for definitions, runs, and artifacts. The UI is not a complex builder; it should be a registry and run/artifact viewer with basic create/edit JSON capability for Agent-authored definitions.

Fifth, verify. Add server tests for definition CRUD, RRULE due calculation, run-now, duplicate prevention, and chat-runtime linkage with a fake or test-safe execution seam. Generate web/CLI API clients, then run focused typechecks and tests.

## Concrete Steps

From `/Users/wibus/dev/Cradle`, install any missing dependencies with:

    pnpm add rrule --filter @cradle/server

This has already been run successfully in this work session.

Create and edit these files:

    packages/db/src/schema/automation.ts
    packages/db/src/schema/index.ts
    packages/db/drizzle/0022_automation_platform.sql
    packages/db/drizzle/meta/_journal.json
    apps/server/src/modules/automation/index.ts
    apps/server/src/modules/automation/model.ts
    apps/server/src/modules/automation/service.ts
    apps/server/src/modules/automation/scheduler.ts
    apps/server/src/modules/automation/poller.ts
    apps/server/src/modules/automation/README.md
    apps/server/src/app.ts
    apps/server/README.md
    apps/server/tests/automation.test.ts
    apps/web/src/features/automation/*
    apps/web/src/features/home/home-dashboard.tsx

Run these commands as validation as implementation progresses:

    pnpm --filter @cradle/server test automation
    pnpm typecheck:server
    pnpm --filter @cradle/web generate
    pnpm gen:cli
    pnpm --filter @cradle/web typecheck
    pnpm --filter @cradle/cli typecheck

If broad typechecks fail because of unrelated dirty worktree changes, record the exact blockers and run narrower tests that cover automation.

## Validation and Acceptance

Acceptance requires observable behavior, not just compiled files.

A server test must prove that `POST /automations` can create an automation with a title, description, RRULE trigger, selected profile/agent, prompt recipe, and mutually exclusive inputs. `GET /automations` must list it, and `GET /automations/:id` must return the same JSON.

A scheduler test must prove that an RRULE such as `FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0` with timezone `Asia/Shanghai` computes due occurrences and does not enqueue duplicate scheduled runs for the same occurrence.

A run-now test must prove that `POST /automations/:id/run` creates an `automation_run`, creates or references a normal chat session/backend run for agent-task recipes, stores `chat_session_id` and `backend_run_id` on the automation run, and writes an automation artifact after completion or records a clear failure.

The UI must let a user see automation definitions, latest run state, linked chat session/run IDs, and artifacts. The Home scheduled automation row should come from real API data rather than the old mock array when the API is available.

Generated CLI metadata must expose useful Agent-facing commands such as `automation create`, `automation list`, `automation get`, `automation run`, `automation runs`, and `automation artifact get`.

## Idempotence and Recovery

The migration is additive. Re-running tests should not duplicate definitions because tests use isolated databases or cleanup hooks. RRULE scheduled enqueue must enforce a unique occurrence key per automation definition and scheduled instant. Poller claim must be guarded so two ticks cannot execute the same queued run.

If an automation run crashes after a chat session/backend run is created, the run remains auditable because `chat_session_id` and `backend_run_id` are stored on `automation_runs`. v0 recovery may mark the run failed and expose manual rerun, but it must not lose the link to the core chat execution.

No destructive Git or database reset command is needed for normal implementation.

## Artifacts and Notes

The user clarified these hard constraints during design:

    Automation is generic, not weekly-report-specific.
    Automations are created by Jarvis/agents through CLI/API.
    Automation defaults to full access.
    RRULE is preferred over cron for schedule flexibility.
    File inputs are either absolute-path references or inline content, never both in one item.
    Automation run stores references to the normal chat session/backend run.
    Automation must not implement a second execution core; all agent execution must go through chat-runtime.

## Interfaces and Dependencies

Use `rrule` in `apps/server/src/modules/automation/scheduler.ts` for recurrence parsing and occurrence calculation. Store timezone separately from the RRULE string.

Define automation input as a discriminated union:

    type AutomationInput =
      | { type: 'file_ref', path: string }
      | { type: 'inline_file', name: string, content: string }
      | { type: 'text', name: string, content: string }
      | { type: 'url', url: string }

Define automation recipe v0 as:

    type AutomationRecipe = {
      kind: 'agent_task'
      prompt: string
      inputs: AutomationInput[]
      artifactRequests: AutomationArtifactRequest[]
      agentId?: string
      agentProfileId: string
    }

Define trigger v0 as:

    type AutomationTrigger = {
      type: 'rrule'
      rrule: string
      timezone: string
      misfirePolicy?: 'skip' | 'run_latest'
    }

The `automation_runs` table must include nullable `chat_session_id` and `backend_run_id` columns. For v0 agent-task recipes they should be populated by the runner.

Revision note 2026-05-20: Initial plan created after the user clarified that the desired feature is a generic Agent-authored automation platform with RRULE triggers and core chat-runtime execution.
