<!--
Output: Agent identity module inventory.
Input: AgentIdentityModule, service, store, and controller.
Position: apps/server/src/modules/agent-identity.
-->

# Agent Identity Module

Agent CRUD, filtered list queries, agent-profile ownership, and avatar URL policy.
Agent rows are the user-visible AI persona boundary; agent profiles are provider/runtime configuration and must not be used as authors.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **avatar.ts**: Shared DiceBear avatar URL policy for agent personas.
- **index.ts**: Elysia `/agents` routes, OpenAPI metadata, and generated CLI descriptors.
- **model.ts**: TypeBox schemas for agent requests and responses.
- **service.ts**: Agent CRUD semantics, avatar URL policy, runtime/profile validation, and constraint mapping.
