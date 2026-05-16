<!-- Once this directory changes, update this README.md -->

# Features/Devtool/Tabs

Tabs-next diagnostics inside the `/devtool` window.

## Files

- **tabs-panel.tsx**: Devtool panel rendering tabs-next snapshot, metrics, mounted tabs, and contexts
- **use-tabs-debug-store.ts**: Zustand bridge that mirrors the tabs-next debug stream through BroadcastChannel/localStorage
