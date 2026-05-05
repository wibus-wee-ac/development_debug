# Context-Owned IPC Adapters

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. The plan must remain self-contained and updated at each stop point.

## Purpose / Big Picture

The tree already has context-owned application and infrastructure code, but the two most active business entrypoints — Kanban and issue-agent — were still mounted under the root `src/main/services/` bucket. That keeps the directory story half-finished: the inside of each context is well-owned, but the outward-facing IPC adapters still live in a horizontal technology folder. After this refactor, the public IPC adapters for Kanban and issue-agent should live under their owner contexts in `src/main/contexts/*/interfaces/`.

This is a structural directory refactor, not a behavior change. The success signal is that `KanbanService` and `IssueAgentService` move into context-owned interface directories, the composition root and IPC type map continue to compile, the old root files disappear, and focused tests/build/E2E remain green.

## Progress

- [x] (2026-05-05 09:39 local) Chose the next larger directory refactor in direct response to the user’s concern that ownership had improved more in code than in the visible tree.
- [x] (2026-05-05 09:40 local) Re-read the active Kanban / issue-agent IPC adapters and confirmed they are the two root services with the clearest single-context ownership.
- [x] (2026-05-05 09:43 local) Created `src/main/contexts/kanban/interfaces/kanban-service.ts` and `src/main/contexts/issue-agent/interfaces/issue-agent-service.ts`, plus new README inventories.
- [x] (2026-05-05 09:44 local) Moved the issue-agent IPC adapter test into `src/main/contexts/issue-agent/interfaces/__tests__/`.
- [x] (2026-05-05 09:46 local) Rewired `src/main/index.ts`, `src/main/ipc-types.ts`, README inventories, and current architecture docs to the new context-owned adapter paths.
- [x] (2026-05-05 09:48 local) Deleted the old root `src/main/services/kanban.ts` / `issue-agent.ts` files and revalidated the change with targeted tests, node typecheck, build, and focused E2E.

## Surprises & Discoveries

- Observation: the root `services/` directory is now best interpreted as a shared/system adapter bucket, not the canonical home for every IPC entrypoint.
  Evidence: after previous context moves, Kanban and issue-agent already depended only on code within their own contexts plus shared DB types.

## Decision Log

- Decision: use `contexts/*/interfaces/` rather than a new global `interfaces/ipc/` bucket.
  Rationale: the user explicitly wants a more meaningful directory structure, and keeping owner-facing adapters inside the same context makes that ownership visible in the path itself.
  Date/Author: 2026-05-05 / GitHub Copilot

## Outcomes & Retrospective

This slice is complete and validated.

Delivered outcomes:

- `src/main/contexts/kanban/interfaces/kanban-service.ts` is the canonical Kanban IPC adapter.
- `src/main/contexts/issue-agent/interfaces/issue-agent-service.ts` is the canonical issue-agent IPC adapter.
- Root `src/main/services/` keeps only shared/system adapters.
- `src/main/index.ts` and `src/main/ipc-types.ts` compile against the new paths.
- Tests/build/E2E stay green.

Validation evidence:

- Targeted tests: `pnpm vitest run src/main/contexts/kanban/application/__tests__/kanban-query-application.test.ts src/main/contexts/kanban/application/__tests__/kanban-write-application.test.ts src/main/contexts/issue-agent/application/__tests__/issue-agent-query-application.test.ts src/main/contexts/issue-agent/application/__tests__/issue-delegation-application.test.ts src/main/contexts/issue-agent/interfaces/__tests__/issue-agent-service.test.ts` -> 5 files passed, 21 tests passed.
- Node typecheck: `pnpm -s tsc --noEmit -p tsconfig.node.json --composite false` -> pass (no output).
- Build: `pnpm build` -> pass; only pre-existing npm config and bundle-splitting warnings remained.
- Focused E2E: `pnpm e2e:cleanup && npx cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001 or @CRADLE-ISSUE-AGENT-001"` -> 7 scenarios passed, 48 steps passed.

What changed from the initial plan:

- The root `services/README.md` needed a broader cleanup than expected because it had already drifted from the real file inventory; finishing the move was a good forcing function to make the root bucket explicitly shared/system-only.
- The issue-agent adapter test moved with the service because keeping it under the root services test directory would have undermined the point of the directory refactor.

What remains for future slices:

- Other root services are still organized horizontally; if more of them become clearly single-context, they should follow the same owner-context migration pattern rather than growing the root bucket again.
- `IssueAgentRunner` remains the largest unresolved hotspot inside a context-owned path and is still the best next target for a meaningful structural refactor.
