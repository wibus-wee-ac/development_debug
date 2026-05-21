# Remove File Header Metadata Comments

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the local ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained and records the scoped cleanup requested by Wibus.

## Purpose / Big Picture

Wibus wants the repository cleaned of file-opening metadata comments shaped as `// Input:`, `// Output:`, and `// Position:`. These comments were added as mechanical documentation headers and now create noise at the top of source files. After this change, real code files should no longer start with those three metadata comments, while historical design documents and newly written planning artifacts should remain intact unless they are part of the codebase surface being cleaned.

The observable result is a repository search that finds no matching metadata headers in real source, test, script, package, plugin, or e2e code files. The cleanup should not rewrite unrelated user changes.

## Progress

- [x] (2026-05-21 12:00 CST) Read the `$multi-work` skill and the ExecPlan rules that are required before using the DAG workflow.
- [x] (2026-05-21 12:03 CST) Ran an initial repository search for `// Input:`, `// Output:`, and `// Position:` and confirmed many matches across source files plus historical documentation snippets.
- [x] (2026-05-21 12:07 CST) Created independent exploration handoffs for `apps/src/e2e` and `packages/plugins/chronicle`.
- [x] (2026-05-21 12:15 CST) Removed matching metadata comments from source, test, script, Rust, Gherkin, and generated CLI command files; also removed the CLI generator template that would recreate the comments.
- [x] (2026-05-21 12:24 CST) ReviewC found one untracked source blocker in `apps/desktop/src/main/tray-manager.ts`; removed that metadata header.
- [x] (2026-05-21 12:31 CST) ReviewD found three tracked source blockers in `apps/desktop/src/main/main-app.ts`, `apps/desktop/src/preload/index.ts`, and `apps/server/src/app.ts`; removed those metadata headers.
- [x] (2026-05-21 12:36 CST) Extended cleanup to `.github/workflows/release-desktop-velopack.yml` and active README/MDX metadata blocks outside `docs/**`.
- [x] (2026-05-21 12:40 CST) Re-scanned the repository outside `docs/**`, dependency folders, build outputs, coverage, targets, and release artifacts; strict comment-prefix metadata search returned no matches and `git diff --check` returned clean output.
- [x] (2026-05-21 12:46 CST) ReviewE passed with no cleanup-specific blockers; recorded final outcome and caveats.

## Surprises & Discoveries

- Observation: The pattern is much broader than the issue module example.
  Evidence: `rg -n "^// (Input|Output|Position):" .` returned matches across `src`, `apps`, `packages`, `plugins`, and `e2e`, plus historical docs.

- Observation: Some metadata headers were reintroduced or missed because files were untracked or concurrently changed.
  Evidence: ReviewC found `apps/desktop/src/main/tray-manager.ts`; ReviewD found `apps/desktop/src/main/main-app.ts`, `apps/desktop/src/preload/index.ts`, and `apps/server/src/app.ts`.

- Observation: The same mechanical metadata existed outside TypeScript/Rust source comments.
  Evidence: `.github/workflows/release-desktop-velopack.yml` used `# Input:` style YAML comments, and active README/MDX files outside `docs/**` used HTML or MDX comment metadata blocks.

## Decision Log

- Decision: Scope removal to real code files rather than every textual occurrence in the repository.
  Rationale: The user asked to remove code-file header comments. Matches inside `docs/superpowers/plans/**`, `docs/exec-plans/**`, or `docs/multi-work/**` can be historical examples, plan content, or required process artifacts. Removing those would rewrite design history without improving runtime code.
  Date/Author: 2026-05-21 / Codex

- Decision: Use a mechanical file-header cleanup rather than hand-editing each file.
  Rationale: The target pattern is uniform: three leading line comments with labels `Input`, `Output`, and `Position`, optionally followed by a blank line. A mechanical pass is lower risk than manual edits across many files, provided the final search verifies no code-file matches remain.
  Date/Author: 2026-05-21 / Codex

- Decision: Remove the CLI generator template headers in addition to generated command file headers.
  Rationale: Leaving `packages/cli/scripts/generate-cli.ts` unchanged would cause future generated command modules to reintroduce the metadata comments.
  Date/Author: 2026-05-21 / Codex

- Decision: Expand cleanup to active repository documentation outside `docs/**`, including module README files, server capability specs, and `documentations/**` MDX pages.
  Rationale: These files used the same `Input` / `Output` / `Position` metadata header blocks as live file headers. They are active docs, not historical planning records.
  Date/Author: 2026-05-21 / Codex

## Outcomes & Retrospective

The cleanup removed the targeted metadata headers from live code, scripts, workflow configuration, generated CLI modules, generator templates, active module README files, server capability specs, and active MDX documentation outside `docs/**`. Historical planning and multi-work artifacts under `docs/**` remain intentionally out of scope.

Two independent review passes failed usefully by finding missed or reintroduced live source headers. Those blockers were fixed, and the final local validation commands now return no strict metadata-header matches outside `docs/**` and generated/build/release/dependency folders.

Final ReviewE passed with no cleanup-specific blockers. The remaining dirty working tree includes unrelated pre-existing feature and documentation work, but this cleanup has no known open metadata-header residue outside the intentionally excluded historical/planning areas.

## Context and Orientation

The repository root is `/Users/wibus/dev/Cradle`. The target anti-pattern is a file header that appears before imports or other code:

    // Input: ...
    // Output: ...
    // Position: ...

These lines are not license headers, compiler directives, or semantic comments. They are repository-local metadata summaries. The cleanup must delete them when they appear as the first non-shebang content at the top of real code files.

Documentation files under `docs/**` can contain historical plan excerpts that mention this pattern. Those are not part of the cleanup unless they are newly created artifacts for this work. The final validation should distinguish code matches from documentation matches.

## Plan of Work

First, run independent exploration over major repository areas to confirm which code files contain the target headers and whether variants exist. The expected independent areas are application/server code, application/web code, packages, plugins, root `src`, and e2e support.

Second, run a mechanical cleanup over real code extensions that commonly contain `//` comments, including TypeScript, TSX, JavaScript, JSX, MJS, CJS, Rust, Go, and similar source files. The cleanup should only remove the exact three-line header at the beginning of a file, preserving shebang lines if any exist.

Third, run a repository search for the three labels. Remaining matches in real code paths should be fixed. Remaining matches in documentation or multi-work artifacts should be documented as intentionally out of scope.

## Concrete Steps

From `/Users/wibus/dev/Cradle`, inspect candidate files:

    rg -n "^// (Input|Output|Position):" . --glob "!node_modules" --glob "!dist" --glob "!out" --glob "!build" --glob "!coverage"

Apply the cleanup mechanically to code files only. Then inspect the diff:

    git diff --stat
    git diff --check

Validate that no code-file matches remain:

    rg -n "^// (Input|Output|Position):" src apps packages plugins e2e chronicle --glob "*.ts" --glob "*.tsx" --glob "*.js" --glob "*.jsx" --glob "*.mjs" --glob "*.cjs" --glob "*.rs" --glob "*.go"

The validation command should return no matches. Documentation matches, if any, should be reviewed separately and recorded.

After expanding the scope beyond TypeScript/Rust source files, run the broader strict checks:

    rg -n --hidden --no-ignore '^[[:space:]]*(//|//!|#)[[:space:]]*(Input|Output|Position)[[:space:]]*:' . --glob '!docs/**' --glob '!**/.git/**' --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/out/**' --glob '!**/build/**' --glob '!**/coverage/**' --glob '!**/target/**' --glob '!**/.next/**' --glob '!**/.turbo/**' --glob '!**/release/**'

    rg -n --hidden --no-ignore '^[[:space:]]*(/\*|\*|<!--|--)[[:space:]]*(Input|Output|Position)[[:space:]]*:' . --glob '!docs/**' --glob '!**/.git/**' --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/out/**' --glob '!**/build/**' --glob '!**/coverage/**' --glob '!**/target/**' --glob '!**/.next/**' --glob '!**/.turbo/**' --glob '!**/release/**'

Both commands should return no matches.

## Validation and Acceptance

Acceptance requires that source and test code no longer contain the target metadata header comments. The expected proof is a clean `rg` result over real code directories and a clean `git diff --check`. A full test suite is not required for this textual cleanup because it does not change executable logic, but the diff must show only comment removals and this plan or multi-work artifacts.

## Idempotence and Recovery

The cleanup is idempotent because rerunning it after the headers are removed should make no further changes. If a mechanical pass removes unexpected text, inspect `git diff` before any commit and restore only the affected lines manually; do not use destructive Git history commands.

## Artifacts and Notes

Multi-work handoff files will be written under `docs/multi-work/remove-header-comments/` using the required naming convention. The ExecPlan itself is separate and remains under `docs/exec-plans/`.

## Interfaces and Dependencies

This work depends only on standard repository tools available from the shell: `rg` for search and Git diff commands for review. No application interface, database schema, public API, or runtime behavior should change.

Revision note 2026-05-21: Initial plan created to satisfy the `$multi-work` DAG prerequisite before cleanup implementation.

Revision note 2026-05-21: Updated progress, decisions, validation commands, and retrospective after implementation, failed review fixes, and expanded active documentation cleanup.
