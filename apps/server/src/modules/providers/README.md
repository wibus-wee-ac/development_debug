<!--
Output: Inventory for provider-owned metadata discovery and capability helpers.
Input: Saved profiles plus secret references for runtime backends.
Position: apps/server/src/modules/providers module guide.
-->

# providers

`providers.controller.ts` accepts schema-typed `config` objects at the HTTP boundary and only serializes to `configJson` when crossing into legacy internal request shapes.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

- `providers.module.ts` — wires provider-owned HTTP endpoints and services.
- `providers.controller.ts` — exposes body-based `/providers/health-check` and `/providers/models` endpoints with Zod-inferred typed config payloads.
- `providers.service.ts` — resolves provider metadata requests, runs health checks, reads secrets, and maps provider errors.
- `providers.store.ts` — writes runtime audit rows and capability snapshots.
- `provider-catalog.ts` — registers provider metadata implementations by kind.
- `provider-base.ts` — shared Zod-backed config parsing and API-key helpers.
- `model-info-registry.ts` — best-effort `models.dev` enrichment.
- `types.ts` — shared provider taxonomy and metadata response types.
