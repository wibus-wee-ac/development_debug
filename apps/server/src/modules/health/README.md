# Health Module

HTTP health check endpoints.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **index.ts**: Elysia plugin exposing `GET /health`.
- **model.ts**: TypeBox schema and inferred response types.
- **service.ts**: Static health check logic.
