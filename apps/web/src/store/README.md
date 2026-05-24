<!-- Once this directory changes, update this README.md -->

# Store

Zustand stores for renderer-side global state.
Persisted stores use versioned keys plus a safe storage wrapper, so tests / restricted environments fall back to in-memory storage instead of warning on missing `localStorage`.
Store naming convention: `use<Domain>Store`.

## Files

- **layout.ts**: Layout shell state — sidebar/aside/panel dimensions and visibility only, with idempotent setters for repeated visibility/ratio writes; bottom panel visibility defaults open in main windows; Electron tear-off windows use session-scoped layout persistence, start with bottom panel and right aside collapsed, and do not persist those open/closed toggles back into the main-window layout state. Feature UI state such as Settings overlay and Jarvis expansion now lives with the owning feature
- **layout.test.ts**: Regression tests for idempotent layout store writes so repeated browser panel open/ratio updates do not broadcast unchanged state
- **browser-panel.ts**: Right-side BrowserPanel tab state — owns lightweight browser tabs plus workspace-file/workspace-diff panel tabs, active panel tab selection, browser-use tab requests, scoped diff scroll commands, and webview navigation metadata.
- **browser-panel.test.ts**: Regression tests for browser panel shortcuts, idempotent active diff tab reopening, and selector-scoped render behavior for diff scroll commands
- **layout-slots.ts**: Layout slot registry — pages inject content into aside/panel regions
- **theme.ts**: Theme preference state — light/dark/system mode
- **sidebar-nav.ts**: Sidebar drill-in navigation state — controls which view the sidebar shows (main / settings)
- **session-activity.ts**: Session activity owner — tracks the currently visible chat session plus unread background activity, so sidebar session items stay display-only while the app shell owns unread reconciliation
- **session-activity.test.ts**: Regression tests for unread ownership, background activity marking, and visible-session clearing semantics
- **chat.ts**: Chat streaming state — stores per-session UI messages, browser-owned tool entities keyed by `toolCallId`, session-level local driver metadata, generation flags, errors, local abort-controller cleanup, and reconciles equivalent server snapshots without changing message references; server cancellation requests stay in the chat feature boundary
- **chat.test.ts**: Regression tests for chat snapshot structural sharing, unchanged message reference preservation, and pre-SSE local driver streaming visibility
- **new-chat.ts**: Composer preferences — persisted last selected runtime, CLI TUI agent, agent profile, per-profile model choice, and thinking effort, plus profile reconciliation when the available profile list changes
- **new-chat.test.ts**: Regression tests for idempotent preference updates and stale-profile reconciliation
- **persist-storage.ts**: Safe persisted storage wrapper with browser `localStorage` + in-memory fallback
- **streamdown.ts**: Streamdown render preferences — persisted animation preset, granularity, cursor visibility
