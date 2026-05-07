<!-- Once this directory changes, update this README.md -->

# Main/Features/Backend Control Plane/__tests__

These tests guard the Cradle-owned control-plane semantics that sit above raw backend transports.
They should fail whenever binding/run/timeline ownership leaks back into chat sessions or provider-native state.
When timeline vocabulary, append ordering, or reducer semantics change, update these tests first.

## Files

- **backend-control-plane.test.ts**: Service-level regression tests for binding upserts, run lifecycle, capability snapshots, and monotonic timeline append behavior
- **timeline-events.test.ts**: Typed timeline parser regression tests plus shared timeline chunk projection guardrail for the Plan 07 rewrite