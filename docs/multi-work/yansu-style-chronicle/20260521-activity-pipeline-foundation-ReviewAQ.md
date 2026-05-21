# Activity Pipeline Foundation Review

## Result

Independent review found issues before finalization.

## Findings

1. High: `chronicle_pipeline_runs` lacked an idempotency key. Repeated direct memory updates could keep one memory row but create multiple pipeline runs for the same evidence.

2. High: segment append logic could merge backfilled or out-of-order evidence into a later same-title segment because candidate selection used absolute time distance.

3. Medium: segmentation runs used `status: success`, which could be read as full Activity Pipeline completion even though triage, summarization, and crystallization are not implemented.

4. Medium: the pipeline run status default was `success`; safe schema semantics should default to `queued`.

5. Low: the generated SQLite migration creates segments before sessions. SQLite tolerates this generated order, but it is harder to audit than dependency order.

## Decision

Fix findings 1-4 in this slice. Leave finding 5 as a Drizzle-generated SQLite ordering quirk because the migration is generated from schema and validated by Drizzle; manually reordering generated SQL would violate the repository's schema-first migration rule.
