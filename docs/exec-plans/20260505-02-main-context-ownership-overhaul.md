# Main Context Ownership Overhaul

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. The plan must remain self-contained and updated at each stop point.

## Purpose / Big Picture

The backend has improved at the code level, but the folder structure still communicates the wrong ownership model. `src/main/application/` and `src/main/lib/` are horizontal technology buckets, while the actual behavior now clusters around bounded contexts such as Kanban and issue-agent execution. After this refactor, the active Kanban and issue-agent backend code should live under explicit context folders so the directory tree itself reflects ownership.

This is a structural refactor, not a user-facing feature. The success signal is that core files move into `src/main/contexts/kanban/` and `src/main/contexts/issue-agent/`, imports keep working, stale horizontal buckets stop owning current business logic, and the same focused tests/build/E2E still pass.

## Progress

- [x] (2026-05-05 09:00 local) Chose the next destructive refactor target: replace the current horizontal ownership of active Kanban/issue-agent backend code with context-first directories.
- [x] (2026-05-05 09:00 local) Re-inspected `src/main/README.md`, `src/main/application/*`, `src/main/lib/issue-agent-runner.ts`, `src/main/services/kanban.ts`, and `src/main/index.ts` to map the concrete move set.
- [x] (2026-05-05 09:04 local) Moved Kanban application services and tests into `src/main/contexts/kanban/application/`.
- [x] (2026-05-05 09:05 local) Moved issue-delegation application service, tests, and `issue-agent-runner.ts` into `src/main/contexts/issue-agent/`.
- [x] (2026-05-05 09:07 local) Updated imports, READMEs, the developer guide, backend architecture audit, and exec-plan index so the new structure is canonical.
- [x] (2026-05-05 09:08 local) Verified targeted tests, node typecheck, full build, and focused Kanban + Issue Agent E2E after the move.

## Surprises & Discoveries

- Observation: the active business logic we have been refactoring now fits naturally into two contexts: `kanban` and `issue-agent`.
  Evidence: `kanban-query-application.ts`, `kanban-write-application.ts`, `issue-delegation-application.ts`, and `issue-agent-runner.ts` are tightly coupled around those two ownership seams.

- Observation: `src/main/application/` now contains only files that really belong to those contexts, so the directory itself no longer adds useful meaning.
  Evidence: directory listing shows only the three application services and their tests.

- Observation: the move touched fewer production imports than expected because the live ownership had already been narrowed by earlier application-boundary refactors.
  Evidence: after creating the new files, the main production import updates were concentrated in `src/main/services/kanban.ts` and `src/main/index.ts`.

- Observation: historical exec plans still mention pre-context paths, so a canonical-path note was needed in the exec-plan index to avoid future confusion.
  Evidence: older plans referenced `src/main/application/*` and `src/main/lib/issue-agent-runner.ts` even though the new canonical locations are under `src/main/contexts/`.

## Decision Log

- Decision: create `src/main/contexts/kanban/` and `src/main/contexts/issue-agent/` now, rather than waiting for a full-repo package split.
  Rationale: this yields real ownership clarity immediately without forcing every backend domain into a monorepo-style package move in one step.
  Date/Author: 2026-05-05 / GitHub Copilot

- Decision: keep `src/main/services/` in place for this refactor and make it depend on the new context folders, instead of simultaneously renaming the entire IPC adapter layer.
  Rationale: renaming all services at once would widen the blast radius beyond the current active contexts and make verification slower.
  Date/Author: 2026-05-05 / GitHub Copilot

- Decision: delete the old `src/main/application/` Kanban/issue-agent files instead of leaving re-export shims behind.
  Rationale: the user explicitly asked for a destructive refactor without compatibility scaffolding, and duplicate ownership would reintroduce the ambiguity this refactor is supposed to remove.
  Date/Author: 2026-05-05 / GitHub Copilot

- Decision: keep older exec plans as historical artifacts, but add a canonical-path note in `docs/exec-plans/README.md` instead of rewriting every historical narrative section.
  Rationale: this preserves implementation history while still telling future readers where the live code now lives.
  Date/Author: 2026-05-05 / GitHub Copilot

## Outcomes & Retrospective

This slice is complete and validated.

Delivered outcomes:

- Active Kanban backend logic now lives under `src/main/contexts/kanban/application/`.
- Active issue-agent backend logic now lives under `src/main/contexts/issue-agent/application/` and `src/main/contexts/issue-agent/infrastructure/`.
- The old `src/main/application/` Kanban/issue-agent service files and tests were deleted, so those horizontal buckets no longer own live business logic.
- `src/main/services/kanban.ts` and `src/main/index.ts` now import the new context-owned paths.
- New directory READMEs for `src/main/contexts/`, `kanban/`, and `issue-agent/` make ownership explicit in the tree itself.

What changed from the initial plan:

- The migration was cleaner than expected because previous refactors had already concentrated the relevant production imports.
- A small documentation clean-up step was added for historical exec plans so old path references do not mislead future contributors.

What remains for future slices:

- `src/main/lib/` still contains other shared or semi-owned infrastructure and should keep shrinking.
- `src/main/services/` is still a horizontal IPC adapter bucket and may later be renamed to a more explicit interface-layer path.
- `src/main/db/schema.ts` remains a monolith and is still a candidate for a context-first split.

## Context and Orientation

The files in scope for this refactor are:

- `src/main/application/kanban-query-application.ts`
- `src/main/application/kanban-write-application.ts`
- `src/main/application/issue-delegation-application.ts`
- `src/main/application/__tests__/kanban-query-application.test.ts`
- `src/main/application/__tests__/kanban-write-application.test.ts`
- `src/main/application/__tests__/issue-delegation-application.test.ts`
- `src/main/lib/issue-agent-runner.ts`
- `src/main/services/kanban.ts`
- `src/main/index.ts`
- `src/main/README.md`
- `src/main/lib/README.md`

The desired end state is not “more folders for decoration.” It is that ownership becomes visible in the path. A contributor should be able to infer from the file path whether a change belongs to Kanban, issue-agent execution, or general infrastructure. This is now true for the active Kanban and issue-agent backend code.

## Plan of Work

First, create the new context directories and move the Kanban application services plus their tests into `src/main/contexts/kanban/application/`.

Second, move the issue-delegation application service, its tests, and `issue-agent-runner.ts` into `src/main/contexts/issue-agent/` under `application/` and `infrastructure/`.

Third, update all imports from `src/main/services/kanban.ts`, `src/main/index.ts`, and the moved tests to use the new paths.

Fourth, update READMEs so `src/main/README.md` describes context-first ownership, `src/main/lib/README.md` no longer lists `issue-agent-runner.ts`, and the new context folders have inventories.

Finally, validate with targeted application tests, Node typecheck, full build, and the focused Kanban + Issue Agent E2E regression run. All four verification steps were executed successfully for the completed implementation.

## Concrete Steps

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. Move files into their new context folders and update imports.
2. Run targeted application tests:

		pnpm -s vitest run src/main/contexts/kanban/application/__tests__/kanban-query-application.test.ts src/main/contexts/kanban/application/__tests__/kanban-write-application.test.ts src/main/contexts/issue-agent/application/__tests__/issue-delegation-application.test.ts

3. Run Node typecheck:

		pnpm -s tsc --noEmit -p tsconfig.node.json --composite false

4. Run build:

		pnpm build

5. Run focused E2E:

		pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001 or @CRADLE-ISSUE-AGENT-001"

## Validation and Acceptance

Acceptance is satisfied when all of the following are true:

- The moved files exist only in their new context-owned locations.
- `src/main/services/kanban.ts` and `src/main/index.ts` build against the new import graph.
- The old `src/main/application/` Kanban/issue-agent files are gone.
- Targeted application tests pass from the new locations.
- Node typecheck and full build pass.
- Focused Kanban + Issue Agent E2E passes.

## Artifacts and Notes

Captured evidence from this implementation:

- Targeted application tests:

    pnpm -s vitest run src/main/contexts/kanban/application/__tests__/kanban-query-application.test.ts src/main/contexts/kanban/application/__tests__/kanban-write-application.test.ts src/main/contexts/issue-agent/application/__tests__/issue-delegation-application.test.ts
    -> Test Files 3 passed, Tests 18 passed

- Node typecheck:

    pnpm -s tsc --noEmit -p tsconfig.node.json --composite false
    -> pass (no output)

- Build:

    pnpm build
    -> pass (electron-vite build completed; only pre-existing bundle warnings remained)

- Focused E2E:

    pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001 or @CRADLE-ISSUE-AGENT-001"
    -> 7 scenarios passed, 48 steps passed

Revision note (2026-05-05 09:08 local): Updated this plan from design state to implementation-complete state. Recorded the context-first move of active Kanban/issue-agent backend code, deletion of old horizontal application files, documentation updates, and final validation evidence.

## Idempotence and Recovery

This refactor is path-sensitive. Move one context at a time and keep tests runnable after each group of import updates. If a moved file temporarily breaks relative imports, fix import paths before touching the next file group. If necessary, recover by restoring the old path from the git working tree and repeating the move more narrowly.
