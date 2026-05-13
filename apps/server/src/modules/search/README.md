# Search Module

Provides thread search over session titles, user messages, and assistant timeline text using FTS-first lookup with legacy full-scan fallback.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `search.module.ts`: Tsuki module registration.
- `search.controller.ts`: HTTP endpoint for thread search.
- `search.service.ts`: capability orchestration.
- `thread-search.engine.ts`: FTS and legacy search engine.
