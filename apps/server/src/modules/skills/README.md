# Skills Module

Provides filesystem-backed skill inventory, CRUD, import/export, and source-fetch flows across builtin, standard `.agents`, Cradle-owned global, workspace, and agent scopes.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.
The module may read standard `.agents/skills` as the legacy compatibility scope, but Cradle-owned writes use `~/.cradle/skills`, workspace `.cradle/skills`, or agent `~/.cradle/agents/{agentId}/skills`.

## Files

- `index.ts`: Elysia routes for skills inventory, document CRUD, import/export, fetch-source, and generated CLI metadata.
- `model.ts`: TypeBox request and response schemas for the skills API.
- `skills.service.ts`: workspace resolution and orchestration.
- `skills.store.ts`: filesystem-backed catalog, CRUD, import, and export logic.
- `skill-source.store.ts`: source parsing, discovery, and fetch-session cleanup.
- `skills-paths.ts`: scope root resolution and write-ownership rules.
