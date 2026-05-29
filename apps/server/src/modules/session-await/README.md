# Session Await Module

`session-await` owns durable waits that can resume an existing chat session when an external condition becomes true. The module owns await lifecycle, polling, cancellation, manual trigger, summary projection, source adapter registration, and dispatches matched awaits into Chat Runtime's durable continuation queue so busy sessions still receive the wake-up message.

## Files

- **index.ts**: Elysia routes under `/session-awaits`, poller startup, and live status dispatch for supported sources.
- **model.ts**: TypeBox request/response schemas for create, list, get, cancel, trigger, and summary routes.
- **service.ts**: Durable await writes, GitHub target preflight validation, pending queries, idempotent trigger handling, and chat runtime queue dispatch for resume messages.
- **poller.ts**: Source registry, interval tick, expiry handling, timer awaits, source checks, permanent source failure handling, and bounded trigger concurrency.
- **types.ts**: Source adapter and await lifecycle TypeScript contracts.
- **sources/github-api.ts**: Shared GitHub REST API boundary, token resolution, ETag cache, rate-limit tracking, missing-target classification, PR/check/status/review/workflow-run/workflow-job fetch helpers.
- **sources/github-ci.ts**: `github-ci` source. Supports `{ repo, pr }`, `{ repo, sha }`, and `{ repo, runs_id }` filters, validates target visibility during registration, resolves PR head SHAs or single check-run head SHAs, aggregates check runs plus legacy commit statuses, and exposes live CI status with optional GitHub Actions job steps.
- **sources/github-review.ts**: `github-review` source. Supports `{ repo, pr, mode }` filters, validates PR visibility during registration, and waits for PR review signals on the current PR head.

## GitHub Sources

`github-ci` waits for all visible check runs and commit statuses on the resolved ref to complete. With `{ repo, runs_id }`, it waits only for that GitHub check run ID and does not fold in sibling checks or legacy statuses from the same commit. It treats `success`, `neutral`, and `skipped` check conclusions as passing; `success` commit statuses as passing; pending signals as still pending; and any failure/error/cancelled/action-required signal as a completed failure. If no checks or statuses appear, it waits for `allowNoChecksAfterSeconds` or the default grace period before resuming with `noCIConfigured`.

GitHub await creation performs a read-only preflight against the target repo plus PR or commit. GitHub 404 and 422 responses are treated as non-retryable missing or inaccessible targets, so the create route returns `github_await_target_invalid` instead of registering an await that would poll forever. Other GitHub API failures return `github_await_validation_unavailable` and do not create the await. Existing pending awaits use the same missing-target classification in the poller and live-status route, then move to `failed` rather than remaining pending indefinitely.

The `github-ci` live-status route also reads GitHub Actions workflow runs for the resolved head SHA and projects workflow jobs plus job steps when available. This is a read-only display enhancement: await completion remains owned by the check-run and commit-status aggregate so legacy status contexts and branch-protection-facing checks stay part of the decision.

`github-review` waits for PR review state on the PR head SHA. Modes are:

- `approved`: at least one current-head approval and no current-head changes-requested review.
- `changes-requested`: at least one current-head changes-requested review.
- `reviewed`: any current-head submitted review signal.

These sources intentionally do not claim exact branch-protection equivalence. Required checks, required review counts, code owners, stale dismissal rules, and rulesets need separate GitHub permissions and should be modeled as a later source or explicit mode.
