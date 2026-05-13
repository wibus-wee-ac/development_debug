# Usage Module

Provides read-model analytics for `usage_logs` including daily totals, dashboard summary, streak stats, and per-session totals.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `usage.module.ts`: Tsuki module registration.
- `usage.controller.ts`: HTTP endpoints.
- `usage.service.ts`: Drizzle queries and streak calculations.
