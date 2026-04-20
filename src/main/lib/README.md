<!-- Once this directory changes, update this README.md -->

# src/main/lib

Core main-process libraries for ACP agent lifecycle and system integration.
These modules manage process spawning, protocol connections, and Electron services.
They are consumed by `src/main/services/` IPC handlers.

## Files

- **acp-connection.ts**: AcpConnectionManager singleton — pure transport bridge over ACP; `prompt()` returns an `AsyncGenerator<ResponseStreamEvent>` and session-title updates fan out via `onSessionTitle` callbacks (no direct IPC coupling)
- **acp-installer.ts**: Agent installation logic (binary download/extract, package-manager metadata)
- **acp-process-manager.ts**: Spawns and manages child processes for ACP agents
- **acp-registry.ts**: Fetches the remote ACP agent registry and filters by platform support
- **acp-responses-converter.ts**: AcpResponsesConverter — converts ACP SessionUpdate events into OpenAI Responses API-style `ResponseStreamEvent` objects for IPC streaming
- **chat-engine.ts**: ChatEngine singleton — sole orchestrator for chat sessions; owns transactional user+assistant writes, OpenAI-style `chat:response-event` IPC broadcast, debounced DB flush, abort/failure semantics, crash-recovery on init, and ACP error detail expansion for chat failures
- **chat-provider.ts**: ChatProvider interface + ChatResponseEventPayload IPC envelope type; defines the provider-agnostic stream contract using `ResponseStreamEvent` from the `openai` SDK
- **ipc-devtool-store.ts**: Ring buffer and live subscriber fan-out for observed IPC events
- **ipc-devtool.ts**: Main-process integration that wires the shared IPC observer into the store, exposes `subscribeIpcDevtool(webContents)` so any BrowserWindow can receive live events, and hosts the dev-only `openDevtoolWindow()` factory for the second `/devtool` window
- **safe-storage.ts**: Electron safeStorage wrapper for storing secrets
- **thread-search.ts**: ThreadSearchEngine singleton — lazy-loaded jieba tokenizer + in-memory scored search over sessions/messages; returns hits with title/snippet match ranges for renderer highlighting
