# Session Await Feature

Renderer-owned UI for chat session awaits in the right aside. The feature lets a user create GitHub checks or review awaits for the active session and inspect live status for pending awaits.

## Files

- **await-panel-loader.ts**: Shared lazy loader and intent preload entry for the right aside Feed tab.
- **awaits-overview-loader.ts**: Shared lazy loader and route preload entry for the Awaits overview tab.
- **awaits-overview.tsx**: Full-tab overview of pending awaits from the Desktop read-only projection.
- **await-panel.tsx**: Await panel, GitHub composer, source cards, check/status tree rendering, and PR review status rendering; GitHub checks render success, failure, skipped/cancelled, and running states with separate icon semantics; session await reads use the shared interactive query refresh policy and live GitHub status keeps an explicit slower interval; records the global right-aside Feed first-render mark once per module lifetime after the session awaits query succeeds.
- **await-github.ts**: GitHub repository detection and target parsing helpers for human-created awaits, including GitHub check-run `/runs/<id>` URLs.
- **await-github.test.ts**: Regression coverage for GitHub repo detection, target parsing, and PR-number inference.

## GitHub Composer

The composer supports two GitHub await sources:

- `github-ci`: waits for check runs plus legacy commit statuses on a PR head or commit/ref, or waits for one explicit GitHub check run when the target is a `/runs/<id>` URL.
- `github-review`: waits for PR review signals. Review awaits require a PR number because review state is PR-scoped.

The target input intentionally has no separate PR/commit type switch. A positive integer is treated as a PR number; a GitHub check-run URL containing `/runs/<id>` is treated as `runs_id`; any other valid Git ref/SHA string is treated as a commit/ref for checks.
