# Introduce Cradle Diffs Local Reviews

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the repository's ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. If a checked-in `PLANS.md` is later added to this repository, this plan must continue to satisfy the same requirements: it must remain self-contained, novice-friendly, outcome-focused, and updated as implementation proceeds.

## Purpose / Big Picture

Cradle currently shows working tree changes through a right-side Changes tab that can open a browser-panel `workspace-diff` viewer. That viewer is useful, but it is only a raw patch display: it has no stable review identity, no immutable revision snapshot, no place for guided review, comments, agent feedback, or commit planning. After this change, users can open local working tree changes in a dedicated Cradle Diffs workspace surface that owns the review concept. The first observable outcome is that clicking Review in the Changes tab opens a Cradle Diffs local review page at `/workspaces/$workspaceId/diffs`, backed by a `diff-review` owner, while still reusing the existing `@pierre/diffs` renderer.

The first implementation slice intentionally avoids GitHub pull requests, remote review sync, comments, merge operations, and automatic AI commits. It creates the architecture-correct foundation: a local working tree source, an immutable revision made from the current git patch, a review-owned web container, and a Changes tab entrypoint. Commit Planner can then be added as a review action that reads a revision and returns an editable plan, instead of being bolted onto the Changes tab as a dialog.

## Progress

- [x] (2026-06-16 13:32Z) Read the ExecPlan requirements from `/Users/wibus/.agents/skills/execplan/references/PLANS.md` and recorded the non-negotiables before creating this file.
- [x] (2026-06-16 13:32Z) Created this self-contained plan in `docs/exec-plans/20260616-01-cradle-diffs-local-review.md`.
- [x] (2026-06-16 13:36Z) Inspected server module registration, database schema layout, generated API workflow, and browser panel tab conventions.
- [x] (2026-06-16 13:41Z) Added `@cradle/db` schema tables for `diff_reviews`, `diff_review_revisions`, and `diff_review_files`; added a package-level Drizzle Kit config and generated migration with Drizzle Kit.
- [x] (2026-06-16 13:41Z) Added a server-owned `diff-review` module for local working tree reviews and immutable revisions, then mounted it from `apps/server/src/app.ts`.
- [x] (2026-06-16 13:45Z) Generated web API client files from the new OpenAPI routes.
- [x] (2026-06-16 13:46Z) Added `apps/web/src/features/diff-review/cradle-diffs-viewer.tsx`, a review-owned container that refreshes local working tree reviews and reuses `@pierre/diffs/react` rendering.
- [x] (2026-06-16 13:46Z) Added an initial browser-panel `cradle-diffs` tab host while retaining legacy `workspace-diff` support.
- [x] (2026-06-16 13:47Z) Changed the Changes tab entrypoint so Review and file clicks open Cradle Diffs instead of a raw `workspace-diff` tab.
- [x] (2026-06-16 13:49Z) Validated server typecheck, web typecheck, focused server diff-review test, and focused existing web tests for Changes/browser-panel behavior.
- [x] (2026-06-16 13:49Z) Updated this plan's Outcomes & Retrospective with shipped behavior and remaining gaps.
- [x] (2026-06-16 14:18Z) Corrected the UI architecture after review: removed the new BrowserPanel host, added a `workspace-diffs` TanStack Router surface, and changed Changes actions to call `openWorkspaceDiffs`.

## Surprises & Discoveries

- Observation: Existing Cradle diff rendering already uses `@pierre/diffs` and should not be replaced.
  Evidence: `apps/web/src/features/browser/workspace-diff-viewer.tsx` imports `parsePatchFiles` from `@pierre/diffs` and `CodeView` from `@pierre/diffs/react`, then renders unified or split views from a git patch string.

- Observation: Existing server git diff materialization already handles untracked files.
  Evidence: `apps/server/src/modules/git/service.ts` uses `git diff HEAD` for tracked files and `git diff --no-index -- /dev/null path` for untracked files, then joins those patches.

- Observation: Before this work, `@cradle/db` had schema modules and migration artifacts but no package-level `drizzle.config.ts` or `generate` script.
  Evidence: `packages/db/package.json` originally exported schema only and had no scripts. Running `find . -maxdepth 3 -name 'drizzle.config.*'` returned no config before adding `packages/db/drizzle.config.ts`.

- Observation: Hand-writing a SQL migration without updating Drizzle snapshot metadata is the wrong path for this repository.
  Evidence: `pnpm --filter @cradle/db generate` generated `packages/db/drizzle/0001_nostalgic_puppet_master.sql` and `packages/db/drizzle/meta/0001_snapshot.json`, keeping SQL and meta in sync.

- Observation: Server tests can inherit `CRADLE_MIGRATIONS_DIR` from a local installed Cradle app, which may point at stale migrations and hide newly generated tables.
  Evidence: The first `diff-review` focused test failed with `SqliteError: no such table: diff_reviews` even though `packages/db/drizzle/0001_nostalgic_puppet_master.sql` existed. The test now sets `CRADLE_MIGRATIONS_DIR` to the repository's `packages/db/drizzle` path before creating the app.

- Observation: Hosting Cradle Diffs in BrowserPanel creates the wrong product surface even if the component is review-owned.
  Evidence: The user expects Review to open an independent workspace surface, not another browser tab. The corrected implementation uses `/workspaces/$workspaceId/diffs`, a `workspace-diffs` surface identity, and layout slot registration instead of a new BrowserPanel tab kind.

- Observation: Placing `diffs.tsx` under `routes/workspaces/$workspaceId/` creates a child route that is swallowed by the workspace route because the workspace detail route does not render an Outlet.
  Evidence: Navigating to `/workspaces/<id>/diffs` selected the Cradle Diffs surface tab and URL, but the visible content remained the workspace overview page. Moving the route file to `routes/workspaces_.$workspaceId.diffs.tsx` keeps the same URL while making it a root-level non-nested surface route.

## Decision Log

- Decision: Name the product surface Cradle Diffs, while naming the server owner `diff-review`.
  Rationale: "Cradle Diffs" is the user-facing page concept. `diff-review` is the implementation namespace that owns review identity, revision snapshots, file diff metadata, and future review lifecycle records. This keeps ownership explicit and leaves `git` as the owner of repository facts and git commands only.
  Date/Author: 2026-06-16 / Codex

- Decision: Implement local working tree review first and defer GitHub PRs, comments, agent fix loops, and Commit Planner execution.
  Rationale: The smallest architecture-correct slice proves the owner boundary and page surface without mixing in remote authentication, outbound operations, or AI behavior. Commit Planner should read a stable revision later; it should not be the foundation.
  Date/Author: 2026-06-16 / Codex

- Decision: Reuse `@pierre/diffs` for parsing and rendering patches.
  Rationale: Repository instructions prohibit inventing new projections when a usable library API exists. The current viewer already proves the library can parse git patches and render split/unified diffs.
  Date/Author: 2026-06-16 / Codex

- Decision: Add `packages/db/drizzle.config.ts` and a `generate` script, then generate migrations with Drizzle Kit instead of maintaining SQL and meta by hand.
  Rationale: Drizzle is the repository's database authority. Generated migrations keep the SQL migration, journal, and snapshot aligned. A direct SQL edit is acceptable only as an emergency patch and was not necessary here.
  Date/Author: 2026-06-16 / Codex

- Decision: Cradle Diffs must be an independent workspace route/surface, not a BrowserPanel tab.
  Rationale: BrowserPanel owns browser/file/diff utility tabs. Cradle Diffs owns review lifecycle and future commit planning. Keeping it as a page-level surface gives it a stable navigation identity, tab title, layout slot contract, and room for review-specific workflows without overloading BrowserPanel semantics.
  Date/Author: 2026-06-16 / Codex

- Decision: Implement the Cradle Diffs route as `routes/workspaces_.$workspaceId.diffs.tsx`, not a nested child under `routes/workspaces/$workspaceId/`.
  Rationale: The workspace detail route is itself a complete page and does not provide an Outlet for child pages. Cradle Diffs should be a sibling surface with the same workspace id parameter, not a child render region inside the workspace overview.
  Date/Author: 2026-06-17 / Codex

## Outcomes & Retrospective

The first architecture-correct Cradle Diffs slice is implemented after one UI correction. The repository now has a `diff-review` server module, Drizzle-owned review/revision/file schema, generated OpenAPI/web client support, a review-owned web container, a `/workspaces/$workspaceId/diffs` route, and a `workspace-diffs` surface identity. The Changes tab entrypoint opens that independent surface through `openWorkspaceDiffs`; it no longer creates a BrowserPanel Cradle Diffs tab. The implementation intentionally stops before comments, GitHub PR adapters, agent fix loops, and Commit Planner execution. Those future features now have a stable local working tree review/revision object to read from instead of attaching directly to the legacy raw diff viewer.

One test command requires `NODE_ENV=test` to avoid React production `act` behavior in this local environment. With that environment variable set, the focused web tests passed. The run still printed a late jsdom cleanup warning after the successful summary, but exited with status 0.

## Context and Orientation

Cradle is a React, TypeScript, Tailwind CSS, Zustand, TanStack Router, Electron, and Elysia application. The relevant current code is split between server git capabilities, web git Changes UI, and browser-panel tab hosting.

The server git module lives under `apps/server/src/modules/git/`. Its `service.ts` file owns repository discovery, status, branches, remotes, graph, checkout, fetch, merge-base, and diff materialization. "Diff materialization" means producing a git patch string from repository state. The `git` module should continue to own that low-level repository work, but it must not own review comments, review decisions, review revisions, guided review semantics, or agent work orders.

The Changes tab lives at `apps/web/src/features/git/changes-panel.tsx`. Before this work, its Review button called `useBrowserPanelStore(s => s.openWorkspaceDiffTab)`, and file clicks opened the same BrowserPanel tab plus a scroll command. After the correction, Review and file clicks call `openWorkspaceDiffs`, which opens the route-level `workspace-diffs` surface.

The current raw diff viewer lives at `apps/web/src/features/browser/workspace-diff-viewer.tsx`. It calls `useGitDiff(workspaceId, repositoryPath, paths)` to fetch a patch string, parses the patch with `parsePatchFiles`, and renders it with `CodeView`. This file is browser-panel-owned today, but the renderer behavior should move behind a review-owned container. The low-level parsing helper can be extracted or duplicated narrowly during migration if that is the least risky path.

The browser panel store lives at `apps/web/src/store/browser-panel.ts`. It defines `BrowserWorkspaceDiffTab` with `kind: 'workspace-diff'`, an `openWorkspaceDiffTab` action, and scroll-to-file state for the legacy raw diff utility. Cradle Diffs does not add a new BrowserPanel tab kind. Its route-level surface identity lives in `apps/web/src/navigation/surface-identity.ts`, and its open command lives in `apps/web/src/navigation/navigation-commands.ts`.

The existing design research for the larger feature is in `docs/specs/linear-diffs/`. Although those files use the historical "Linear Diffs" name, this plan treats the user-facing product name as Cradle Diffs. The essential design from those specs is that Cradle Diffs owns stable review objects and immutable revisions, while reading facts from `git`, `workspace`, `issue`, `session`, and `agent` without writing lifecycle data into those namespaces.

Important terms:

- A review is a stable product object representing a set of changes a user can inspect. In this first slice it represents local working tree changes for one workspace repository.
- A revision is an immutable snapshot of a review at one point in time. In this first slice, it stores the exact patch string hash, file counts, additions, deletions, and file metadata for the current working tree patch.
- A source is where a review's changes come from. This plan implements only `local-working-tree`, meaning the user's current uncommitted git changes.
- A renderer is UI code that displays a patch. The renderer does not own review lifecycle semantics.

## Plan of Work

First, inspect the server module registration, database setup, and generated API conventions. The implementation should follow existing module patterns rather than inventing a parallel framework. Use Drizzle for any persistent data. If the repository currently has a generated API client workflow, update the server route first and regenerate client types with the existing command rather than hand-writing generated files.

Second, add a `diff-review` server module. The module should expose local working tree review operations scoped by `workspaceId` and optional `repositoryPath`. The initial API should be minimal and explicit: create or refresh a local working tree review, get a review detail with current revision and files, and optionally get the raw patch for the current revision if patch storage is not returned inline. The API must not perform git commits or staging. It may call the existing `git` service to read status and patch materialization. If the current git service does not expose enough metadata to compute file counts, additions, deletions, or file statuses, add a small exported helper to `apps/server/src/modules/git/service.ts` rather than duplicating repository resolution logic.

Third, add persistent schema for `diff-review` if the repository has an existing SQLite/Drizzle module pattern. The minimal persistent entities are a review row, a revision row, and file diff rows. For this first slice, it is acceptable for patch content to be stored as a text field on the revision if the repository has no artifact store. The review row should include workspace id, repository path, source kind `local-working-tree`, title, status, current revision id, and timestamps. The revision row should include review id, source version, patch hash, file count, additions, deletions, generated timestamp, and patch content or artifact reference. File rows should include revision id, path, previous path, status, additions, deletions, binary/generated flags if available, and viewed state defaulting false.

Fourth, add `apps/web/src/features/diff-review/` as the web owner. It should include a Cradle Diffs local review container hosted by a workspace route at `apps/web/src/routes/workspaces/$workspaceId/diffs.tsx`. The container should fetch or create the local working tree review, show a header with "Cradle Diffs", repository or branch context, file count, additions, deletions, refresh action, and a non-functional or disabled Commit Planner action if the UI needs to signal the future path. The main diff body should reuse the same `@pierre/diffs` parsing and `CodeView` rendering behavior from `WorkspaceDiffViewer`.

Fifth, migrate the Changes tab entrypoint. The Review button and file click behavior should open the Cradle Diffs workspace surface by calling `openWorkspaceDiffs`. Preserve scroll-to-file behavior by passing the file path in route search to the review-owned container, not by making Changes own diff rendering.

Sixth, keep the old `WorkspaceDiffViewer` path only if needed for compatibility with existing tests or other entrypoints during this slice. If retained, mark it as legacy in code comments only where helpful and route new Changes behavior through the review-owned container. Do not do unrelated UI rewrites.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Inspect current module and database conventions before editing:

    rg -n "drizzle|sqlite|schema|modules/.*/index|new Elysia|module" apps/server/src -g '*.ts'
    rg -n "openWorkspaceDiffTab|workspace-diff|BrowserWorkspaceDiffTab" apps/web/src/store apps/web/src/features -g '*.ts' -g '*.tsx'
    rg -n "react-query.gen|openapi|api-gen" package.json apps -g '*.json' -g '*.ts' -g '*.tsx'

Expected result: these searches should identify the server module registration file, the database schema location, generated API client workflow, and current browser panel tab model. Update this plan's Surprises & Discoveries if any of those locations differ from the assumptions above.

After inspection, implement server changes. Prefer files under:

    apps/server/src/modules/diff-review/index.ts
    apps/server/src/modules/diff-review/model.ts
    apps/server/src/modules/diff-review/service.ts

If the server uses central module registration, import and mount the new module there. If the server has capability docs, add a short capability document for `diff-review` that states ownership and non-ownership.

Then implement web changes. Prefer files under:

    apps/web/src/features/diff-review/cradle-diffs-viewer.tsx
    apps/web/src/routes/workspaces_.$workspaceId.diffs.tsx
    apps/web/src/navigation/surface-identity.ts
    apps/web/src/navigation/navigation-commands.ts

Update `apps/web/src/features/git/changes-panel.tsx` so Review opens Cradle Diffs through `openWorkspaceDiffs`. Do not add a Cradle Diffs BrowserPanel tab kind. Keep Tailwind classes static and use the repository's `cn` utility when combining classes.

Regenerate API clients if the repository has an established command. The command must be discovered from package scripts or existing docs before running. Do not hand-edit generated API files if a generator is present.

Run focused validation commands after each major area. The exact commands may change after inspecting package scripts, but prefer the narrowest commands that exercise the changed server and web packages. Record the exact commands and results in Artifacts and Notes.

## Validation and Acceptance

Acceptance is based on observable behavior, not just code structure.

After implementation, a user with a workspace containing git changes can open the Changes tab and click Review. The app opens a Cradle Diffs review surface, not the legacy raw workspace diff tab. The header says Cradle Diffs or Working Tree Review, shows the changed file count, and displays the current patch with split/unified diff rendering. Clicking a file in the Changes tab opens the same review surface and scrolls to that file when possible. Refreshing the review creates or updates the current local working tree revision without creating commits, staging files, or changing the working tree.

Server acceptance should include a direct API exercise if feasible. A successful create-or-refresh call for a workspace with changes should return a review id, current revision id, source kind `local-working-tree`, file count greater than zero, and a patch hash. A workspace with no changes should either return an empty review state or a clear no-changes response; choose one behavior and document it in the API model.

Validation commands must include type checking or focused tests for touched packages. If existing tests cover `changes-panel` and `browser-panel`, update them to assert that Changes calls the Cradle Diffs surface command and that BrowserPanel behavior remains legacy-only. Because repository instructions say not to add frontend tests casually, only update existing tests if they fail due to changed behavior or already cover the migrated entrypoint.

## Idempotence and Recovery

The create-or-refresh local working tree review operation must be idempotent for the same workspace, repository path, and unchanged patch. Calling it repeatedly should reuse the existing review and avoid creating duplicate revisions when the patch hash has not changed. When the patch changes, it should create a new immutable revision and point the review's current revision id to it.

No operation in this slice should stage files, commit files, write to the working tree, push to remotes, or write into issue/session/chat namespaces. If implementation fails halfway, rerun type checks and inspect the new `diff-review` rows. If schema migrations are added, follow the repository's migration recovery rules; do not delete user data manually.

The UI migration is retryable. If the new Cradle Diffs route fails to render, the old `WorkspaceDiffViewer` remains available for legacy BrowserPanel entrypoints, but new Changes entrypoints must target the review-owned workspace surface once the slice is complete.

## Artifacts and Notes

Initial evidence gathered before implementation:

    apps/web/src/features/browser/workspace-diff-viewer.tsx
      Uses parsePatchFiles from @pierre/diffs and CodeView from @pierre/diffs/react.

    apps/web/src/features/git/changes-panel.tsx
      Before this work, Review called openWorkspaceDiffTab and file clicks requested scroll-to-file on that BrowserPanel tab.

    apps/server/src/modules/git/service.ts
      getDiff returns a patch string generated from git diff HEAD plus no-index diffs for untracked files.

    apps/web/src/store/browser-panel.ts
      BrowserWorkspaceDiffTab currently uses kind 'workspace-diff' and ids like legacy-workspace-diff-N.

Corrected surface implementation note:

    apps/web/src/routes/workspaces_.$workspaceId.diffs.tsx
      Hosts CradleDiffsViewer as a workspace route and registers layout slots under workspace-diffs:$workspaceId.

    apps/web/src/navigation/navigation-commands.ts
      openWorkspaceDiffs syncs the workspace-diffs surface before router navigation.

    apps/web/src/features/git/changes-panel.tsx
      Review and changed-file clicks call openWorkspaceDiffs instead of BrowserPanel actions.

Implementation transcripts, validation outputs, and concise diffs must be added here as work proceeds.

Drizzle migration generation transcript:

    pnpm --filter @cradle/db generate
    Reading config file '/Users/wibus/dev/Cradle/packages/db/drizzle.config.ts'
    74 tables
    [✓] Your SQL migration file ➜ drizzle/0001_nostalgic_puppet_master.sql

Initial focused test failure and recovery note:

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    SqliteError: no such table: diff_reviews

The failure was caused by the test environment using a stale migration directory from `CRADLE_MIGRATIONS_DIR`. The test fixture now pins migrations to `packages/db/drizzle`.

Validation transcripts:

    pnpm --filter @cradle/server exec tsc --noEmit
    exit code 0

    pnpm --filter @cradle/web generate
    Done. Your output is in ./apps/web/src/api-gen

    pnpm --filter @cradle/web exec tsc --noEmit
    exit code 0

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files 1 passed
    Tests 1 passed

    NODE_ENV=test pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts src/store/browser-panel.test.ts src/features/browser/browser-panel.test.tsx
    Test Files 3 passed
    Tests 35 passed

Post-correction validation transcripts:

    pnpm --filter @cradle/web exec tsc --noEmit
    exit code 0

    NODE_ENV=test pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts src/store/browser-panel.test.ts src/features/browser/browser-panel.test.tsx
    Test Files 3 passed
    Tests 35 passed

    pnpm --filter @cradle/server exec tsc --noEmit
    exit code 0

    pnpm --filter @cradle/server exec vitest run tests/diff-review.test.ts
    Test Files 1 passed
    Tests 1 passed

## Interfaces and Dependencies

Use the existing `git` service as the source of repository facts and patch materialization. Do not call shell git commands directly from the new `diff-review` service unless a needed primitive does not exist and adding it to `git` would be more invasive than the slice warrants.

The server should expose models equivalent to these TypeScript shapes. Exact TypeBox syntax should match local module conventions:

    type DiffReviewSourceKind = 'local-working-tree'

    interface DiffReviewView {
      id: string
      workspaceId: string
      repositoryPath: string
      sourceKind: DiffReviewSourceKind
      title: string
      status: 'open' | 'abandoned'
      currentRevisionId: string | null
      createdAt: number
      updatedAt: number
      currentRevision: DiffRevisionView | null
      files: ReviewFileDiffView[]
    }

    interface DiffRevisionView {
      id: string
      reviewId: string
      sourceVersion: string
      patchHash: string
      fileCount: number
      additions: number
      deletions: number
      generatedAt: number
      patch: string
    }

    interface ReviewFileDiffView {
      id: string
      revisionId: string
      path: string
      previousPath: string | null
      status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
      additions: number
      deletions: number
      isGenerated: boolean
      isBinary: boolean
      isViewed: boolean
    }

The first endpoint should be equivalent to:

    POST /:workspaceId/diff-reviews/local-working-tree
      body: { repo?: string }
      response: DiffReviewView

The detail endpoint should be equivalent to:

    GET /:workspaceId/diff-reviews/:reviewId
      response: DiffReviewView

If existing route naming conventions require `/workspaces/:id/...` or another prefix, follow the existing convention and record the exact final path here.

The web feature should expose a component equivalent to:

    function CradleDiffsViewer(props: {
      workspaceId: string
      repositoryPath?: string | null
      initialPath?: string | null
      ownerId?: string | null
      tabId?: string
    }): JSX.Element

This component owns the review query, refresh action, header, file metadata, and diff rendering. It may call a lower-level patch renderer helper extracted from the current `WorkspaceDiffViewer`, but `browser-panel` must not own review semantics.

## Revision Notes

- 2026-06-16 13:32Z: Initial ExecPlan created to define the Cradle Diffs local working tree review slice before implementation, per user request.
- 2026-06-16 13:41Z: Recorded the Drizzle Kit migration workflow discovery and corrected the plan to require generated migrations through `@cradle/db`.
- 2026-06-16 13:47Z: Recorded the stale `CRADLE_MIGRATIONS_DIR` test environment discovery and the focused-test recovery.
- 2026-06-16 13:49Z: Recorded completed implementation, validation results, and the remaining deferred feature scope.
