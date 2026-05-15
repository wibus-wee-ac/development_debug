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
- **shortcut-context.ts**: React context for keyboard shortcut management
- **shortcut-provider.tsx**: Provider component for shortcut context
- **shortcut-utils.ts**: Keyboard shortcut parsing and matching utilities
- **spring.ts**: Spring animation configuration constants
- **utils.ts**: Re-exports from cn.ts
