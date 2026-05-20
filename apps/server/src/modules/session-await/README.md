<!--
Output: Session-await server module inventory and GitHub source contract.
Input: Elysia routes, durable session await rows, poller source adapters, and GitHub REST API projections.
Position: Server-owned await/resume runtime for chat sessions.
-->

# Session Await Module

`session-await` owns durable waits that can resume an existing chat session when an external condition becomes true. The module owns await lifecycle, polling, cancellation, manual trigger, summary projection, and source adapter registration.

## Files

- **index.ts**: Elysia routes under `/session-awaits`, poller startup, and live status dispatch for supported sources.
- **model.ts**: TypeBox request/response schemas for create, list, get, cancel, trigger, and summary routes.
- **service.ts**: Durable await writes, pending queries, idempotent trigger handling, and chat runtime resume dispatch.
- **poller.ts**: Source registry, interval tick, expiry handling, timer awaits, source checks, and bounded trigger concurrency.
- **types.ts**: Source adapter and await lifecycle TypeScript contracts.
- **sources/github-api.ts**: Shared GitHub REST API boundary, token resolution, ETag cache, rate-limit tracking, PR/check/status/review fetch helpers.
- **sources/github-ci.ts**: `github-ci` source. Supports `{ repo, pr }` and `{ repo, sha }` filters, resolves PR head SHAs, aggregates check runs plus legacy commit statuses, and exposes live CI status.
- **sources/github-review.ts**: `github-review` source. Supports `{ repo, pr, mode }` filters and waits for PR review signals on the current PR head.

## GitHub Sources

`github-ci` waits for all visible check runs and commit statuses on the resolved ref to complete. It treats `success`, `neutral`, and `skipped` check conclusions as passing; `success` commit statuses as passing; pending signals as still pending; and any failure/error/cancelled/action-required signal as a completed failure. If no checks or statuses appear, it waits for `allowNoChecksAfterSeconds` or the default grace period before resuming with `noCIConfigured`.

`github-review` waits for PR review state on the PR head SHA. Modes are:

- `approved`: at least one current-head approval and no current-head changes-requested review.
- `changes-requested`: at least one current-head changes-requested review.
- `reviewed`: any current-head submitted review signal.

These sources intentionally do not claim exact branch-protection equivalence. Required checks, required review counts, code owners, stale dismissal rules, and rulesets need separate GitHub permissions and should be modeled as a later source or explicit mode.
