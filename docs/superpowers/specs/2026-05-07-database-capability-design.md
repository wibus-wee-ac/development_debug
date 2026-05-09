<!--
Output: DB capability design for Cradle server migration (SQLite + Drizzle).
Input: Migration plan 2026-05-07, afilmory DB patterns, user decisions.
Position: Superpowers spec to drive implementation planning.
-->

# Cradle Server DB Capability Design

## Summary
This spec defines the database capability for the Tsuki/Hono server migration. The design establishes a dedicated `packages/db` schema package, moves migrations under it, and introduces a server-side `DatabaseModule` that opens SQLite, auto-runs migrations at startup, and exposes a `DbAccessor` for upper modules. No request-scoped transaction context is introduced at this stage.

## Goals
- Create `packages/db` as the authoritative schema and migration home for the server.
- Move existing migrations from root `drizzle/` to `packages/db/drizzle`.
- Add a Tsuki-style `DatabaseModule` in `apps/server` to manage lifecycle (connect → migrate → provide db).
- Resolve DB file path via `CRADLE_DATA_DIR` + fixed filename (e.g., `cradle.db`).

## Non-Goals
- No request-scoped transaction context (no `AsyncLocalStorage` middleware).
- No concurrency/locking/WAL optimization (migration phase assumes no Electron access).
- No business module migration (workspace/session/agent/usage/search remain untouched).

## Architecture Overview

### Packages & Ownership
- **`packages/db`** (owner: DB infrastructure)
  - `schema/` — table and type definitions, copied and lightly cleaned from `src/main/db/schema`.
  - `drizzle/` — migrations and meta files.
  - `index.ts` — re-export schema and types for consumers.

- **`apps/server/src/modules/database`** (owner: server runtime)
  - `DatabaseModule` — wires config, provider, migrator, accessor.
  - `DbProvider` — opens SQLite and builds drizzle instance.
  - `MigrationRunner` — runs migrations on startup.
  - `DbAccessor` — exposes `get()` for drizzle instance usage.

### Boundary Rules
- DB module handles infrastructure only.
- Business filtering (scope/tenant) happens in upper modules, not inside DB module.

## Lifecycle & Data Flow
1. On server bootstrap, read `CRADLE_DATA_DIR` and compute `dbPath`.
2. `DbProvider` opens SQLite and creates drizzle instance.
3. `MigrationRunner` auto-executes migrations under `packages/db/drizzle`.
4. `DbAccessor` provides drizzle instance to other modules.
5. On shutdown, SQLite connection closes cleanly.

## Error Handling & Logging
- Missing `CRADLE_DATA_DIR` → fail fast with explicit error.
- Migration failure → fail fast; server should not start partially.
- Connection failure → fail fast with path + error details.
- Minimal logs: connect ok / migrate start / migrate success / error.

## Testing & Validation
- **Module-level tests (apps/server)**
  - Boot `DatabaseModule` against a temp `CRADLE_DATA_DIR`.
  - Assert DB file created + migrations applied.
  - Smoke query through `DbAccessor.get()`.
- **Manual validation**
  - Start server, confirm migration logs and DB file presence.

## Decisions & Rationale
- SQLite chosen for migration phase; no concurrency issues expected.
- Schema copied from `src/main/db/schema` into `packages/db` for clean ownership.
- Auto-run migrations on startup for predictable deployment.
- No request-level transaction context to keep early architecture minimal.
