<!-- Once this directory changes, update this README.md -->

# Automation

Agent-authored automation registry and viewer UI.

## Files

- **api-client.ts**: `/automations` endpoints 的本地 fetch boundary，保留与 server automation contract 对齐的 feature-local response parser。
- **api-client.test.ts**: 覆盖 server-shaped automation payload parsing 的 contract regression tests。
- **automation-dashboard-loader.ts**: Automation tab 的共享 lazy loader 与 route preload 入口。
- **automation-dashboard.tsx**: Registry/viewer surface for definitions, latest run state, run history, chat/backend run links, recipe snapshots, inputs, and artifacts.
- **index.ts**: Public feature exports used by Home.
- **types.ts**: Temporary local API payload contracts owned by this feature.
- **use-automations.ts**: TanStack Query hooks and mutation for definition, run, artifact, and run-now operations.
