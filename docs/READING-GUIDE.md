# Docs Reading Guide

Last reviewed: 2026-06-07

This guide is a triage map for the `docs/` directory. The directory currently mixes user-facing docs, current specs, living ExecPlans, old architecture notes, manual audits, and raw multi-agent handoffs. Do not read it alphabetically.

## Quick Verdict

`docs/` has about 503 Markdown documents. Most of the volume is not canonical product documentation:

- `docs/multi-work/`: 274 files. Mostly raw parallel review, exploration, critique, and synthesis handoffs.
- `docs/exec-plans/`: 100 files. Living and historical implementation plans.
- `docs/specs/`: 78 files. Future-facing capability specs.
- `docs/for-users/`: 10 files. User and integration documentation.
- `docs/superpowers/`: 11 files. Older workflow-generated specs/plans.
- Root-level architecture/audit docs: mixed current and historical context.

The useful read path is: current synthesis docs first, then current ExecPlans, then user docs, then specs by feature area. Treat old root architecture notes and most `multi-work/*Review*.md` files as evidence, not source of truth.

## Read First

Start here when trying to understand the current project state.

1. `docs/README.md`
   - Top-level inventory. It is useful but slightly stale.
2. `docs/multi-work/architecture-review/20260606-architecture-review-Main.md`
   - Most recent architecture synthesis. Best current summary of ownership, namespace, server/CLI, frontend/Electron, plugin, and skill boundary risks.
3. `docs/multi-work/private-release-readiness/20260606-private-release-readiness-Main.md`
   - Current private release verdict. The conclusion is that Cradle is not ready for private release testing.
4. `docs/multi-work/runtime-risk-audit/20260606-server-runtime-rereview-H.md`
   - Server runtime queue/settings/provider-model risks.
5. `docs/multi-work/runtime-risk-audit/20260606-frontend-runtime-rereview-G.md`
   - Frontend autosave and provider/model selection race risks.
6. `docs/exec-plans/20260606-01-chat-session-activity-frames.md`
   - Current chat session retention and Activity-frame plan.
7. `docs/exec-plans/20260606-02-react-doctor-health.md`
   - Current React Doctor health improvement plan and baseline.
8. `docs/codebase-audit-2026-05-30.md`
   - Broad codebase audit. Useful for coupling and risk background, but older than the 2026-06-06 reviews.

## Current Risk Themes

These are the recurring current concerns across the newest docs:

- Contract generation should not start runtime behavior. `pnpm gen:cli` currently composes the normal server app and can activate recovery, plugins, DB access, or other runtime paths.
- Renderer plugin boundaries are weaker than the capability model suggests because generic Electron IPC is exposed to plugin-reachable globals.
- Builtin skills must not become writable through agent-scope compatibility symlinks.
- `apps/web` should not depend directly on `@cradle/db` persistence row types.
- Provider target write ownership is split between `provider-targets` and `external-provider-sources`.
- Runtime setting/provider/model snapshots need stronger queue semantics, especially for live steer items and migrated queued rows.
- Frontend autosave flows can drop or overwrite provider/model/thinking changes during navigation or in-flight saves.
- Release readiness is blocked by red type/contract gates, non-distributable desktop artifacts, migration safety gaps, runtime diagnostics, packaging of plugins/skills, web runtime critical paths, E2E coverage, and tester onboarding.

## Read By Goal

### If You Are Fixing Architecture Boundaries

- `docs/multi-work/architecture-review/20260606-architecture-review-Main.md`
- `docs/exec-plans/20260531-01-provider-tool-call-mapper-refactor.md`
- `docs/exec-plans/20260524-03-provider-target-core-refactor.md`
- `docs/exec-plans/20260526-02-ai-sdk-v6-runtime-ownership.md`
- `docs/exec-plans/20260601-01-desktop-chat-stream-ownership.md`

### If You Are Preparing A Private Release

- `docs/multi-work/private-release-readiness/20260606-private-release-readiness-Main.md`
- `docs/exec-plans/20260522-02-v001-preview-release-readiness.md`
- `docs/for-users/private-release-tester-guide.md`
- `docs/for-users/preview-release-notes.md`
- `docs/for-users/troubleshooting.md`

Use the individual `docs/multi-work/private-release-readiness/*ReleaseAudit*.md` files only when drilling into a specific blocker.

### If You Are Working On Chat Runtime

- `docs/exec-plans/20260516-03-message-snapshot-chat-runtime.md`
- `docs/exec-plans/20260524-01-chat-session-steer-queue.md`
- `docs/exec-plans/20260524-02-chat-tool-entity-streaming.md`
- `docs/exec-plans/20260601-01-desktop-chat-stream-ownership.md`
- `docs/exec-plans/20260606-01-chat-session-activity-frames.md`
- `docs/multi-work/runtime-risk-audit/20260606-server-runtime-rereview-H.md`
- `docs/multi-work/runtime-risk-audit/20260606-frontend-runtime-rereview-G.md`

### If You Are Working On Plugins Or Skills

- `docs/exec-plans/20260518-04-plugin-system-v01.md`
- `docs/exec-plans/20260519-02-plugin-governance-runtime.md`
- `docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md`
- `docs/exec-plans/20260522-01-plugin-provided-chat-runtimes.md`
- `docs/specs/alma-inspired/plugin-runtime-marketplace.md`
- `docs/specs/alma-inspired/plugin-ui-primitives.md`
- `docs/multi-work/plugin-system-design/20260518-final-SynthesisE.md`
- `docs/multi-work/plugin-system-decoupling/20260519-wibus-decisions-Main.md`

### If You Are Working On Agent / Multi-Agent Direction

- `docs/ROADMAP-agent-experience.md`
- `docs/specs/multi-agent-collaboration.md`
- `docs/specs/multi-agent-pattern-matrix.md`
- `docs/specs/multi-agent-runtime-architecture.md`
- `docs/specs/multica-inspired/README.md`
- `docs/specs/linear-ai-intelligence/README.md`
- `docs/exec-plans/20260521-02-automation-platform.md`
- `docs/exec-plans/20260525-01-unclosed-feature-audit.md`

### If You Are Working On Jarvis / Context / Chronicle

- `docs/specs/jarvis-context-engine.md`
- `docs/exec-plans/20260526-01-jarvis-context-engine.md`
- `docs/exec-plans/20260519-03-cradle-chronicle.md`
- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
- `docs/exec-plans/20260523-01-rust-chronicle-core.md`
- `docs/draft-solutions/done/yansu-chronicle-spec.md`
- `docs/draft-solutions/done/codex-chronicle-spec.md`

### If You Are Updating User Docs

- `docs/for-users/README.md`
- `docs/for-users/quick-start.md`
- `docs/for-users/end-user-guide.md`
- `docs/for-users/integrations-guide.md`
- `docs/for-users/cli-reference.md`
- `docs/for-users/ipc-api-reference.md`
- `docs/for-users/data-model-and-storage.md`
- `docs/for-users/private-release-tester-guide.md`
- `docs/for-users/preview-release-notes.md`
- `docs/for-users/troubleshooting.md`

This folder is the closest thing to a user-facing contract. Update it alongside behavior changes.

## Mostly Historical Or Supporting Context

Read these only for background or archaeology:

- `docs/SPEC-v1.md`
- `docs/SPEC-v2.md`
- `docs/agent-client-console-architecture.md`
- `docs/architecture-review-2026-04-21.md`
- `docs/backend-architecture-overhaul-2026-05-04.md`
- `docs/superpowers/*`
- Most `docs/multi-work/*/*Review*.md`, `*Exploration*.md`, `*Critique*.md`, and `*Worker*.md` files.

When a `multi-work` folder has a `*Main.md`, `*Synthesis*.md`, or `README.md`, read that first and only open the worker/review files for evidence.

## README Drift Found

Several inventories are stale:

- `docs/README.md` was missing `READING-GUIDE.md`, `architecture-tabs-next.md`, and `codebase-audit-2026-05-30.md`; those root entries were added during this review.
- `docs/exec-plans/README.md` is missing many current plans, including the 2026-06-06 plans.
- `docs/specs/README.md` is missing `diff-rendering-research.md`.
- `docs/draft-solutions/README.md` is missing `i18n.md` and does not inventory `done/`.
- `docs/superpowers/plans/README.md` is missing `2026-05-08-server-capability-wave-2.md`.

Do not assume a file is unimportant because it is absent from a README.

## Maintenance Recommendation

Keep this structure going forward:

- Canonical user docs stay in `docs/for-users/`.
- Current implementation plans stay in `docs/exec-plans/`.
- Future product/capability specs stay in `docs/specs/`.
- One-off evidence and manual audits stay in `docs/manual-reports/`.
- Parallel agent output stays in `docs/multi-work/`, but each run should have a `README.md`, `*Main.md`, or `*Synthesis*.md` entrypoint.
- Historical docs should be explicitly marked historical in their title or opening paragraph.
