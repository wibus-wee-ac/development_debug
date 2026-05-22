# Desktop Tray Feature

Main-window action bridge for Electron Desktop tray commands.

## Files

- **api.ts**: Fetch boundary for Desktop-owned await projection endpoints used by the awaits overview.
- **types.ts**: Local tray action and await contracts shared by the main-window bridge.
- **use-desktop-tray-action-bridge.ts**: Main-window subscription that maps native tray IPC actions to tab navigation, settings sections, and global search.
- **use-desktop-tray-action-bridge.test.tsx**: Unit coverage for tray action routing with tab route preloading mocked at the navigation boundary.
