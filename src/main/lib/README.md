<!-- Once this directory changes, update this README.md -->

# src/main/lib

Core main-process libraries for ACP agent lifecycle and system integration.
These modules manage process spawning, protocol connections, and Electron services.
They are consumed by `src/main/services/` IPC handlers.

## Files

- **acp-connection.ts**: AcpConnectionManager singleton — pure transport bridge over ACP; `prompt()` returns an `AsyncGenerator<UIMessageChunk>` and session-title updates fan out via `onSessionTitle` callbacks (no direct IPC coupling)
- **acp-installer.ts**: Agent installation logic (binary download/extract, package-manager metadata)
- **acp-process-manager.ts**: Spawns and manages child processes for ACP agents
- **acp-registry.ts**: Fetches the remote ACP agent registry and filters by platform support
- **acp-stream-converter.ts**: AcpStreamConverter — converts ACP SessionUpdate events to AI SDK UIMessageChunk arrays for IPC streaming
- **chat-engine.ts**: ChatEngine singleton — sole orchestrator for chat sessions; owns transactional user+assistant writes, per-chunk IPC broadcast, debounced DB flush, abort/failure semantics, and crash-recovery on init
- **ipc-devtool-store.ts**: Ring buffer and live subscriber fan-out for observed IPC events
- **ipc-devtool.ts**: Main-process integration that wires the shared IPC observer into the store, exposes `subscribeIpcDevtool(webContents)` so any BrowserWindow can receive live events, and hosts the dev-only `openDevtoolWindow()` factory for the second `/devtool` window
- **safe-storage.ts**: Electron safeStorage wrapper for storing secrets
- **thread-search.ts**: ThreadSearchEngine singleton — lazy-loaded jieba tokenizer + in-memory scored search over sessions/messages; returns hits with title/snippet match ranges for renderer highlighting
