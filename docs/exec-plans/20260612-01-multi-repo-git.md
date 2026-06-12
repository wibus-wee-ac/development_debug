# Implement VS Code-style multi-repository Git support

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the ExecPlan rules read from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The plan is self-contained, records decisions as they are made, and must remain sufficient for a new contributor to continue from this file alone.

## Purpose / Big Picture

Cradle currently assumes each workspace path is itself one Git repository. If a user opens a directory that contains multiple independent Git repositories, such as a parent folder with two project subfolders, the right aside Changes panel can show `Git changes unavailable` even though each child folder is a valid repository. After this change, Cradle will behave more like VS Code source control: a workspace may contain zero, one, or many Git repositories; Git status, branches, graph, fetch, checkout, and diff operations are scoped to one discovered repository; and the web UI groups changes by repository instead of flattening or losing them.

The feature is visible when a workspace contains two child repositories. The user should see both repositories in the Git/Changes areas, each with its own branch and change count. Reviewing a file should open a diff for the correct repository and scroll to the correct file. CLI users should be able to run repository-aware commands such as `cradle workspace git repositories <workspaceId>` and `cradle workspace git status <workspaceId> --repo apps/web`.

## Progress

- [x] (2026-06-12 11:58Z) Read the ExecPlan rules and confirmed the plan must be self-contained, living, and stored under `docs/exec-plans/` without wrapping triple backticks.
- [x] (2026-06-12 11:58Z) Read `server-app-development` and `cli-app-development` rules. Server route/schema ownership stays in `apps/server/src/modules/git`, and generated CLI commands must come from OpenAPI `x-cradle-cli` metadata rather than manual edits under `packages/cli/src/commands/generated`.
- [x] (2026-06-12 11:58Z) Confirmed current Git server code uses `simpleGit(getWorkspacePath(workspaceId))`, which makes the workspace root the only Git repository.
- [x] (2026-06-12 11:58Z) Confirmed web consumers use a single workspace-level Git status through `apps/web/src/features/git/use-git.ts`, including Changes, Git panel, branch control, file tree badges, review slot, await panel, and diff viewer.
- [x] (2026-06-12 11:58Z) Confirmed the working tree already contains unrelated user changes. Do not revert them. Only touch files required for this Git capability.
- [x] (2026-06-12 12:08Z) Implemented server repository discovery, repository-scoped service operations, route schemas, route handlers, module README updates, and server tests.
- [x] (2026-06-12 12:31Z) Regenerated web API bindings and generated CLI commands from the server OpenAPI contract.
- [x] (2026-06-12 12:31Z) Updated web Git hooks, diff tab state, Changes panel, Git panel, branch control, file tree badge inputs, review slot, await panel, and diff viewer to use repository-aware data.
- [x] (2026-06-12 12:31Z) Ran focused validation commands and recorded outcomes here.

## Surprises & Discoveries

- Observation: The current server Git module is a workspace-root-only model.
  Evidence: `apps/server/src/modules/git/service.ts` defines `getGit(workspaceId)` as `simpleGit(getWorkspacePath(workspaceId))`.
- Observation: The UI impact is broader than the right aside Changes panel.
  Evidence: `rg` found `useGitStatus` and `useGitFileStatuses` consumers in `apps/web/src/features/git/git-branch-control.tsx`, `apps/web/src/features/git/git-panel.tsx`, `apps/web/src/features/workspace/file-tree.tsx`, `apps/web/src/features/chat/composer/composer-slots/review-slot-state.tsx`, and `apps/web/src/features/session-await/await-panel.tsx`.
- Observation: The current diff tab identity cannot distinguish repositories.
  Evidence: `apps/web/src/store/browser-panel.ts` defines `BrowserWorkspaceDiffTab` with `workspaceId` and optional `paths`, but no repository identity.
- Observation: Focused server Git tests pass after adding the multi-repo fixture, but test startup logs existing duplicate plugin registration noise.
  Evidence: `pnpm --filter @cradle/server exec vitest run tests/git.test.ts` reported `Test Files 1 passed (1)` and `Tests 4 passed (4)`, while logging `Duplicate MCP server registration: browser-use` during plugin activation.
- Observation: The installed/running `cradle` server in the local environment did not yet have the new route after code generation.
  Evidence: `cradle workspace git repositories "$CRADLE_WORKSPACE_ID" --format json` returned `Not Found`, while generated CLI help from the working tree shows `workspace git repositories`. This indicates the running server process was stale, not that the generated command is missing.

## Decision Log

- Decision: The Git module, not the workspace module and not the frontend, owns repository discovery and repository-scoped Git semantics.
  Rationale: Workspace owns workspace records and file access, while Git owns Git status, branches, remotes, graph, checkout, branch creation, fetch, merge-base, and diff semantics. This follows Cradle namespace ownership: a module may read another namespace, but should not write or reinterpret another namespace's data.
  Date/Author: 2026-06-12 / Codex
- Decision: A repository identity is `workspaceId` plus a workspace-relative `repositoryPath`. The root repository is represented as `.`.
  Rationale: This avoids a database table for discovered repositories, keeps identity stable across API/CLI/UI, and works for ordinary child repositories without writing metadata into user-owned Git directories.
  Date/Author: 2026-06-12 / Codex
- Decision: Git file status entries must carry both repo-relative `path` and workspace-relative `workspacePath`.
  Rationale: Git commands need paths relative to the repository root, while Cradle file open/reveal/rename and BrowserPanel scroll behavior operate on paths relative to the workspace root.
  Date/Author: 2026-06-12 / Codex
- Decision: Multi-repository UI should group by repository instead of flattening files into a single list.
  Rationale: Branch, fetch, checkout, and diff are repository-scoped. Flattening would hide ownership and make branch controls ambiguous.
  Date/Author: 2026-06-12 / Codex
- Decision: Do not add frontend tests unless the user asks. Add or update server tests for the route/service behavior because the risk and contract boundary are in the server capability.
  Rationale: The repository instruction explicitly says not to spend time writing frontend tests by default. Server route tests prove the new API behavior and prevent CLI/generated-client regressions.
  Date/Author: 2026-06-12 / Codex

## Outcomes & Retrospective

No implementation outcome yet. This section must be updated after each major milestone and at completion with what was achieved, what remains, and any validation gaps.

2026-06-12 12:08Z: Server milestone complete. The Git module now discovers repositories under a workspace, exposes `GET /workspaces/:id/git/repositories`, scopes status/branches/remotes/graph/diff/merge-base/fetch/checkout/create-branch by optional `repo`, requires `repo` for multi-repo workspaces, and returns file statuses with both repo-relative `path` and workspace-relative `workspacePath`. Focused Git tests and server typecheck pass.

2026-06-12 12:31Z: Full plan implemented. The generated web API and CLI now include the repository route and repo flags. The web Git feature now consumes repository summaries as the top-level source of truth; Changes and Git panels render multi-repository sections; diff tabs include repository identity; workspace file tree badges use workspace-relative `workspacePath`; branch picker mutations are repo-scoped; header branch control avoids showing a misleading single branch for multi-repo workspaces; review mode and GitHub await auto-detection only use Git metadata when exactly one repository is available. Server tests, server typecheck, CLI typecheck/help, and web typecheck pass. Frontend tests and browser automation were intentionally not run.

## Context and Orientation

Cradle is a TypeScript monorepo. The server lives under `apps/server`, the web renderer lives under `apps/web`, and the generated CLI lives under `packages/cli`. The server is an Elysia application: each capability module has route declarations in `index.ts`, TypeBox request/response schemas in `model.ts`, and behavior in `service.ts`. The Git capability is owned by `apps/server/src/modules/git`.

The current Git module exposes workspace-owned routes under `/workspaces/:id/git/*`. At the start of this plan, those routes are:

- `GET /workspaces/:id/git/status`
- `GET /workspaces/:id/git/branches`
- `GET /workspaces/:id/git/remotes`
- `GET /workspaces/:id/git/graph`
- `GET /workspaces/:id/git/merge-base`
- `POST /workspaces/:id/git/checkout`
- `POST /workspaces/:id/git/branches`
- `POST /workspaces/:id/git/fetch`
- `GET /workspaces/:id/git/diff`

The current web Git hooks are in `apps/web/src/features/git/use-git.ts`. They wrap generated TanStack Query options from `apps/web/src/api-gen/@tanstack/react-query.gen.ts`. These generated files are produced from the server OpenAPI document by running `pnpm --filter @cradle/web generate`.

The current CLI is generated from server OpenAPI route metadata. Routes with `detail['x-cradle-cli'].command` are projected into generated command modules under `packages/cli/src/commands/generated`. Do not edit generated CLI modules manually. Change server route metadata or the CLI generator/runtime and then run `pnpm gen:cli`.

A "workspace-relative path" means a path from the workspace root, such as `apps/web/src/main.tsx`. A "repo-relative path" means a path from a particular Git repository root, such as `src/main.tsx` if the repository root is `apps/web`. The root repository uses repositoryPath `.`; a nested repository uses a workspace-relative path such as `packages/plugin-sdk`.

## Plan of Work

First, update the server Git model. Add a `repo` query parameter schema for read routes and a `repo` body field for write routes. Add a repository summary schema that returns `path`, `name`, `absolutePath`, `branch`, `tracking`, `ahead`, `behind`, `isDetached`, and `files`. Update file status entries to include `workspacePath` while preserving `path` as repo-relative. Add a route `GET /workspaces/:id/git/repositories` with CLI metadata `['workspace', 'git', 'repositories']`. Existing status/branches/remotes/graph/diff/merge-base routes should accept `?repo=`. Existing checkout, create-branch, and fetch routes should accept a `repo` body field. For backward compatibility while the UI migrates, single-repository workspaces may omit `repo`; multi-repository workspaces should require it for repo-specific operations and should return a structured error such as `git_repository_required` when omitted.

Second, update `apps/server/src/modules/git/service.ts`. Replace workspace-root-only `getGit(workspaceId)` with helpers that resolve a repository root from the workspace path and optional `repo`. Discovery should walk the workspace tree looking for `.git` directories or files, skip expensive directories such as `.git`, `node_modules`, `.DS_Store`, `dist`, `build`, `.next`, `.turbo`, and `vendor`-style generated folders, and stop descending below a discovered repository root so nested project files do not create duplicate parent results. Use Node filesystem APIs and existing `simple-git`; do not invent a database-backed projection unless discovery proves too slow. The result should be sorted by repository path, with `.` first. For each discovered repository, collect status using existing normalization logic. Map repo-relative file paths to workspace-relative paths with a small helper that joins `repositoryPath` and `path` while keeping `.` invisible.

Third, update server tests in `apps/server/tests/git.test.ts`. Add a fixture where the workspace root is a plain directory containing two independent child repositories. Assert `GET /workspaces/:id/git/repositories` returns both children, status reports changes for each, `GET /workspaces/:id/git/status?repo=repo-a` works, omitting `repo` from a multi-repo workspace returns the expected structured error for repo-specific routes, and `GET /workspaces/:id/git/diff?repo=repo-a&paths=<repo-relative-file>` returns only that repository's diff.

Fourth, regenerate API and CLI artifacts. Run `pnpm --filter @cradle/web generate` to refresh web generated API files. Run `pnpm gen:cli` to refresh generated CLI commands. Inspect that `cradle workspace git repositories --help` exists and that `status`, `diff`, `graph`, and write commands show `--repo`.

Fifth, migrate web runtime code. In `apps/web/src/features/git/types.ts`, add generated types for repository summaries and repository-aware file statuses. In `apps/web/src/features/git/use-git.ts`, add `useGitRepositories(workspaceId)` and update existing hooks to accept `repositoryPath?: string | null`. Query keys must include `repo` when present. Provide helper selectors such as "default repository" only for single-repository workspaces.

Sixth, update BrowserPanel diff identity. In `apps/web/src/store/browser-panel.ts`, add `repositoryPath?: string` to `BrowserWorkspaceDiffTab` and to `openWorkspaceDiffTab` input. Include repositoryPath in tab reuse comparisons. In `apps/web/src/features/browser/browser-panel.tsx`, pass repositoryPath into `WorkspaceDiffViewer`. In `apps/web/src/features/browser/workspace-diff-viewer.tsx`, call `useGitDiff(workspaceId, repositoryPath, paths)` and keep scroll-to-file using the path that the diff viewer emits. If the diff viewer parses repo-relative paths, scroll requests from ChangesPanel must send repo-relative `path`, while file open/reveal still uses `workspacePath`.

Seventh, update the Changes panel. In `apps/web/src/features/git/changes-panel.tsx`, replace the single `useGitFileStatuses(workspaceId)` call with `useGitRepositories(workspaceId)`. For zero repositories, show a calm empty state such as `No Git repositories found`. For one repository, keep the current compact layout but pass the repository path to Review and diff operations. For multiple repositories, render repository sections with repo name/path, branch, change count, and a per-repo Review button. Within each repository, continue to support Type and Tree views. Each row should display the repo-relative file name/path, but actions that open or reveal a workspace file should use `workspacePath`. Use static Tailwind classes and `cn()` for conditional styling.

Eighth, update the Git panel and branch controls. In `apps/web/src/features/git/git-panel.tsx`, render a repository selector or stacked repository sections. Each repository should have its own branch picker, fetch button, and commit graph. In `apps/web/src/features/git/branch-picker.tsx`, pass repositoryPath through branch, fetch, checkout, and create branch calls. In `apps/web/src/features/git/git-branch-control.tsx`, show the single branch badge only when there is exactly one repository; when there are multiple repositories, show a compact `N repos`/change count indicator instead of a misleading single branch.

Ninth, update other consumers. `apps/web/src/features/workspace/file-tree.tsx` should use workspace-relative `workspacePath` for tree git badges. `apps/web/src/features/chat/composer/composer-slots/review-slot-state.tsx` and `apps/web/src/features/session-await/await-panel.tsx` should avoid assuming one workspace-level branch if multiple repositories exist. Prefer showing a multi-repo summary or requiring a selected repository rather than guessing.

Tenth, validate. Run server tests, server typecheck, generated API/CLI validation, and web typecheck. Do not run browser/E2E tests unless explicitly requested. Update this ExecPlan after each milestone with exact commands and outcomes.

## Concrete Steps

Work from repository root `/Users/wibus/dev/Cradle`.

1. Inspect current Git module and web consumers:

    rg -n "useGitStatus|useGitFileStatuses|openWorkspaceDiffTab|workspace-diff|/git/status|/git/diff" apps/server apps/web packages/cli -S

   Expected outcome: references in `apps/server/src/modules/git`, `apps/web/src/features/git`, `apps/web/src/features/browser`, `apps/web/src/features/workspace`, and generated API files.

2. Edit server files:

    apps/server/src/modules/git/model.ts
    apps/server/src/modules/git/service.ts
    apps/server/src/modules/git/index.ts
    apps/server/src/modules/git/README.md
    apps/server/tests/git.test.ts

   Expected outcome: tests can create multi-repo fixtures and repo-specific routes return structured JSON.

3. Run focused server validation:

    pnpm --filter @cradle/server exec vitest run apps/server/tests/git.test.ts
    pnpm typecheck:server

   If the first command path is wrong for Vitest's working directory, retry with:

    pnpm --filter @cradle/server exec vitest run tests/git.test.ts

   Expected outcome: Git tests pass and server typecheck succeeds. If unrelated dirty-worktree files block typecheck, record the exact errors here and continue with narrower validation.

4. Regenerate generated artifacts:

    pnpm --filter @cradle/web generate
    pnpm gen:cli

   Expected outcome: generated web API files expose repository routes and `repo` query/body fields; generated CLI exposes `workspace git repositories` and `--repo` flags.

5. Validate generated CLI:

    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/cli cradle workspace git --help
    pnpm --filter @cradle/cli cradle workspace git repositories --help

   Expected outcome: typecheck succeeds and help output lists the intended commands.

6. Edit web files:

    apps/web/src/features/git/types.ts
    apps/web/src/features/git/use-git.ts
    apps/web/src/features/git/changes-panel.tsx
    apps/web/src/features/git/git-panel.tsx
    apps/web/src/features/git/git-branch-control.tsx
    apps/web/src/features/git/branch-picker.tsx
    apps/web/src/features/workspace/file-tree.tsx
    apps/web/src/features/browser/workspace-diff-viewer.tsx
    apps/web/src/features/browser/browser-panel.tsx
    apps/web/src/store/browser-panel.ts
    apps/web/src/features/chat/composer/composer-slots/review-slot-state.tsx
    apps/web/src/features/session-await/await-panel.tsx

   Expected outcome: no consumer assumes one workspace-level Git repository in multi-repo cases.

7. Run web validation:

    pnpm typecheck:apps-web

   Expected outcome: web typecheck succeeds. Frontend tests and browser automation are intentionally skipped unless requested.

8. Optionally exercise the server manually with a temporary workspace containing two repos:

    cradle workspace git repositories "$CRADLE_WORKSPACE_ID" --format json

   Expected outcome in a multi-repo workspace: JSON array of repository summaries. In this Cradle repo workspace, which is currently a single root repository, the command should return one repository with `path` equal to `.`.

## Validation and Acceptance

Acceptance for the server: `GET /workspaces/:id/git/repositories` returns every discovered repository in a workspace, including child repositories when the workspace root is not a repository. Repo-specific status and diff routes accept `repo` and return data only for that repo. Multi-repo workspaces return a structured error if a repo-specific command omits `repo`.

Acceptance for the CLI: `cradle workspace git repositories <workspaceId> --format json` works, and existing commands such as `cradle workspace git status <workspaceId> --repo <repositoryPath> --format json` work. Help output should show `repositories` under `workspace git` and `--repo` on repo-specific commands.

Acceptance for the web UI: the Changes panel no longer shows `Git changes unavailable` merely because the selected workspace root contains multiple child repositories. It shows repositories as separate sections, with per-repo branch and change counts. Clicking Review opens a repository-scoped diff. Clicking one changed file scrolls to the correct diff item. The Git panel and header branch control do not present one branch as if it represented the whole workspace when multiple repositories exist.

Required validation commands before completion:

    pnpm --filter @cradle/server exec vitest run tests/git.test.ts
    pnpm typecheck:server
    pnpm --filter @cradle/web generate
    pnpm gen:cli
    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/cli cradle workspace git --help
    pnpm typecheck:apps-web

## Idempotence and Recovery

All implementation steps are source edits and generated artifact refreshes. Re-running tests and generation commands is safe. If generated files change unexpectedly outside Git/API/CLI surfaces, inspect the generated diff before keeping it. Do not manually edit generated CLI files under `packages/cli/src/commands/generated`; regenerate them from server OpenAPI. Do not revert unrelated dirty worktree files. If a server route change breaks generated clients, fix the server TypeBox schemas first, then regenerate.

Repository discovery reads user workspace directories but does not write into them. Branch checkout, branch creation, and fetch are existing write-like Git operations; after this change they must target an explicit repository in multi-repo workspaces to avoid acting on the wrong repository.

## Artifacts and Notes

Initial workspace inspection showed unrelated dirty files before this work began:

    M apps/desktop/electron.vite.config.ts
    M apps/desktop/package.json
    M apps/desktop/src/main/native-services.ts
    M apps/server/src/modules/chat-runtime/service.ts
    M apps/server/tests/chat-runtime.test.ts
    M apps/web/src/app-shell.tsx
    M apps/web/src/components/layout/app-layout.tsx
    M apps/web/src/features/agent-management/agent-runtime-settings.tsx
    M apps/web/src/features/browser/browser-annotation-adjustment-panel.tsx
    M apps/web/src/features/browser/browser-panel.tsx
    M apps/web/src/features/chat/composer/appshot-attachment-model.ts
    M apps/web/src/features/onboarding/onboarding-page.tsx
    M apps/web/src/features/tui/shell-view.tsx
    M apps/web/src/locales/default/agent-management.ts
    M apps/web/src/locales/en-US/agentManagement.json
    M apps/web/src/locales/es-ES/agentManagement.json
    M apps/web/src/locales/ja-JP/agentManagement.json
    M apps/web/src/locales/zh-CN/agentManagement.json
    M apps/web/src/main.tsx
    M apps/web/src/navigation/surface-resource-lifecycle.ts
    M pnpm-lock.yaml
    M resources/system-workflow.md
    ?? apps/web/src/features/browser/browser-color-palette.tsx

Keep future notes here short and evidence-based.

Server validation after the first implementation milestone:

    pnpm --filter @cradle/server exec vitest run tests/git.test.ts
    Test Files  1 passed (1)
    Tests       4 passed (4)

    pnpm typecheck:server
    $ pnpm --filter @cradle/server exec tsc --noEmit

Generated API and CLI validation:

    pnpm --filter @cradle/web generate
    @hey-api/openapi-ts v0.97.1
    Done! Your output is in ./apps/web/src/api-gen

    pnpm gen:cli
    Generated 221 CLI commands
    Updated SKILL.md with 21 modules

    pnpm --filter @cradle/cli typecheck
    $ tsc --noEmit

    pnpm --filter @cradle/cli cradle workspace git --help
    Commands:
      branch
      branches [options] <id>
      checkout [options] <id>
      diff [options] <id>
      fetch [options] <id>
      graph [options] <id>
      repositories [options] <id>
      status [options] <id>

    pnpm --filter @cradle/cli cradle workspace git status --help
    Options include --repo <value>

    pnpm --filter @cradle/cli cradle workspace git fetch --help
    Options include --repo <value>

Web validation:

    pnpm typecheck:apps-web
    $ pnpm --filter @cradle/web exec tsc --noEmit

Manual current-server check:

    cradle workspace git repositories "$CRADLE_WORKSPACE_ID" --format json
    Not Found

This manual command used the currently running Cradle server, which had not been restarted with the new route. Generated CLI help and server tests validated the working tree implementation.

## Interfaces and Dependencies

Use existing dependencies and APIs:

- `simple-git` for Git status, branches, remotes, graph, checkout, branch creation, and fetch.
- Node `fs` and `path` modules for repository discovery.
- Elysia and TypeBox `t` schemas in `apps/server/src/modules/git/model.ts` for HTTP contracts.
- Server OpenAPI `x-cradle-cli` metadata for generated CLI commands.
- TanStack Query generated helpers in `apps/web/src/api-gen/@tanstack/react-query.gen.ts`.
- Zustand store `apps/web/src/store/browser-panel.ts` for BrowserPanel tab identity.
- Existing `cn()` utility from `~/lib/cn` for conditional Tailwind classes.
- Existing workspace file menu helpers for open/reveal/rename/create operations in the Changes tree.

The end-state server interfaces should include these shapes:

    interface GitRepositoryView {
      path: string
      name: string
      absolutePath: string
      branch: string
      tracking: string | null
      ahead: number
      behind: number
      isDetached: boolean
      files: GitFileStatusView[]
    }

    interface GitFileStatusView {
      path: string
      workspacePath: string
      status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
    }

    interface GitStatusView {
      repositoryPath: string
      repositoryName: string
      branch: string
      tracking: string | null
      ahead: number
      behind: number
      isDetached: boolean
      files: GitFileStatusView[]
    }

The end-state web diff tab interface should include repository identity:

    interface BrowserWorkspaceDiffTab {
      kind: 'workspace-diff'
      id: string
      workspaceId: string
      repositoryPath?: string
      paths?: string[]
      title: string
      loading: false
      favicon: null
    }

Revision note, 2026-06-12 11:58Z: Initial plan created after confirming current single-repository assumptions and the intended repository-scoped design.

Revision note, 2026-06-12 12:08Z: Updated after completing and validating the server Git repository discovery and repo-scoped operation milestone.

Revision note, 2026-06-12 12:31Z: Updated after completing generated API/CLI and web repository-aware UI migration, recording final validation outcomes and the stale-running-server manual check.
