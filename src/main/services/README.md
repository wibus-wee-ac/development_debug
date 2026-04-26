<!-- Once this directory changes, update this README.md -->

# Main/Services

Main-process IPC services expose persisted app state and backend operations to the renderer.
Each service groups a cohesive set of methods behind one IPC namespace.
Register new services in `src/main/index.ts`.

## Files

- **agent-runtime.ts**: IPC service for unified Agent Profile CRUD, provider probes, model listing, and credential metadata
- **acp.ts**: Deprecated compatibility module; legacy ACP IPC is no longer registered
- **chat.ts**: IPC service forwarding to ChatEngine — `createAndSend`, `send`, `abort`, `getMessages`, `ensureLive`
- **cli.ts**: Deprecated compatibility module; legacy CLI IPC is no longer registered
- **dev.ts**: Dev-only IPC service backing the bottom bar (`openUserData`, `hardReload`)
- **ipc-devtool.ts**: IPC service exposing buffered observed IPC events (`getSnapshot`, `clear`) and the dev-only `openWindow` action used by the renderer bottom bar
- **preferences.ts**: IPC service for global app chat preferences persisted in `electron-store`
- **search.ts**: IPC service forwarding to ThreadSearchEngine — `searchThreads` returns ranked hits across sessions with jieba-tokenized title + content matches
- **session.ts**: IPC service for persisted chat sessions, provider session handles, and per-session config snapshots; message writes are owned by ChatEngine (this service only reads)
- **workspace.ts**: IPC service for workspace CRUD, file listing, and native OS integrations
- **usage.ts**: IPC service for aggregated token usage analytics — `getDailyUsage` (heatmap data) and `getUsageSummary` (totals + breakdowns by agent/model)
