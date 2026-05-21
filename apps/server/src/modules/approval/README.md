# Approval Module

Provides an in-memory pending approval registry with HTTP endpoints for create/list/respond flows.
Route metadata includes `x-cradle-cli` descriptors for safe generated CLI commands.
Approval creation and SSE streaming are intentionally not exposed through the generated CLI.

## Files

- `approval.module.ts`: Tsuki module registration.
- `approval.controller.ts`: HTTP endpoints under `/approvals/*`, with request/response bodies typed from the approval schemas.
- `approval.service.ts`: in-memory registry and Promise-based approval wait primitive.
- `approval.types.ts`: canonical request/response contracts and validation schemas.
