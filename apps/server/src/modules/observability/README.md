<!--
Output: observability module file inventory.
Input: observability HTTP/controller/service/store/contracts.
Position: apps/server/src/modules/observability index.
-->

# Observability Module

Provides canonical observability event capture, incident projection, queue-backed persistence, and HTTP query/export surfaces.

## Files

- `observability.module.ts`: Tsuki module registration.
- `observability.controller.ts`: HTTP endpoints under `/observability/*`.
- `observability.service.ts`: event capture, dedupe, incident projection, and export orchestration.
- `store.ts`: queue-backed event persistence and incident query/upsert logic.
- `contract.ts`: canonical event and incident helpers.
- `rules.ts`: pure incident rule evaluation.
- `exporter.ts`: bundle export assembly with related timeline rows.
- `sink.ts`: minimal producer-facing observability port.