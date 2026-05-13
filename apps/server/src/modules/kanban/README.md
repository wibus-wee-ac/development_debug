# Kanban Module

Provides the workspace-scoped board shell, default status seeding, issue core loop, and comment core loop.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `index.ts`: Elysia `/kanban` routes, OpenAPI metadata, and generated CLI descriptors.
- `model.ts`: TypeBox schemas for kanban requests and responses.
- `service.ts`: board, status, milestone, issue, relation, context-ref, and comment semantics.
