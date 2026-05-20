<!-- Once this directory changes, update this README.md -->

# Automation

Agent-authored automation registry and viewer UI.

## Files

- **api-client.ts**: Small local fetch boundary for `/automations` endpoints until generated OpenAPI SDK functions are available.
- **automation-dashboard.tsx**: Registry/viewer surface for definitions, latest run state, run history, chat/backend run links, recipe snapshots, inputs, and artifacts.
- **index.ts**: Public feature exports used by Home.
- **types.ts**: Temporary local API payload contracts owned by this feature.
- **use-automations.ts**: TanStack Query hooks and mutation for definition, run, artifact, and run-now operations.
