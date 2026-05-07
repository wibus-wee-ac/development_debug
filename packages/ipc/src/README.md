<!-- Once this directory changes, update this README.md -->

# Packages/Ipc/Src

Source files for the shared IPC abstraction and devtool instrumentation.
These modules are imported by both renderer and main process code, so every export must stay serializable and Electron-safe.
Prefer small focused helpers over feature-specific logic in this directory.

## Files

- **base.ts**: Main-process service registration, handler context, and IPC observer hooks.
- **client.ts**: Renderer-side typed proxy and renderer instrumentation entry point.
- **events.ts**: Shared IPC event schema, serialization helpers, and trace metadata helpers.
- **observability-events.ts**: Shared observability event/incident contracts for main-renderer devtool streaming.
- **index.ts**: Public exports for the package.
- **utility.ts**: Type-level helpers for extracting typed service method signatures.
