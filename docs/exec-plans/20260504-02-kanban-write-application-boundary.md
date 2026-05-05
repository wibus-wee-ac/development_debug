# Kanban Write-Side Application Boundary

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. The plan must remain self-contained and updated at each stop point.

## Purpose / Big Picture

The Kanban feature already works, but almost every mutation still lives directly inside `src/main/services/kanban.ts`. That means the IPC adapter owns business rules, JSON serialization details, parent-child cleanup, and cross-table write coordination. After this change, the user-visible Kanban behavior stays the same, but the main-process architecture becomes cleaner: `KanbanService` is reduced to an IPC facade, and a dedicated application-layer module owns the Kanban write side.

This matters because the current service is the second main-process monolith after `ChatEngine`. If we do not cut a real boundary now, every new Kanban feature will keep adding branching logic to the IPC layer. The success signal is not a new screen; it is observable architectural change backed by tests: a failing application-layer test goes green, the renderer still uses the same IPC contract, and targeted Kanban regressions still pass.

## Progress

- [x] (2026-05-04 17:20Z) Re-read repository rules, TDD skill, ExecPlan rules, and the existing backend application/event-pipeline ExecPlan.
- [x] (2026-05-04 17:20Z) Re-inspected `src/main/services/kanban.ts`, `src/main/application/issue-delegation-application.ts`, `src/main/lib/issue-delegation.ts`, and related README files to confirm the current write-side ownership gap.
- [x] (2026-05-04 17:20Z) Chose the first destructive refactor slice: move Kanban mutations into a new application service and delete the now-redundant legacy `src/main/lib/issue-delegation.ts`.
- [x] (2026-05-04 17:24Z) RED: added `src/main/application/__tests__/kanban-write-application.test.ts` and verified the expected missing-module failure before implementation.
- [x] (2026-05-04 18:16Z) GREEN: implemented `src/main/application/kanban-write-application.ts`, delegated Kanban write methods from `src/main/services/kanban.ts`, and deleted `src/main/lib/issue-delegation.ts`.
- [x] (2026-05-04 18:16Z) Updated directory READMEs and file headers so the documented architecture matches the new write-side ownership.
- [x] (2026-05-04 18:16Z) Verified targeted application tests, node typecheck, full build, and focused Kanban + Issue Agent E2E regressions.

## Surprises & Discoveries

- Observation: `src/main/services/kanban.ts` still mixes two distinct roles: read-side queries and write-side orchestration.
	Evidence: the same class owns pure reads such as `listIssues()` and write-heavy flows such as `deleteIssue()`, `addContextRef()`, and `linkIssueToSession()`.

- Observation: the old `src/main/lib/issue-delegation.ts` has no live callers left.
	Evidence: repository search shows only the file itself and documentation references remain.

- Observation: `src/main/services/README.md` has already drifted once; it claims `AcpService` is not registered even though `src/main/index.ts` still registers it.
	Evidence: `src/main/index.ts` imports `AcpService` and includes it in `createServices([...])`.

- Observation: real SQLite-backed Node tests are a trap in this repository because `better-sqlite3` alternates between Node ABI and Electron ABI depending on the last rebuild step.
	Evidence: running the first implementation against real DB tests required `pnpm rebuild better-sqlite3`, which then broke Electron startup until the native module was rebuilt for Electron again.

- Observation: lazy `require('../lib/issue-agent-runner')` and `require('../db')` are not bundle-safe in `out/main/index.js` because the Electron main bundle is emitted as a bundled file rather than a file tree mirroring the source layout.
	Evidence: direct Electron launch failed with `Cannot find module '../lib/issue-agent-runner'` and then `Cannot find module '../db'` until the implementation was changed back to bundle-friendly imports.

## Decision Log

- Decision: keep Kanban reads in `src/main/services/kanban.ts` for this slice and move only the write side into `src/main/application/kanban-write-application.ts`.
	Rationale: the highest-value seam is command ownership. This creates a real architecture boundary without forcing a simultaneous read-model rewrite.
	Date/Author: 2026-05-04 / GitHub Copilot

- Decision: test `kanban-write-application` through an injected in-memory `KanbanWriteStore` fake instead of real SQLite.
	Rationale: this preserves behavior-focused tests while avoiding Node/Electron native module ABI churn in the repo's mixed unit-test + Electron-build workflow.
	Date/Author: 2026-05-04 / GitHub Copilot

- Decision: delete `src/main/lib/issue-delegation.ts` in this slice instead of leaving dead code behind.
	Rationale: the repository explicitly prefers destructive cleanup over compatibility scaffolding, and the application-layer service already supersedes the old module.
	Date/Author: 2026-05-04 / GitHub Copilot

- Decision: keep `getDb()` as a static import in `kanban-write-application.ts`, and isolate unit tests with dependency injection plus module mocks rather than lazy `require()`.
	Rationale: static imports are bundle-safe for Electron main output, whereas lazy `require()` from the bundled file caused runtime resolution failures.
	Date/Author: 2026-05-04 / GitHub Copilot

- Decision: resolve the default Issue delegation runner via dynamic `import('../lib/issue-agent-runner')` only inside async commands.
	Rationale: this avoids Vitest eagerly loading Electron-only transitive imports while remaining safe for Electron bundling.
	Date/Author: 2026-05-04 / GitHub Copilot

## Outcomes & Retrospective

This slice is complete and validated.

Delivered outcomes:

- `src/main/application/kanban-write-application.ts` now owns Kanban write-side command semantics for statuses, boards, milestones, issues, comments, relations, context refs, and session linking.
- `src/main/services/kanban.ts` keeps its read-side queries but delegates the write side to the new application service, making it a real IPC facade instead of a mixed adapter/orchestrator.
- `src/main/lib/issue-delegation.ts` was deleted because it had no remaining callers.
- `src/main/application/issue-delegation-application.ts` now lazily resolves its default runner with dynamic import, so Node-side tests do not trip Electron module loading while the Electron bundle still works.
- README documentation for `src/main/application/`, `src/main/application/__tests__/`, `src/main/services/`, and `src/main/lib/` now reflects the current architecture.

What changed from the initial plan:

- The original plan expected real SQLite-backed tests for the new write service. During implementation this proved incompatible with the repository's native-module workflow, so the final test design uses an injected fake store instead. This keeps the application boundary explicit and the tests deterministic without fighting Electron ABI rebuilds.

What remains for future slices:

- The Kanban read side is still query logic inside `src/main/services/kanban.ts`.
- `src/main/lib/issue-agent-runner.ts` is still a large orchestrator and will need its own decomposition later.
- Higher-level architecture docs outside this plan still need a broader consistency pass as the application layer grows.

## Context and Orientation

The current main-process Kanban entrypoint is `src/main/services/kanban.ts`. In this repository, an IPC service is the adapter that the renderer calls through `window.ipc`. It should be a stable boundary with simple parameter semantics, not the place where business rules accumulate.

The existing application layer currently contains only `src/main/application/issue-delegation-application.ts`, which proves the pattern but only covers delegated issue workflows. The rest of the Kanban write side still lives in `KanbanService`: status creation and ordering, board mutations, milestone mutations, issue creation and deletion, comment and relation writes, context-reference JSON edits, and chat-session linkage.

The write-side application service introduced by this plan will own those command workflows. “Write side” means every operation that mutates state. Queries such as `listBoards()` or `getIssue()` remain in `KanbanService` for now. This is intentionally a command/query split at the architecture seam, not a user-facing feature change.

The relevant files for this slice are:

- `src/main/services/kanban.ts`: current mixed read/write IPC service.
- `src/main/application/issue-delegation-application.ts`: existing application-layer precedent.
- `src/main/application/__tests__/issue-delegation-application.test.ts`: test style precedent for application-layer workflows.
- `src/main/db/schema.ts`: source of Kanban and session table definitions used by the new write service.
- `src/main/lib/issue-delegation.ts`: now-dead legacy module to delete once this slice is complete.
- `src/renderer/src/features/kanban/use-kanban.ts`: renderer caller that proves the IPC contract must remain unchanged.

## Plan of Work

First, add a new application-layer test file at `src/main/application/__tests__/kanban-write-application.test.ts`. The tests should exercise command behavior through an injected in-memory `KanbanWriteStore` fake so they stay deterministic and do not depend on native SQLite bindings. The suite must cover status ordering, board and milestone updates, issue mutation and deletion semantics, comment and relation lifecycle, context-ref JSON edits, and chat-session linking. The test suite must fail before implementation.

Second, implement `src/main/application/kanban-write-application.ts`. This file will export a factory that returns a write-side application service. It will own all Kanban command methods currently implemented inline in `KanbanService`, including the JSON serialization logic for labels and context refs and the child-issue cleanup performed before parent issue deletion.

Third, refactor `src/main/services/kanban.ts` so the constructor receives or creates both the existing `IssueDelegationApplicationService` and the new `KanbanWriteApplicationService`. All write-oriented IPC methods become thin delegations to the application service. Query methods stay in place.

Fourth, delete `src/main/lib/issue-delegation.ts` because it is dead code after the previous application-layer migration. Update `src/main/lib/README.md`, `src/main/application/README.md`, `src/main/application/__tests__/README.md`, and `src/main/services/README.md` so the documented ownership matches the code.

Finally, validate with targeted tests, node typecheck, and a focused Kanban regression run. If a wider E2E check is required after the refactor, run the minimal tags that touch Kanban issue editing and linked issue flows rather than immediately paying for the whole suite again.

## Concrete Steps

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. Add the failing test file and run it alone:

		pnpm -s vitest run src/main/application/__tests__/kanban-write-application.test.ts

	 Expected before implementation: at least one failure caused by the missing application module or missing exported behavior.

2. Implement the new application service and service delegation, then rerun the targeted application tests:

		pnpm -s vitest run src/main/application/__tests__/kanban-write-application.test.ts src/main/application/__tests__/issue-delegation-application.test.ts

	 Expected after implementation: both files pass.

3. Run any directly affected unit tests for Kanban-facing modules if added during refactor.

4. Run node typecheck:

		pnpm -s tsc --noEmit -p tsconfig.node.json --composite false

	 Expected: no TypeScript errors.

5. Run focused Kanban regressions and delegation regressions:

		pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001"
		pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-ISSUE-AGENT-001"

	 Expected: both feature groups pass independently and in combined execution.

## Validation and Acceptance

Acceptance is satisfied when all of the following are true:

The new application test suite fails before implementation and passes after implementation. `KanbanService` still exposes the same IPC method signatures used by `src/renderer/src/features/kanban/use-kanban.ts`, but the write methods no longer own the mutation logic directly. Deleting an issue still clears `parentIssueId` on children before deleting the parent. Adding and removing context refs still preserves JSON array semantics. Linking and unlinking a chat session to an issue still updates `sessions.linkedIssueId`. Node typecheck passes. No dead callers remain for `src/main/lib/issue-delegation.ts` because the file has been removed.

## Idempotence and Recovery

The test setup must be safe to rerun multiple times and must not depend on the current native-module ABI state. The injected fake store satisfies that requirement. If a partial refactor breaks `KanbanService`, restore the write methods temporarily from the ExecPlan descriptions and move one command family at a time until tests are green again. Deleting `src/main/lib/issue-delegation.ts` is safe only after search confirms there are no remaining imports.

## Artifacts and Notes

Captured evidence from this implementation:

- RED:

		pnpm -s vitest run src/main/application/__tests__/kanban-write-application.test.ts
		-> Error: Cannot find module '/src/main/application/kanban-write-application'

- GREEN targeted application tests:

		pnpm -s vitest run src/main/application/__tests__/kanban-write-application.test.ts src/main/application/__tests__/issue-delegation-application.test.ts
		-> Test Files 2 passed, Tests 13 passed

- Node typecheck:

		pnpm -s tsc --noEmit -p tsconfig.node.json --composite false
		-> pass (no output)

- Build:

		pnpm build
		-> pass (electron-vite build completed)

- Focused E2E:

		pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001"
		-> 5 scenarios passed, 28 steps passed

		pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-ISSUE-AGENT-001"
		-> 2 scenarios passed, 20 steps passed

		pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001 or @CRADLE-ISSUE-AGENT-001"
		-> 7 scenarios passed, 48 steps passed

## Interfaces and Dependencies

In `src/main/application/kanban-write-application.ts`, define:

		export interface KanbanWriteApplicationService {
			createStatus(input: { workspaceId: string, name: string, color?: string | null }): KanbanStatus
			updateStatus(id: string, patch: { name?: string, color?: string | null }): KanbanStatus
			reorderStatuses(workspaceId: string, orderedIds: string[]): void
			deleteStatus(id: string): void
			createBoard(input: { workspaceId: string, name: string, filterConfig?: string | null }): KanbanBoard
			updateBoard(id: string, patch: { name?: string, filterConfig?: string | null }): KanbanBoard
			deleteBoard(id: string): void
			createMilestone(input: { workspaceId: string, title: string, description?: string | null, dueDate?: number | null }): KanbanMilestone
			updateMilestone(id: string, patch: { title?: string, description?: string | null, dueDate?: number | null, status?: 'open' | 'closed' }): KanbanMilestone
			deleteMilestone(id: string): void
			createIssue(input: { workspaceId: string, title: string, description?: string | null, priority?: KanbanIssue['priority'], labels?: string[], milestoneId?: string | null, parentIssueId?: string | null, statusId?: string | null }): KanbanIssue
			updateIssue(id: string, patch: Partial<{ title: string, description: string | null, priority: KanbanIssue['priority'], labels: string[], milestoneId: string | null, parentIssueId: string | null, statusId: string | null, assigneeKind: string | null, assigneeId: string | null }>): KanbanIssue
			moveIssue(id: string, statusId: string | null): KanbanIssue
			deleteIssue(id: string): void
			addComment(input: { issueId: string, content: string, authorKind?: KanbanIssueComment['authorKind'], authorId?: string | null }): KanbanIssueComment
			deleteComment(id: string): void
			addRelation(input: { sourceIssueId: string, targetIssueId: string, type: 'blocks' | 'duplicates' | 'relates_to' }): KanbanIssueRelation
			deleteRelation(id: string): void
			updateContextRefs(issueId: string, refs: string): void
			addContextRef(issueId: string, ref: string): void
			removeContextRef(issueId: string, index: number): void
			linkIssueToSession(chatSessionId: string, issueId: string): void
			unlinkIssueFromSession(chatSessionId: string): void
		}

The service now depends on an explicit `KanbanWriteStore` abstraction plus a default Drizzle-backed implementation. It must not import renderer code or Electron window primitives. `src/main/services/kanban.ts` remains the only IPC entrypoint for renderer callers in this slice.

Revision note (2026-05-04 18:16Z): Updated this plan from design state to implementation-complete state. Recorded the shift from real SQLite tests to an injected fake store, the bundle-safe runner resolution change, and the final validation evidence.
