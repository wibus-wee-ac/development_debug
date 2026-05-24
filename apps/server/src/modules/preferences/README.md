# Preferences Module

Server-owned preference read/write endpoints for chat and Jarvis defaults.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **index.ts**: Elysia `/preferences` routes for chat and Jarvis preference get/set.
- **model.ts**: TypeBox schemas for preference request and response bodies, including Jarvis's explicit model selection and chat continuation behavior.
- **service.ts**: Persistence semantics for server-owned preferences.
