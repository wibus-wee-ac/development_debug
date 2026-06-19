# Linear Diffs Feature Coverage Matrix

本文把 Linear Diffs 已有特性和 Cradle 预案特性拆成可审计 feature matrix。它用于确认 SPEC 覆盖范围，不替代 `cradle-diff-review-spec.md`。

## Coverage Legend

- `Reuse`: Cradle 已有能力可直接作为底层基础。
- `Move`: Cradle 已有 UI/能力需要迁移到正确 owner。
- `Build`: 需要新建 capability。
- `Defer`: 有价值但不属于第一阶段。

## Existing Linear Features To Cover

| Linear capability | Observed behavior | Cradle target | Action |
| --- | --- | --- | --- |
| Reviews sidebar | Shows PRs needing attention, authored PRs, participated reviews | `diff-review` review list grouped by attention, author, source, issue | Build |
| GitHub code access | Requires GitHub integration repository code permissions | Source readiness model and GitHub adapter auth checks | Build |
| Personal GitHub connection | Required for user-specific PR/code/review access | User connection state exposed by source adapter | Build |
| PR detail surface | Details, activity, CI checks, comments, files | Review detail header, activity feed, check summary, file rail | Build |
| Changed files | File list and diffs in review page | `diff_review_files` plus `@pierre/diffs` renderer | Move |
| Split/unified diff | Toggle and shortcut, split unavailable on narrow screens | Review display options with responsive split fallback | Reuse |
| Inline comments | Threads beside relevant code, replies, emoji reactions | Anchored threads, comments, reactions in `diff-review` namespace | Build |
| Submit review | Approve, request changes, comment | `diff_review_submissions` and outbound adapter operation | Build |
| PR status sync | Comments, approvals, PR status up to date with GitHub | Adapter refresh and idempotent outbound operations | Build |
| Merge from review | Merge PR when ready and permitted | GitHub adapter operation with explicit permission state | Defer |
| Guided reviews | Guide tab, semantic sections, purpose and impact explanations | `ReviewGuide` graph with rationale and linked file ranges | Build |
| Guide generation toggle | Controlled in GitHub integration settings | Source adapter capability flag and review preference | Build |
| Structural highlighting | Reduce formatting-only noise | Structural analysis over immutable raw patch | Build |
| Notifications | PR activity modes, bot filtering | Review event stream and user notification preferences | Build |
| Code theme settings | Theme, font size, line height | Review display preferences | Build |
| Preview links | PR preview links appear on issue | Separate preview-link owner, displayed read-only in review | Defer |
| Open PR URL in Linear | `linear.review/owner/repo/pull/123` redirect | Deep link resolver for external PR sources | Defer |

## Current Cradle Features To Reuse Or Move

| Current Cradle capability | Current owner/file | Target role | Action |
| --- | --- | --- | --- |
| Workspace patch rendering | `apps/web/src/features/browser/workspace-diff-viewer.tsx` | Renderer container for `diff-review` revisions | Move |
| Diff parser/renderer | `@pierre/diffs`, `@pierre/diffs/react` | Low-level diff parsing and virtualized code view | Reuse |
| Changes panel entrypoint | `apps/web/src/features/git/changes-panel.tsx` | Creates/opens local working tree review | Move |
| Chat file edit preview | `apps/web/src/features/chat/blocks/edit-file-block.tsx` | Optional "open as review" source candidate | Reuse |
| Tool diff payload parsing | `apps/web/src/features/chat/blocks/tool-call-block.tsx` | Candidate agent change-set source extraction | Reuse |
| Git status and diff | `apps/server/src/modules/git/service.ts` | Repository facts and patch materialization | Reuse |
| Browser panel tabs | `apps/web/src/features/browser/browser-panel.tsx` | Host for review detail tabs only | Reuse |
| Issue context | `apps/server/src/modules/issue` and web kanban | Read-only issue refs in review | Reuse |
| Agent sessions | `chat-runtime` and providers | Agent fix loop execution | Reuse |

## Planned Cradle Features

| Planned capability | Owner | Technical standard |
| --- | --- | --- |
| Review lifecycle | `diff-review` | Immutable revisions, mutable review state, workspace-scoped APIs |
| Source adapters | `diff-review` plus adapter modules | Normalize source facts; adapters do not write lifecycle rows |
| Anchor remapping | `diff-review` | Exact line hash, hunk context, fuzzy search, stale fallback |
| Review operations | `diff-review` | Persist outbound operation before remote side effect |
| Agent fix loop | `diff-review` | Work order links thread/range to session/run/artifact |
| Guided review | `diff-review` | Rationale-bearing ordered graph, direct links to file ranges |
| Structural diff | `diff-review` | Reversible analysis layer, raw patch always preserved |
| Notification preferences | `diff-review` | Per-user mode and bot filtering |
| Code display preferences | `diff-review` | Per-user theme, font size, line height, layout |
| GitHub PR adapter | `review-source-github` | Code access checks, refresh authoritative, webhook hints |

## First Architecture-Correct Slice

1. Build `diff-review` local working tree source using existing `git` patch materialization.
2. Persist `DiffReview`, immutable `DiffRevision`, and `ReviewFileDiff`.
3. Move current workspace diff rendering behind a review-owned container.
4. Let Changes panel create/open the local review.
5. Add viewed state and split/unified preferences.

This slice avoids remote auth, comments, and agent execution while proving the owner boundary and renderer migration.

## Current Implementation Status

This matrix is a specification coverage checklist, not a completed-feature checklist. As of the current local implementation, Cradle Diffs has a local working-tree review lifecycle, generated-file classification/collapse, and explicit agent-fix start/cancel/rerun/artifact controls backed by Chat Runtime. It still does not perform remote GitHub review sync or extract rich provider-native artifacts beyond final assistant output.

| Scope item | Status | Notes |
| --- | --- | --- |
| `diff-review` local working tree source | Done | Server module creates or refreshes a workspace-scoped local review from existing `git` status and diff materialization. |
| `diff-review` local branch compare source | Done | Server module creates or refreshes `local-branch-compare` reviews from existing `git` branch compare facts without checkout, and Cradle Diffs has a minimal base/head compare opener. |
| `diff-review` local commit source | Done | Server module creates or refreshes `local-commit` reviews from a commit ref, stores the resolved commit SHA as source identity, and Cradle Diffs has API/CLI/web entrypoints for opening a commit review. |
| `DiffReview`, immutable `DiffRevision`, `ReviewFileDiff` persistence | Done | Drizzle schema and migration exist for review, revision, and file rows. |
| Review-owned diff container | Done | `features/diff-review/cradle-diffs-viewer.tsx` renders review revisions with `@pierre/diffs`. |
| Changes panel opens local review | Done | Changes actions open the `workspace-diffs` surface at `/workspaces/$workspaceId/diffs`. |
| Independent Cradle Diffs surface | Done | Route is `routes/workspaces_.$workspaceId.diffs.tsx`, intentionally non-nested under workspace detail. |
| Split/unified display toggle | Done | UI toggle persists through `diff_review_preferences`; narrow layout hides rails and keeps the main diff usable. |
| Viewed file state | Done | `diff_review_file_view_state` persists per local user/review/revision/file and the file rail projects viewed status. |
| Review sidebar / inbox | Partial | Cradle Diffs left rail now has attention/authored/participated/all tabs, source/status grouping, review counts, and review meta from `diff-review` lifecycle data. Issue/requester grouping and failed-check grouping wait for issue refs and GitHub/check adapters. |
| GitHub source adapter and auth readiness | Partial | Source readiness API returns explicit local ready states for working tree and branch compare, plus GitHub integration missing state. No GitHub adapter, code access check, personal connection check, or webhook refresh exists. |
| PR detail metadata | Partial | Review detail has header, file rail, activity, threads, and agent rail. It does not have remote PR CI checks, GitHub activity metadata, or semantic guided review content. |
| Inline comments and reactions | Partial | Local threads, comments, resolve, and reaction persistence exist. Threads can now be anchored from click/drag same-side base/head diff selections, persist typed range anchors, and remap by exact line hash, hunk/context, or conservative fuzzy same-file matching. Cross-side range UX is not complete. |
| Submit review operations | Partial | Local approve/request-changes/comment submissions persist with `local-only` sync state. Remote outbound operations are not implemented. |
| Guided review | Partial | Backend generation now persists revision-scoped guide steps from `runtime.quickQuestion` for Codex/Claude Agent runtimes with explicit unsupported-provider errors. Frontend guide authoring/refresh UX, range-level links, and quality/eval loops are not complete. |
| Structural diff | Partial | The `hideWhitespaceOnly` preference now suppresses whitespace-only file changes in the Cradle Diffs rail and renderer using `@pierre/diffs` parsed metadata while preserving raw patches. Review files are also deterministically classified as generated from paths such as `api-gen`, `drizzle`, `dist`, lockfiles, snapshots, and `.gen.*` outputs, and the `collapseGeneratedFiles` preference hides those files from the rail and renderer. AST/semantic structural highlighting is not implemented yet. |
| Notifications and review preferences | Partial | Events and display preferences persist locally. Notification delivery and bot filtering are not implemented. |
| Agent fix loop | Partial | Review-owned agent fix work orders persist and show in UI. Pending work orders can start real chat-runtime sessions/runs through an explicit start operation, running work orders can be cancelled, and terminal work orders can be rerun with fresh session/run links. Completed runs refresh the review source, link to the resulting review revision, record a content-addressed artifact id from final assistant output, and expose the artifact through web/API/CLI. Rich provider-native artifacts and richer agent selection remain incomplete. |
| Commit Planner / AI Commit | Partial | Rule-based draft commit plans persist in `diff_review_commit_plans`, expose grouped/single planning APIs, render in the Cradle Diffs Commit rail, support manual edits to messages/rationale/status with server-side file/dependency validation, and can apply accepted local working-tree plans as native git commits with idempotent operation records. LLM grouping, remote/source-adapter apply, and richer commit staging controls are not implemented. |
| Agent CLI surface | Done | Generated `cradle workspace diffs ...` commands expose local review creation/list/get/refresh, commit review creation, viewed state, threads/comments/reactions/resolve, submissions, preferences, readiness, agent fix work order create/start/cancel/rerun/artifact retrieval, and commit plan create/update/apply from the server OpenAPI contract. |
