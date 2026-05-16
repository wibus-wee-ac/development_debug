<!--
Output: Inventory of superpowers implementation plans.
Input: Approved design specs.
Position: docs/superpowers/plans index.
-->

# Superpowers Implementation Plans

## Files

- **2026-05-07-database-capability-plan.md**: Implementation plan for the server DB capability (SQLite + Drizzle + DatabaseModule).
- **2026-05-08-server-foundation-plan.md**: Implementation plan for server foundation (config, logging, errors, request tracing, health, DB lifecycle entry).
- **2026-05-08-workspace-capability-plan.md**: Implementation plan for the workspace capability (CRUD + safe file IO).
- **2026-05-08-session-capability-plan.md**: Historical implementation plan for an earlier session capability migration stage that still referenced timeline extraction before the canonical `messages.messageJson` + `messages.content` + sequenced SSE delta contract.
- **2026-05-08-agent-identity-capability-plan.md**: Implementation plan for capability layout normalization and the agent identity capability.
