<!-- Once this directory changes, update this README.md -->

# Developers Guide

This guide explains how to extend Cradle without reintroducing the main-process coupling problems we are actively removing.
Use it as the practical companion to the architecture audits and execution plans.
When in doubt, prefer a thinner adapter, a clearer owner, and a test that proves behavior before code exists.

## What Lives Where

Cradle is not a generic web app with an Electron wrapper bolted on top. The desktop shell, main process, renderer, IPC bridge, and persistence layer each have distinct responsibilities.

### Main process layers

- `src/main/app/`: bootstrap, IPC adapters, and app-wide persistent stores.
- `src/main/features/*`: owner-owned business semantics such as chat, kanban, issue-agent, skills, and agent-runtime.
- `src/main/platform/*`: OS/process/protocol adapters such as ACP, windowing, PTY, safe storage, socket server, and bundled resources.
- `src/main/devtools/`: runtime observability buffers and devtool-window integration.
- `src/main/events/`: in-process domain event bus and bridges.
- `src/main/db/`: schema, initialization, and persistence primitives.

### Renderer layers

- `src/renderer/src/features/`: feature-owned UI and hooks.
- `src/renderer/src/components/ui/`: universal UI primitives.
- `src/renderer/src/components/common/`: app-specific shared UI.
- `src/renderer/src/routes/`: route or tab entrypoints.

### Ownership rule

Before adding code, ask one question: **who owns this behavior?**

- Transport and lifecycle glue belong in `app/`.
- Query/command semantics and orchestrators belong in `features/`.
- OS/process/protocol bridges belong in `platform/`.
- Debug-only observation belongs in `devtools/`.
- Durable data shape belongs in `db/schema/`.

If the answer is “multiple layers,” the boundary is probably still wrong.

## Current backend direction

The current backend direction is:

1. `app/ipc/*` stays thin.
2. `features/*` owns workflow/query semantics.
3. `platform/*` owns ACP/window/pty/storage/socket/resources plumbing.
4. Event-driven lifecycle replaces hidden singleton callbacks where practical.
5. Dead compatibility layers are deleted instead of preserved.

Recent examples:

- `src/main/features/issue-agent/issue-delegation.ts` owns issue delegation commands.
- `src/main/features/issue-agent/issue-agent-query.ts` owns agent-session/activity query ordering.
- `src/main/features/kanban/kanban-query.ts` owns Kanban read-side filtering, search, ordering, and linked-session projections.
- `src/main/features/kanban/kanban-write.ts` owns Kanban write-side commands.
- `src/main/features/agent-runtime/agent-runtime.ts` owns profile CRUD, credential persistence, provider probe/listModels orchestration, and runtime audit recording.
- `src/main/app/ipc/kanban.ts` owns the public Kanban IPC namespace and delegates only Kanban-owned behavior.
- `src/main/app/ipc/issue-agent.ts` owns the public issue-agent IPC namespace for delegation commands and agent-session/activity queries.
- `src/main/app/ipc/agent-runtime.ts` owns the public agent-runtime IPC namespace and forwards to the feature-owned runtime control-plane service.

That split is deliberate. Do not move new query-side or write-side business rules back into IPC adapters.

## How to add a new backend workflow

Use this checklist whenever you introduce or change behavior in the main process.

### 1. Decide the owner first

- **Feature rule/query/command**: put it in the owning feature directory.
- **Platform bridge**: put it in the relevant `platform/*` bucket.
- **App glue / transport**: keep it in `app/` and keep it boring.

### 2. Write the failing test first

The repository expects TDD, not “tests eventually.”

A good path is:

1. Create or extend a test in the owning feature directory, such as `src/main/features/kanban/__tests__/`.
2. Run only that test.
3. Confirm the failure is for the missing behavior, not a typo.
4. Implement the minimal production code.
5. Re-run the targeted test, then broader validations.

For feature services, prefer behavior-first tests with injected fakes over brittle mock-call snapshots.

### 3. Keep the IPC adapter boring

An IPC method should ideally:

- validate or reshape transport input if needed
- call one feature or platform method
- return the result

If an IPC method starts assembling JSON, coordinating transactions, cleaning child records, and writing comments, stop and move that logic down a layer.

### 4. Delete superseded code

Cradle currently allows destructive refactors. If an old helper or compatibility path has no live caller, delete it.

Examples of what to remove instead of preserving:

- dead horizontal buckets replaced by feature-first ownership
- obsolete config toggles or compatibility branches
- stale docs that pretend the old structure is still canonical

## Testing strategy that works in this repo

This repository mixes Node-side unit tests with Electron runtime validation. That matters because native modules such as `better-sqlite3` can behave differently depending on whether they were rebuilt for Node or Electron.

### Recommended testing pyramid here

- **Feature tests**: prefer injected fakes and behavior assertions.
- **IPC adapter tests**: add when transport behavior itself matters.
- **Typecheck/build**: always run after main-process refactors.
- **Focused E2E**: run the smallest feature tags that prove the user journey still works.

### Suggested commands

Run from repository root:

    pnpm -s vitest run src/main/features/kanban/__tests__/kanban-query-application.test.ts src/main/features/kanban/__tests__/kanban-write-application.test.ts src/main/features/issue-agent/__tests__/issue-agent-query-application.test.ts src/main/features/issue-agent/__tests__/issue-delegation-application.test.ts src/main/app/ipc/__tests__/issue-agent.test.ts
    pnpm -s tsc --noEmit -p tsconfig.node.json --composite false
    pnpm build
    pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-KANBAN-001"
    pnpm e2e:cleanup && pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-ISSUE-AGENT-001"

### Practical warning about native modules

If you use real SQLite in Node-side tests, you may force `better-sqlite3` into a Node ABI build and then break Electron launch until native modules are rebuilt for Electron again.

That is why recent feature tests prefer injected fakes when the goal is orchestration correctness rather than persistence-driver validation.

## Documentation rules you must follow

This repo enforces documentation as part of the architecture, not as optional garnish.

### Directory README updates

When you add, remove, or substantially change files in a directory:

- update that directory’s `README.md`
- keep the file inventory current
- keep descriptions short and concrete

### ExecPlans

For any non-trivial refactor, create or update an ExecPlan in `docs/exec-plans/`.
The plan must be self-contained and kept current while you work.

## Suggested next architectural cuts

The backend is cleaner than before, but it is not done.

High-value next steps:

1. Keep trimming thick `app/ipc/*` adapters such as `acp.ts`, `workspace.ts`, `session.ts`, and `usage.ts` until they are transport-only.
2. Continue decomposing `ChatEngine`, which is still the largest feature hotspot.
3. Reconcile session-model overlap only after the current app/feature boundaries are stable.
4. Reduce cross-layer knowledge where `platform/*` still knows too much feature-specific detail (for example window/chat or ACP/chat touchpoints).

## A simple rule of thumb

When you touch backend code, try to make one thing more true than before:

- adapters thinner
- ownership clearer
- tests more behavior-focused
- docs closer to reality

If your change makes the codebase feel slightly more inevitable and slightly less magical, you are probably moving in the right direction.
