# Health Module

HTTP health check endpoints with server memory, CPU, uptime, and liveness snapshots.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **index.ts**: Elysia plugin exposing `GET /health`.
- **model.ts**: TypeBox schema and inferred response types for memory and CPU diagnostics.
- **service.ts**: Static health check logic with process memory and interval CPU sampling.
