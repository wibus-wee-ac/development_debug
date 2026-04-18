<!-- Once this directory changes, update this README.md -->

# Main/Services

Main-process IPC services expose persisted app state and backend operations to the renderer.
Each service groups a cohesive set of methods behind one IPC namespace.
Register new services in `src/main/index.ts`.

## Files

- **acp.ts**: IPC service for ACP registry, install lifecycle, runtime control, and session operations
- **preferences.ts**: IPC service for global app chat preferences persisted in `electron-store`
- **session.ts**: IPC service for persisted chat sessions and message history
- **workspace.ts**: IPC service for workspace CRUD, file listing, and native OS integrations
