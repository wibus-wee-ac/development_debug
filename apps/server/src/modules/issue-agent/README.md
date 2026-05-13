# Issue Agent Module

Provides server-owned issue delegation, agent session tracking, activity timeline projection, rerun, and undelegation semantics.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `index.ts`: Elysia routes for issue delegation and issue-agent sessions.
- `model.ts`: TypeBox schemas for delegation state, session views, activity views, params, and bodies.
- `service.ts`: delegation semantics and background run watcher.
