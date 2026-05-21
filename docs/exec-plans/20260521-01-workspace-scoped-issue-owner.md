# Workspace-Scoped Issue Owner

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root.

## Purpose / Big Picture

Issues are currently implemented under the Kanban namespace even though every issue belongs to a workspace and Kanban is only one view over those issues. After this change, agents and users interact with issues through an Issue capability, while Kanban only owns board/view configuration. The visible proof is that issue CRUD, status, milestone, comment, relation, context-ref, search, and delegation routes move from `/kanban/issues` or `/kanban/statuses` to `/issues`, and `/kanban` keeps only board routes.

## Progress

- [x] (2026-05-21 00:00Z) Confirmed the existing implementation makes Kanban the code owner while using `workspaceId` as the real issue scope.
- [x] (2026-05-21 00:00Z) Chose a breaking API change with no old `/kanban/issues` compatibility adapter.
- [x] (2026-05-21 00:40Z) Added Issue-owned DB schema exports while keeping the current SQLite table names for this first implementation slice.
- [x] (2026-05-21 00:40Z) Added a server Issue module and registered it in the Elysia app before Kanban.
- [x] (2026-05-21 00:45Z) Stripped Issue-owned routes and writes out of the Kanban module.
- [x] (2026-05-21 00:55Z) Updated issue-agent, server tests, frontend SDK callers, and docs to use the Issue namespace.
- [x] (2026-05-21 00:57Z) Added workspace-derived Issue ID coverage for sequential IDs and same-prefix conflict skipping.
- [x] (2026-05-21 00:58Z) Ran focused server tests, server typecheck, and frontend typecheck. Server tests passed all assertions but Vitest exited 1 due to unrelated Chronicle daemon unhandled rejections.
- [x] (2026-05-21 16:05Z) Closed the generated CLI refresh item as intentionally out of scope. The generated CLI artifacts are not required for this plan and must not be hand-edited.

## Surprises & Discoveries

- Observation: The current working tree already contains unrelated uncommitted changes, including edits in `apps/web/src/features/kanban/use-kanban.ts`.
  Evidence: `git status --short` showed existing modifications before this implementation started.

- Observation: A physical table rename would mix namespace ownership with risky data migration.
  Evidence: current SQLite migrations and foreign keys already reference `kanban_issues`, `kanban_statuses`, and related tables.

- Observation: The generated CLI command tree is owned by the OpenAPI generator and should not be edited by hand, and generated CLI refresh is not required for this plan.
  Evidence: the user explicitly clarified that command files are generated and later confirmed the CLI generation follow-up should be ignored. This plan leaves `packages/cli/src/commands/generated` untouched.

- Observation: Focused server tests passed their assertions but the command still exited with code 1 because unrelated Chronicle daemon startup work reads server config after tests restore `CRADLE_DATA_DIR`.
  Evidence: Vitest reported `34 files / 104 tests passed`, then two unhandled rejections from `chronicleInitDaemon` with `CRADLE_DATA_DIR or CRADLE_DB_PATH is required`.

## Decision Log

- Decision: Move code and HTTP ownership to `issue` now, but keep physical SQLite table names in this slice.
  Rationale: The user explicitly requested a breaking ownership change. Moving API/module/schema exports gives the architectural boundary immediately, while deferring physical table rename avoids combining a broad API change with a destructive data migration.
  Date/Author: 2026-05-21 / Codex

- Decision: Do not provide compatibility routes under `/kanban/issues`.
  Rationale: The requested change is intentionally breaking; old namespace adapters would preserve the ambiguous owner boundary.
  Date/Author: 2026-05-21 / Codex

- Decision: Generate issue IDs from the workspace identifier prefix instead of UUIDs.
  Rationale: Issues are human-facing workspace artifacts. The ID should be readable and stable, so `Issue.createIssue` now uses the first three normalized uppercase characters from `workspace.identifier`, falling back to workspace name or ID, then appends a zero-padded sequence such as `KAN-001`. If another workspace has the same prefix and the generated ID already exists, the sequence advances until the global primary key is free.
  Date/Author: 2026-05-21 / Codex

- Decision: Do not hand-edit generated CLI command files.
  Rationale: The command tree under `packages/cli/src/commands/generated` is generated from OpenAPI. Manual edits would be overwritten and would mix generated artifacts into the semantic owner refactor. If command output needs to reflect the new routes, run the generator in a separate generated-artifact step.
  Date/Author: 2026-05-21 / Codex

## Outcomes & Retrospective

The source-level owner migration is implemented for server, database schema exports, frontend API callers, and documentation. Kanban now owns board/view configuration, while Issue owns statuses, milestones, issue CRUD, comments, relations, context refs, session links, and issue ID generation. Remaining generated CLI artifacts were intentionally left untouched by hand.

## Context and Orientation

The repository exposes server capabilities through Elysia modules under `apps/server/src/modules`. The `kanban` module currently owns board, status, milestone, issue, comment, relation, and context-ref routes. The database package exposes Drizzle table objects through `packages/db/src/schema`. The frontend uses generated OpenAPI SDK functions from `apps/web/src/api-gen`.

An owner is the module that defines semantics, writes the data, and owns compatibility. A scope is the lifecycle root. The target model is: Issue owns issue semantics, Workspace scopes issue lifecycle through `workspaceId`, and Kanban owns board/view configuration.

## Plan of Work

First, create `packages/db/src/schema/issue.ts` and move the Issue table exports there. The first implementation slice keeps SQLite table names such as `kanban_issues` so existing databases still open, but code imports should use `issues`, `issueStatuses`, `issueMilestones`, `issueComments`, and `issueRelations`.

Second, create `apps/server/src/modules/issue` with `model.ts`, `service.ts`, `index.ts`, and `README.md`. This module exposes `/issues`, `/issues/statuses`, `/issues/milestones`, `/issues/comments`, and `/issues/relations`. It owns default status seeding, issue CRUD, comments, relations, context refs, and session links.

Third, shrink `apps/server/src/modules/kanban` so it only owns board routes and board view configuration. Board creation must not write Issue-owned status data.

Fourth, update `apps/server/src/modules/issue-agent` to use `/issues/:id/delegation` and to read/write core issue state through the Issue service instead of the Kanban service.

Finally, update frontend/server tests to call the new namespace. No old `/kanban/issues` route should remain in server or frontend source except negative OpenAPI assertions that prove the route is absent. Generated CLI files are not edited by hand.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

1. Apply the schema/module split.
2. Run `pnpm typecheck:server` and fix type errors.
3. Run `pnpm --filter @cradle/server test -- apps/server/tests/kanban.test.ts apps/server/tests/issue-agent.test.ts` if Vitest accepts the path filter, otherwise run `pnpm --filter @cradle/server test`.
4. Use the existing generated web SDK names for `/issues` and update frontend SDK call sites.
5. Run `pnpm typecheck:apps-web`.
6. Do not hand-edit CLI command files. Generated CLI refresh is intentionally out of scope for this plan.

## Validation and Acceptance

Acceptance requires the server OpenAPI document to expose Issue-owned paths such as `/issues`, `/issues/statuses`, and `/issues/{id}/comments`, while `/kanban` exposes board routes only. Creating a workspace, listing issue statuses, creating an issue, commenting on it, delegating it, and listing agent sessions must work through the new Issue paths. Focused server tests and frontend typecheck should pass.

Issue IDs are accepted when a workspace with identifier `KAN` creates `KAN-001`, then `KAN-002`, and two workspaces sharing identifier `APP` produce `APP-001` then `APP-002` rather than colliding or using UUIDs.

## Idempotence and Recovery

The implementation is source-level and can be rerun safely. If generated SDK output diverges, rerun `pnpm generate:web` after server typecheck passes. If physical table rename is desired later, add a separate migration plan that renames tables and updates foreign keys with explicit backup guidance.

## Artifacts and Notes

Validation artifacts:

    pnpm --filter @cradle/server test -- tests/kanban.test.ts tests/issue-agent.test.ts tests/openapi.test.ts
    Result: 34 files / 104 tests passed, command exited 1 due to two unrelated Chronicle daemon unhandled rejections after tests.

    pnpm typecheck:server
    Result: exited 0.

    pnpm typecheck:apps-web
    Result: exited 0 before the final canonical Issue type export; rerun after that small export.

## Interfaces and Dependencies

At the end of this plan, `apps/server/src/modules/issue/index.ts` must export `issue`, and `apps/server/src/app.ts` must call `app.use(issue)`. `packages/db/src/schema/issue.ts` must export Issue-owned Drizzle tables and row types. `apps/server/src/modules/kanban/index.ts` must not expose issue, status, milestone, comment, relation, context-ref, or delegation routes.

Revision note: Initial plan created to capture the breaking Issue owner migration before implementation.

Revision note: Updated after implementation to record the Issue module split, workspace-derived issue IDs, generated CLI boundary, and validation outcomes.

Revision note: Updated after Wibus confirmed generated CLI refresh is not required for this plan; the remaining checkbox is closed as intentionally out of scope.
