<!-- Once this directory changes, update this README.md -->

# Store

Zustand stores for renderer-side global state.
Persisted stores use versioned keys plus a safe storage wrapper, so tests / restricted environments fall back to in-memory storage instead of warning on missing `localStorage`.
Store naming convention: `use<Domain>Store`.

## Files

- **layout.ts**: Layout state — sidebar/aside/panel dimensions and visibility
- **layout-slots.ts**: Layout slot registry — pages inject content into aside/panel regions
- **theme.ts**: Theme preference state — light/dark/system mode
- **sidebar-nav.ts**: Sidebar drill-in navigation state — controls which view the sidebar shows (main / settings)
- **session-activity.ts**: Session activity state — tracks which sessions received a new response while not being viewed, drives the sidebar dot indicator
- **new-chat.ts**: New chat preferences — persisted last selected agent profile / per-profile model choice, plus profile reconciliation when the available profile list changes
- **new-chat.test.ts**: Regression tests for idempotent updates and stale-profile reconciliation
- **persist-storage.ts**: Safe persisted storage wrapper with browser `localStorage` + in-memory fallback
