# Desktop Tray Feature

Renderer-owned tray surface and main-window action bridge for Electron Desktop.

## Files

- **api.ts**: Fetch boundary for Desktop-owned read-only tray projection endpoints.
- **tray-popover.tsx**: Compact Electron tray popover surface for running sessions, resident sessions, metrics, and quick actions.
- **types.ts**: Local tray projection contracts shared by the popover and bridge.
- **use-desktop-tray-action-bridge.ts**: Main-window subscription that maps tray IPC actions to tab navigation, settings sections, and global search.
