# Approval Module

提供 in-memory pending approval registry，以及 create/list/respond HTTP flows。
Approval request 会读取 Chat preferences 中的 Cradle 层 approval mode；`allowAll` 会直接返回一次性 allow response，不写入 session allow policy，也不切换底层 provider permission settings。
Route metadata 包含安全 generated CLI commands 所需的 `x-cradle-cli` 描述。
Approval creation 和 SSE streaming 不暴露为 generated CLI command。

## Files

- `index.ts`: Elysia `/approvals/*` HTTP endpoints，request/response body 由 approval schemas 约束。
- `model.ts`: TypeBox schemas for approval route contracts。
- `service.ts`: in-memory registry、Promise-based approval wait primitive、Cradle 层 approval mode 短路与 session-scoped allow policy。
- `approval.types.ts`: canonical request/response contracts and validation schemas。
