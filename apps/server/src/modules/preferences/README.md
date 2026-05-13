<!--
Output: Preferences module inventory.
Input: Server-owned preference HTTP routes and persistence helpers.
Position: apps/server/src/modules/preferences
-->

# Preferences Module

Server-owned preference read/write endpoints.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **index.ts**: Elysia `/preferences` routes for chat preference get/set.
- **model.ts**: TypeBox schemas for preference request and response bodies.
- **service.ts**: Persistence semantics for server-owned preferences.
