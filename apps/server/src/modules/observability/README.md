# Observability Module

Provides canonical observability event capture, incident projection, queue-backed persistence, and HTTP query/export surfaces.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `index.ts`: Elysia endpoints under `/observability/*`, including local event ingestion, query, flush, and export surfaces.
- `model.ts`: TypeBox schemas for event, incident, create-event, flush, query, and diagnostics bundle contracts.
- `service.ts`: Event capture, dedupe, incident projection, queue-backed persistence, query, and export orchestration.
- `contract.ts`: canonical event and incident helpers.
- `rules.ts`: pure incident rule evaluation.
- `exporter.ts`: private-preview diagnostics bundle assembly with runtime metadata, redaction summary, event/incident rows, timeline placeholder, and server log tail.
- `sink.ts`: minimal producer-facing observability port.
