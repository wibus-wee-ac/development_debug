<!--
Output: Health module inventory.
Input: Health Elysia plugin.
Position: apps/server/src/modules/health
-->

# Health Module

HTTP health check endpoints.

## Files

- **index.ts**: Elysia plugin exposing `GET /health`.
- **model.ts**: TypeBox schema and inferred response types.
- **service.ts**: Static health check logic.
