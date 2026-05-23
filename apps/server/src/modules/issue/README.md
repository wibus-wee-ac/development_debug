# Issue Module

Workspace-scoped issue capability. Owns workflow statuses, milestones, issue CRUD, comments, relations, context refs, session links, and delegation markers. Kanban reads this data as a board view but does not own issue semantics.
Comment responses include a server-resolved author projection; clients should not infer AI identity from agent profiles.

## Files

- `index.ts`: Elysia `/issues` routes, OpenAPI metadata, generated CLI descriptors, and the Agent-facing issue move route that accepts status name slugs.
- `model.ts`: TypeBox schemas for issue requests and responses, including comment author projections and `statusName` request aliases for Agent workflows.
- `service.ts`: Issue workflow, key generation, default status assignment, status name/slug resolution, actor provenance, comment author projection, relations, context refs, and session link semantics.
