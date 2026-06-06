# Improve React Doctor Health

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

The repository currently reports a React Doctor score of `38 / 100 Critical` on a full scan. This work raises the score by fixing real React correctness, data-flow, accessibility, and compiler issues before broad maintainability cleanup. A user can see the work succeeding by running React Doctor from the repository root and observing fewer error-level diagnostics and a higher score, especially in `@cradle/web`.

This plan does not treat every React Doctor warning as equally valid. Generated files, duplicate scan roots, and style rules that conflict with the repository design can be configured or deferred. React Hooks rules, render purity, state ownership, accessible interactive roles, and reduced-motion support are treated as real product quality issues unless source inspection proves a false positive.

## Progress

- [x] (2026-06-06 12:09Z) Captured the baseline React Doctor result: full scan score `38 / 100 Critical`, `453 errors`, `4540 warnings`, and `@cradle/web` score `42 Needs work`.
- [x] (2026-06-06 12:09Z) Confirmed the worktree is heavily dirty and must be edited carefully without reverting unrelated user changes.
- [ ] Use Multi-Work DAG-style investigation to produce handoff files for hooks/data flow, compiler purity, and scan-scope/configuration.
- [ ] Apply the first batch of deterministic fixes for error-level diagnostics that are backed by source inspection.
- [ ] Run React Doctor again, preferably `--diff` after edits and full scan when practical, then record score and issue-count changes.
- [ ] Update this plan with decisions, discoveries, and remaining high-value follow-up work.

## Surprises & Discoveries

- Observation: The full React Doctor output appears to count duplicate file roots such as `apps/web/src/...` and `src/...` for the same package content.
  Evidence: The same diagnostics were reported for pairs such as `apps/web/src/features/agent-management/agent-detail.tsx:493` and `src/features/agent-management/agent-detail.tsx:493`.

## Decision Log

- Decision: Prioritize error-level React semantics and data-flow fixes before maintainability warnings.
  Rationale: Hooks rule violations, render impurity, and compiler bailouts can represent real correctness and scheduling hazards in React 19, while many maintainability warnings are architectural preferences that need owner-level review.
  Date/Author: 2026-06-06 / Codex

- Decision: Use React Doctor configuration only to remove duplicate/generated scan noise, not to suppress valid application diagnostics.
  Rationale: The user's goal is to improve the real React health score, not hide defects. However, duplicate scan roots distort prioritization and can make progress look worse or better than reality.
  Date/Author: 2026-06-06 / Codex

- Decision: In this first implementation pass, sub-agents produce analysis handoff files instead of editing source files.
  Rationale: The worktree has many unrelated edits. Keeping writes centralized avoids merge conflicts and preserves ownership of final architecture decisions.
  Date/Author: 2026-06-06 / Codex

## Outcomes & Retrospective

No implementation milestone is complete yet. The current outcome is a recorded baseline and a constrained execution path for improving React Doctor score without masking real React problems.

## Context and Orientation

React Doctor is a static analyzer for React projects. It reports a health score from `0` to `100` and groups diagnostics into security, bugs, performance, accessibility, and maintainability. In this repository, a full scan is run from `/Users/wibus/dev/Cradle` with:

    npx -y react-doctor@latest . --verbose

The most important web application code lives under `apps/web/src`. The repository also contains package-local paths that React Doctor may show as `src/...` when scanning individual package roots. When the same logical file is shown under both `apps/web/src/...` and `src/...`, source edits should be made in the real repository file under `apps/web/src/...`.

The first baseline wrote diagnostics to:

    /var/folders/vx/5kj6zs2n1zsb9k23r5gm9qbh0000gn/T/react-doctor-71b76d8b-ebae-43d0-ab94-c97104efd92f

Important baseline diagnostic files include `react-doctor--rules-of-hooks.txt`, `react-hooks-js--purity.txt`, `react-hooks-js--hooks.txt`, `react-doctor--role-has-required-aria-props.txt`, `react-doctor--require-reduced-motion.txt`, and `react-hooks-js--incompatible-library.txt`.

React 19 is the target React version. React 19 allows `ref` as a normal prop for function components and includes released APIs such as `use` and `useActionState`. The React Compiler still requires render functions and hooks to be pure and hooks to be called unconditionally at the top level. Code should use existing repository state libraries first, especially Zustand stores already present under `apps/web/src/store`, instead of inventing new projections or state containers. New libraries such as `foxact` should only be added if source inspection shows they materially improve React data-flow semantics.

## Plan of Work

First, inspect the React Doctor diagnostic files and the affected source files. Split the investigation into independent areas: hooks/data flow, compiler purity, and scan scope/configuration. Each investigation writes a self-contained handoff file in `docs/multi-work/react-doctor-health/` using the Multi-Work handoff convention.

Second, merge the handoff findings and choose fixes that are deterministic and low risk. Expected first-pass fixes include removing Effect Event callbacks from dependency arrays, avoiding conditional hook call patterns, moving impure `Math.random()` work out of render-time calculations, adding missing ARIA props or replacing incorrect roles in tests, and adding reduced-motion CSS where animation behavior is global.

Third, edit only the files required for selected fixes. For frontend code, use static Tailwind classes and the repository `cn()` helper when combining classes. Do not add frontend component tests solely to satisfy this plan unless source inspection shows a correctness bug that needs coverage. Keep generated API files and unrelated user edits unchanged.

Fourth, run verification. The minimum validation is:

    npx -y react-doctor@latest . --verbose --diff

If the diff scan is clean enough and time permits, run the full scan again:

    npx -y react-doctor@latest . --verbose

Record score deltas, remaining errors, and any false-positive or deferral decisions in this plan.

## Concrete Steps

Run from `/Users/wibus/dev/Cradle`:

    git status --short
    npx -y react-doctor@latest . --verbose

Expected baseline from the first run:

    All 4993 issues
    Security › 16 warnings
    Bugs › 112 errors, 605 warnings
    Performance › 338 errors, 406 warnings
    Accessibility › 3 errors, 288 warnings
    Maintainability › 3225 warnings
    38 / 100 Critical

Create the Multi-Work handoff directory if it does not exist:

    mkdir -p docs/multi-work/react-doctor-health

Inspect relevant files with `sed`, `rg`, and `git diff -- <path>` before editing. Apply source edits with `apply_patch`. After edits, run:

    npx -y react-doctor@latest . --verbose --diff

If the command exits nonzero because diagnostics remain, that is acceptable for intermediate milestones. Record the score and changed diagnostics instead of treating any remaining issue as a command failure.

## Validation and Acceptance

The first milestone is accepted when at least one error-level React Doctor diagnostic class is reduced or removed by source changes, and no unrelated user changes are reverted. The proof is the React Doctor `--diff` output plus `git diff -- <edited paths>`.

The broader goal is accepted only when the full React Doctor score is materially higher than `38`, error-level diagnostics are significantly reduced, and remaining ignored or deferred diagnostics have explicit rationale. Because the user requested "尽可能" rather than a fixed number, completion requires a final audit showing that the remaining high-impact issues are either fixed, proven false positives, or explicitly out of scope for a reasonable first governance pass.

## Idempotence and Recovery

All analysis commands are read-only and can be repeated. Source edits are made with small patches after checking existing diffs. If a patch conflicts with user changes, stop and inspect the current file instead of reverting. React Doctor output directories under the system temporary directory are disposable and can be regenerated by rerunning the scan.

Do not run destructive Git commands. Do not reset, checkout, or delete user changes. If a validation command needs network and fails because of sandbox restrictions, rerun it with the appropriate approval request.

## Artifacts and Notes

Baseline summary:

    React Doctor v0.4.0
    Scanned 1988 files in 128.8s
    All 4993 issues
    38 / 100 Critical
    @cradle/web 42 Needs work

The scan also reported:

    React Doctor is not installed in this project.
    npx react-doctor install --yes

Installing React Doctor is not required for this plan unless repeated scans become cumbersome. If installation is considered later, it should be treated as a dependency and script change, not as part of the first source-fix milestone.

## Interfaces and Dependencies

The implementation uses the existing React 19 application code and existing state libraries. The primary dependency is `react-doctor@latest` invoked through `npx -y`; no source dependency is required for diagnostics. If global state changes are needed, use existing Zustand stores under `apps/web/src/store` or feature-owned hooks before adding new libraries.

Handoff files must be placed under:

    docs/multi-work/react-doctor-health/

The expected handoff filenames for this pass are:

    docs/multi-work/react-doctor-health/20260606-hooks-data-flow-ExplorationA.md
    docs/multi-work/react-doctor-health/20260606-compiler-purity-ExplorationB.md
    docs/multi-work/react-doctor-health/20260606-scan-scope-ExplorationC.md

Revision note 2026-06-06: Initial plan created from the React Doctor baseline and Multi-Work requirements so the score-improvement work can continue across turns without losing context.
