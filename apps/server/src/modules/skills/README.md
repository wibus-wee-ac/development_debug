# Skills Module

Provides filesystem-backed skill inventory, CRUD, import/export, and source-fetch flows across builtin, standard `.agents`, Cradle-only, workspace, and agent scopes.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `skills.module.ts`: Tsuki module registration.
- `skills.controller.ts`: HTTP API for skills inventory and management.
- `skills.service.ts`: workspace resolution and orchestration.
- `skills.store.ts`: filesystem-backed catalog, CRUD, import, and export logic.
- `skill-source.store.ts`: source parsing, discovery, and fetch-session cleanup.
- `skills-paths.ts`: scope root resolution and write-ownership rules.
