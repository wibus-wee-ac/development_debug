<!-- Once this directory changes, update this README.md -->

# Main/Observability/__tests__

Observability namespace tests validate queue persistence behavior, rule evaluation, and non-blocking failure handling.
These tests focus on local durability and incident semantics rather than renderer presentation.

## Files

- **store.test.ts**: Queue flush persistence, incident upsert merge behavior, and write-failure non-throw guarantee
- **rules.test.ts**: High-value pure-function rules for empty-output completion, stream failures, and domain-event handler failures
