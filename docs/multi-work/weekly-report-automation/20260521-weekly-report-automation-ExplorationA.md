<!--
Output: Initial implementation proposal for automated project weekly report generation.
Input: AGENTS.md, Chronicle ExecPlan, task-system ExecPlan, server modules, home dashboard placeholder.
Position: Exploration handoff for weekly report automation design review.
-->

# ExplorationA: Weekly Report Automation

## Direct Recommendation

建议把 “每周一 09:00 自动生成项目周报” 作为 Cradle-owned automation/reporting 能力落在新的 server module，而不是放进 `issue-agent`、`session-await`、`chronicle` 或 `kanban`。

推荐边界是：

- `apps/server/src/modules/automation`: 拥有 schedule 定义、due-run 计算、missed-run 策略、duplicate prevention、retry policy、run lifecycle。
- `apps/server/src/modules/reporting`: 拥有 report domain，包括 `weekly_project_report` 类型、prompt/context assembly、report artifact metadata、publication state。
- `apps/server/src/modules/chronicle`: 只作为 passive context data source，被读取，不写入 weekly report 语义。
- `apps/server/src/modules/session` 和 `apps/server/src/modules/chat-runtime`: 只作为 agent execution substrate，用于创建 report-generation session 和 run。
- `apps/server/src/modules/kanban` / `issue-agent`: 只读 issues、comments、agent activities 等源数据；不把 weekly report state 写进 issue-agent tables。

如果 MVP 要压缩范围，可以先合并为一个 `weekly-report` module，但内部仍保持 `schedule`、`run`、`artifact` 三个子边界。长期看不建议直接复用 `session-await`：它是 “等待某个 session 被外部条件恢复” 的能力，语义中心是 chat session continuation；周报自动化的中心是 workspace-scoped recurring job 和 durable artifact。

## Repository Context Read

本提案基于以下已读上下文：

- `AGENTS.md`: 强调 feature owner 和 namespace ownership。可以读其他 namespace，但不应写入其他 owner 的 namespace。
- `docs/exec-plans/20260519-03-cradle-chronicle.md`: Chronicle 是 Cradle-owned passive context pipeline，写 artifacts 和 memory summaries；它不是任务调度 owner。
- `docs/exec-plans/20260426-02-task-system-foundation.md`: Issue Agent 负责 issue delegation、agent session、activity timeline；计划中明确 scheduled tasks 曾被 deferred。
- `apps/server/src/modules`: 当前 server 是 Elysia module composition。`session-await` 有 poller 和 timer-like `fireAt`，但语义绑定到 session resume；`issue-agent` 有 agent run lifecycle；`chronicle` 有 config、daemon、timeline、memories endpoints。
- `apps/web/src/features/home/home-dashboard.tsx`: Home 里已有 mock `ScheduledTask`，包含 “项目周报生成 / 每周一 09:00”，说明 UI 概念存在但后端未落地。
- `packages/db/src/schema/*`: schema 已按 owner 拆分。新增表应新增 owner-specific schema file 并从 `schema/index.ts` export，而不是把 weekly report 写进 existing owner tables。

## Owner And Module Boundaries

### Recommended Ownership

`automation` should own recurring job semantics:

- schedule expression and timezone
- next due time calculation
- job enablement and workspace binding
- due run claiming and duplicate prevention
- retry policy and backoff
- missed-run catch-up policy
- run status transitions

`reporting` should own report semantics:

- report type: `weekly_project_report`
- workspace/project report period
- context source selection
- generated markdown artifact metadata
- review/publish state
- links to source sessions/issues/chronicle memories

The split is useful because automation will likely later cover more than reports: CI waits, recurring cleanup, reminders, digest jobs, recurring issue triage, etc. Reporting is a content domain; automation is lifecycle infrastructure.

### Why Not Existing Modules

- `session-await`: It already has a poller, `fireAt`, pending/triggered/failed states, and idempotent trigger. However, its table requires `chatSessionId`, and its API model is “resume this existing chat session when condition matches”. Weekly reports need recurring schedule definitions and generated artifact history, not one-off session awaits.
- `issue-agent`: It owns issue delegation and agent activity logs. A weekly report may read issue-agent sessions and activities, but writing report runs into `agent_sessions` would overload an issue-specific lifecycle.
- `chronicle`: Chronicle owns capture/memory artifacts. Weekly report can read `getMemories()` and timeline entries, but Chronicle should not own report scheduling or report artifact publication.
- `kanban`: Kanban owns issue and board state. Report generation may read issues, statuses, comments, milestones, labels, and linked sessions, but report status should not be stored as kanban issues unless a user explicitly asks to create a follow-up issue.

## Proposed Persistence

Add a new schema module, likely `packages/db/src/schema/automation.ts`, exported from `packages/db/src/schema/index.ts`.

Minimum tables:

```ts
automationSchedules
automationRuns
reportArtifacts
```

Conceptual shape:

- `automation_schedules`
  - `id`
  - `workspace_id`
  - `kind`: `weekly_project_report`
  - `enabled`
  - `timezone`: IANA name, default from user/app preference, e.g. `Asia/Shanghai`
  - `schedule_json`: structured schedule, not raw cron-only text
  - `missed_run_policy`: `skip` or `run_latest`
  - `retry_policy_json`
  - `agent_id`
  - `agent_profile_id`
  - `created_at`, `updated_at`

- `automation_runs`
  - `id`
  - `schedule_id`
  - `workspace_id`
  - `kind`
  - `scheduled_for`
  - `period_start`
  - `period_end`
  - `status`: `queued`, `claimed`, `running`, `completed`, `failed`, `cancelled`, `skipped`
  - `attempt`
  - `claimed_at`
  - `started_at`
  - `finished_at`
  - `next_retry_at`
  - `last_error_text`
  - `chat_session_id`
  - `chat_run_id`
  - `artifact_id`

- `report_artifacts`
  - `id`
  - `workspace_id`
  - `run_id`
  - `kind`: `weekly_project_report`
  - `title`
  - `period_start`
  - `period_end`
  - `content`
  - `source_manifest_json`
  - `created_at`
  - `updated_at`

Duplicate prevention should be enforced with a unique key equivalent to:

```ts
unique(scheduleId, scheduledFor)
```

If SQLite migration support for unique constraints on new tables is straightforward, enforce this at the DB level. The service should still handle conflicts idempotently.

## Scheduling Semantics

### Meaning Of Monday 09:00

The user-facing schedule “every Monday 09:00” should mean:

- local wall-clock time in an explicit IANA timezone stored on the schedule
- weekday: Monday
- local time: `09:00:00`
- recurrence: every week
- report period: previous Monday 00:00 inclusive to current Monday 00:00 exclusive in the same timezone

For example, for timezone `Asia/Shanghai`, a run scheduled at local `2026-05-25 09:00:00` should report:

- `period_start`: `2026-05-18T00:00:00+08:00`
- `period_end`: `2026-05-25T00:00:00+08:00`
- `scheduled_for`: the UTC instant corresponding to `2026-05-25 09:00:00 Asia/Shanghai`

Store instants as Unix seconds in DB for consistency with current schemas, but retain `timezone` on schedule and source manifest so the wall-clock interpretation is auditable.

### Timezone

MVP should require a timezone field and default it from the runtime environment only when creating the schedule. Do not dynamically reinterpret old schedules if the OS timezone changes.

Recommended defaulting order:

1. workspace or user preference if such preference exists later
2. server runtime timezone detected at creation time
3. explicit fallback `UTC`

The UI should display the timezone next to the schedule. A schedule created as `Asia/Shanghai Monday 09:00` must remain that schedule even if the user later travels.

### DST

Monday 09:00 is normally safe across DST regions because 09:00 is not in the common skipped/repeated transition window. Still, schedule calculation should use an IANA timezone library rather than fixed offsets.

Tradeoff:

- Native `Date` is not sufficient for robust IANA wall-clock recurrence.
- `Temporal` may not be available across the target runtime without a polyfill.
- A small dependency like `luxon` or `date-fns-tz` is reasonable if the repo accepts a dependency. If dependency minimization is preferred, implement only a narrow helper and cover it with fixtures, but this is higher risk.

### Missed Runs

Recommended MVP policy: `run_latest`.

If the app/server is stopped at Monday 09:00 and starts later, create at most one missed run for the most recent due schedule whose `scheduled_for` has no run. Do not backfill many historical weeks automatically.

Behavior:

- If current time is after `scheduled_for` and no run exists for that scheduled instant, enqueue it.
- If several Mondays were missed, enqueue only the latest due Monday by default.
- If a run already exists for `schedule_id + scheduled_for`, do not create another.
- Record the run as normal; optionally include `started_at - scheduled_for` as latency in status views.

Later phase can add a manual “backfill last N weeks” action that creates explicit historical runs.

### Duplicate Prevention

There are two duplicate classes:

1. duplicate enqueue for the same schedule occurrence
2. duplicate execution if two poller ticks or server instances claim the same queued run

Recommended controls:

- DB uniqueness on `automation_runs(schedule_id, scheduled_for)`
- enqueue through an idempotent `createRunIfMissing(scheduleId, scheduledFor)`
- claim by conditional update:
  - select due rows with `status in ('queued', 'failed')` and retry due
  - update one row from `queued` to `claimed` only if status is still `queued`
  - re-read row and continue only if this worker owns the claim
- keep the poller single-process safe with an in-memory `running` guard like `session-await/poller.ts`

For current desktop-local Cradle, single-process conditional DB updates are enough. If Cradle later supports multi-process or sync, add a `claim_token` and stale claim expiry.

### Retry Behavior

Recommended MVP:

- max attempts: 3
- backoff: 5 minutes, 30 minutes, then fail
- retry only generation failures and transient chat-runtime conflicts
- do not retry validation failures such as missing workspace, missing agent profile, disabled schedule, invalid timezone, or unavailable report source config

State transitions:

- `queued` -> `claimed` -> `running` -> `completed`
- `running` -> `failed` with `next_retry_at` if retryable and attempts remain
- `running` -> `failed` terminal if attempts exhausted or non-retryable
- `failed` -> `claimed` only when `next_retry_at <= now` and attempts remain

If `ChatRuntime.createRun()` returns active-run conflict for the target session, treat as retryable. Prefer creating a fresh chat session per report run to avoid session busy conflicts.

## Data Sources And Namespace Rules

### Likely Sources To Read

Workspace:

- `workspaces`: name, path, identifier.
- Optional workspace files later: `README.md`, changelog, docs, package metadata through workspace safe file APIs.

Kanban / issue:

- `kanban_issues`: title, description, priority, labels, status, milestone, timestamps, delegate markers.
- `kanban_statuses`: category and status names for progress grouping.
- `kanban_milestones`: due dates and milestone status.
- `kanban_issue_comments`: human/agent/system comments during the week.
- `kanban_issue_relations`: blockers and related work.

Issue Agent:

- `agent_sessions`: issue-linked automation/delegation sessions.
- `agent_activities`: response/error/activity summaries for work completed by agents.

Chat/session:

- `sessions`: workspace-scoped sessions updated during the week.
- `messages`: exported or summarized session content, preferably via `Session.exportMarkdown()` or a narrower query helper.
- `backend_runs`: run status and timing if needed.

Chronicle:

- `chronicle` server service: `getMemories(limit)` and possibly `getTimeline(limit)`.
- Chronicle storage root memories under Cradle-owned Chronicle namespace are read-only inputs.

Git:

- `git` module can provide status/log/diff summary if existing APIs support it. If not, keep Git data out of MVP to avoid unreviewed raw shell semantics.

Observability:

- `observability` incidents/events may be useful for risk section later, but probably not MVP.

### What Weekly Report May Write

Weekly report automation may write only to its owner tables and generated chat/session surfaces:

- `automation_schedules`
- `automation_runs`
- `report_artifacts`
- a new `sessions` row for the report-generation conversation
- normal `messages` / `backend_runs` through `chat-runtime`

It should not write to:

- Chronicle storage or memories
- Kanban issues/comments, unless user explicitly requests “create issue from report”
- Issue-agent sessions/activities, because no issue is being delegated
- Workspace files by default, unless there is a later explicit export action

This follows the namespace rule: weekly report reads cross-domain evidence but owns its own lifecycle and artifacts.

## MVP Flow

1. User creates/enables a schedule from Home automation UI:
   - workspace
   - agent
   - Monday 09:00
   - timezone
   - missed-run policy default `run_latest`

2. Server module starts an automation poller on app start, similar in placement to `session-await`:
   - `automation` module `.onStart()` starts poller
   - `.onStop()` stops poller
   - poll interval can be 30-60 seconds

3. Poller detects due schedules:
   - compute latest due `scheduled_for`
   - create missing `automation_run`
   - claim queued runs with status guard

4. Reporting runner assembles context:
   - workspace identity
   - issues changed/created/updated in report period
   - completed/in-progress/blocking issue groups
   - recent sessions in period
   - issue-agent responses/errors in period
   - latest Chronicle memories overlapping or near the period

5. Runner creates a fresh chat session:
   - title: `Weekly report: <workspace> <YYYY-MM-DD>`
   - workspaceId: report workspace
   - agentId/profileId from schedule
   - configJson can include a report-run marker if needed

6. Runner calls `ChatRuntime.createRun()` with a structured prompt:
   - asks for concise weekly report in Markdown
   - includes report period and source manifest
   - requires sections for summary, shipped work, in-progress work, blockers, risks, next week
   - instructs model to avoid inventing facts and mark uncertainty

7. Runner waits for run completion via `ChatRuntime.waitForRunCompletion(runId)`.

8. On success:
   - read assistant final message from `Session.getRunMessageContents([runId])` or related helper
   - create `report_artifacts` row with content and `source_manifest_json`
   - mark `automation_runs.completed`

9. Home dashboard:
   - replace mock scheduled row with real automation schedules
   - show latest report artifact under artifacts or automation detail
   - show pending review if report was generated but not reviewed

## Later Phases

Phase 2: Review and publication.

- Add report states: `draft`, `reviewed`, `published`, `archived`.
- Add manual regenerate with edited prompt/context.
- Add export to Markdown file under a Cradle-owned reports directory, not workspace root by default.
- Add “create follow-up issues” action that writes to Kanban only on explicit user action.

Phase 3: Better source adapters.

- Git weekly diff/log summary through `git` module.
- Chronicle period filtering by exact timestamps instead of latest `limit`.
- Session summarization rather than raw message stuffing.
- Source manifest viewer with citations back to issues, sessions, and Chronicle memories.

Phase 4: General automation platform.

- Multiple schedule kinds.
- Manual backfill.
- Pause/resume.
- Notification routing.
- Calendar-like preview of next runs.
- Stale claim recovery for multi-process/server restart cases.

Phase 5: Team or sync readiness.

- Claim tokens and heartbeat.
- Lease expiry.
- More explicit audit events.
- Permission model around generated reports and source visibility.

## API Surface Sketch

This is intentionally high-level and should be refined after schema decisions.

- `GET /automation/schedules?workspaceId=...`
- `POST /automation/schedules`
- `PATCH /automation/schedules/:id`
- `DELETE /automation/schedules/:id`
- `POST /automation/schedules/:id/run-now`
- `GET /automation/runs?scheduleId=...`
- `GET /reports?workspaceId=...&kind=weekly_project_report`
- `GET /reports/:id`

Generated CLI descriptors should follow existing route metadata style with `x-cradle-cli`.

## Validation Strategy

### Unit Tests

Scheduling:

- Monday 09:00 computes the next due instant correctly for `UTC`, `Asia/Shanghai`, and one DST-observing timezone.
- Report period is previous Monday 00:00 to current Monday 00:00 in schedule timezone.
- App start after missed Monday creates one latest run under `run_latest`.
- Multiple missed weeks do not backfill many runs in MVP.
- Existing `schedule_id + scheduled_for` run prevents duplicate enqueue.

Run lifecycle:

- Conditional claim prevents double execution.
- Retryable error schedules correct next retry.
- Non-retryable error fails terminally.
- Attempts stop at max attempts.
- Stale/missing agent or disabled schedule does not retry forever.

Context assembly:

- Reads only current workspace data.
- Includes issues updated in period.
- Includes source manifest with IDs and time bounds.
- Handles malformed Chronicle memory files or unavailable Chronicle config gracefully.
- Does not write to Kanban/Chronicle/issue-agent namespaces.

Prompt/report:

- Prompt includes period, timezone, source manifest, and uncertainty instruction.
- Empty project activity produces a truthful low-activity report instead of hallucinated progress.

### Integration Tests

Server-level tests should start Elysia app with test DB and fake chat runtime:

- Create workspace, agent/profile, schedule.
- Advance fake clock past Monday 09:00.
- Trigger poller tick directly.
- Assert one automation run, one chat session, one report artifact.
- Trigger tick again and assert no duplicate run/artifact.
- Force fake chat runtime failure twice and success on third attempt.
- Delete or disable profile and assert terminal failure with clear error.

If the current code lacks fake clock injection, add a small clock abstraction to `automation` rather than mocking global `Date`.

### Manual Validation

- Enable “项目周报生成 / 每周一 09:00” for one workspace.
- Use `run-now` to generate a report without waiting for Monday.
- Confirm Home automation row shows schedule, next run, latest status.
- Open generated report and verify it cites actual workspace issues/sessions/memories.
- Restart app before and after due time; verify missed-run and duplicate behavior.

## Risks And Tradeoffs

### Timezone Correctness

Risk: Wall-clock recurrence is easy to get subtly wrong with native `Date`.

Recommendation: Use an IANA-aware library or an isolated scheduler helper with exhaustive fixtures. Do not store only UTC hour/day because it loses the user intent around Monday 09:00 local time.

### Overusing Chat Sessions As Artifacts

Risk: If the report only exists as a chat session, it becomes hard to list, review, regenerate, publish, or cite sources.

Recommendation: Use chat-runtime for generation, but persist a `report_artifacts` row as the report truth for product UI.

### Source Volume And Token Pressure

Risk: Raw sessions, issues, comments, and Chronicle memories can exceed context limits.

Recommendation: MVP uses bounded source selection and compact formatting. Later phase can add per-source summaries and source scoring.

### Hallucinated Reports

Risk: Weekly reports can invent progress if context is sparse.

Recommendation: Prompt must require uncertainty markings, and source manifest should be retained. Empty activity should produce an empty/low-activity report.

### Namespace Drift

Risk: It is tempting to create a Kanban issue or Chronicle memory as the report output.

Recommendation: Do not write to other namespaces in the automated path. Provide explicit user actions for cross-domain writes.

### Local Desktop Reliability

Risk: The app may be closed at due time.

Recommendation: `run_latest` missed-run behavior is enough for MVP. The UX should show “generated late” rather than pretending it ran exactly at 09:00.

### Multi-instance Future

Risk: In-memory poller guards are not enough if server instances multiply.

Recommendation: DB uniqueness and conditional claim are mandatory even in MVP. Claim token and lease heartbeat can wait.

## Open Questions

- Should default timezone be app/user-level preference or workspace-level preference? Current repository context did not reveal a general user preference owner.
- Should reports be per workspace only, or can one schedule aggregate all workspaces? MVP should be per workspace for ownership and source scoping clarity.
- Should generated reports require human review before appearing in “Artifacts”? Home mock suggests “等待你审阅后发布” for pending weekly report; MVP can mark generated artifacts as `draft`.
- Which agent should be default for report generation? MVP should require explicit agent selection to avoid hidden model/provider costs.

## Proposed MVP Acceptance Criteria

- A workspace-scoped weekly report schedule can be created with explicit timezone and Monday 09:00 recurrence.
- Server restart after a missed Monday creates at most one latest missed run.
- Repeated poller ticks do not create duplicate runs for the same schedule occurrence.
- Failed transient generation retries with bounded backoff and terminal failure after max attempts.
- Successful run creates a report artifact linked to the automation run and chat session.
- Source manifest records which issues, sessions, issue-agent activities, and Chronicle memories were read.
- No automated path writes to Chronicle, Kanban, or issue-agent namespaces.
- Home dashboard automation section can be backed by real schedules rather than `MOCK_SCHEDULED`.

