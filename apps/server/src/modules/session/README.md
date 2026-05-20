<!--
Output: Session module inventory.
Input: SessionModule, service, store, export helper.
Position: apps/server/src/modules/session
-->

# Session Module

Session CRUD, pin toggle, message read, markdown export, and session-owned cleanup hooks.
Session list/get responses also expose the currently requested model id from backend session bindings as `modelId` when a run has selected one.
Provider-backed session creation resolves a stable agent persona and stores `agentId`, so CLI calls carrying the session context can be attributed to an Agent identity.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **index.ts**: Elysia route surface for CRUD, message listing, export, and linked-issue helpers.
- **model.ts**: Session HTTP params/body/response schemas.
- **service.ts**: Module semantics (CRUD + export + cleanup), provider-backed default agent binding, and a transaction-friendly profile cleanup entrypoint used by profile deletion.
