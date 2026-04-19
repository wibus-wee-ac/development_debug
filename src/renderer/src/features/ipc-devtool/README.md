<!-- Once this directory changes, update this README.md -->

# features/ipc-devtool

Developer-only IPC observability panel rendered in the second (`/devtool`) BrowserWindow.
Consumes the preload `window.ipcDevtool` API to build a network-tab style view of
IPC calls grouped by `traceId` (renderer:start → main:start → main:finish → renderer:finish).
UI intentionally does not follow the main app's Base-UI style — it uses plain Tailwind
primitives tuned for density and developer ergonomics.

Theme follows the main window via the persisted `useThemeStore`.
Runtime theme
changes in the main window do not propagate live to an already-open devtool window;
re-open the devtool window to sync.

## Files

- **index.ts**: Barrel export — `IpcDevtoolPage`
- **ipc-devtool-page.tsx**: Page shell — top filter bar + split table/detail panes, wires the preload subscription and keyboard shortcuts
- **use-ipc-events.ts**: Zustand stores for event buffer + filters, plus `useIpcTraces` / `useIpcFilteredTraces` selectors that group raw events by `traceId`
- **use-ipc-keyboard.ts**: Window-level keyboard shortcuts (arrow navigation, search focus, pause/clear, escape to clear selection)
- **ipc-filter-bar.tsx**: Search input, status toggles, side toggles, pause/clear buttons, filtered/total counts
- **ipc-events-table.tsx**: TanStack Table v8 rendering one row per logical trace — time, channel, phase flow dots, status chip, duration, args preview
- **ipc-event-detail.tsx**: Right pane — trace metadata, per-phase status grid, args/result/error/stack tabs with copy-to-clipboard
