<!-- Once this directory changes, update this README.md -->

# Store

Zustand stores for renderer-side global state.
Persisted stores use versioned keys plus a safe storage wrapper, so tests / restricted environments fall back to in-memory storage instead of warning on missing `localStorage`.
Store naming convention: `use<Domain>Store`.

## Files

- **layout.ts**: Layout shell state — sidebar/aside/panel dimensions and visibility only; feature UI state such as Settings overlay and Jarvis expansion now lives with the owning feature
- **layout-slots.ts**: Layout slot registry — pages inject content into aside/panel regions
- **theme.ts**: Theme preference state — light/dark/system mode
- **sidebar-nav.ts**: Sidebar drill-in navigation state — controls which view the sidebar shows (main / settings)
- **session-activity.ts**: Session activity owner — tracks the currently visible chat session plus unread background activity, so sidebar session items stay display-only while the app shell owns unread reconciliation
- **session-activity.test.ts**: Regression tests for unread ownership, background activity marking, and visible-session clearing semantics
- **chat.ts**: Chat streaming state — stores per-session UI messages, generation flags, errors, and reconciles equivalent server snapshots without changing message references
- **chat.test.ts**: Regression tests for chat snapshot structural sharing and unchanged message reference preservation
- **new-chat.ts**: New chat preferences — persisted last selected agent profile / per-profile model choice, plus profile reconciliation when the available profile list changes
- **new-chat.test.ts**: Regression tests for idempotent updates and stale-profile reconciliation
- **persist-storage.ts**: Safe persisted storage wrapper with browser `localStorage` + in-memory fallback
- **streamdown.ts**: Streamdown render preferences — persisted animation preset, granularity, cursor visibility
