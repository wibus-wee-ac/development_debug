# Issue Module

Workspace-scoped issue capability. Owns workflow statuses, milestones, issue CRUD, comments, relations, context refs, session links, and delegation markers. Kanban reads this data as a board view but does not own issue semantics.
Comment responses include a server-resolved author projection; clients should not infer AI identity from agent profiles.

## Files

- `index.ts`: Elysia `/issues` routes, OpenAPI metadata, and generated CLI descriptors.
- `model.ts`: TypeBox schemas for issue requests and responses, including comment author projections.
- `service.ts`: Issue workflow, key generation, actor provenance, comment author projection, relations, context refs, and session link semantics.
