<!-- Once this directory changes, update this README.md -->

# src/main/lib

Core main-process libraries for ACP agent lifecycle and system integration.
These modules manage process spawning, protocol connections, and Electron services.
They are consumed by `src/main/services/` IPC handlers.

## Files

- **acp-connection.ts**: AcpConnectionManager singleton — manages ACP ClientSideConnection instances, converts session updates to UIMessageChunk, and streams to renderer via IPC
- **acp-installer.ts**: Agent installation logic (binary download/extract, package-manager metadata)
- **acp-process-manager.ts**: Spawns and manages child processes for ACP agents
- **acp-registry.ts**: Fetches the remote ACP agent registry and filters by platform support
- **acp-stream-converter.ts**: AcpStreamConverter — converts ACP SessionUpdate events to AI SDK UIMessageChunk arrays for IPC streaming
- **safe-storage.ts**: Electron safeStorage wrapper for storing secrets
