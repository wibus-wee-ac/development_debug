<!-- Once this directory changes, update this README.md -->

# Developers Guide

This guide explains how to extend Cradle without reintroducing the main-process coupling problems we are actively removing.
Use it as the practical companion to the architecture audits and execution plans.
When in doubt, prefer a thinner adapter, a smaller ownership boundary, and a test that proves behavior before code exists.

## What Lives Where

Cradle is not a generic web app with an Electron wrapper bolted on top. The desktop shell, main process, renderer, IPC bridge, and persistence layer each have distinct responsibilities.

### Main process layers

- `src/main/services/`: IPC adapters. These are the stable entrypoints used by the renderer through `window.ipc.*`. Services should keep parameters simple and should not become orchestration blobs.
- `src/main/application/`: use-case orchestration. If a workflow writes multiple records, coordinates a runner, or owns state transitions, it belongs here.
- `src/main/lib/`: lower-level orchestration and infrastructure-heavy runtime code. `ChatEngine` and `IssueAgentRunner` still live here today, but new business workflows should not be added here by default.
- `src/main/events/`: in-process event pipeline and event-bridge code.
- `src/main/db/`: schema, initialization, and persistence primitives.

### Renderer layers

- `src/renderer/src/features/`: feature-owned UI and hooks.
- `src/renderer/src/components/ui/`: universal UI primitives.
- `src/renderer/src/components/common/`: app-specific shared UI.
- `src/renderer/src/routes/`: route or tab entrypoints.

### Ownership rule

Before adding code, ask one question: **who owns this behavior?**

- IPC transport semantics are owned by `services/`.
- Use-case semantics are owned by `application/`.
- Runtime engines, process bridges, and infrastructure helpers are owned by `lib/`.
- Durable data shape is owned by `db/schema.ts`.

If the answer is “multiple layers,” the boundary is probably still wrong.

## Current backend direction

The current backend direction is:

1. Services become thin facades.
2. Complex workflows move into application services.
3. Event-driven lifecycle replaces hidden singleton callbacks where practical.
4. Dead compatibility layers are deleted instead of preserved.

Recent examples:

- `src/main/application/issue-delegation-application.ts` owns Issue delegation commands.
- `src/main/application/kanban-query-application.ts` owns Kanban read-side filtering, search, ordering, and linked-session projections.
- `src/main/application/kanban-write-application.ts` owns Kanban write-side commands.
- `src/main/services/kanban.ts` delegates Kanban queries and commands to application services.

That split is deliberate. Do not move new query-side or write-side business rules back into `KanbanService`.

## How to add a new backend workflow

Use this checklist whenever you introduce or change behavior in the main process.

### 1. Decide whether it is a query or a command

- **Query**: reads data and returns a projection. If it needs filtering, ordering, search semantics, or multi-record composition, put it in `application/`.
- **Command**: mutates data, coordinates multiple tables, triggers a runner, or emits events. Put it in `application/`.

### 2. Write the failing test first

The repository expects TDD, not “tests eventually.”

A good path is:

1. Create or extend a test in `src/main/application/__tests__/`.
2. Run only that test.
3. Confirm the failure is for the missing behavior, not a typo.
4. Implement the minimal production code.
5. Re-run the targeted test, then broader validations.

For application services, prefer behavior-first tests with injected fakes over brittle mock-call snapshots.

### 3. Keep the service adapter boring

A service method should ideally look like this in spirit:

- validate/reshape IPC input if needed
- call one application service method
- return the result

If a service method starts assembling JSON, coordinating transactions, cleaning child records, and writing comments, stop and move that logic down a layer.

### 4. Delete superseded code

Cradle currently allows destructive refactors. If an old helper or compatibility path has no live caller, delete it.

Examples of what to remove instead of preserving:

- dead lib-level orchestration replaced by application services
- obsolete config toggles or compatibility branches
- stale docs that describe an architecture that no longer exists

## Testing strategy that works in this repo

This repository mixes Node-side unit tests with Electron runtime validation. That matters because native modules such as `better-sqlite3` can behave differently depending on whether they were rebuilt for Node or Electron.

### Recommended testing pyramid here

- **Application tests**: prefer injected fakes and behavior assertions.
- **Service tests**: add when adapter behavior itself matters.
- **Typecheck/build**: always run after backend refactors.
- **Focused E2E**: run the smallest feature tags that prove the user journey still works.

### Verified commands

Run from repository root:

    pnpm -s vitest run src/main/application/__tests__/kanban-query-application.test.ts src/main/application/__tests__/kanban-write-application.test.ts src/main/application/__tests__/issue-delegation-application.test.ts
    pnpm -s tsc --noEmit -p tsconfig.node.json --composite false
    pnpm build
    pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001"
    pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-ISSUE-AGENT-001"

### Practical warning about native modules

If you use real SQLite in Node-side tests, you may force `better-sqlite3` into a Node ABI build and then break Electron launch until native modules are rebuilt for Electron again.

That is why recent application tests prefer injected fakes when the goal is orchestration correctness rather than persistence-driver validation.

## Documentation rules you must follow

This repo enforces documentation as part of the architecture, not as optional garnish.

### Directory README updates

When you add, remove, or substantially change files in a directory:

- update that directory’s `README.md`
- keep the file inventory current
- keep descriptions short and concrete

### File headers

Every `.ts`, `.tsx`, `.js`, `.jsx` file must begin with:

    // Input: ...
    // Output: ...
    // Position: ...

If the role of a file changes, update the header.

### ExecPlans

For any non-trivial refactor, create or update an ExecPlan in `docs/exec-plans/`.
The plan must be self-contained and kept current while you work.

## Suggested next architectural cuts

The backend is cleaner than before, but it is not done.

High-value next steps:

1. Shrink `IssueAgentRunner` into smaller orchestration pieces.
2. Continue decomposing `ChatEngine`, which is still the largest architecture hotspot.
3. Reconcile session-model overlap only after the current application boundaries are stable.
4. Tighten `agent-runtime` lifecycle boundaries so provider/credential orchestration keeps shrinking.

## A simple rule of thumb

When you touch backend code, try to make one thing more true than before:

- adapters thinner
- ownership clearer
- tests more behavior-focused
- docs closer to reality

If your change makes the codebase feel slightly more inevitable and slightly less magical, you are probably moving in the right direction.
