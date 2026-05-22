# Workspace Module

Workspace CRUD 与 safe filesystem access，包含 listing 和 text read/write。
Route metadata 包含用于 generated CLI commands 的 `x-cradle-cli` descriptors。
Workspace file writes 是 non-Cradle-owned writes，因为目标文件位于用户 workspace directories。Write route 要求 `confirmedNonCradleOwnedWrite: true`，并返回命名 workspace boundary 与 target path 的 `ownerBoundary` metadata。

## Files

- **index.ts**: Elysia `/workspaces` routes、OpenAPI metadata、generated CLI descriptors，以及 workspace file write confirmation contract。
- **model.ts**: Workspace requests、responses 和 owner-boundary metadata 的 TypeBox schemas。
- **service.ts**: Workspace CRUD semantics，以及 explicit non-Cradle-owned write confirmation enforcement。
- **files.ts**: `.gitignore` filtering、safe text IO、workspace path resolution 和 owner-boundary payload construction。
