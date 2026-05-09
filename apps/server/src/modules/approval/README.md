<!--
Output: approval module file inventory.
Input: approval HTTP/controller/service/types.
Position: apps/server/src/modules/approval index.
-->

# Approval Module

Provides an in-memory pending approval registry with HTTP endpoints for create/list/respond flows.

## Files

- `approval.module.ts`: Tsuki module registration.
- `approval.controller.ts`: HTTP endpoints under `/approvals/*`, with request/response bodies typed from the approval schemas.
- `approval.service.ts`: in-memory registry and Promise-based approval wait primitive.
- `approval.types.ts`: canonical request/response contracts and validation schemas.