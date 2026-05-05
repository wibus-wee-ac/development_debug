# Issue-Agent IPC Ownership Split

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. The plan must remain self-contained and updated at each stop point.

## Purpose / Big Picture

The backend tree now has explicit `kanban` and `issue-agent` contexts, but the IPC namespace still leaks issue-agent ownership through `kanban.*` methods such as delegation, session queries, and activity queries. That is the wrong public boundary: Kanban should own issue/board/status semantics, while issue-agent should own delegation execution and agent-session visibility. After this refactor, the main-process IPC surface should expose a dedicated `issueAgent` service, and renderer/CLI callers should stop routing issue-agent workflows through `kanban`.

This is a structural boundary refactor, not a user-facing feature. The success signal is that delegation/session/activity IPC methods move out of `KanbanService`, a dedicated `IssueAgentService` owns them, relevant query logic sits under `src/main/contexts/issue-agent/application/`, and the existing tests/build/focused E2E remain green.

## Progress

- [x] (2026-05-05 09:24 local) Chose IPC ownership as the next hotspot after the DB schema split.
- [x] (2026-05-05 09:25 local) Re-inspected `src/main/services/kanban.ts`, `src/main/ipc-types.ts`, `src/main/index.ts`, renderer hooks, and CLI call sites to map the cross-process blast radius.
- [x] (2026-05-05 09:29 local) Added failing tests for the new issue-agent query boundary and IPC facade, then implemented the missing modules until the tests passed.
- [x] (2026-05-05 09:31 local) Introduced `IssueAgentService` plus `issue-agent-query-application`, and removed issue-agent delegation/session/activity methods from `KanbanService`.
- [x] (2026-05-05 09:33 local) Updated renderer hooks, CLI RPC calls, README inventories, architecture docs, and developer guide to use the new `issueAgent` namespace.
- [x] (2026-05-05 09:34 local) Verified targeted tests, node typecheck, full build, and focused Kanban + Issue Agent E2E.

## Surprises & Discoveries

- Observation: the code already has a natural issue-agent application boundary for commands, but the public IPC namespace never caught up.
  Evidence: delegation commands live in `src/main/contexts/issue-agent/application/issue-delegation-application.ts`, yet renderer and CLI still call `kanban.delegateIssue` / `kanban.undelegateIssue`.

## Decision Log

- Decision: use camelCase `issueAgent` as the IPC group name.
  Rationale: existing service groups such as `agentRuntime`, `workflowRules`, and `ipcDevtool` already use camelCase rather than kebab-case.
  Date/Author: 2026-05-05 / GitHub Copilot

## Outcomes & Retrospective

This slice is complete and validated.

Delivered outcomes:

- `src/main/contexts/issue-agent/interfaces/issue-agent-service.ts` exists and owns delegation/session/activity IPC methods.
- `KanbanService` no longer exposes issue-agent workflow methods.
- Issue-agent session/activity query behavior lives under `src/main/contexts/issue-agent/application/`.
- Renderer hooks and CLI commands call `issueAgent.*` instead of `kanban.*`.
- Tests/build/E2E stay green.

Validation evidence:

- Targeted tests: `pnpm vitest run src/main/contexts/kanban/application/__tests__/kanban-query-application.test.ts src/main/contexts/kanban/application/__tests__/kanban-write-application.test.ts src/main/contexts/issue-agent/application/__tests__/issue-agent-query-application.test.ts src/main/contexts/issue-agent/application/__tests__/issue-delegation-application.test.ts src/main/services/__tests__/issue-agent.test.ts` -> 5 files passed, 21 tests passed.
- Node typecheck: `pnpm -s tsc --noEmit -p tsconfig.node.json --composite false` -> pass (no output).
- Build: `pnpm build` -> pass; only pre-existing npm config and bundle-splitting warnings remained.
- Focused E2E: `pnpm e2e:cleanup && npx cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001 or @CRADLE-ISSUE-AGENT-001"` -> 7 scenarios passed, 48 steps passed.

What changed from the initial plan:

- The read-side split needed its own application-layer module (`issue-agent-query-application.ts`) rather than only a new IPC facade, because session/activity ordering semantics should not stay in `KanbanQueryApplicationService`.
- Renderer feature hooks stayed inside `features/kanban/` for now because the UI surface still lives in the Kanban issue detail/panel, even though the transport namespace is now `issueAgent`.

What remains for future slices:

- `IssueAgentRunner` is still a large orchestrator and remains the next likely decomposition target inside the issue-agent context.
- `getLinkedIssue()` still spans chat / kanban / issue-agent data; if that projection grows further it may deserve its own cross-context read model instead of staying inside Kanban query application code.
