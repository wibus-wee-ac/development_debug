# Frontend Query Refresh Policy for Workspace Data

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a reader should be able to understand why the current frontend data refresh behavior is unreliable, which files own the first implementation slice, and how to verify the result without relying on earlier chat context.

## Purpose / Big Picture

Cradle is used as an agent workspace. Data can change from the web UI, the `cradle` CLI, automation, other windows, and running agents. Today many frontend views only refresh after local mutations or after unrelated per-component polling intervals. This makes the UI feel stale: a user can move an issue from the CLI and keep seeing the old Kanban state, or edit files externally and wait before the File Tree and Git panels catch up.

After this change, Cradle should have one small frontend-owned refresh policy for React Query data. The first implementation does not introduce a server push protocol. Instead, it gives high-value workspace views consistent focus/reconnect refresh behavior and visibility-aware polling intervals. A user can verify the result by opening a Kanban board, changing issues with the CLI, editing files in the workspace, and observing the UI update without a full page reload.

## Progress

- [x] (2026-05-23 23:40 +0800) Read `/Users/wibus/.agents/skills/execplan/references/PLANS.md` and confirmed that the plan must stay self-contained, living, and validation-focused.
- [x] (2026-05-23 23:40 +0800) Inspected existing React Query usage in `apps/web/src/main.tsx`, `apps/web/src/features/kanban/use-kanban.ts`, `apps/web/src/features/workspace/file-tree.tsx`, `apps/web/src/features/git/use-git.ts`, `apps/web/src/features/session-await/await-panel.tsx`, and `apps/web/src/features/chat/use-session-await.ts`.
- [x] (2026-05-23 23:40 +0800) Confirmed today's next ExecPlan filename is `docs/exec-plans/20260523-03-frontend-query-refresh-policy.md` because `20260523-01-rust-chronicle-core.md` and `20260523-02-boxsh-integration-research.md` already exist.
- [x] (2026-05-23 23:49 +0800) Added `apps/web/src/lib/query-refresh-policy.ts` and `apps/web/src/lib/query-refresh-policy.test.ts`.
- [x] (2026-05-23 23:49 +0800) Applied refresh policies to the first high-impact workspace data hooks: Kanban, File Tree, workspace file mentions, Git, Chat await summary, and Session Await panel.
- [x] (2026-05-23 23:51 +0800) Updated modified directory READMEs for `lib`, `kanban`, `git`, `workspace`, `chat`, and `session-await`.
- [x] (2026-05-23 23:58 +0800) Ran focused policy tests, targeted ESLint, `git diff --check`, and web typecheck. Focused tests, targeted ESLint, and whitespace checks pass. Web typecheck still fails in pre-existing files outside this task; a follow-up grep check found no errors in the touched files.
- [x] (2026-05-23 23:59 +0800) Completed five reviewer-to-fix passes covering policy semantics, Kanban behavior, Git/FileTree behavior, Await behavior, and documentation/testing.

## Surprises & Discoveries

- Observation: The current implementation already has several local polling decisions, but they are not named or shared.
  Evidence: `apps/web/src/features/git/use-git.ts` sets `refetchInterval: 15_000` for file statuses, `apps/web/src/features/chat/use-session-await.ts` sets `refetchInterval: 10_000`, and `apps/web/src/features/kanban/use-kanban.ts` mostly relies on mutation invalidation without polling.

- Observation: The global React Query client sets `staleTime: 30_000` and `retry: 1`.
  Evidence: `apps/web/src/main.tsx` constructs `new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })`.

- Observation: The current worktree contains unrelated uncommitted changes outside this task.
  Evidence: `git status --short` shows modified Chronicle and macOS bridge files. This plan must not revert or edit those unrelated files.

- Observation: Full web typecheck is currently blocked by unrelated TypeScript errors outside this task.
  Evidence: `pnpm --filter @cradle/web exec tsc --noEmit` exits non-zero with errors in `src/features/agent-management/agent-detail.tsx`, `src/features/agent-management/profile-detail-panel.tsx`, `src/features/agent-runtime/agent-config-schema.ts`, `src/features/chat/blocks/tool-call-block.tsx`, `src/features/chronicle/use-chronicle.ts`, and `src/store/chat.ts`. A follow-up filtered command over touched filenames produced no output.

## Decision Log

- Decision: Implement a shared frontend refresh policy before introducing SSE or WebSocket server events.
  Rationale: The stale-data issue is user-visible today and can be improved with a small React Query layer. Server push needs event ownership, payload compatibility, and multi-window semantics. This first slice leaves a future event source able to reuse the same query invalidation boundaries.
  Date/Author: 2026-05-23 / Codex

- Decision: Keep the first policy local to `apps/web/src/lib` and reuse React Query options instead of adding a new state manager.
  Rationale: React Query already owns server data caching in the web app. A small helper keeps ownership clear and avoids spreading magic numbers across feature hooks.
  Date/Author: 2026-05-23 / Codex

- Decision: Use visibility-aware polling by default and rely on React Query's focus/reconnect refresh flags.
  Rationale: Workspace data should refresh while the user can observe it, but hidden windows should not keep high-frequency polling active. React Query supports `refetchIntervalInBackground: false`, `refetchOnWindowFocus`, and `refetchOnReconnect` directly.
  Date/Author: 2026-05-23 / Codex

- Decision: Keep issue search queries non-polling while giving them interactive stale and focus behavior.
  Rationale: Search results are user-input driven and can create many distinct query keys. Polling every search term would waste requests. The hook now uses `queryRefreshPolicy('interactive', { refetchInterval: false })` so focus and reconnect still refresh the active term without background churn.
  Date/Author: 2026-05-23 / Codex

- Decision: Keep `useGitStatus` and `useGitFileStatuses` as separate observers over the generated Git status query key.
  Rationale: They already share one server response and project different data through `select`. Multiple mounted observers can each request active refresh, but the affected surfaces are exactly the header, Git panel, Changes panel, File Tree, and Await composer surfaces that need visible freshness. This is acceptable for the polling-first slice and can later be replaced by server event invalidation.
  Date/Author: 2026-05-23 / Codex

## Outcomes & Retrospective

The first polling-based slice is implemented. Cradle now has a shared frontend refresh policy in `apps/web/src/lib/query-refresh-policy.ts`, and the first high-impact workspace data hooks use it. Kanban issue reads, Issue detail reads, File Tree file reads, workspace file mention reads, Git reads, Chat await summary, and Session Await panel reads now have consistent visibility-aware refresh behavior.

This slice intentionally does not add SSE or WebSocket events. That remains the long-term realtime direction, but this implementation creates a named policy layer that a future event source can complement with targeted invalidations. The main validation gap is full web typecheck, which is currently blocked by unrelated existing errors outside the touched files.

## Context and Orientation

The web frontend lives under `apps/web/src`. It uses React Query from `@tanstack/react-query` for data fetched from the Cradle server. A query is a cached server read, identified by a query key. Invalidating a query means telling React Query that the cached data is stale and should be refetched when active.

`apps/web/src/main.tsx` creates the global `QueryClient`. It currently sets a default `staleTime` of 30 seconds. `staleTime` is how long React Query considers cached data fresh. Fresh data is not automatically refetched on every render.

`apps/web/src/features/kanban/use-kanban.ts` owns frontend hooks for Kanban boards, issue statuses, milestones, issues, issue details, comments, relations, issue-agent sessions, and related mutations. Many mutations call `invalidateQueries`, which updates the current window after a local write. That does not solve external writes from CLI, agents, automation, or another window.

`apps/web/src/features/workspace/file-tree.tsx` fetches workspace file lists with query key `['workspace-files', workspaceId]`. It currently uses `staleTime: 30_000` and no explicit polling, so external filesystem changes can be delayed.

`apps/web/src/features/git/use-git.ts` owns Git status, branches, remotes, and graph hooks. Git status and file status are high-value live data, while branches and graph can refresh more slowly.

`apps/web/src/features/session-await/await-panel.tsx` and `apps/web/src/features/chat/use-session-await.ts` fetch session await rows and summary data. Await state is user-visible because it controls badges and disabled chat input state.

The new helper should live in `apps/web/src/lib/query-refresh-policy.ts`. The `lib` directory is for shared renderer utilities. The helper should return normal React Query option fields so feature hooks can spread it into existing `useQuery` calls without changing their query functions or schemas.

## Plan of Work

First, create `apps/web/src/lib/query-refresh-policy.ts`. Define a small set of policy names that describe behavior rather than implementation details: `static`, `background`, `active`, and `interactive`. Export a function named `queryRefreshPolicy(policy, overrides?)` that returns React Query options for `staleTime`, `refetchInterval`, `refetchIntervalInBackground`, `refetchOnWindowFocus`, and `refetchOnReconnect`. Also export `queryRefreshPolicies` constants for call sites that prefer object spreading. The helper must not use the words `ensure`, `shell`, or `make` in identifiers.

Second, add `apps/web/src/lib/query-refresh-policy.test.ts` with focused tests. The tests should prove the interval values, that interval polling is disabled in background tabs, and that overrides can customize stale time or interval without changing every call site.

Third, apply the policy to high-impact hooks. In `apps/web/src/features/kanban/use-kanban.ts`, apply `active` to board/status/milestone/issues queries, `interactive` to current issue, comments, relations, and linked issue, and keep the existing dynamic fast polling for active agent sessions. In `apps/web/src/features/workspace/file-tree.tsx`, apply `active` to the file list query. In `apps/web/src/features/git/use-git.ts`, apply `active` to status/file status, `background` to branches/remotes/graph, and preserve `retry: false`. In `apps/web/src/features/chat/use-session-await.ts` and `apps/web/src/features/session-await/await-panel.tsx`, apply `interactive` to await summary/list and keep live CI status polling at its current interval unless a policy override expresses it clearly.

Fourth, update `README.md` files in modified directories. At minimum update `apps/web/src/lib/README.md`. If feature directory README files exist for touched feature folders, update them to mention the refresh policy usage. Do not create unrelated documentation churn in directories that do not have local READMEs unless needed for repository rules.

Fifth, run validation. From `/Users/wibus/dev/Cradle`, run `pnpm --filter @cradle/web exec tsc --noEmit` and `pnpm --filter @cradle/web test -- src/lib/query-refresh-policy.test.ts`. If the targeted test command cannot filter that way, run `pnpm --filter @cradle/web test`. Fix any errors.

Sixth, complete five reviewer-to-fix passes. A reviewer pass means inspecting the current diff against the purpose of this plan and writing a finding or "no finding" result in `Artifacts and Notes`. A fix pass means changing code or plan text when the review finds an actionable issue, then rerunning the relevant validation if the fix affects code. The five passes should cover: policy semantics, Kanban behavior, Git/FileTree behavior, Await behavior, and documentation/testing.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

Inspect the relevant files:

    rg "QueryClient|staleTime|refetchInterval|invalidateQueries|useQuery" -n apps/web/src -g '*.{ts,tsx}'
    sed -n '1,120p' apps/web/src/main.tsx
    sed -n '1,780p' apps/web/src/features/kanban/use-kanban.ts
    sed -n '1,170p' apps/web/src/features/workspace/file-tree.tsx
    sed -n '1,150p' apps/web/src/features/git/use-git.ts

Create the helper and tests:

    apps/web/src/lib/query-refresh-policy.ts
    apps/web/src/lib/query-refresh-policy.test.ts

Update hook call sites:

    apps/web/src/features/kanban/use-kanban.ts
    apps/web/src/features/workspace/file-tree.tsx
    apps/web/src/features/git/use-git.ts
    apps/web/src/features/chat/use-session-await.ts
    apps/web/src/features/session-await/await-panel.tsx

Run validation:

    pnpm --filter @cradle/web exec tsc --noEmit
    pnpm --filter @cradle/web test -- src/lib/query-refresh-policy.test.ts

Expected successful output should include no TypeScript errors and a Vitest summary showing the new `query-refresh-policy` tests passed.

Actual validation during implementation:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/lib/query-refresh-policy.test.ts
    Result: 1 test file passed, 4 tests passed.

    pnpm exec eslint apps/web/src/lib/query-refresh-policy.ts apps/web/src/lib/query-refresh-policy.test.ts apps/web/src/features/kanban/use-kanban.ts apps/web/src/features/workspace/file-tree.tsx apps/web/src/features/workspace/use-workspace-files.ts apps/web/src/features/git/use-git.ts apps/web/src/features/chat/use-session-await.ts apps/web/src/features/session-await/await-panel.tsx
    Result: passed after running eslint --fix once for import ordering and a stale eslint-disable directive.

    git diff --check -- apps/web/src/lib apps/web/src/features/kanban apps/web/src/features/workspace apps/web/src/features/git apps/web/src/features/chat apps/web/src/features/session-await docs/exec-plans
    Result: passed.

    pnpm --filter @cradle/web exec tsc --noEmit
    Result: failed due to unrelated existing TypeScript errors outside touched files.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false 2>&1 | rg 'query-refresh-policy|use-kanban|use-git|file-tree|use-session-await|await-panel|use-workspace-files' || true
    Result: no output, so no current TypeScript error references this task's touched files.

## Validation and Acceptance

The implementation is accepted when the web app has a shared query refresh policy and high-impact workspace views use it. Compilation must pass. The new tests must prove the policy exports the intended values.

Manual acceptance should be performed after starting the web app and server. Open a Kanban board in the browser. In another terminal, run a CLI issue update such as:

    cradle issue create --workspace-id 5ac57d9e-0113-4a88-9e23-20b135a68ac1 --title "Refresh policy smoke test"

Within the active query interval, the Kanban issue list should update without a full page reload. Edit or create a file in the same workspace and observe that the Right Aside File Tree and Git status refresh while the page is visible. Register or cancel a session await and observe the Feed badge or await panel update without manual reload.

This first slice does not promise sub-second realtime updates and does not add SSE or WebSocket events. It is accepted if external changes become predictably visible through shared policy-driven refetching and if the code has a clear place for a future server event source to trigger invalidations.

## Idempotence and Recovery

The changes are additive and local to frontend source and documentation. Running tests repeatedly is safe. If a policy interval is too aggressive, change the number in `apps/web/src/lib/query-refresh-policy.ts` and rerun the policy test plus web typecheck. If a hook has a domain-specific dynamic interval, keep that interval local and document why in this plan's Decision Log.

Do not run destructive Git commands. The current worktree contains unrelated uncommitted changes; leave them untouched. Use `git diff -- apps/web docs/exec-plans` to review only this task's files.

## Artifacts and Notes

Initial evidence gathered before implementation:

    apps/web/src/main.tsx defines QueryClient defaults with staleTime 30_000 and retry 1.
    apps/web/src/features/git/use-git.ts already polls file Git status every 15_000 ms.
    apps/web/src/features/chat/use-session-await.ts already polls await summary every 10_000 ms.
    apps/web/src/features/kanban/use-kanban.ts has mutation invalidation but no shared external-change refresh policy.

Reviewer pass results:

    Pass 1, policy semantics:
    Finding: React Query option names and value types needed confirmation before relying on the helper.
    Fix: No code fix required. `node_modules/@tanstack/query-core/src/types.ts` confirms `refetchInterval`, `refetchIntervalInBackground`, `refetchOnWindowFocus`, and `refetchOnReconnect` accept the values used here.

    Pass 2, Kanban behavior:
    Finding: `useSearchIssues` should not poll because each typed term creates a distinct query key.
    Fix: Already handled by `queryRefreshPolicy('interactive', { refetchInterval: false })`; the decision is recorded above. Board, issue list, issue detail, comments, relations, and linked issue reads use active or interactive refresh.

    Pass 3, Git and File Tree behavior:
    Finding: `useGitStatus` and `useGitFileStatuses` share the generated Git status query key but are separate observers with different `select` projections.
    Fix: No code fix required for this slice. The shared response remains cache-compatible, and the decision to keep both observers is recorded above.

    Pass 4, Await behavior:
    Finding: GitHub live status should not be pulled into the 5 second interactive default because it may hit external GitHub-backed server work.
    Fix: Already handled by `queryRefreshPolicy('interactive', { refetchInterval: 20_000 })`; session await list and chat summary use the normal interactive policy.

    Pass 5, documentation and validation:
    Finding: Initial implementation only updated `apps/web/src/lib/README.md`, but repository rules require modified directories to have current README inventories.
    Fix: Updated README entries for `apps/web/src/features/kanban`, `apps/web/src/features/git`, `apps/web/src/features/workspace`, `apps/web/src/features/chat`, and `apps/web/src/features/session-await`. Targeted ESLint also found import-sort and stale disable issues; running `eslint --fix` corrected them.

## Interfaces and Dependencies

In `apps/web/src/lib/query-refresh-policy.ts`, define and export:

    export type QueryRefreshPolicyName = 'static' | 'background' | 'active' | 'interactive'

    export interface QueryRefreshPolicyOverrides {
      staleTime?: number
      refetchInterval?: number | false
    }

    export function queryRefreshPolicy(
      name: QueryRefreshPolicyName,
      overrides?: QueryRefreshPolicyOverrides,
    ): {
      staleTime: number
      refetchInterval: number | false
      refetchIntervalInBackground: false
      refetchOnWindowFocus: boolean | 'always'
      refetchOnReconnect: boolean | 'always'
    }

The helper depends only on TypeScript and React Query-compatible option shapes. It must not import React. Feature hooks continue to depend on `@tanstack/react-query` and existing generated API clients.

Revision note: Initial plan created before implementing the first shared React Query refresh policy for CRA-003.

Revision note: Updated after adding the shared refresh policy helper, applying it to the first hook set, and documenting touched directories before validation.

Revision note: Updated after validation and five reviewer-to-fix passes; records passing focused tests, passing targeted lint, the unrelated full typecheck blocker, review findings, and the first-slice outcome.
