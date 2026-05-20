<!--
Output: Session-await web feature inventory.
Input: Session await API query hooks, GitHub remotes/status data, and live status projections.
Position: Renderer UI for creating and inspecting chat session awaits.
-->

# Session Await Feature

Renderer-owned UI for chat session awaits in the right aside. The feature lets a user create GitHub checks or review awaits for the active session and inspect live status for pending awaits.

## Files

- **await-panel.tsx**: Await panel, GitHub composer, source cards, check/status tree rendering, and PR review status rendering.
- **await-github.ts**: GitHub repository detection and target parsing helpers for human-created awaits.
- **await-github.test.ts**: Regression coverage for GitHub repo detection, target parsing, and PR-number inference.

## GitHub Composer

The composer supports two GitHub await sources:

- `github-ci`: waits for check runs plus legacy commit statuses on a PR head or commit/ref.
- `github-review`: waits for PR review signals. Review awaits require a PR number because review state is PR-scoped.

The target input intentionally has no separate PR/commit type switch. A positive integer is treated as a PR number; any other valid Git ref/SHA string is treated as a commit/ref for checks.
