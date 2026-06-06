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

