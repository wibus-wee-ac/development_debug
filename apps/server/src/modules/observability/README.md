# Observability Module

Provides canonical observability event capture, incident projection, queue-backed persistence, error-pattern inspection, and HTTP query/export surfaces.
Observability reads Chat Runtime-owned run snapshots to build diagnostics timelines and error pattern buckets, but it does not own provider runtime semantics or write provider namespaces.
Incident dedupe is intentionally signal-oriented rather than always run-scoped: chat stream failures aggregate by code so development-time interrupted runs do not create one incident per run, while producers may still pass an explicit dedupe key for cases that need narrower ownership.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `index.ts`: Elysia endpoints under `/observability/*`, including local event ingestion, event/incident/error-pattern query, flush, and export surfaces.
- `model.ts`: TypeBox schemas for event, incident, error-pattern, create-event, flush, query, and diagnostics bundle contracts.
- `service.ts`: Event capture, dedupe, incident projection, queue-backed persistence, run-snapshot timeline projection, error-pattern bucketing, query, and export orchestration.
- `contract.ts`: canonical event and incident helpers.
- `rules.ts`: pure incident rule evaluation.
- `exporter.ts`: private-preview diagnostics bundle assembly with runtime metadata, redaction summary, event/incident rows, error-pattern buckets, run snapshot timeline, and server log tail.
- `sink.ts`: minimal producer-facing observability port.
