# Kanban Read-Side Query Boundary

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. The plan must remain self-contained and updated at each stop point.

## Purpose / Big Picture

The previous Kanban refactor moved the write side into `src/main/application/kanban-write-application.ts`, but `src/main/services/kanban.ts` still owns every read path directly. That leaves the IPC adapter responsible for query filtering, ad hoc joins, projection assembly, and mixed return semantics. After this next slice, `KanbanService` should become a fully thin facade: it forwards both commands and queries to application-layer services, while read-specific orchestration moves into a dedicated query boundary.

This matters because the current service is still one of the busiest main-process entrypoints. If we stop after the write-side extraction, the query side will gradually accumulate the same coupling pressure again. The success signal is architectural, not cosmetic: query tests go red then green, `KanbanService` stops reading from `getDb()` directly for Kanban projections, and focused Kanban regressions still pass.

## Progress

- [x] (2026-05-05 00:00Z) Re-inspected `src/main/services/kanban.ts` after the write-side extraction and confirmed that read-side responsibility is now the dominant remaining coupling point.
- [x] (2026-05-05 00:00Z) Re-read `docs/backend-architecture-overhaul-2026-05-04.md` and confirmed that the current P0 target still says `KanbanService` should shrink to a facade.
- [x] (2026-05-05 00:00Z) Captured this next-slice ExecPlan so implementation can proceed without rediscovering the boundary decision later.
- [x] (2026-05-05 08:22 local) RED: added `src/main/application/__tests__/kanban-query-application.test.ts` and verified the expected missing-module failure before implementation.
- [x] (2026-05-05 08:24 local) GREEN: implemented `src/main/application/kanban-query-application.ts` with an explicit `KanbanQueryStore` abstraction and a default Drizzle-backed store.
- [x] (2026-05-05 08:25 local) Refactored `src/main/services/kanban.ts` so read-oriented IPC methods now delegate to the query application service instead of calling `getDb()` directly.
- [x] (2026-05-05 08:26 local) Updated README inventories, the developer guide, and the backend architecture audit so documentation matches the new read-side ownership.
- [x] (2026-05-05 08:29 local) Removed dead `KanbanService` IPC methods (`updateAgentSessionStatus`, `updateAgentSessionChatSession`, `addAgentActivity`) after confirming they had no callers in the workspace.
- [x] (2026-05-05 08:33 local) Re-verified targeted application tests, node typecheck, full build, and focused Kanban + Issue Agent E2E regressions after the final dead-code cleanup.

## Surprises & Discoveries

- Observation: `KanbanService` still owns all of the following read concerns: plain lists, filtered issue search, comment/relation queries, agent session/activity queries, and the composite `getLinkedIssue()` projection.
  Evidence: `src/main/services/kanban.ts` still calls `getDb()` inside `listStatuses`, `listBoards`, `listMilestones`, `listIssues`, `searchIssues`, `getIssue`, `listComments`, `listRelations`, `getAgentSessions`, `getAgentActivities`, and `getLinkedIssue`.

- Observation: `getLinkedIssue()` is the most important read-side smell because it already behaves like an application query rather than a raw repository lookup.
  Evidence: it checks `agent_sessions` first, then `sessions.linkedIssueId`, then conditionally loads issue and status records to construct a composite return shape.

- Observation: the Kanban read side does not yet have a stable abstraction comparable to the write-side `KanbanWriteStore`.
  Evidence: no `kanban-query-application.ts` or query store interface exists today.

- Observation: the editor/TS-language-service diagnostic for `src/main/application/__tests__/kanban-query-application.test.ts` can remain stale even after the module exists and the CLI typecheck is green.
	Evidence: `get_errors` kept reporting `Cannot find module '../kanban-query-application'` while `pnpm -s vitest run ...`, `pnpm -s tsc --noEmit -p tsconfig.node.json --composite false`, and `pnpm build` all passed.

- Observation: the remaining direct agent-session/activity write IPC methods in `KanbanService` had no call sites in the repository.
	Evidence: workspace search for `updateAgentSessionStatus`, `updateAgentSessionChatSession`, and `addAgentActivity` returned only their own method definitions.

## Decision Log

- Decision: introduce `src/main/application/kanban-query-application.ts` as the next application-layer boundary for Kanban reads.
  Rationale: the repo is already moving toward thin IPC services plus explicit application orchestration. A dedicated query service keeps the boundary consistent instead of leaving reads as a special case.
  Date/Author: 2026-05-05 / GitHub Copilot

- Decision: define a `KanbanQueryStore` abstraction with a default Drizzle-backed implementation, mirroring the testability pattern used on the write side.
  Rationale: query logic should be testable without depending on native SQLite builds, and the fake-store pattern already proved stable in this repository.
  Date/Author: 2026-05-05 / GitHub Copilot

- Decision: move all Kanban read IPC methods into the query application service in one slice rather than leaving agent-session or linked-issue queries behind.
  Rationale: partial extraction would keep `KanbanService` semantically mixed and delay the point of the refactor.
  Date/Author: 2026-05-05 / GitHub Copilot

- Decision: keep the store abstraction intentionally low-level and let `kanban-query-application.ts` own filtering, ordering, search semantics, and linked-issue fallback behavior in memory.
	Rationale: this preserves the application boundary as the semantic owner, keeps fake-store tests deterministic, and avoids hiding read behavior inside ad hoc store helpers.
	Date/Author: 2026-05-05 / GitHub Copilot

- Decision: leave the remaining agent session/activity write helpers in `KanbanService` for a later slice instead of folding another write refactor into this query-focused TDD loop.
	Rationale: superseded during implementation. Once search showed these IPC methods had no callers, deletion became cleaner than migration.
	Date/Author: 2026-05-05 / GitHub Copilot

- Decision: delete the unused `updateAgentSessionStatus`, `updateAgentSessionChatSession`, and `addAgentActivity` IPC methods from `KanbanService` instead of preserving or migrating them.
	Rationale: destructive cleanup is preferred in this repository, and dead IPC surface is a long-term source of ambiguity.
	Date/Author: 2026-05-05 / GitHub Copilot

## Outcomes & Retrospective

This slice is complete and validated.

Delivered outcomes:

- `src/main/application/kanban-query-application.ts` now owns Kanban read-side semantics for sorting, filtering, search, relation/comment lookup, agent-session/activity reads, and linked-issue projection.
- `src/main/services/kanban.ts` delegates Kanban read/write/delegation workflows to application services and no longer contains direct DB access or dead auxiliary IPC writers.
- `src/main/application/__tests__/kanban-query-application.test.ts` provides fake-store behavior coverage for the new query boundary without native SQLite dependency churn.
- `src/main/application/README.md`, `src/main/application/__tests__/README.md`, `src/main/services/README.md`, `docs/developers-guide.md`, and `docs/backend-architecture-overhaul-2026-05-04.md` now describe the current read/write split accurately.

What changed from the initial plan:

- The store abstraction stayed intentionally minimal. Instead of pushing sort/filter behavior into repository-like helpers, the final application service owns those query semantics directly and uses the store only for row access.
- After the first implementation pass, a workspace search showed that the residual agent session/activity write IPC methods were dead. They were deleted instead of being migrated, which made the final facade cleaner than the original plan.

What remains for future slices:

- `IssueAgentRunner` is still a large orchestrator and remains a strong candidate for the next destructive cleanup.
- `ChatEngine` remains the largest main-process hotspot overall.
- Session-model overlap still needs a later structural pass.

## Context and Orientation

The current main-process Kanban entrypoint is `src/main/services/kanban.ts`. Before implementation, the remaining DB-heavy methods were entirely read-oriented. These methods fell into three groups:

1. Simple table lists:
   - `listStatuses`
   - `listBoards`
   - `listMilestones`
   - `getIssue`
   - `listComments`
   - `listRelations`
   - `getAgentSessions`
   - `getAgentActivities`

2. Filtered query logic:
   - `listIssues`
   - `searchIssues`

3. Composite read model:
   - `getLinkedIssue`

The third group is especially important. `getLinkedIssue` already encodes business-facing read semantics by resolving both automatic links through `agent_sessions.chatSessionId` and manual links through `sessions.linkedIssueId`, then enriching the result with status data. That logic belongs at the application boundary, not in the IPC adapter.

The relevant files for this slice are:

- `src/main/services/kanban.ts`: the IPC facade that previously owned the Kanban read side directly and now delegates those reads.
- `src/main/application/kanban-write-application.ts`: the write-side precedent for store abstraction and application ownership.
- `src/main/application/kanban-query-application.ts`: the new read-side application boundary added by this slice.
- `src/main/application/__tests__/kanban-write-application.test.ts`: recent test pattern precedent using an injected fake store.
- `src/main/application/__tests__/kanban-query-application.test.ts`: new fake-store query test suite for this slice.
- `src/main/db/schema.ts`: source of Kanban, session, and agent-session table definitions.
- `src/renderer/src/features/kanban/use-kanban.ts`: renderer caller proving IPC method signatures must remain stable.
- `docs/backend-architecture-overhaul-2026-05-04.md`: high-level architecture target that this slice continues.

## Plan of Work

First, add a new application-layer test file at `src/main/application/__tests__/kanban-query-application.test.ts`. Use an injected in-memory fake `KanbanQueryStore` to prove behavior without requiring native SQLite. Cover every existing read contract currently exposed by `KanbanService`, especially filter combinations in `listIssues()`, text search behavior in `searchIssues()`, and fallback ordering in `getLinkedIssue()`.

Second, implement `src/main/application/kanban-query-application.ts`. The file should export a query application service plus a default Drizzle-backed store factory. The service owns query semantics; the store owns table access. Keep return types aligned with the current IPC contract so the renderer does not need any changes.

Third, refactor `src/main/services/kanban.ts` so every read-oriented IPC method delegates to the query application service instead of calling `getDb()` directly. After this change, `KanbanService` should effectively be a pure adapter with almost no persistence logic.

Fourth, update directory READMEs and architecture docs so the documented ownership matches the new structure. `docs/developers-guide.md` should stay aligned with the new split if implementation reveals a better rule of thumb.

Finally, validate with targeted application tests, Node typecheck, build, and focused Kanban regressions. For this implementation pass, the combined focused Kanban + Issue Agent run was used to prove that the linked-issue and agent-session flows still work after the read-side extraction.

## Concrete Steps

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. Add the failing query-application test file and run it alone:

		pnpm -s vitest run src/main/application/__tests__/kanban-query-application.test.ts

	Expected before implementation: failure caused by the missing query application module or missing exported behavior.

2. Implement the new query application service and refactor `KanbanService`, then rerun the targeted application tests:

		pnpm -s vitest run src/main/application/__tests__/kanban-query-application.test.ts src/main/application/__tests__/kanban-write-application.test.ts src/main/application/__tests__/issue-delegation-application.test.ts

	Expected after implementation: all targeted application suites pass.

3. Run Node typecheck:

		pnpm -s tsc --noEmit -p tsconfig.node.json --composite false

	Expected: no TypeScript errors.

4. Run build:

		pnpm build

	Expected: Electron main and renderer bundles both build successfully.

5. Run focused Kanban regressions:

		pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001"

	Expected: Kanban feature scenarios still pass after the read-side extraction.

## Validation and Acceptance

Acceptance is satisfied when all of the following are true:

- `src/main/application/__tests__/kanban-query-application.test.ts` fails before implementation and passes after implementation.
- `src/main/services/kanban.ts` no longer directly calls `getDb()` for Kanban read-side methods.
- `listIssues()` still preserves current filter semantics for workspace, milestone, parent issue, priority, labels, and nullable status.
- `searchIssues()` still searches title and description with the current limit behavior.
- `getLinkedIssue()` still prefers automatic agent-session links over manual session links, and still enriches the response with status when available.
- Node typecheck and build both pass.
- Focused Kanban regressions pass.

## Idempotence and Recovery

The test suite should be safe to rerun multiple times because the fake query store does not depend on native SQLite state. If the refactor temporarily breaks the renderer-facing service contract, restore delegation one method family at a time, starting with the simplest list queries and ending with `getLinkedIssue()`. If implementation pressure suggests introducing more DTO mapping, keep those DTOs in the application layer rather than leaking mapping code back into `KanbanService`.

## Interfaces and Dependencies

In `src/main/application/kanban-query-application.ts`, define a service along these lines:

		export interface KanbanQueryApplicationService {
			listStatuses(workspaceId: string): KanbanStatus[]
			listBoards(workspaceId?: string): KanbanBoard[]
			listMilestones(workspaceId: string): KanbanMilestone[]
			listIssues(params: {
				workspaceId: string
				milestoneId?: string | null
				parentIssueId?: string | null
				priority?: string | null
				labels?: string[] | null
				statusId?: string | null
			}): KanbanIssue[]
			searchIssues(query: string, limit?: number): KanbanIssue[]
			getIssue(id: string): KanbanIssue | undefined
			listComments(issueId: string): KanbanIssueComment[]
			listRelations(issueId: string): KanbanIssueRelation[]
			getAgentSessions(issueId: string): AgentSession[]
			getAgentActivities(agentSessionId: string): AgentActivity[]
			getLinkedIssue(chatSessionId: string): {
				issue: KanbanIssue
				status: KanbanStatus | null
				agentSession: AgentSession | null
			} | null
		}

The implementation depends on an explicit `KanbanQueryStore` abstraction plus a default Drizzle-backed implementation. It does not import renderer code or Electron window primitives. `src/main/services/kanban.ts` remains the only IPC entrypoint for renderer callers, and it now delegates query logic instead of owning it.

## Artifacts and Notes

Captured evidence from this implementation:

- RED:

		pnpm -s vitest run src/main/application/__tests__/kanban-query-application.test.ts
		-> Error: Cannot find module '/src/main/application/kanban-query-application'

- GREEN targeted application tests:

		pnpm -s vitest run src/main/application/__tests__/kanban-query-application.test.ts src/main/application/__tests__/kanban-write-application.test.ts src/main/application/__tests__/issue-delegation-application.test.ts
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

Revision note (2026-05-05 08:33 local): Updated this plan from design state to implementation-complete state. Recorded the fake-store query test design, the thinner Kanban IPC facade, the deletion of dead residual IPC methods, and the final re-validation evidence.
