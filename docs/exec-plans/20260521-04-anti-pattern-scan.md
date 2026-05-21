# Repository-wide anti-pattern scan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is intentionally self-contained so a fresh contributor can continue the scan without prior chat history.

## Purpose / Big Picture

The goal is to inspect the current Cradle working tree for maintainability anti-patterns, especially helper/tooling code that can silently spread duplication, ownership leaks, and generated-code drift. After this work, Wibus should have a concrete, evidence-backed list of anti-patterns across server, web, CLI/generation, desktop, Rust, and plugin/helper surfaces, plus targeted fixes for high-confidence issues where the blast radius is acceptable.

This is a scan-and-remediation task, not a feature build. A successful result is demonstrated by handoff reports under `docs/multi-work/anti-pattern-scan/`, this plan being updated with findings and decisions, and verification commands showing that any changed code still passes the relevant checks.

## Progress

- [x] (2026-05-20 17:46Z) Read `multi-work` and `execplan` skill instructions and confirmed that a DAG-style scan requires an ExecPlan plus handoff files.
- [x] (2026-05-20 17:46Z) Inspected the current repository file inventory and `git status --short`; the worktree already contains broad unrelated modifications, so this scan must preserve existing changes.
- [x] (2026-05-20 17:46Z) Created the handoff directory `docs/multi-work/anti-pattern-scan/`.
- [x] (2026-05-20 17:53Z) Spawned four independent scan agents for server/backend, web/frontend, CLI/generated tooling, and desktop/Rust/plugin-helper surfaces.
- [x] (2026-05-20 18:02Z) Received all four handoff reports under `docs/multi-work/anti-pattern-scan/` and confirmed each report contains scope, findings, evidence, recommended fixes, verification, uncertainties, and quality gate.
- [x] (2026-05-20 18:05Z) Ran local static searches for high-signal anti-patterns and compared the results against the agent findings.
- [x] (2026-05-20 18:10Z) Applied targeted remediation for the highest-confidence low-risk issues: workspace skill write namespace, test reset HOME cleanup, CLI boolean flag parsing, automation CLI description drift, and stale skills module README inventory.
- [x] (2026-05-20 18:12Z) Ran targeted verification commands for the touched server and CLI areas; the server tests, CLI tests, and both package typechecks passed.
- [x] (2026-05-20 18:15Z) Created the merged synthesis report `docs/multi-work/anti-pattern-scan/20260521-synthesis-Main.md`.
- [x] (2026-05-20 18:15Z) Completed final static audit: all handoff reports exist, workspace skill writes no longer target `.agents/skills`, emitted Cradle CLI skill docs no longer contain the generic automation fallback, and the remaining findings are recorded as backlog rather than falsely marked fixed.

## Surprises & Discoveries

- Observation: The worktree is already heavily modified across desktop, server, web, CLI generation, database schema, and Chronicle.
  Evidence: `git status --short` shows modified files such as `apps/server/src/modules/issue/service.ts`, `apps/web/src/features/kanban/issue-detail/activity-timeline.tsx`, `packages/cli/scripts/generate-cli.ts`, `chronicle/src/daemon.rs`, and many untracked feature directories.

- Observation: The dynamic Tailwind class construction check was cleaner than expected.
  Evidence: Local searches and `ReviewB` found no application-level dynamic Tailwind utility construction in `apps/web`, `packages/tabs-next`, or `packages/streamdown`; the dynamic streamdown class names are BEM-style package classes, not Tailwind utilities.

- Observation: The most dangerous confirmed server tooling issue was a test helper, not a production route.
  Evidence: `ReviewA` found `/test/reset` deleting `path.join(os.homedir(), '.cradle', 'skills')`; the fix now cleans HOME skills only when HOME is inside the active `CRADLE_DATA_DIR`.

- Observation: Managed E2E server startup needed HOME isolation to make the safer reset behavior testable end to end.
  Evidence: `e2e/src/support/server-lifecycle.ts` now sets `HOME` to `join(dataDir, 'home')` when starting the managed server.

- Observation: Generated CLI boolean handling had a broad correctness bug at the runtime layer.
  Evidence: `operation-command.ts` previously parsed booleans with `Boolean(value)` and generated only `--flag`; optional booleans now support `--flag` and `--no-flag`, while required booleans parse strict `true` / `false`.

- Observation: The emitted Cradle CLI skill module table no longer contains the generic automation fallback, but the generator fallback string intentionally remains as a last-resort default.
  Evidence: `rg -n "Generated Cradle CLI module\\." packages/cli resources/skills/cradle-cli/SKILL.md` now reports only `packages/cli/scripts/generate-cli.ts`.

## Decision Log

- Decision: Use a DAG-style `multi-work` scan rather than a single serial read-through.
  Rationale: The objective explicitly asks to use `$multi-work`, and the repository naturally decomposes into independent ownership surfaces that can be reviewed in parallel.
  Date/Author: 2026-05-20 / Codex.

- Decision: Treat this pass as evidence-first review with targeted remediation, not broad refactoring.
  Rationale: The worktree contains many unrelated active edits. Large speculative refactors would risk overwriting or entangling work that is outside this scan.
  Date/Author: 2026-05-20 / Codex.

- Decision: Fix only high-confidence issues with clear ownership during this pass, and record larger architecture issues as backlog.
  Rationale: Findings such as preload IPC hardening, browser-use socket authentication, plugin shared config ownership, legacy CLI removal, and frontend BrowserPanel decomposition need explicit design boundaries and broader tests. Patching around them locally would make the architecture less clear.
  Date/Author: 2026-05-20 / Codex.

- Decision: Move workspace-owned skills to `<workspace>/.cradle/skills` while retaining `.agents/skills` as read-only legacy compatibility.
  Rationale: This follows the repository ownership rule: Cradle may read agent-owned namespaces for compatibility, but Cradle-owned writes must live under a Cradle namespace.
  Date/Author: 2026-05-20 / Codex.

- Decision: Do not run `pnpm gen:cli` as part of the automation description fix.
  Rationale: The generated command directory already contains many unrelated uncommitted changes in the active worktree. Running the full generator could amplify unrelated diffs. The generator source, runtime description, and emitted skill block were aligned manually for this small drift fix.
  Date/Author: 2026-05-20 / Codex.

## Outcomes & Retrospective

The repository-wide anti-pattern scan is complete. Four independent `multi-work` handoff reports were produced, and the main synthesis report reconciles the findings into fixed items, confirmed high/medium/low backlog, checked-without-issue notes, and validation evidence.

Targeted remediation landed for the highest-confidence low-risk issues: workspace skill namespace ownership, `/test/reset` HOME safety, CLI boolean false handling, automation CLI module description drift, and stale skills module README inventory. The touched server and CLI areas passed focused tests and typechecks.

The remaining confirmed issues are intentionally not marked fixed. They include architecture and ownership work such as legacy `src/cli` removal/renaming, generated automation SDK migration, BrowserPanel decomposition, preload IPC hardening, Chronicle URL ownership, plugin shared config namespacing, browser-use socket authentication, FTS schema ownership, and several helper/process lifecycle cleanups. These are recorded in `docs/multi-work/anti-pattern-scan/20260521-synthesis-Main.md` so future work can proceed from evidence rather than rediscovery.

## Context and Orientation

Cradle is a multi-package repository. The main TypeScript backend lives under `apps/server/`. Its modules are organized by capability in `apps/server/src/modules/`, with shared HTTP, logging, plugin, and helper code under `apps/server/src/http/`, `apps/server/src/logging/`, `apps/server/src/plugins/`, and `apps/server/src/helpers/`. Backend tests live under `apps/server/tests/`.

The React frontend lives under `apps/web/`. Feature-specific UI should live under `apps/web/src/features/{domain}/`, shared app-specific components under `apps/web/src/components/common/`, and reusable primitives under `apps/web/src/components/ui/`. The repository rule in `AGENTS.md` forbids dynamic Tailwind class construction and requires use of the design system conventions.

The generated CLI lives under `packages/cli/`. The generator is `packages/cli/scripts/generate-cli.ts`, generated commands are under `packages/cli/src/commands/generated/`, and runtime helpers are under `packages/cli/src/runtime/`. Anti-patterns in this surface are particularly important because generator mistakes multiply across generated files.

The Electron desktop app lives under `apps/desktop/`, with main-process code under `apps/desktop/src/main/` and preload code under `apps/desktop/src/preload/`. Chronicle is the Rust component under `chronicle/`, with recorder and screen submodules under `chronicle/src/recorder/` and `chronicle/src/screen/`. Plugins and skills live under `plugins/` and `resources/skills/`.

For this plan, an "anti-pattern" means code or structure that weakens maintainability, correctness, or ownership clarity. Examples include duplicated helper logic that should have a single owner, modules writing into namespaces they do not own, raw SQL where Drizzle is required, dynamic Tailwind class construction, generated files edited manually when the generator owns them, helpers with ambiguous names or hidden side effects, circular or cross-domain dependencies, broad singleton state that bypasses module boundaries, and test gaps around non-trivial logic.

## Plan of Work

First, create independent handoff reports using `multi-work`. Each agent reads this plan and the relevant repository files directly, then writes a self-contained Markdown report into `docs/multi-work/anti-pattern-scan/`. The initial scan nodes are server/backend, web/frontend, CLI/generated tooling, and desktop/Rust/plugin-helper surfaces. Each report must include evidence with file paths and line references, severity, why it is an anti-pattern, recommended fix direction, and verification.

Second, run local static searches from the main agent for high-signal patterns that may cut across ownership boundaries. These searches include dynamic Tailwind strings, raw SQL usage, helper naming smells, broad `any` casts, generated-code edits, duplicated fetch/retry or path resolution helpers, and namespace writes into foreign directories.

Third, merge agent reports with local evidence into one prioritized finding set. The merge should identify duplicates, distinguish definite issues from weak signals, and choose a small number of high-confidence fixes. A finding should not be called fixed until the current worktree and relevant checks prove it.

Fourth, implement only targeted remediation where the owner is clear and the fix does not rewrite unrelated active work. If a finding requires an architectural migration, record it as an escalation instead of patching around it.

Finally, validate touched areas with the smallest commands that actually cover the changes. For TypeScript server work, prefer package-specific tests such as `pnpm --filter @cradle/server test -- <test file>` when available. For web changes, run relevant Vitest tests or type/lint checks. For CLI generator changes, run generator tests or inspect regenerated output. For Rust Chronicle changes, run `cargo test` from `chronicle/` if Rust code changes.

## Concrete Steps

From repository root `/Users/wibus/dev/Cradle`, run:

    git status --short

Use the output to avoid overwriting unrelated active changes. Then create the handoff directory if it does not already exist:

    mkdir -p docs/multi-work/anti-pattern-scan

Spawn independent scan agents. Each agent wrote one file:

    docs/multi-work/anti-pattern-scan/20260521-server-backend-ReviewA.md
    docs/multi-work/anti-pattern-scan/20260521-web-frontend-ReviewB.md
    docs/multi-work/anti-pattern-scan/20260521-cli-tooling-ReviewC.md
    docs/multi-work/anti-pattern-scan/20260521-desktop-rust-plugins-ReviewD.md

Merge the reports into the synthesis file:

    docs/multi-work/anti-pattern-scan/20260521-synthesis-Main.md

Run local static search commands. The command set evolved as findings appeared, but included `rg` searches over TypeScript, TSX, Rust, SQL migrations, and Markdown docs. Important outputs are recorded in `Artifacts and Notes` and in the synthesis report.

After reports were written, read each handoff file, merged findings, and updated this plan's `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`.

Targeted verification commands run during the remediation pass:

    cd /Users/wibus/dev/Cradle/apps/server
    pnpm exec vitest run tests/test-reset.test.ts tests/skills.test.ts

    cd /Users/wibus/dev/Cradle/packages/cli
    pnpm exec vitest run src/runtime/operation-command.test.ts src/runtime/http-client.test.ts

    cd /Users/wibus/dev/Cradle
    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/server typecheck

Final static audit commands:

    cd /Users/wibus/dev/Cradle
    find docs/multi-work/anti-pattern-scan -maxdepth 1 -type f -print | sort
    rg -n "workspace.*\\.agents|path\\.join\\(context\\.workspacePath, '.agents'|skills\\.module\\.ts|skills\\.controller\\.ts|Generated Cradle CLI module\\." apps/server/src/modules/skills packages/cli resources/skills/cradle-cli/SKILL.md
    rg -n "\\.agents.*skills|agents.*skills" apps/server/src/modules/skills apps/server/tests/skills.test.ts

## Validation and Acceptance

Acceptance requires evidence for each part of the user's objective.

The scan scope is accepted because all planned handoff files exist and each is self-contained, evidence-backed, and covers its assigned ownership surface. The synthesis report adds a fifth file that reconciles the four reports and prevents duplicate findings from being lost.

The anti-pattern analysis is accepted because the merged finding set specifically evaluates helper/tooling code and DRY/SOLID concerns. It distinguishes between fixed findings, confirmed backlog, low-severity smells, and areas checked without finding a problem.

Remediation is accepted for the patches applied in this pass because they are small enough to review, aligned with ownership rules, and verified by targeted tests or static checks. Larger confirmed findings remain backlog because they need broader architecture work.

Completion of the broader goal is supported by the final audit against this acceptance list. The scan is complete; not every anti-pattern is fixed, but every confirmed finding from this pass is either remediated with verification evidence or recorded as backlog with owner, severity, and recommended validation.

## Idempotence and Recovery

The scan is safe to repeat. Handoff files are additive review artifacts under `docs/multi-work/anti-pattern-scan/`. If an agent report is incomplete, create a new corrected handoff file rather than editing unrelated reports. If a code fix causes failures, prefer a minimal follow-up patch in the touched files; do not use destructive Git commands.

Because the current worktree is already dirty, do not revert or rewrite files unless Wibus explicitly asks. Before editing any business code, re-read the specific file and check `git diff -- <path>` so the patch works with current changes.

## Artifacts and Notes

Initial setup evidence:

    $ date -u '+%Y-%m-%d %H:%MZ'
    2026-05-20 17:46Z

    $ git status --short
    M apps/desktop/electron-builder.yml
    M apps/server/src/app.ts
    M apps/web/src/app.tsx
    M chronicle/src/daemon.rs
    M packages/cli/scripts/generate-cli.ts
    ?? apps/server/src/modules/automation/
    ?? docs/exec-plans/20260521-01-workspace-scoped-issue-owner.md

The status excerpt is intentionally abbreviated; the full command should be rerun when continuing work.

Handoff inventory evidence from final audit:

    docs/multi-work/anti-pattern-scan/20260521-cli-tooling-ReviewC.md
    docs/multi-work/anti-pattern-scan/20260521-desktop-rust-plugins-ReviewD.md
    docs/multi-work/anti-pattern-scan/20260521-server-backend-ReviewA.md
    docs/multi-work/anti-pattern-scan/20260521-synthesis-Main.md
    docs/multi-work/anti-pattern-scan/20260521-web-frontend-ReviewB.md

Targeted verification evidence:

    apps/server: pnpm exec vitest run tests/test-reset.test.ts tests/skills.test.ts
    Result: passed, 2 files, 4 tests.

    packages/cli: pnpm exec vitest run src/runtime/operation-command.test.ts src/runtime/http-client.test.ts
    Result: passed, 2 files, 3 tests.

    pnpm --filter @cradle/cli typecheck
    Result: passed.

    pnpm --filter @cradle/server typecheck
    Result: passed.

Static audit evidence:

    Search for workspace `.agents` writes and stale skills README names now has no workspace write hit. The only `Generated Cradle CLI module.` hit is the generator fallback string in `packages/cli/scripts/generate-cli.ts`.

## Interfaces and Dependencies

The scan depends on the repository's existing toolchain: `rg` for fast search, `git status` and `git diff` for current-state evidence, `pnpm` for TypeScript package tests, and `cargo` for Chronicle tests if Rust is touched.

The handoff files are the interface between scan agents and the main merge step. Each handoff must include:

    # <surface> anti-pattern scan

    ## Scope
    Repository paths and ownership surfaces reviewed.

    ## Findings
    Ordered findings with severity, file path, line reference, evidence, why it matters, recommended fix, and verification.

    ## Checked Without Finding Issues
    Important searches or files that were reviewed but did not produce a finding.

    ## Uncertainties
    Any weak evidence or follow-up needed.

    ## Quality Gate
    A short statement that the file is self-contained and addresses the assigned acceptance criteria.

Revision note: Initial plan created to satisfy `multi-work` DAG prerequisites and define the anti-pattern scan workflow.

Revision note: Updated after completing the four-node scan, synthesis report, targeted remediation, verification, and final acceptance audit.
