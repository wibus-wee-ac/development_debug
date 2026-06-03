# Cradle Server Foundation Design

## Summary
This spec defines the Phase 1 foundation for the Tsuki/Hono server. It establishes a clean composition root, configuration and logging primitives, standardized error handling, request tracing, and a minimal module structure that future capabilities can plug into without reworking the runtime. No legacy IPC compatibility is included.

## Goals
- Provide a stable **composition root** with explicit module imports and no business logic.
- Centralize **runtime configuration** with Zod validation and defaults.
- Define **logging + request tracing** for consistent diagnostics.
- Implement **global exception handling** for predictable error payloads.
- Add **health/readiness** endpoints for operational checks.
- Wire **database lifecycle** entry using `packages/db` (connect → migrate → provide).
- Keep boundaries clear: `capabilities -> infra -> core`.

## Non-Goals
- No Electron IPC or socket compatibility layer.
- No migration of business capabilities (workspace/session/chat/etc.).
- No request-scoped transaction system.
- No advanced observability stack (metrics/trace exporters deferred).

## Architecture Overview

### Module & Package Structure

- **apps/server/src**
  - `app.module.ts` — module imports only (composition root)
  - `app.factory.ts` — createApplication wiring + global middleware/filters
  - `index.ts` — server bootstrap (port/host, start server)

- **apps/server/src/core** (runtime foundation)
  - `config/` — Zod config schema, env parsing, defaults
  - `logging/` — logger interface + default implementation
  - `errors/` — exception types + global exception filter
  - `request/` — requestId middleware/interceptor utilities
  - `health/` — health and readiness controllers

- **apps/server/src/infra** (system adapters)
  - `database/` — Drizzle lifecycle module (uses `packages/db`)
  - `paths/` — data dir resolution and filesystem helpers

- **apps/server/src/capabilities/*`** (future) — empty modules for later migration

### Boundary Rules
- `capabilities/*` must not import from each other (only via shared domain libs).
- `infra/*` can depend on `core/*` but not on `capabilities/*`.
- `core/*` is dependency-free except for framework libs.

## Lifecycle & Data Flow
1. `index.ts` loads env, resolves host/port, calls `createConfiguredApp()`.
2. `createConfiguredApp()` registers global middleware, exception filter, and imports `CoreModule` + `InfraModule`.
3. `InfraModule` initializes database lifecycle (connect → migrate → provide).
4. Incoming requests flow through requestId middleware → pipes/handlers → exception filter on errors.
5. `/health` and `/ready` respond without touching business modules.

## Error Handling & Response Shape
- Standard error payload:
  - `code`: stable string identifier
  - `message`: human-readable summary
  - `details`: optional structured data
  - `requestId`: for tracing
- Fail-fast on configuration errors or DB migration errors.

## Configuration
- Zod schema enforces:
  - `CRADLE_HOST`, `CRADLE_PORT`
  - `CRADLE_DATA_DIR` (or `CRADLE_DB_PATH` if explicit)
  - `CRADLE_LOG_LEVEL`
- Config module exports a typed config object for DI.

## Testing & Validation
- **Unit tests**
  - Config parsing: defaults + invalid env cases
  - Error filter: maps thrown error to payload
- **Integration tests**
  - `createApplication(AppModule)` responds on `/health`
  - Error response includes `requestId`
- **Typecheck**
  - `pnpm typecheck` is required for the foundation milestone

## Decisions & Rationale
- Use Zod for config to keep runtime safety and explicit defaults.
- Define a clear folder boundary early to prevent capability sprawl.
- Keep health endpoints in `core` to avoid coupling with business logic.
- Defer observability exporters until after core capability migration.
