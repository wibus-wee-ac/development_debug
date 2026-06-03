# CritiqueB: Weekly Report Automation Proposal Review

## Direct Conclusion

ExplorationA chooses a mostly correct ownership direction: weekly report automation should not be hidden inside `session-await`, `chronicle`, `kanban`, or `issue-agent`, and it correctly treats those modules as read-only evidence sources. The proposal is strongest on namespace separation and duplicate-prevention intent.

The weak points are product scope and scheduling semantics. It implicitly designs a general automation platform plus reporting subsystem before proving the narrow "project weekly report every Monday 09:00" product workflow. Several failure modes are named but not decision-grade: stale claims after crashes, timezone source of truth, disabled schedules with queued runs, late-generation UX, artifact visibility before review, source citation quality, and privacy/permission boundaries across source data.

Recommendation: keep the owner split as a candidate, but force a few explicit decisions before Code mode:

- Define the MVP product contract: draft generation, review state, visibility, manual run, and schedule editing.
- Define exact recurrence semantics in terms of wall-clock timezone, missed runs, retries, disabled schedules, and duplicate claiming.
- Decide whether `automation` is a platform module now or whether a narrower `weekly-report` owner creates less surface area for the first implementation.
- Treat source gathering as a bounded reporting adapter contract with citations and privacy constraints, not as "read everything relevant".

## Context Read

This critique is based on direct reading of:

- `docs/multi-work/weekly-report-automation/20260521-weekly-report-automation-ExplorationA.md`
- `AGENTS.md`, especially namespace ownership rules
- `apps/server/src/modules/session-await/poller.ts`
- `packages/db/src/schema/session-await.ts`
- `packages/db/src/schema/index.ts`
- `apps/server/src/modules/workflow-rules/README.md`
- `apps/server/src/modules/preferences/README.md`
- `apps/web/src/features/home/home-dashboard.tsx`

Important repository observations:

- `session-await` has a 30s in-memory poller and timer-like `fireAt`, but its schema requires a `chatSessionId`; ExplorationA is right that this is not a recurring job owner.
- The current schema barrel is owner-split, but only exports existing owner files. A new owner schema is consistent with local patterns.
- `home-dashboard.tsx` has mock weekly report and scheduled-task rows, but they are not a reliable product spec. The pending row says "waiting for review before publish", which materially affects artifact state.
- `preferences` exists, but the sampled README only confirms server-owned preference routes, not a clear workspace/user timezone owner.

## Critiques

### 1. High: MVP scope drifts into a general automation platform

ExplorationA recommends `automation` plus `reporting`, then sketches schedules, run lifecycle, retries, APIs, backfill, pause/resume, notifications, calendar preview, claim tokens, heartbeat, publication, and source adapters. Those are plausible future capabilities, but the initial feature is narrower: generate project weekly reports every Monday at 09:00.

Rationale: A general automation owner is expensive because it must define stable cross-domain semantics from day one. Once `/automation/schedules` and generic `kind`-based tables exist, other features will attach to them and the lifecycle becomes hard to revise. The design currently has more platform API than proven product surface.

Concrete correction: make an explicit decision point:

- Option A: build a narrow `weekly-report` module first, with private schedule/run tables and no generic automation API.
- Option B: build `automation` as platform infrastructure, but constrain the public API to `weekly_project_report` until at least two schedule kinds exist.

Tradeoff: Option A is less reusable but easier to validate. Option B may be correct for Cradle's future, but only if ownership, migration, and extension rules are documented now.

### 2. High: Schedule creation defaults are under-specified and can silently encode wrong user intent

ExplorationA says timezone defaults from workspace/user preference, then server runtime timezone, then UTC. The repository context sampled here does not prove that a workspace or user timezone preference exists. Falling back to runtime timezone is dangerous in a desktop app because it may reflect the machine at creation time, not the workspace or user's intended reporting locale.

Rationale: "Every Monday 09:00" is a wall-clock promise. If Cradle creates the schedule while the user is traveling or after OS timezone changes, the report cadence becomes surprising. This is a product correctness issue, not just implementation detail.

Concrete correction: require timezone to be explicit in the creation UI for MVP, even if prefilled. Persist the IANA timezone and display it anywhere the schedule is shown. Treat missing timezone as invalid input rather than silently falling through to UTC, except for internal tests or legacy migrations.

Decision point: should the timezone belong to the schedule, workspace, user preference, or app preference? ExplorationA should not assume all four are interchangeable.

### 3. High: Missed-run behavior needs a hard lateness window and disable/edit semantics

`run_latest` is sensible, but ExplorationA does not define how late is too late, what happens after schedule edits, or how disabled schedules interact with queued runs.

Rationale: If the app has been closed for months, creating a report for the latest missed Monday may still be confusing. If a user disables a schedule after a due time but before the poller runs, the system must not generate a report. If a schedule is edited from timezone A to timezone B, old and new occurrences need deterministic treatment.

Concrete corrections:

- Add `missed_run_grace_seconds` or an explicit product rule such as "run latest missed occurrence only if it is less than 7 days late".
- Define whether disabling a schedule cancels queued/claimed runs or only prevents future enqueue.
- Define whether editing recurrence/timezone affects only future scheduled occurrences.
- Store the schedule snapshot on each run: timezone, recurrence, report period, prompt version, source adapter version.

Tradeoff: strict grace windows may skip desired reports after long downtime; no grace window may surprise users with stale reports.

### 4. High: Duplicate execution protection is incomplete without stale-claim and crash recovery semantics

The proposal requires DB uniqueness and conditional claim, which is necessary. It defers claim tokens and stale claim expiry to later phases. That deferral is risky even for a desktop-local app because crashes and forced quits are ordinary local failure modes.

Rationale: A run can move to `claimed` or `running`, then the app crashes before completion. Without a lease or stale recovery policy, the run can be stuck forever. If the recovery is added later, existing stuck states and transitions will need migration semantics.

Concrete correction: MVP should include at least a simple `claim_expires_at` or `heartbeat_at` policy. It does not need full multi-instance coordination, but it must define how `claimed` and `running` rows recover after process death.

Decision point: on restart, should stale `running` runs be retried, marked failed, or require manual intervention? The answer affects idempotency because the chat run may have completed while the process died before artifact persistence.

### 5. High: Report artifact state is inconsistent with the Home product hint

ExplorationA says successful generation creates a report artifact, and later phases add `draft`, `reviewed`, `published`, `archived`. But the existing Home mock includes a pending weekly report that is "waiting for review before publish". That suggests review is not a later enhancement; it may be part of the initial product promise.

Rationale: Automatically generated reports can contain hallucinations, sensitive data, or wrong attributions. Showing them as normal artifacts immediately after generation creates a trust and UX problem.

Concrete correction: MVP artifacts should at least have `draft` state and a clear "needs review" surface. "Published" can wait, but "generated draft" versus "reviewed artifact" should not wait.

Tradeoff: adding state increases schema and UI complexity. However, a single `status: draft | reviewed` is much cheaper than retrofitting artifact visibility rules after users already rely on generated reports.

### 6. Medium-High: Source namespace boundaries are correct but permission/privacy boundaries are not defined

ExplorationA carefully avoids writing to Chronicle, Kanban, and Issue Agent namespaces. It does not define whether the report agent is allowed to read all data in those namespaces, whether source visibility follows workspace permissions, or whether user-private sessions are excluded.

Rationale: "Read-only" is not automatically safe. A weekly report can leak private chat content, secrets in comments, or unrelated workspace activity. In a local-first desktop app this may seem lower risk, but generated artifacts are easier to share/export than raw source data.

Concrete correction: introduce a reporting source policy before implementation:

- scope all sources to the selected workspace by default;
- include only records whose timestamps overlap the report period plus explicit lookback windows;
- avoid raw full-message stuffing unless the session is explicitly reportable;
- include source IDs and timestamps in a manifest;
- redact or exclude known secret-bearing fields.

Decision point: are chat sessions private by default or reportable by default? ExplorationA assumes reportable.

### 7. Medium-High: The proposal under-specifies the reporting data contract

The context assembly step lists many sources but does not define a stable adapter boundary, source scoring, maximum volume, or citation model. The prompt asks the model not to invent facts, but the system has no structural way to connect statements back to evidence.

Rationale: Weekly reports fail quietly when the source bundle is too sparse, too large, or poorly labeled. A source manifest alone is useful for audit, but it does not guarantee the generated text can be reviewed against evidence.

Concrete correction: define a small `ReportSourceBundle` contract before implementation. It should include source type, ID, title, timestamp range, concise excerpt/summary, and optional URL or route target. Keep raw content limits explicit per source type.

Tradeoff: this adds a reporting abstraction earlier, but it prevents the runner from becoming a pile of cross-module queries and prompt string concatenation.

### 8. Medium: `agent_id` and `agent_profile_id` on schedules are likely too coupled

ExplorationA suggests storing both `agent_id` and `agent_profile_id` on the schedule. It also says MVP should require explicit agent selection to avoid hidden model/provider costs.

Rationale: If agent identity, profile, provider, model, or permissions change between schedule creation and run execution, the expected behavior is unclear. A weekly report schedule may need either a stable profile snapshot or a live reference. Both are valid, but they have different failure and audit semantics.

Concrete correction: choose one:

- live reference: schedule stores profile ID, run fails clearly if missing or disabled;
- snapshot: schedule stores a resolved generation config snapshot for repeatability;
- hybrid: schedule stores live profile ID, run stores resolved snapshot.

The hybrid is likely best for auditability without blocking profile updates.

### 9. Medium: Run-now semantics are not specified

The API sketch includes `POST /automation/schedules/:id/run-now`, but the proposal does not define its report period, duplicate key, retry behavior, or whether it creates a schedule occurrence.

Rationale: Manual run is a key MVP validation path. If `run-now` uses the same `(schedule_id, scheduled_for)` unique key with current time, it can create strange duplicates. If it uses the latest scheduled occurrence, it may collide with automatic runs.

Concrete correction: model manual runs explicitly with `trigger: scheduled | manual` and a deterministic `period_start` / `period_end`. Decide whether manual runs are allowed to duplicate a scheduled period and how the UI labels them.

### 10. Medium: Period definition ignores workweek/product expectations

ExplorationA defines Monday 09:00 generation as reporting previous Monday 00:00 to current Monday 00:00. That is coherent, but not obviously the only product expectation. A user might expect "last week" to mean Monday through Sunday inclusive, or "since previous report generation".

Rationale: The chosen period excludes Monday 00:00-09:00 work from the report generated at 09:00 and includes the prior Monday early morning. That may be correct, but it must be visible and testable.

Concrete correction: keep the proposed period for MVP, but name it explicitly in UI and artifact metadata. Add a decision point for whether the period is calendar-week-based or previous-successful-run-based.

### 11. Medium: Retry policy does not separate generation retries from artifact persistence retries

The proposal treats generation failures and transient chat-runtime conflicts as retryable. It does not define what happens if the model run succeeds but reading the final message or writing `report_artifacts` fails.

Rationale: This is the highest-risk idempotency boundary. A second attempt may produce a different report for the same period, while the first output already exists in a chat session. Conversely, marking the run failed may hide a successfully generated report.

Concrete correction: split run phases more explicitly:

- context assembled;
- chat session created;
- chat run started;
- chat run completed;
- artifact persisted;
- run finalized.

On retry, reuse or inspect the existing chat run when possible instead of blindly starting a new generation.

### 12. Medium: The proposal assumes `ChatRuntime.waitForRunCompletion` is the right execution model

ExplorationA proposes synchronous waiting for a chat run to finish inside the automation runner. That may be fine, but the review should confirm timeout, cancellation, app shutdown, and long-running model behavior.

Rationale: A background poller that awaits long model runs can block later work or complicate shutdown. It also blurs whether chat-runtime owns run completion notifications or reporting owns polling.

Concrete correction: specify a runner timeout and cancellation behavior. If chat-runtime already has observable run state, prefer recording `chat_run_id` and polling status over holding a long promise with no durable progress.

### 13. Medium: Home UX scope is under-defined

ExplorationA says "replace mock scheduled row with real automation schedules" and "show latest report artifact". It does not define empty states, setup flow, edit/disable actions, late status, failure status, review CTA, or per-workspace filtering.

Rationale: The feature is user-facing automation. Without UX decisions, backend state will leak raw lifecycle concepts into the UI and be harder to revise.

Concrete correction: define a minimal UI state matrix:

- no schedule configured;
- enabled and next run scheduled;
- late missed run queued/running;
- draft generated and awaiting review;
- failed terminal with retry/run-now action;
- disabled.

### 14. Medium: `report_artifacts` ownership name may be too generic for first implementation

The proposal creates `report_artifacts` as a reporting-owned table. This is defensible. The risk is that Cradle already has broader "artifacts" concepts in Home mock and possibly future product surfaces. A generic table name may prematurely claim product vocabulary.

Rationale: Ownership names should answer who owns lifecycle and semantics. If "artifact" becomes a cross-product primitive, `report_artifacts` may be too narrow. If reporting owns only reports, `weekly_report_artifacts` may be clearer.

Concrete correction: decide whether this table is the source of truth for all report artifacts or only weekly project reports. Name it accordingly. Avoid mixing generated reports with unrelated docs/diffs unless a broader artifact owner exists.

### 15. Low-Medium: Poll interval and local scheduling resolution are stated but not justified

The proposal suggests 30-60 seconds. That is probably fine, but it should state that this feature has minute-level, not exact-second, scheduling precision.

Rationale: Users read "Monday 09:00" as near 09:00, not necessarily 09:00:00. Product and tests should tolerate poller delay.

Concrete correction: define scheduling SLA as "best effort within the next poll interval while the app is running; late runs are labeled late".

### 16. Low-Medium: Validation strategy is good but depends on fake clock and fake chat seams that may not exist

ExplorationA recommends fake clocks and fake chat runtime. That is correct but may be larger than the feature implementation if the current app does not have injectable time/runtime boundaries.

Rationale: If those seams are added casually inside the automation module only, tests will be brittle. If they are added globally, the task becomes a broader testability refactor.

Concrete correction: keep the fake clock local to the scheduler helper and provide a small reporting runner interface for tests. Do not introduce global clock infrastructure unless another owner already needs it.

## Ownership Assessment

ExplorationA mostly follows Cradle's namespace rule:

- It reads Chronicle, Kanban, Issue Agent, session, workspace, git, and observability data as evidence.
- It writes only to automation/reporting tables and normal chat-runtime/session surfaces.
- It avoids writing report outputs into Chronicle memories, Kanban comments, or Issue Agent activities.

The main ownership risk is not cross-namespace writes; it is premature namespace creation. A generic `automation` module will become an owner of recurring semantics for the whole product. That is acceptable only if the first implementation documents extension rules and does not expose a generic API surface that future modules depend on before the semantics harden.

The second ownership risk is source reading. Cross-namespace reads still need a policy contract. Reporting should not query arbitrary tables ad hoc from the runner. Each source should be accessed through owner-provided service methods or small read adapters that preserve source semantics.

## Required Decision Points Before Implementation

1. Should MVP create a generic `automation` owner or a narrow `weekly-report` owner?
2. Is the schedule timezone explicit user input, workspace preference, user preference, or server default?
3. What is the maximum missed-run lateness that still auto-generates a report?
4. What happens to queued/running runs when a schedule is disabled or edited?
5. Are generated reports visible as normal artifacts immediately, or are they drafts requiring review?
6. Are chat sessions reportable by default, or must sessions opt in to report inclusion?
7. Does `run-now` create a manual run for the current calendar period, the previous scheduled period, or a user-selected period?
8. On crash after chat completion but before artifact persistence, should recovery reuse the completed chat output or regenerate?
9. What source bundle size limits apply per source type?
10. Which agent/profile configuration is live and which is snapshotted per run?

## Suggested Corrections To ExplorationA

Do not rewrite the whole proposal. Amend it with these targeted changes:

- Add an "MVP Product Contract" section covering draft/review, schedule setup, manual run, failure visibility, and late-run labeling.
- Add a "Durable Run Recovery" section with stale claim, crash recovery, and post-generation artifact persistence behavior.
- Replace timezone defaulting with explicit timezone selection for MVP.
- Add schedule snapshot fields to `automation_runs` or equivalent run metadata.
- Add `trigger` to runs: `scheduled | manual | retry`.
- Add a reporting source bundle contract before listing individual source tables.
- Treat `draft` artifact status as MVP, not Phase 2, unless product explicitly rejects the Home review hint.
- Limit generic automation APIs until the second schedule kind exists, or document why the platform surface is required now.

## Residual Uncertainty

This critique did not inspect every server service or generated OpenAPI convention. It sampled the relevant poller, schema, preference, workflow-rules, and Home dashboard files to validate ExplorationA's assumptions. The biggest unknowns are:

- whether there is an existing artifact owner outside the mocked Home UI;
- whether agent/profile identity has a stable configuration snapshot pattern elsewhere;
- whether chat-runtime exposes durable run completion status that would make synchronous waiting unnecessary;
- whether workspace/user preferences already have a timezone shape beyond the README.

Those unknowns should be resolved before schema/API finalization, but they do not invalidate the main critique: the proposal is directionally sound on namespace ownership and under-specified on product contract, recurrence semantics, and durable recovery.
