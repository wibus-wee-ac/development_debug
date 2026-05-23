# Usage Module

Provides read-model analytics for `usage_logs` including daily totals, dashboard summary, streak stats, and per-session totals.
The summary agent breakdown resolves `agentProfileName` from `agent_profiles` when available and keeps `agentProfileId` as the stable fallback key for orphaned historical rows.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **budget.ts**: Budget threshold helpers for usage cost checks.
- **index.ts**: Elysia routes under `/usage`, including CLI metadata for generated commands.
- **model.ts**: TypeBox request and response schemas for usage and cost endpoints.
- **pricing.ts**: Model pricing lookup and cost calculation helpers.
- **service.ts**: Drizzle queries, profile-name resolution, cost aggregation, and streak calculations.
