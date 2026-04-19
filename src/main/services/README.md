<!-- Once this directory changes, update this README.md -->

# Main/Services

Main-process IPC services expose persisted app state and backend operations to the renderer.
Each service groups a cohesive set of methods behind one IPC namespace.
Register new services in `src/main/index.ts`.

## Files

- **acp.ts**: IPC service for ACP registry, install lifecycle, runtime control, and session operations
- **chat.ts**: IPC service forwarding to ChatEngine — `createAndSend`, `send`, `abort`, `getMessages`, `ensureLive`
- **dev.ts**: Dev-only IPC service backing the bottom bar (`openUserData`, `hardReload`)
- **ipc-devtool.ts**: IPC service exposing buffered observed IPC events (`getSnapshot`, `clear`) and the dev-only `openWindow` action used by the renderer bottom bar
- **preferences.ts**: IPC service for global app chat preferences persisted in `electron-store`
- **session.ts**: IPC service for persisted chat sessions and per-session config snapshots; message writes are owned by ChatEngine (this service only reads)
- **workspace.ts**: IPC service for workspace CRUD, file listing, and native OS integrations
