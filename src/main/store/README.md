<!-- Once this directory changes, update this README.md -->

# Main/Store

Main-process persistent stores back native app preferences and window state.
These helpers wrap `electron-store` so renderer code accesses preferences through IPC only.
Keep app-wide persisted defaults here instead of adding renderer-only persistence.

## Files

- **app.ts**: Persistent app preference store for window state and global chat model/thinking defaults
