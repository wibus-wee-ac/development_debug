<!-- Once this directory changes, update this README.md -->

# Store

Zustand stores for renderer-side global state.
All stores use `persist` middleware for localStorage persistence.
Store naming convention: `use<Domain>Store`.

## Files

- **layout.ts**: Layout state — sidebar/aside/panel dimensions and visibility
- **layout-slots.ts**: Layout slot registry — pages inject content into aside/panel regions
- **theme.ts**: Theme preference state — light/dark/system mode
- **sidebar-nav.ts**: Sidebar drill-in navigation state — controls which view the sidebar shows (main / settings)
- **session-activity.ts**: Session activity state — tracks which sessions received a new response while not being viewed, drives the sidebar dot indicator
- **new-chat.ts**: New chat preferences — persisted last selected agent profile and model per profile
- **new-chat.test.ts**: Regression tests for idempotent new-chat preference updates
