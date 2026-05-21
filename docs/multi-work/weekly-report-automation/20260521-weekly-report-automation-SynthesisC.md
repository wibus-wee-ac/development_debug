<!--
Output: Final architecture synthesis for automated weekly project report generation.
Input: ExplorationA and CritiqueB handoffs plus sampled Cradle module/schema context.
Position: Synthesis handoff for senior engineering review before implementation planning.
-->

# SynthesisC: Weekly Report Automation Final Proposal

## Direct Recommendation

MVP 应实现一个 **workspace-scoped `weekly-report` feature owner**，而不是第一版就暴露通用 `automation` 平台 API。

内部可以按 `schedule`、`run`、`artifact`、`source bundle` 四个边界组织；但对外产品语义只承诺一件事：为某个 workspace 在显式 timezone 下每周一 09:00 生成上一自然周项目周报草稿。这样既保留 ExplorationA 正确的 namespace 分离，也吸收 CritiqueB 对产品契约和可靠性的约束。

推荐落点：

- `apps/server/src/modules/weekly-report`: 拥有 weekly report schedule、run lifecycle、source policy、report artifact lifecycle、HTTP routes、poller startup。
- `packages/db/src/schema/weekly-report.ts`: 拥有 `weekly_report_schedules`、`weekly_report_runs`、`weekly_report_artifacts`。
- `apps/web/src/features/home` 或后续 `apps/web/src/features/weekly-report`: 展示 Home 中已有的 scheduled task、pending review、artifact 概念，但必须接真实 backend state。
- Read-only source adapters: 读取 workspace、kanban/issue、issue-agent、session/chat、Chronicle；不向这些 namespace 写入自动化结果。

长期演进时，如果出现第二个 recurring job kind，再把 `weekly-report` 内部 schedule/run 抽到 `automation` owner。MVP 不应提前发布 `/automation/schedules` 这类泛化 API，因为一旦其他 feature 依赖，recurrence、claim、retry、permission 语义会过早固化。

## Reconciled Decisions

### MVP Scope

MVP 包含：

- 每个 workspace 可创建一个或多个 weekly report schedule；UI 第一版可以只支持一个默认 schedule。
- Recurrence 固定为每周一 09:00，timezone 必须显式存储，UI 可预填但用户能看到并确认。
- 自动 run、manual run、bounded retry、stale claim recovery、duplicate prevention。
- 成功生成 `draft` report artifact，默认需要 review；不自动 publish，不写 workspace files。
- Home surface 显示 schedule、next run、latest run state、late/failure state、draft awaiting review CTA。
- Manual `run now` 用于验证和用户主动补生成。

MVP 不包含：

- 多种 schedule kind 的通用 automation platform。
- 自动创建 Kanban issue、Chronicle memory 或 workspace Markdown file。
- 多周自动 backfill。
- Team/sync/multi-instance distributed locking beyond DB-level lease fields.
- Full citation UI; source manifest 必须持久化，viewer 可后续补齐。

### Owner And Module Boundaries

`weekly-report` owns:

- weekly report schedule semantics;
- due occurrence calculation;
- missed-run policy;
- run claiming, retry, stale recovery;
- source bundle assembly policy;
- weekly report prompt contract;
- report artifact draft/review/publish lifecycle.

Other modules remain source or execution substrates:

- `session-await`: 不复用为 recurring job owner；它绑定 existing chat session resume。
- `chat-runtime` and `session`: 只负责创建 report-generation session/run 和消息持久化。
- `kanban`, `issue`, `issue-agent`, `chronicle`, `workspace`: 只提供 read evidence；weekly report 不写入这些 namespace。
- `profiles` and `agent-identity`: schedule stores live references; each run stores resolved generation snapshot for audit.

This follows Cradle ownership principle: weekly report may read foreign namespaces through owner-aware service/read adapters, but automated paths write only weekly-report-owned tables plus normal chat-runtime/session tables.

### Persistence

Use a new schema module instead of adding report state to existing owners.

Recommended tables:

- `weekly_report_schedules`
  - `id`
  - `workspace_id`
  - `enabled`
  - `timezone`
  - `weekday`
  - `local_time`
  - `missed_run_policy`
  - `missed_run_grace_seconds`
  - `agent_id`
  - `agent_profile_id`
  - `created_at`
  - `updated_at`

- `weekly_report_runs`
  - `id`
  - `schedule_id`
  - `workspace_id`
  - `trigger`: `scheduled | manual`
  - `scheduled_for`
  - `period_start`
  - `period_end`
  - `timezone_snapshot`
  - `recurrence_snapshot_json`
  - `generation_config_snapshot_json`
  - `source_policy_snapshot_json`
  - `prompt_version`
  - `source_adapter_version`
  - `status`: `queued | claimed | running | artifact_pending | completed | failed | cancelled | skipped`
  - `attempt`
  - `claim_token`
  - `claimed_at`
  - `claim_expires_at`
  - `started_at`
  - `finished_at`
  - `next_retry_at`
  - `last_error_text`
  - `chat_session_id`
  - `chat_run_id`
  - `assistant_message_id`
  - `artifact_id`

- `weekly_report_artifacts`
  - `id`
  - `workspace_id`
  - `run_id`
  - `title`
  - `status`: `draft | reviewed | published | archived`
  - `period_start`
  - `period_end`
  - `timezone`
  - `content`
  - `source_manifest_json`
  - `created_at`
  - `updated_at`
  - `reviewed_at`
  - `published_at`

DB constraints:

- Unique scheduled occurrence: `unique(schedule_id, scheduled_for)` for `trigger = scheduled`; SQLite partial uniqueness can be avoided by giving manual runs distinct `scheduled_for` semantics, but scheduled duplicate prevention must be DB-enforced.
- `weekly_report_artifacts.run_id` should be unique to avoid multiple canonical artifacts per run.
- Index `weekly_report_runs(status, next_retry_at)` and `weekly_report_runs(claim_expires_at)` for poller recovery.

### Schedule Semantics

User-facing "every Monday 09:00" means:

- Wall-clock recurrence in an explicit IANA timezone.
- `weekday = monday`, `local_time = 09:00:00`.
- `scheduled_for` stores the UTC instant corresponding to that local occurrence.
- Report period is previous Monday 00:00 inclusive to current Monday 00:00 exclusive in the same timezone.
- Scheduling precision is best effort within the poll interval while the app/server is running.

For `Asia/Shanghai`, a run scheduled at local `2026-05-25 09:00:00` reports:

- `period_start`: local `2026-05-18 00:00:00`
- `period_end`: local `2026-05-25 00:00:00`
- `scheduled_for`: UTC instant for `2026-05-25 09:00:00 Asia/Shanghai`

Do not implement recurrence by fixed UTC weekday/hour. Use an IANA-aware library such as `luxon` or an isolated recurrence helper with fixture coverage for `UTC`, `Asia/Shanghai`, and one DST timezone.

### Timezone

Timezone is schedule-owned for MVP.

Decision:

- Creation requires an explicit IANA timezone value.
- UI may prefill from detected runtime timezone, but missing timezone is invalid.
- Store timezone on schedule and snapshot it onto each run and artifact.
- Existing schedules are not reinterpreted if OS timezone changes or user travels.

Reasoning: repository context does not prove a workspace/user timezone owner. Silent fallback to server runtime or UTC can encode wrong user intent.

### Missed Runs

MVP missed-run policy: `run_latest` with a grace window.

Decision:

- If app/server starts after a due Monday 09:00, enqueue only the latest missing scheduled occurrence.
- Do not auto-backfill older missed weeks.
- Only auto-generate a missed run if it is less than `missed_run_grace_seconds` late; default `604800` seconds.
- If the latest due occurrence is outside the grace window, mark or expose it as skipped/too-late rather than generating stale content automatically.
- UX must label late generated runs as late, based on `started_at - scheduled_for`.

Disable/edit semantics:

- Disabled schedules do not enqueue future or missed runs.
- Disabling a schedule cancels `queued` runs for that schedule; `claimed` or `running` runs are allowed to finish unless the user explicitly cancels them.
- Editing recurrence/timezone affects only future occurrences; existing runs keep snapshots.

### Duplicate Prevention

Duplicate prevention has two layers:

- Enqueue idempotency: DB unique key on scheduled occurrence plus idempotent `create scheduled run if missing`.
- Execution idempotency: claim by conditional update from eligible status to `claimed` with a fresh `claim_token` and `claim_expires_at`.

Poller should keep the same in-memory `running` guard pattern as `session-await`, but correctness must not depend on it. DB uniqueness and conditional claim are mandatory because poller ticks, restarts, and future multi-window/server execution can otherwise duplicate generation.

### Retry And Stale Claim Recovery

MVP retry policy:

- Max attempts: 3.
- Backoff: 5 minutes, 30 minutes, then terminal failure.
- Retry transient chat-runtime conflicts, provider/network failures, stale claims, and artifact persistence failures when recovery can inspect existing chat output.
- Do not retry invalid timezone, missing workspace, disabled schedule before claim, missing/deleted required agent profile, invalid source policy, or permission/source visibility violations.

Stale recovery:

- A claimed/running/artifact-pending run with expired `claim_expires_at` becomes recoverable.
- On recovery, first inspect persisted `chat_run_id` and `assistant_message_id`.
- If chat run completed and assistant content exists, do not regenerate; move to `artifact_pending` and persist the artifact.
- If chat run failed/aborted or no durable chat run exists, retry according to attempt budget.
- If durable state is ambiguous after max attempts, mark terminal `failed` with diagnostic text and expose manual retry.

Run phases:

- `queued`
- `claimed`
- `running`
- `artifact_pending`
- `completed`
- `failed`
- `cancelled`
- `skipped`

`artifact_pending` is explicit because the highest-risk idempotency boundary is "model produced output, but report artifact was not persisted".

### Source And Read Policy

Weekly report source gathering must use a bounded `ReportSourceBundle` contract, not ad hoc table dumping.

Each source item should include:

- `source_type`
- `source_id`
- `workspace_id`
- `title`
- `timestamp_range`
- `summary_or_excerpt`
- `route_target`
- `visibility`
- `metadata`

Default source policy:

- Scope all reads to the schedule workspace.
- Include records overlapping the report period, with explicit per-source lookback windows only where needed.
- Include issues, statuses, milestones, comments, issue-agent activities, recent workspace sessions, and Chronicle memories only through read adapters or owner service methods.
- Exclude raw full chat sessions by default unless session metadata marks them reportable, or the product explicitly decides sessions are reportable by default.
- Redact or omit known secret-bearing fields.
- Store `source_manifest_json` on artifact and source policy snapshot on run.
- If source data is sparse, generate a low-activity report rather than inventing progress.

The material open product decision is chat privacy: whether workspace chat sessions are reportable by default. Until decided, MVP should use conservative inclusion: issue-linked sessions and explicitly reportable sessions only.

### Report Artifact Lifecycle

Generated reports are artifacts, but they start as drafts.

Decision:

- Successful generation creates one `weekly_report_artifacts` row in `draft`.
- Draft appears in Home as "awaiting review"; it is not treated as published output.
- Review changes status to `reviewed`.
- Publishing can be implemented later; when added, it should remain weekly-report-owned unless user explicitly exports to workspace files.
- Regeneration creates a new run and artifact revision rather than mutating completed run history. A later artifact revision model may be added if editing/review requires it.

This matches the Home mock hint that a weekly report may be waiting for review before publish and avoids treating model output as trusted by default.

### Manual Run Semantics

Manual run is an MVP validation and UX requirement.

Decision:

- `trigger = manual`.
- Default period is the latest completed calendar-week period for the schedule timezone: previous Monday 00:00 to current Monday 00:00.
- Manual runs may duplicate a scheduled period; UI labels them as manual.
- Manual run should not consume or replace the scheduled occurrence unless user chooses "retry this failed scheduled run".
- Manual retries of a failed scheduled run should target the existing scheduled run when possible, not create a separate manual run.

### Agent/Profile Configuration

Use a hybrid model:

- Schedule stores live `agent_id` and `agent_profile_id`.
- At run claim time, resolve the effective generation config and store `generation_config_snapshot_json`.
- If the live profile is missing/disabled/invalid at claim time, fail terminally with a clear error.

This allows profile updates to affect future reports while each generated artifact remains auditable.

### UX Surface

Minimum Home states:

- No schedule configured: setup CTA.
- Enabled: next run time with timezone.
- Late queued/running: show late label and current run status.
- Draft generated: "awaiting review" CTA.
- Failed terminal: show failure reason summary plus retry/run-now action.
- Disabled: show disabled state and enable/edit action.

The UI should display period and timezone near the report title. Raw backend states like `claimed` or `artifact_pending` can be mapped to user-facing "preparing", "generating", or "finalizing".

## Alternatives Considered

### Alternative 1: Generic `automation` + `reporting` Platform Now

This is ExplorationA's long-term direction.

Pros:

- Reusable for future recurring jobs.
- Clean infrastructure/content split.
- Centralizes recurrence and claim semantics.

Cons:

- Exposes broad API before a second schedule kind proves the abstraction.
- Forces stable cross-domain semantics too early.
- Increases schema/API review surface for a narrow feature.

Why not MVP: CritiqueB is correct that this drifts into a platform. Keep it as Phase 4 extraction path.

### Alternative 2: Reuse `session-await`

Pros:

- Existing poller and timer-like `fireAt`.
- Already integrated with session resume semantics.

Cons:

- Schema requires `chat_session_id`.
- Semantics are one-off "resume this session", not recurring workspace job.
- Report artifacts, schedule snapshots, missed runs, and review lifecycle would be unnatural.

Why not: It violates semantic ownership and would overload a module whose center is session continuation.

### Alternative 3: Store Weekly Report As Chat Session Only

Pros:

- Minimal schema.
- Uses existing chat-runtime persistence.

Cons:

- Cannot list, review, publish, retry, or audit reports cleanly.
- Source manifest and artifact lifecycle become implicit.
- Home artifact/review UX cannot be modeled well.

Why not: Chat-runtime should generate content; weekly-report should own report truth.

## Implementation Phases

### Phase 1: Domain And Persistence

- Add `weekly-report` server module skeleton and README.
- Add `packages/db/src/schema/weekly-report.ts` and migration.
- Define schedule, run, artifact models and TypeBox schemas.
- Add source bundle types and source policy contract.
- Add schedule calculation helper with injectable clock.

Validation:

- Unit tests for recurrence, period calculation, timezone fixtures, duplicate occurrence key, and missed-run grace.

### Phase 2: Poller And Runner

- Start/stop weekly-report poller with server module lifecycle.
- Implement due schedule discovery and idempotent scheduled run enqueue.
- Implement conditional claim with `claim_token` and `claim_expires_at`.
- Implement stale recovery and bounded retry.
- Create fresh chat session per run; call chat-runtime; persist artifact from assistant output.

Validation:

- Integration tests with test DB and fake chat runtime.
- Crash/restart-style tests by expiring claim leases and asserting recovery behavior.
- Duplicate tick tests asserting one run and one artifact.

### Phase 3: Source Adapters And Prompt Contract

- Implement bounded source adapters for workspace, issues/kanban, issue-agent, reportable sessions, Chronicle.
- Persist source manifest.
- Add prompt versioning and low-activity behavior.
- Keep Git and observability out unless existing owner APIs make bounded summaries trivial.

Validation:

- Tests assert workspace scoping, time bounds, source IDs, malformed source handling, and no writes to source namespaces.
- Prompt snapshot tests for period, timezone, manifest, sections, and uncertainty instructions.

### Phase 4: Home UX And Review

- Replace Home mock schedule/report data with real API reads.
- Add setup/edit/disable/run-now actions for the MVP schedule shape.
- Add draft review surface and status mapping.

Validation:

- Component tests for state matrix.
- Manual validation with a real workspace and `run now`.

### Phase 5: Extraction And Expansion

Only after at least one more recurring job kind exists:

- Extract generic schedule/run infrastructure into `automation`.
- Keep report-specific artifact/source/prompt semantics in `weekly-report` or `reporting`.
- Add backfill, publish/export, citation viewer, notification routing, and multi-instance lease hardening.

## Validation Strategy

Required unit tests:

- Next Monday 09:00 occurrence for `UTC`, `Asia/Shanghai`, and a DST-observing timezone.
- Report period previous Monday 00:00 inclusive to current Monday 00:00 exclusive.
- Missed run creates only latest occurrence inside grace window.
- Missed run outside grace window is skipped/not auto-generated.
- Schedule disable cancels queued runs and prevents enqueue.
- Schedule edit affects only future occurrences.
- Conditional claim prevents double execution.
- Stale `claimed`, `running`, and `artifact_pending` recovery.
- Retryable vs terminal errors.
- Manual run period and duplicate labeling.

Required integration tests:

- Create workspace, profile, schedule; advance fake clock; tick poller; assert one run, one chat session, one draft artifact.
- Tick repeatedly; assert no duplicate scheduled run/artifact.
- Simulate chat completion followed by artifact persistence failure; recovery persists from existing assistant output without regeneration.
- Simulate provider failure twice then success; assert attempts/backoff.
- Delete profile before claim; assert terminal failure and visible error.
- Verify source bundle reads only selected workspace and stores manifest.

Manual validation:

- Configure schedule from Home with visible timezone.
- Use run-now and inspect draft report.
- Restart app before and after due time; verify late, duplicate, and stale recovery behavior.
- Review a draft and confirm status changes without writing to Kanban, Chronicle, issue-agent, or workspace files.

## Remaining Open Questions

Only two questions materially affect implementation:

1. Are workspace chat sessions reportable by default?
   - Recommendation until decided: include issue-linked sessions and explicitly reportable sessions only.

2. Does MVP need `published` behavior, or only `draft` and `reviewed`?
   - Recommendation: implement `draft` and `reviewed`; reserve `published` schema value for compatibility but do not expose publish/export until product semantics are clear.

These do not block Phase 1 if the conservative defaults above are accepted.
