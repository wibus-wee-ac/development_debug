<!-- Once this directory changes, update this README.md -->

# src/renderer/src/lib

Shared utilities and services for the renderer process.
Contains IPC wrappers, styling helpers, keyboard shortcut logic, and chat transport.
Used across features and components in the renderer.

## Files

- **acp-chat-transport.ts**: AcpChatTransport — custom ChatTransport bridging Electron IPC to AI SDK useChat
- **cn.ts**: Tailwind class merging utility (`cn`) using clsx + tailwind-merge
- **ipc.ts**: Typed IPC proxy for renderer-to-main communication
- **shortcut-context.ts**: React context for keyboard shortcut management
- **shortcut-provider.tsx**: Provider component for shortcut context
- **shortcut-utils.ts**: Keyboard shortcut parsing and matching utilities
- **spring.ts**: Spring animation configuration constants
- **utils.ts**: Re-exports from cn.ts
