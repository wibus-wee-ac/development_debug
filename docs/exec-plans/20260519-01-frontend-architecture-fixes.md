# Frontend Architecture Fixes From Multi-Work Review

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It implements the highest-value fixes from the prior review handoffs in `docs/multi-work/frontend-architecture-review/` by using the `$multi-work` DAG workflow. The handoff files remain review artifacts; this plan is the implementation control file.

## Purpose / Big Picture

Cradle's frontend review found several correctness, accessibility, state ownership, and developer experience problems. After this work, switching away from a chat tab will not leak stale layout panels, browser history back/forward will keep tab content and labels in sync, chat tool rendering will preserve tool input/output/error instead of dropping specialized tool details, core UI controls will expose better accessibility semantics, and frontend packages will have clearer local validation commands.

The observable outcome is a working app with safer shell/tab behavior and a cleaner developer workflow. A reviewer can verify this by running focused Vitest suites, typechecking `@cradle/web`, typechecking `@cradle/tabs-next`, and manually checking tab switching, browser history, and chat tool block expansion.

## Progress

- [x] (2026-05-18 16:01Z) Read `$multi-work`, `execplan`, React best-practice, React Doctor, current `git status`, and prior review handoffs.
- [x] (2026-05-18 16:05Z) Created this implementation ExecPlan and selected a DAG decomposition with disjoint write ownership.
- [x] (2026-05-18 16:08Z) Spawned shell/layout, tabs-next, chat rendering, and DX/UI hygiene workers with disjoint write ownership.
- [x] (2026-05-18 16:18Z) Shell/layout WorkerA completed stale slot projection and settings tab cleanup with focused tests.
- [x] (2026-05-18 16:25Z) tabs-next WorkerB completed URL sync, persisted context repair, TabBar cleanup, package scripts, README, and tests.
- [x] (2026-05-18 16:26Z) Chat rendering worker failed with 429; main agent closed the failed worker and implemented the chat render-plan and a11y subset locally.
- [x] (2026-05-18 16:32Z) DX/UI hygiene WorkerD completed web package test script, `components/ui` README, transition/static class cleanup, and browser control labels.
- [x] (2026-05-18 16:37Z) Strategy 2 Critique-Chain completed for API generation ownership escalation with InitialG, CritiqueH, and SynthesisI handoffs.
- [x] (2026-05-18 16:38Z) Merged worker results and fixed integration test/typecheck blockers in `composer.test.tsx` and `workspace-sidebar.test.tsx`.
- [x] (2026-05-18 16:40Z) Ran focused validation commands and recorded outcomes.

## Surprises & Discoveries

- Observation: The working tree is already heavily modified before this implementation pass, including server, desktop, plugin, web, design-system docs, and previous multi-work artifacts.
  Evidence: `git status --short` showed many modified and untracked files before this plan was created.

- Observation: Some prior review findings are already partially changed in the current working tree. For example `message-bubble.tsx` now imports `RenderableToolPart` from `tool-ui-classifier` and no longer renders `ReadFilesBlock` / `EditFileBlock` directly.
  Evidence: Static read of `apps/web/src/features/chat/message-bubble.tsx` before spawning workers.

- Observation: The first chat worker did not complete because the subagent hit a 429 retry limit.
  Evidence: Subagent notification reported `exceeded retry limit, last status: 429 Too Many Requests`; main agent closed the failed worker and implemented the scoped chat changes locally.

- Observation: Adding `@cradle/web test` surfaced existing test-suite assumptions that were not valid under package-local jsdom execution.
  Evidence: `workspace-sidebar.test.tsx` originally rendered `Link` without a `TabsProvider`, and `composer.test.tsx` used a jest-dom matcher that was not configured in this project.

## Decision Log

- Decision: Use DAG Strategy 1 for implementation and reserve Strategy 2 Critique-Chain only for unresolved architecture escalations.
  Rationale: The review findings split naturally into independent write sets. Critique-Chain is useful only if a worker finds a decision that should not be patched locally, such as changing the API client generation policy or settings route product semantics.
  Date/Author: 2026-05-19 / Main Agent.

- Decision: Do not attempt to fix every review item in one massive rewrite.
  Rationale: Several items are architecture direction rather than immediate bugs. This pass prioritizes correctness, regression tests, a11y/DX improvements, and small ownership cleanups that are safe in a dirty working tree.
  Date/Author: 2026-05-19 / Main Agent.

- Decision: Keep worker write sets disjoint.
  Rationale: The repository is dirty and multiple agents will write in parallel. Disjoint ownership reduces merge conflicts and protects unrelated user changes.
  Date/Author: 2026-05-19 / Main Agent.

- Decision: Treat API generation ownership as a Strategy 2 architecture escalation, not as a local patch in the DX worker.
  Rationale: Changing whether `apps/web/src/api-gen` is committed, generated, or CI-orchestrated affects server, web, root scripts, and potentially CLI ownership. It should be decided explicitly instead of patched inside a package hygiene task.
  Date/Author: 2026-05-19 / Main Agent.

- Decision: Keep `apps/web/src/api-gen` as a web-owned ignored generated client, but future implementation should introduce a server-owned OpenAPI export capability and root/CI-owned validation choreography.
  Rationale: SynthesisI reconciled InitialG and CritiqueH: submitting generated client by default would add review churn, but live localhost should not be the normal bootstrap dependency. A server-owned export path allows deterministic regeneration without crossing namespace ownership.
  Date/Author: 2026-05-19 / Strategy 2 SynthesisI.

## Outcomes & Retrospective

Completed. The DAG pass fixed the highest-priority correctness and DX/UX issues that were safe to land in the current dirty working tree.

Produced implementation handoffs:

- `docs/multi-work/frontend-architecture-fixes/20260519-shell-layout-WorkerA.md`
- `docs/multi-work/frontend-architecture-fixes/20260519-tabs-next-WorkerB.md`
- `docs/multi-work/frontend-architecture-fixes/20260519-chat-rendering-WorkerC.md`
- `docs/multi-work/frontend-architecture-fixes/20260519-dx-ui-hygiene-WorkerD.md`

Produced Strategy 2 API generation ownership handoffs:

- `docs/multi-work/frontend-architecture-fixes/20260519-api-gen-ownership-InitialG.md`
- `docs/multi-work/frontend-architecture-fixes/20260519-api-gen-ownership-CritiqueH.md`
- `docs/multi-work/frontend-architecture-fixes/20260519-api-gen-ownership-SynthesisI.md`

Validation completed successfully:

    pnpm --filter @cradle/tabs-next test
    pnpm --filter @cradle/tabs-next typecheck
    pnpm --filter @cradle/web test
    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    git diff --check

`@cradle/web test` passed 18 files and 69 tests. `@cradle/tabs-next test` passed 6 files and 16 tests. React Doctor was also run with `npx -y react-doctor@latest . --verbose --diff`; it returned non-zero because broader existing warnings remain in `apps/web`, `packages/streamdown`, `apps/playground`, and plugin code. The web score was 90/100 and tabs-next was 99/100. The remaining React Doctor findings include larger follow-up work such as TabBar render-prop API shape, Electron `<webview>` custom attributes, Composer state shape, and unrelated existing component hygiene.

## Context and Orientation

This repository is a monorepo. The relevant frontend app is `apps/web`, which uses React, TypeScript, Tailwind CSS, Zustand, TanStack Query, and Vite. The tab runtime package is `packages/tabs-next`, used by the web app for tab state, tab rendering, URL hash synchronization, and the top tab bar.

Prior review artifacts live under `docs/multi-work/frontend-architecture-review/`. The most relevant files are:

- `20260518-shell-navigation-ExplorationA.md`: stale layout slot bug, settings lifecycle, shell/tab ownership concerns.
- `20260518-tabs-package-ExplorationB.md`: URL sync label bug, missing URL sync tests, context restore repair, TabBar cleanup.
- `20260518-chat-rendering-ExplorationC.md`: chat tool rendering ownership, generic fallback, folding tests, block accessibility.
- `20260518-state-data-flow-ExplorationD.md`: query key ownership and chat store/data-flow direction.
- `20260518-design-system-ui-ExplorationE.md`: TabBar a11y, dynamic class discipline, scrollbar and transition concerns.
- `20260518-repo-hygiene-ExplorationF.md`: package-local scripts, README inventory, generated API ownership risk.

Important repository constraints from `AGENTS.md` still apply. UI code must follow design-system conventions, Tailwind classes must be statically defined, `cn()` should combine classes, feature-specific components should stay in feature directories, new files need header comments, and modified directories should have README updates when ownership changes.

## Plan of Work

Milestone 1 fixes shell correctness. The shell/layout worker owns `apps/web/src/components/layout/layout-slots-context.tsx` and adjacent tests, and may make small changes in `apps/web/src/app.tsx` or `apps/web/src/features/settings/settings-overlay-store.ts` only if required for settings cleanup. The user-visible behavior is that non-chat tabs do not keep the last chat bottom panel and stale settings tab ids are cleaned safely.

Milestone 2 fixes tabs-next runtime invariants. The tabs-next worker owns `packages/tabs-next/**`. It should add URL sync regression tests before or alongside fixes, make popstate restoration update tab labels through a store-owned action or equivalent invariant-preserving path, prune invalid persisted history entries, add TabBar unmount cleanup and basic a11y labels/hit areas, and add package-local validation scripts.

Milestone 3 fixes chat render behavior. The chat worker owns `apps/web/src/features/chat/message-bubble.tsx`, `apps/web/src/features/chat/tool-ui-classifier.ts`, `apps/web/src/features/chat/blocks/**`, `apps/web/src/features/chat/README.md`, and adjacent chat tests. It should keep all tool calls visible through generic fallback semantics, preserve input/output/error/subagent messages, extract testable render-plan or classifier logic when feasible, add a11y state to collapsible blocks, and update README inventory.

Milestone 4 improves DX/UI hygiene outside the above scopes. The hygiene worker owns `apps/web/package.json`, `apps/web/src/components/ui/README.md`, and low-risk app UI cleanup files outside chat, layout, and tabs-next. It should add package-local scripts for web, document `components/ui` placement rules, and apply small static Tailwind or transition/scrollbar cleanup only where it will not conflict with the other workers.

Main agent then merges, reads worker handoff files, runs focused checks, and decides whether any finding requires Strategy 2 Critique-Chain. If a worker reports an architecture escalation instead of a patch, the main agent will not patch around it; it will spawn critique/synthesis agents or narrow the scope.

## Concrete Steps

From `/Users/wibus/dev/Cradle`, the main agent first creates this plan and the handoff directory:

    mkdir -p docs/multi-work/frontend-architecture-fixes

Then spawn four workers with disjoint write ownership. Each worker must write one handoff file under `docs/multi-work/frontend-architecture-fixes/` using the naming convention `20260519-<short-description>-WorkerX.md`.

After workers complete, inspect:

    find docs/multi-work/frontend-architecture-fixes -maxdepth 1 -type f | sort
    git diff --stat
    git diff --check

Then run focused validation:

    pnpm --filter @cradle/tabs-next typecheck
    pnpm --filter @cradle/tabs-next test
    pnpm --filter @cradle/web exec tsc --noEmit
    pnpm --filter @cradle/web test

If `@cradle/web test` is introduced with a narrower command, also run the specific chat/layout tests named by workers. If React code changed, run React Doctor on the diff:

    npx -y react-doctor@latest . --verbose --diff

## Validation and Acceptance

Acceptance requires all worker handoff files to exist and describe changed files, tests added or updated, validation run or skipped, and unresolved risks. Code acceptance requires no TypeScript errors in `@cradle/tabs-next` and `@cradle/web` for the touched scope, focused tests for `packages/tabs-next` and chat/layout behavior, and no `git diff --check` whitespace errors.

Behavior acceptance:

Switching from a chat tab with bottom panel slots to a non-chat tab yields empty active layout slots, so the bottom panel toggle and stale panel content are not shown.

Using browser back/forward through tab-local history restores the tab route and tab label consistently.

Persisted tab contexts with unknown history routes are repaired instead of rendering a blank tab.

Chat tool calls remain visible even when specialized summary data is missing; tool input, output, error, and subagent children are not discarded.

Collapsible tool/reasoning controls expose accessible expanded state and are safe as buttons.

Frontend package-level validation commands exist for at least `@cradle/web` and `@cradle/tabs-next`.

## Idempotence and Recovery

This plan is safe to rerun because workers should make additive tests and local refactors rather than destructive migrations. The working tree is dirty, so no worker may run `git checkout`, `git reset`, or remove unrelated files. If a file outside a worker's ownership is needed, that worker must report it in the handoff instead of editing it. If validation fails because of unrelated pre-existing changes, record the exact failure and continue with targeted checks for the files modified in this plan.

## Artifacts and Notes

The current implementation topic directory is:

    docs/multi-work/frontend-architecture-fixes/

The prior review topic directory is:

    docs/multi-work/frontend-architecture-review/

The current working tree had pre-existing changes before this plan, including but not limited to `apps/web/src/features/chat/blocks/`, `apps/web/src/features/chat/tool-ui-classifier.ts`, `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/styles.css`, and multiple server/plugin files. This plan must not claim ownership over unrelated changes.

## Interfaces and Dependencies

The tabs-next package should continue exporting its existing public API from `packages/tabs-next/src/index.ts`. If it needs a new store action for URL sync, define it in `packages/tabs-next/src/store.ts` and use it from `packages/tabs-next/src/url-sync.ts`.

The chat rendering layer should keep `MessageBubble` as the UI shell and should move testable classification/projection logic into a pure TypeScript module such as `apps/web/src/features/chat/tool-ui-classifier.ts` or an adjacent render-plan module. Public React components in `apps/web/src/features/chat/blocks/` should keep English identifiers, stable props, and accessible button semantics.

Package scripts should use existing workspace tooling. Prefer `vitest run <path>` for local tests and `tsc --noEmit` for package typechecks.

Revision note: Initial implementation plan created on 2026-05-19 for the DAG fix pass requested by Wibus.

Revision note: Updated on 2026-05-19 after WorkerA, WorkerB, WorkerD, main-agent WorkerC fallback, Strategy 2 API ownership synthesis, and validation completed.
