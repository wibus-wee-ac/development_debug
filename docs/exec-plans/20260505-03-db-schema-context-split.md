# DB Schema Context Split

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. The plan must remain self-contained and updated at each stop point.

## Purpose / Big Picture

`src/main/db/schema.ts` is still a monolithic persistence file even after the backend has started moving toward explicit bounded contexts. That makes the file a structural choke point: chat, Kanban, issue-agent, ACP, and agent-runtime tables all evolve in one place. After this refactor, the schema should be split into context-aware modules under `src/main/db/schema/`, while preserving the same import surface through `src/main/db/schema/index.ts`.

This is a structural refactor, not a behavior change. The success signal is that the monolith `schema.ts` disappears, schema ownership becomes visible in the tree, and the same tests/build/E2E continue to pass.

## Progress

- [x] (2026-05-05 09:12 local) Chose `src/main/db/schema.ts` as the next structural hotspot after the context-first backend move.
- [x] (2026-05-05 09:12 local) Re-read the full schema, `src/main/db/index.ts`, and `src/main/db/README.md` to design a split that avoids cyclic ownership confusion.
- [x] (2026-05-05 09:14 local) Created `src/main/db/schema/` modules for shared/chat/identity/runtime/acp/kanban/issue-agent ownership plus the new `README.md` inventory.
- [x] (2026-05-05 09:15 local) Added `src/main/db/schema/index.ts` as the canonical export surface and deleted the old `src/main/db/schema.ts` monolith.
- [x] (2026-05-05 09:18 local) Updated `src/main/db/README.md` and `docs/exec-plans/README.md` so the split schema path is the documented canonical location.
- [x] (2026-05-05 09:19 local) Verified targeted tests, node typecheck, full build, and focused Kanban + Issue Agent E2E after the split.

## Surprises & Discoveries

- Observation: a naive split by “chat vs agent-runtime” creates an import cycle because `sessions` depends on agent identity tables while `runtimeSessions` depends on `sessions`.
  Evidence: `sessions.agentProfileId` references `agentProfiles`, while `runtimeSessions.chatSessionId` references `sessions`.

- Observation: the repository ESLint preset auto-sorts both import declarations and named specifiers, including preferring dependency imports before the shared-helper import in `chat.ts`.
  Evidence: `pnpm eslint src/main/db/schema/identity.ts src/main/db/schema/kanban.ts src/main/db/schema/chat.ts --fix-dry-run --format json` produced canonical import output with zero warnings.

## Decision Log

- Decision: split identity tables (`agentProfiles`, `agentCredentials`, `agents`) away from runtime tables so chat/session tables can depend on identity without creating a cycle.
  Rationale: this keeps references directional and avoids a chat <-> runtime module knot.
  Date/Author: 2026-05-05 / GitHub Copilot

## Outcomes & Retrospective

This slice is complete and validated.

Delivered outcomes:

- `src/main/db/schema.ts` is replaced by a `src/main/db/schema/` directory.
- Schema files map more directly to context ownership.
- Existing imports continue to work through `src/main/db/schema/index.ts`.
- Tests/build/E2E stay green.

Validation evidence:

- Targeted application tests: `pnpm vitest run src/main/contexts/kanban/application/__tests__/kanban-write-application.test.ts src/main/contexts/kanban/application/__tests__/kanban-query-application.test.ts src/main/contexts/issue-agent/application/__tests__/issue-delegation-application.test.ts` -> 3 files passed, 18 tests passed.
- Node typecheck: `pnpm -s tsc --noEmit -p tsconfig.node.json --composite false` -> pass (no output).
- Build: `pnpm build` -> pass; only pre-existing npm config and bundle-splitting warnings remained.
- Focused E2E: `npx cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001 or @CRADLE-ISSUE-AGENT-001"` -> 7 scenarios passed, 48 steps passed.

What changed from the initial plan:

- The split needed one extra lint-normalization step because the project preset enforces a stricter import order than the manually authored first pass.
- No production import call sites needed changes beyond preserving the `./schema` barrel, so `src/main/db/index.ts` continued to work unchanged.

What remains for future slices:

- Schema ownership is now explicit, but the runtime and issue-agent modules still expose many raw table details directly; a later slice could tighten query/write store boundaries around those contexts too.
