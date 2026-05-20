<!-- Once this directory changes, update this README.md -->

# src/renderer/src/lib

Shared utilities and services for the renderer process.
Contains IPC wrappers, styling helpers, and keyboard shortcut logic.
Used across features and components in the renderer.

## Files

- **cn.ts**: Tailwind class merging utility (`cn`) using clsx + tailwind-merge
- **electron.ts**: Electron environment helpers, typed IPC proxy, server HTTP base URL resolution, and server WebSocket URL derivation
- **ipc.ts**: Typed IPC proxy for renderer-to-main communication; 默认只在 devtool route 上启用昂贵的 caller stack 捕获
- **ipc-options.ts**: IPC instrumentation policy helper，决定何时允许捕获调用栈
- **plugin-host.ts**: Web plugin host，读取 server 返回的 governed plugin descriptors，并按 `routeSegment` 加载 web bundle
- **plugin-store.ts**: Plugin panel / command 的 Zustand store，记录 owner-scoped contribution ids
- **shortcut-context.ts**: React context for keyboard shortcut management
- **shortcut-provider.tsx**: Provider component for shortcut context
- **shortcut-utils.ts**: Keyboard shortcut parsing and matching utilities
- **spring.ts**: Spring animation configuration constants
- **types.ts**: Shared renderer type surface, including provider model capabilities and models.dev registry match metadata.
- **utils.ts**: Re-exports from cn.ts
- **workspace-drag-data.ts**: Shared DataTransfer protocol helpers for dragging workspace file paths from the file tree into chat and TUI targets.
- **workspace-drag-data.test.ts**: Regression coverage for workspace file drag payload serialization, terminal-safe quoting, and text/plain fallback.
