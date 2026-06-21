# Cradle Diff Review SPEC

## Direct Conclusion

Cradle 应把 Linear Diffs 类能力设计为独立的 `diff-review` product capability，而不是把现有 `git` diff viewer 扩写成更多按钮。目标是：一个 workspace-first、issue-aware、agent-native 的 code review surface，能同时覆盖本地 working tree、agent branch、GitHub pull request、未来外部 review source，并以统一 review lifecycle 管理 comments、approvals、guided review、agent fix loop、notifications 和 code display preferences。

本 SPEC 允许脱离现有历史债务做架构升级。现有 `WorkspaceDiffViewer`、`ChangesPanel`、chat tool diff preview 可以迁移为 renderer / entrypoint，但不能继续作为语义 owner。

## Goals

- 在 Cradle 内提供完整 diff review experience：review list、diff detail、file navigation、inline comments、review submit、approve/request changes/comment、resolved threads、viewed files、review state。
- 支持多个 source：local working tree、local branch comparison、local commit、agent-produced change set、GitHub PR、future external imported review。
- 支持 review attention views：需要我关注、我创建、我参与、全部 source reviews。
- 让 issue context、agent context、workspace context 和 diff context 在同一个 review surface 中可见，但保持 namespace ownership 清晰。
- 提供 agent-native feedback loop：从 diff range 或 review thread 创建 agent fix request，并能把 agent result 关联回 review thread / revision。
- 提供 semantic guided review：按意图、模块、dependency order、risk order 引导审阅，而不是只按 file path。
- 提供 structural highlighting：隐藏或降噪 formatting-only changes，保留可恢复的原始 patch。
- 保留 `@pierre/diffs` 作为 renderer/parser 基础，不发明新的低层 diff UI library。
- 所有 API 以 `workspaceId`、`reviewId`、`revisionId` 为入口，客户端不直接接触绝对路径。

## Non-Goals

- 不在第一阶段实现完整 GitHub replacement。
- 不把 GitHub draft review state 做成强一致同步；Linear 文档也确认 draft review sync 有限制。
- 不把 merge PR 作为第一阶段目标；merge 是 source adapter 的高风险 outbound operation，必须等 review lifecycle 和 permission model 稳定。
- 不在 `git` module 中写 review lifecycle 数据。
- 不在 `issue` module 中写 PR/diff lifecycle 数据；issue 只可被引用或读出。
- 不自研通用 diff parser / renderer，除非现有库无法满足必须的 semantic model。
- 不把 chat tool output preview 等同于 review lifecycle；chat preview 只是 review source 的一种候选输入。

## Ownership And Namespaces

### `diff-review`

Owns:

- Review identity and lifecycle.
- Review source binding.
- Diff revisions and immutable file snapshots.
- Review threads, comments, ranges, resolved state.
- Review submissions and decisions.
- Viewed file state.
- Guided review graph and semantic grouping.
- Review notification preferences.
- Source capability and access readiness state.
- Merge intent records when a remote adapter supports merge.
- Agent fix work orders initiated from review context.
- Display preferences that are specific to review surfaces.

Reads:

- `workspace`: workspace root, path-safe file access, workspace metadata.
- `git`: repository facts, patch materialization, branch comparison, remotes, commit metadata.
- `issue`: issue title/status/assignee/labels only as context.
- `session` / `chat-runtime`: agent session state and transcript references.
- `provider-runtime` / `agent`: agent profiles and capabilities.
- `secrets`: GitHub token references only through integration adapter.

Must not write:

- `workspace` file data except through explicit agent/user actions owned by workspace/git commands.
- `issue` records except through future issue-owned automation API.
- GitHub state except through `review-source-github` adapter with explicit outbound operation records.

### `git`

Owns local repository operations and facts:

- Status, branches, graph, remotes.
- Patch generation for local source types.
- Branch compare and merge-base facts.
- Optional low-level apply/checkout operations.

Does not own:

- Review comments.
- Approval state.
- Review notification policy.
- Guided review semantics.
- Agent feedback loop.

### `browser-panel`

Owns only mixed right-side panel hosting. It may render `diff-review` tab content but must not own review data or lifecycle semantics.

### `chat`

Owns chat transcript and tool part rendering. Chat may open a `diff-review` entrypoint or attach a review context item, but review comments and review decisions belong to `diff-review`.

## Conceptual Model

### Review Source

A review source describes where a diff comes from and which adapter can refresh it.

```ts
type ReviewSourceKind =
  | 'local-working-tree'
  | 'local-branch-compare'
  | 'local-commit'
  | 'agent-change-set'
  | 'github-pull-request'
  | 'external-import'

interface ReviewSource {
  id: string
  kind: ReviewSourceKind
  workspaceId: string
  ownerNamespace: 'diff-review'
  binding: unknown
  refreshPolicy: 'manual' | 'webhook' | 'watch-worktree' | 'session-event'
}
```

Binding examples:

- `local-working-tree`: `{ baseRef?: string | null, includeUntracked: boolean }`
- `local-branch-compare`: `{ baseRef: string, headRef: string, mergeBaseSha?: string | null }`
- `local-commit`: `{ repositoryPath: string, commitSha: string }`
- `agent-change-set`: `{ sessionId: string, runId?: string | null, artifactId?: string | null }`
- `github-pull-request`: `{ owner: string, repo: string, pullNumber: number, providerAccountId: string }`
- `external-import`: `{ sourceName: string, externalUrl?: string | null }`

### Review

The review is the stable product object. A review can have multiple revisions as the source updates.

```ts
interface DiffReview {
  id: string
  workspaceId: string
  sourceId: string
  title: string
  status: 'open' | 'merged' | 'closed' | 'abandoned'
  reviewState: 'unreviewed' | 'in-review' | 'changes-requested' | 'approved' | 'commented'
  issueRefs: Array<{ issueId: string, relation: 'resolves' | 'related' | 'unknown' }>
  currentRevisionId: string | null
  createdAt: number
  updatedAt: number
}
```

### Revision

A revision is immutable. It captures the exact patch and metadata used for comments, guided review, and agent tasks.

```ts
interface DiffRevision {
  id: string
  reviewId: string
  sourceVersion: string
  baseSha: string | null
  headSha: string | null
  patchHash: string
  fileCount: number
  additions: number
  deletions: number
  generatedAt: number
  materialization: {
    patchArtifactId: string
    fileSnapshotManifestId?: string | null
  }
}
```

`sourceVersion` examples:

- local working tree: hash of `git status --porcelain=v2` plus patch hash.
- branch compare: `${baseSha}...${headSha}`.
- local commit: `${parentSha ?? 'root'}..${commitSha}` plus patch hash.
- GitHub PR: latest head sha plus PR updated timestamp or ETag.
- agent change set: session run output artifact id plus patch hash.

### File Diff

```ts
interface ReviewFileDiff {
  id: string
  revisionId: string
  path: string
  previousPath: string | null
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  language: string | null
  additions: number
  deletions: number
  isGenerated: boolean
  isBinary: boolean
  isViewed: boolean
  riskLevel: 'low' | 'medium' | 'high' | 'unknown'
}
```

### Anchored Range

Comments must not depend only on current line numbers. They need stable anchors.

```ts
interface ReviewRangeAnchor {
  revisionId: string
  fileId: string
  side: 'base' | 'head'
  startLine: number
  endLine: number
  startColumn?: number
  endColumn?: number
  hunkHeader: string
  lineHash: string
  contextBeforeHash?: string
  contextAfterHash?: string
}
```

When a new revision arrives, anchors are re-mapped by:

1. exact file path and line hash;
2. hunk header plus surrounding context hash;
3. fuzzy intra-file search;
4. unresolved stale state requiring human attention.

### Thread And Comment

```ts
interface ReviewThread {
  id: string
  reviewId: string
  originalRevisionId: string
  currentRevisionId: string | null
  fileId: string | null
  anchor: ReviewRangeAnchor | null
  state: 'open' | 'resolved' | 'stale'
  createdBy: string
  createdAt: number
  resolvedBy?: string | null
  resolvedAt?: number | null
}

interface ReviewComment {
  id: string
  threadId: string
  authorKind: 'user' | 'agent' | 'external'
  authorId: string
  bodyMarkdown: string
  externalUrl?: string | null
  createdAt: number
  updatedAt: number
}
```

### Review Submission

```ts
interface ReviewSubmission {
  id: string
  reviewId: string
  revisionId: string
  actorId: string
  decision: 'approve' | 'request-changes' | 'comment'
  bodyMarkdown?: string
  submittedAt: number
  sourceSyncState: 'local-only' | 'pending' | 'synced' | 'failed'
}
```

## Source Adapter Standard

Every source adapter implements the same contract:

```ts
interface ReviewSourceAdapter {
  kind: ReviewSourceKind
  refresh(input: RefreshReviewSourceInput): Promise<RefreshReviewSourceResult>
  listEvents(input: ListReviewSourceEventsInput): Promise<ReviewSourceEvent[]>
  submitReview?(input: SubmitReviewInput): Promise<SubmitReviewResult>
  createThread?(input: CreateReviewThreadInput): Promise<CreateReviewThreadResult>
  resolveThread?(input: ResolveReviewThreadInput): Promise<ResolveReviewThreadResult>
}
```

Adapter rules:

- Adapters return normalized source facts and outbound operation results.
- Adapters do not write `diff-review` database rows directly.
- `diff-review` owns idempotency, lifecycle transitions, persistence, and event emission.
- Remote adapters must persist outbound operation records before side effects.
- Webhook events are hints; refresh is authoritative.

## API Design

All paths are examples and should be implemented under the server module that owns OpenAPI metadata.

### Review Collection

- `GET /workspaces/:workspaceId/diff-reviews`
- `POST /workspaces/:workspaceId/diff-reviews`
- `GET /workspaces/:workspaceId/diff-reviews/:reviewId`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/refresh`
- `GET /workspaces/:workspaceId/diff-reviews/source-readiness`

Create payload:

```ts
interface CreateDiffReviewRequest {
  source: ReviewSource
  title?: string
  issueRefs?: Array<{ issueId: string, relation: 'resolves' | 'related' | 'unknown' }>
}
```

### Revision And Files

- `GET /workspaces/:workspaceId/diff-reviews/:reviewId/revisions`
- `GET /workspaces/:workspaceId/diff-reviews/:reviewId/revisions/:revisionId/files`
- `GET /workspaces/:workspaceId/diff-reviews/:reviewId/revisions/:revisionId/patch`
- `GET /workspaces/:workspaceId/diff-reviews/:reviewId/revisions/:revisionId/guide`

### Threads And Submissions

- `GET /workspaces/:workspaceId/diff-reviews/:reviewId/threads`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/threads`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/threads/:threadId/comments`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/threads/:threadId/reactions`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/threads/:threadId/resolve`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/submit`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/files/:fileId/viewed`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/merge`

### Agent Fix Loop

- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/agent-fixes`
- `GET /workspaces/:workspaceId/diff-reviews/:reviewId/agent-fixes`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/agent-fixes/:agentFixId/start`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/agent-fixes/:agentFixId/cancel`
- `POST /workspaces/:workspaceId/diff-reviews/:reviewId/agent-fixes/:agentFixId/rerun`
- `GET /workspaces/:workspaceId/diff-reviews/:reviewId/agent-fixes/:agentFixId/artifact`
- `DELETE /workspaces/:workspaceId/diff-reviews/:reviewId/agent-fixes/:agentFixId`

```ts
interface CreateReviewAgentFixRequest {
  threadId?: string
  anchor?: ReviewRangeAnchor
  instruction: string
  // The owning agent id. The agent's own config supplies provider target,
  // model, runtime kind, and thinking effort; callers must not pick those
  // again here. Stored in `diff_review_agent_fixes.profile_id` (text) — the
  // column is kept under its legacy name for compatibility, but semantically
  // holds an agent id.
  agentId?: string
  expectedOutput: 'commit' | 'working-tree-change' | 'patch-artifact'
}

interface StartReviewAgentFixRequest {
  // Optional override. When omitted, the server reuses the agent stored on the
  // work order at create time. Callers may switch agents between runs.
  agentId?: string
  // Kept for spec completeness, but the agent-native path does not need it.
  providerTargetId?: string
  modelId?: string
}
```

The agent fix creates a `diff-review` work order and may start a chat/session through existing runtime APIs. The review keeps the authoritative relation between feedback and produced revision.

Work order lifecycle is `pending → running → completed | failed | cancelled`. Only `completed`, `failed`, and `cancelled` work orders may be deleted — `pending` must be started or cancelled, `running` must be cancelled first. Delete is a hard row removal from `diff_review_agent_fixes`; the `agent_fix_deleted` event records the previous status so the audit trail keeps the work order's terminal outcome even after the row is gone.

### Source Readiness

Remote source readiness is explicit UI/API state, not a hidden adapter error.

```ts
interface ReviewSourceReadiness {
  sourceKind: ReviewSourceKind
  workspaceId: string
  state:
    | 'ready'
    | 'workspace-integration-missing'
    | 'repository-code-access-missing'
    | 'personal-connection-missing'
    | 'permission-insufficient'
  actions: Array<{
    label: string
    url?: string
    ownerKind: 'workspace-admin' | 'github-org-owner' | 'current-user'
  }>
}
```

For GitHub PR sources, readiness must model both workspace-level code access and personal GitHub connection. This follows the Linear Docs distinction between repository code access and user-specific review/code access.

## Database Design

Use Drizzle. Table names use `diff_review_*` prefix to keep ownership explicit.

Candidate tables:

- `diff_review_sources`
- `diff_reviews`
- `diff_review_revisions`
- `diff_review_files`
- `diff_review_threads`
- `diff_review_comments`
- `diff_review_submissions`
- `diff_review_file_view_state`
- `diff_review_agent_fixes`
- `diff_review_source_operations`
- `diff_review_source_readiness_cache`
- `diff_review_preferences`
- `diff_review_events`

Important invariants:

- `diff_review_revisions` rows are immutable after creation except derived analysis status fields.
- Comments reference immutable original revision and remapped current anchor separately.
- Remote outbound operations are idempotent by `(source_id, operation_kind, idempotency_key)`.
- Patch artifacts are content-addressed by `patchHash`.
- User-specific preferences and viewed state are scoped by `userId` / local identity, not global review state.

## UI Architecture

### Primary Surfaces

- `features/diff-review/review-list`: inbox-like list of open reviews, grouped by source, issue, requester, status, or agent involvement.
- `features/diff-review/review-detail`: main diff review surface.
- `features/diff-review/review-guide`: semantic guide sidebar or top flow.
- `features/diff-review/review-thread-panel`: open/resolved/stale threads.
- `features/diff-review/review-agent-actions`: fix request, rerun, attach agent output.

### Host Surfaces

- Browser panel may host review detail tabs.
- Workspace changes panel may create/open a local working tree review.
- Chat tool blocks may offer "Open as review" when the output has stable file diff content.
- Issue detail may show related reviews through read-only references.

### Review Detail Layout

- Header: review title, source badge, issue refs, status, decision controls.
- Review list: attention tabs for needs attention, authored, participated, all, with grouping/sorting by status, author, repository/source, issue, and failed checks.
- Left rail: file tree, changed file counts, viewed state, generated/binary filters.
- Main: `@pierre/diffs/react` `CodeView` for virtualized rendering.
- Right rail: threads, guided review steps, agent fix history.
- Bottom or inline composer: comment / submit review.

### Display Options

- Unified / Split.
- Hide whitespace-only changes.
- Structural highlight mode.
- Collapse generated files.
- Font size.
- Line height.
- Code theme.
- Show comments inline / side panel.
- Show draft or closed remote reviews.
- Show repository/source, failed checks, and preview links when available.

Split layout must auto-disable when container width cannot support side-by-side code without wrapping.

## Structural Highlighting Standard

Structural highlighting must be implemented as an analysis layer over immutable raw patch.

Required outputs:

```ts
interface StructuralDiffAnalysis {
  revisionId: string
  files: Array<{
    fileId: string
    formattingOnlyRanges: ReviewRangeAnchor[]
    semanticRanges: ReviewRangeAnchor[]
    movedOnlyRanges: ReviewRangeAnchor[]
    confidence: 'low' | 'medium' | 'high'
    analyzer: string
  }>
}
```

Rules:

- Raw patch remains visible and exportable.
- Structural mode is a reversible view filter.
- Low-confidence analysis can dim noise but must not hide it by default.
- Language-aware analyzers may use existing parsers where available. Do not invent broad AST abstractions before proving need.
- Whitespace-only detection can be language-neutral and should ship before AST-based semantic grouping.

## Guided Review Standard

Guided review creates a review graph from file changes, issue context, commit metadata, and optional agent explanation.

```ts
interface ReviewGuide {
  revisionId: string
  steps: Array<{
    id: string
    title: string
    rationale: string
    fileIds: string[]
    threadIds: string[]
    riskLevel: 'low' | 'medium' | 'high' | 'unknown'
    order: number
  }>
}
```

MVP ordering:

1. files with comments or failed checks;
2. public API / schema / config changes;
3. core implementation files;
4. tests;
5. generated files;
6. formatting-only or low-confidence noise.

Future ordering can use language dependency graphs and agent-generated summaries, but the guide must always expose its rationale.

## Notification Standard

User preference modes:

- `all-activity`
- `all-activity-by-people`
- `reviews-and-comments`
- `reviews-and-comments-by-people`
- `none`

Event kinds:

- `review_created`
- `review_requested`
- `thread_created`
- `comment_created`
- `review_submitted`
- `revision_updated`
- `ci_failed`
- `agent_fix_completed`
- `agent_fix_failed`
- `agent_fix_deleted`
- `source_readiness_changed`
- `merge_completed`
- `merge_failed`

Bot filtering is based on source actor metadata and Cradle agent actor kind.

## Preview Links

Preview links should be owned by a future `preview-link` or `deployment-preview` capability, not by `diff-review`.

`diff-review` may read and display preview links connected to a review source:

```ts
interface ReviewPreviewLink {
  id: string
  reviewId: string
  label: string
  url: string
  source: 'github-pr-body' | 'check-run' | 'manual' | 'agent'
}
```

Extraction from GitHub PR body or check output belongs to the source adapter or preview owner; review UI only displays normalized links.

## Migration From Current Cradle

### Phase 1: Local Review Foundation

- Create `diff-review` server module and database tables.
- Add local working tree source adapter backed by existing `git` diff API.
- Move `WorkspaceDiffViewer` into `features/diff-review` or wrap it with a review-owned container.
- Changes panel opens a `local-working-tree` review instead of a browser-owned workspace diff tab.
- Keep `@pierre/diffs` renderer options aligned with current behavior: split/unified, word diff, sticky headers, worker pool.

### Phase 2: Review Lifecycle

- Add threads, comments, viewed files, submit decision.
- Add review detail route and browser-panel tab integration.
- Add preferences for layout, code theme, font size, line height.
- Add event stream for review activity.

### Phase 3: Agent Fix Loop

- Add agent fix work order API.
- Let review thread create agent task with scoped context.
- Refresh source after agent output and create a new revision.
- Link agent session/run artifacts back to review thread.

### Phase 4: GitHub PR Source

- Add GitHub source adapter.
- Support PR refresh, comments, reactions, submitted reviews, approvals, basic status.
- Add source readiness states for missing workspace integration, missing repository code access, missing personal connection, and insufficient permission.
- Respect known limitations: draft reviews and rich check annotations are not guaranteed.
- Add outbound operation idempotency and sync failure UI.
- Defer merge until the adapter can prove mergeability and permissions.

### Phase 5: Guided Review And Structural Highlighting

- Add whitespace-only suppression.
- Add generated-file detection.
- Add semantic guide MVP.
- Add language-aware structural analysis only where existing libraries make it reliable.

## Validation

### Unit / Service

- Creating local working tree review materializes immutable revision from current patch.
- Refresh creates a new revision only when source version or patch hash changes.
- Anchors remap across simple adjacent edits.
- Thread becomes stale when anchor cannot remap.
- Outbound source operations are idempotent.
- Notification preference filters bot actors.

### Integration

- Temporary git repo can create review from modified, added, deleted, renamed, and untracked files.
- Review detail can load large patches without blocking UI by relying on `@pierre/diffs` worker rendering.
- Agent fix work order starts a session and records produced patch artifact.
- GitHub adapter can refresh PR metadata and tolerate missing draft review state.
- GitHub source readiness distinguishes missing repository code access from missing personal connection.

### UI

- Split/unified switch remains stable and auto-falls back on narrow containers.
- File viewed state survives navigation.
- Inline comments remain anchored after refresh or become visibly stale.
- Structural highlight mode can be disabled to show raw patch.

## Acceptance Criteria

- A user can open local workspace changes as a review, inspect files, comment on lines, mark files viewed, and submit a local review decision.
- A user can create an agent fix request from a comment or diff range and see the resulting revision linked back to the review.
- A user can review the same source after updates without losing prior comments; comments either remap or become stale.
- Review UI uses `@pierre/diffs` renderer and does not duplicate renderer logic.
- `git`, `workspace`, `issue`, `browser-panel`, and `chat` do not own review lifecycle rows.
- All review APIs are workspace-scoped and never expose absolute workspace paths.
- Source research and continuation prompt are present under `docs/specs/linear-diffs/`.

## Open Decisions

- Whether the canonical product name should be `diff-review`, `code-review`, or `reviews`.
- Whether local review decisions should be persisted only locally or exportable as patch review artifacts.
- Which GitHub auth owner should provide token references for PR review operations.
- Whether preview links should be a separate first-class capability before GitHub PR source ships.
