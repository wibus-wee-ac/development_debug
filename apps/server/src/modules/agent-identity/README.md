<!--
Output: Agent identity module inventory.
Input: AgentIdentityModule, service, store, and controller.
Position: apps/server/src/modules/agent-identity.
-->

# Agent Identity Module

Agent CRUD, filtered list queries, agent-profile ownership, and avatar URL policy.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **agent-identity.module.ts**: Tsuki module registration.
- **agent-identity.controller.ts**: HTTP endpoints for agent identity module.
- **agent-identity.service.ts**: Module semantics, avatar URL policy, and constraint mapping.
- **agent-identity.store.ts**: Drizzle-backed CRUD and filter queries.
