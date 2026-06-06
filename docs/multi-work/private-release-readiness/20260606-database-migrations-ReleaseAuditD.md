# Private Release Readiness Audit D: Database And Migrations

Date: 2026-06-06
Scope: `packages/db`, server database usage, desktop runtime database path and migration availability, data ownership regressions.
Mode: Read-only audit, except this handoff file.

## Summary

Current private-release readiness is blocked by migration artifacts that exist in the working tree but are not tracked by git. The current disk state has a coherent Drizzle journal through `0064_backend_run_nullable_binding`, and desktop production now points the server at `process.resourcesPath/drizzle`, with electron-builder copying `packages/db/drizzle` there. That means a local package made from this dirty tree is likely to include migrations, but a clean checkout or CI/private-release builder will not include `0061`-`0064` SQL/snapshot files unless they are added to source control.

No direct regression was found where Cradle writes to the standard `.agents/skills` namespace for normal skill CRUD. Cradle reads `~/.agents/skills` and workspace `.agents/skills`, but writable scopes are restricted to Cradle-owned locations or an explicitly confirmed export destination.

## Findings

### Release Blocker: New Drizzle migration artifacts are untracked

Severity: Blocker

Evidence:

- `git status --short packages/db/drizzle ...` reports these required migration artifacts as untracked:
  - `packages/db/drizzle/0061_chat_runtime_settings.sql`
  - `packages/db/drizzle/0062_session_read_state.sql`
  - `packages/db/drizzle/0063_agent_thinking_effort_concrete.sql`
  - `packages/db/drizzle/0064_backend_run_nullable_binding.sql`
  - `packages/db/drizzle/meta/0061_snapshot.json`
  - `packages/db/drizzle/meta/0062_snapshot.json`
  - `packages/db/drizzle/meta/0063_snapshot.json`
  - `packages/db/drizzle/meta/0064_snapshot.json`
- `git ls-files` for the same files returns only `packages/db/drizzle/meta/_journal.json`, so the SQL and snapshot files are not part of the committed release input.
- Current schema references these migration changes:
  - `packages/db/src/schema/chat.ts` has `sessions.last_read_at`, queue `runtime_access_mode`, and queue `runtime_interaction_mode`.
  - `packages/db/src/schema/identity.ts` constrains agent `thinking_effort`.
  - `packages/db/src/schema/backend-control-plane.ts` makes `backend_runs.binding_id` nullable with `ON DELETE set null`.

Impact:

Private testers installing a build produced from a clean checkout or CI artifact will get application code compiled against schema changes whose migrations are absent. Existing databases will not receive the new columns or table rebuilds, causing runtime errors such as missing column failures or failed inserts/updates around chat runtime settings, session read state, agent thinking effort, and nullable provider-runtime run bindings.

Confidence: High

Recommended validation:

- Add the untracked SQL/snapshot files to source control before cutting the private build.
- From a clean checkout, run a migration consistency check that compares `packages/db/drizzle/*.sql`, `packages/db/drizzle/meta/*_snapshot.json`, and `packages/db/drizzle/meta/_journal.json`.
- From a clean checkout, build the desktop package and inspect `Cradle.app/Contents/Resources/drizzle` or the platform-equivalent resources directory for `0061` through `0064`.

### Release Blocker: `backend_runs.binding_id` migration is required by current runtime behavior

Severity: Blocker when the untracked `0064` artifact is absent from the release input

Evidence:

- Baseline migration creates `backend_runs.binding_id` as `text NOT NULL` with `ON DELETE cascade` in `packages/db/drizzle/0000_initial_baseline.sql`.
- Current schema has `bindingId: text('binding_id').references(..., { onDelete: 'set null' })` in `packages/db/src/schema/backend-control-plane.ts`.
- Current runtime inserts nullable run bindings: `apps/server/src/modules/chat-runtime/service.ts` writes `bindingId: binding?.id ?? null`.
- `packages/db/drizzle/0064_backend_run_nullable_binding.sql` rebuilds `backend_runs` with nullable `binding_id` and `ON DELETE set null`.

Impact:

If `0064` is not included and executed, any provider-native side/runtime path that starts a run without a durable binding can fail at insert time because SQLite still enforces `backend_runs.binding_id NOT NULL`. This is a high-likelihood private-tester failure because it affects startup/use of current chat runtime paths rather than only legacy data.

Confidence: High

Recommended validation:

- After applying migrations on an upgraded database, verify `PRAGMA table_info(backend_runs)` shows `binding_id` with `notnull = 0`.
- Verify `PRAGMA foreign_key_list(backend_runs)` shows the binding FK uses `ON DELETE SET NULL`.

### Resolved During Audit Window: Drizzle journal currently includes `0064`

Severity: Informational

Evidence:

- Initial read-only check observed `sql_count = 65`, `journal_count = 64`, and `sql_not_in_journal = 0064_backend_run_nullable_binding`.
- A later read of the same working tree shows `packages/db/drizzle/meta/_journal.json` ending with:
  - `idx: 64`
  - `tag: 0064_backend_run_nullable_binding`
- Current consistency script output:
  - `sqlCount: 65`
  - `journalCount: 65`
  - `sqlNotInJournal: []`
  - `journalNotInSql: []`
  - `lastJournal.tag: 0064_backend_run_nullable_binding`

Impact:

The current disk state no longer has a journal/SQL mismatch, but this was changing during audit and the SQL/snapshot files remain untracked. The release blocker is therefore source-control completeness, not the current local journal contents.

Confidence: Medium-high

Recommended validation:

- Treat migration consistency as a release gate, not a manual spot check.
- Fail CI when any `packages/db/drizzle/*.sql` file is missing from `_journal.json`, or any journal entry lacks its SQL file.

### Pass With Caveat: Desktop production DB path and migration resources are wired

Severity: Pass with caveat

Evidence:

- Desktop starts the production server from `join(process.resourcesPath, 'server/dist/main.js')`.
- Desktop passes `CRADLE_DATA_DIR = join(app.getPath('userData'), 'data')`.
- Server config derives `dbPath = join(CRADLE_DATA_DIR, 'cradle.db')`.
- Desktop passes `CRADLE_MIGRATIONS_DIR = join(process.resourcesPath, 'drizzle')` in production.
- electron-builder copies `../../packages/db/drizzle` to `drizzle` under `extraResources`.
- `apps/server/scripts/rebuild-electron-runtime.mjs` prunes duplicate `@cradle/db/drizzle` from deployed node_modules, so the explicit `process.resourcesPath/drizzle` copy is the production source of truth.

Impact:

The runtime path design is suitable for private testers: app data lives under Electron `userData/data`, and migrations are shipped as resources outside the server bundle. The caveat is that packaging from clean source still depends on the migration artifacts being tracked.

Confidence: High

Recommended validation:

- Build a packaged app from a clean checkout and inspect the resources directory for `drizzle/meta/_journal.json` plus `0061`-`0064`.
- Start the packaged app with a fresh userData directory and confirm `cradle.db` appears under `userData/data`.

### Pass: No direct skill namespace ownership write regression found

Severity: Pass

Evidence:

- `apps/server/src/modules/skills/skills-paths.ts` maps readable standard scopes:
  - `legacy` to `~/.agents/skills`
  - `repository` to `<workspace>/.agents/skills`
- `assertWritableScope` rejects `builtin`, `legacy`, and `repository` writes.
- Writable skill scopes resolve to Cradle-owned paths:
  - `global` to `~/.cradle/skills`
  - `workspace` to `<workspace>/.cradle/skills`
  - `agent` to `~/.cradle/agents/{agentId}/skills`
- Agent runtime home creates compatibility symlinks inside `~/.cradle/agents/{agentId}`: `.agents/skills -> ../skills` and `.claude/skills -> ../skills`. It does not write into the user's top-level `~/.agents`.
- Skill export requires `confirmedNonCradleOwnedWrite: true` and returns owner-boundary metadata.

Impact:

The audited skill paths preserve namespace ownership: Cradle reads standard skills but writes Cradle-owned storage unless the user explicitly confirms export to a user-selected non-Cradle directory.

Confidence: Medium-high

Caveat:

Desktop private builds still use `os.homedir()` for global and agent skill storage, so Cradle writes `~/.cradle/...` outside Electron `userData/data`. This appears intentional and documented by module ownership, but testers should know app uninstall/reset will not necessarily remove these home-directory Cradle skill files.

## Read-only Checks Run

- `git status --short`
- `rg --files` over `packages/db`, `apps/server`, and desktop packaging files
- Static scans for `drizzle`, `migrate`, `sqlite`, `CRADLE_DB_PATH`, `CRADLE_MIGRATIONS_DIR`, `extraResources`, `.agents`, `.cradle`, and skill write APIs
- Drizzle artifact consistency script comparing SQL files, snapshot files, and `_journal.json`
- Source-control tracking check with `git ls-files` for `0061`-`0064` artifacts
- Static inspection of:
  - `apps/server/src/config/server-config.ts`
  - `apps/server/src/database/*`
  - `packages/db/src/paths.ts`
  - `packages/db/src/schema/*`
  - `apps/desktop/electron-builder.mjs`
  - `apps/desktop/src/main/server-process.ts`
  - `apps/server/scripts/prepare-desktop-runtime.mjs`
  - `apps/server/scripts/rebuild-electron-runtime.mjs`
  - `apps/server/src/modules/skills/*`

## Not Run

No source tests or migration execution tests were run because this audit requested read-only checks. No packaged desktop build was produced.
