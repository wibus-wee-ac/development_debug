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
- **asset-precache.ts**: Production asset precache service worker registration helper，启动后在 shell 可见之后注册 Vite 生成的静态资源缓存。
- **plugin-host.ts**: Web plugin host，读取 server 返回的 governed plugin descriptors，按 `routeSegment` 和 `layers.web.status` 加载 web bundle，投影 renderer-local web layer lifecycle，并在 deactivation 时清理 web plugin subscriptions
- **plugin-host.test.ts**: 覆盖 web plugin activation failure cleanup、deactivation cleanup、disabled web layer skip 和 renderer-local web layer state projection。
- **plugin-store.ts**: Plugin panel / command 的 Zustand store，记录 owner-scoped contribution ids 和 renderer-local web layer state
- **perf-monitor.ts**: Renderer performance monitor，收集 Web Vitals、heap snapshots、Cradle startup marks 和 acceptance measures.
- **perf-report.ts**: Structured Cradle performance acceptance report builder，汇总 marks、measures、Web Vitals 和 memory snapshots，并计算 startup、route、browser panel、bottom-panel shell、TUI view、Kanban sidebar、Plugins sidebar、Jarvis popover、settings overlay、right-aside Files/Git/Issue/Feed、Workspace Workflow Rules、Workspace Skills、Pack Codebase dialog 与 interaction gate 状态。
- **perf-report.test.ts**: 覆盖 performance report gate 的 pass、fail、missing 与重复 measure 取最新值。
- **shortcut-context.ts**: React context for keyboard shortcut management
- **shortcut-provider.tsx**: Provider component for shortcut context
- **shortcut-utils.ts**: Keyboard shortcut parsing and matching utilities
- **spring.ts**: Spring animation configuration constants
- **types.ts**: Shared renderer type surface, including provider model capabilities and models.dev registry match metadata.
- **utils.ts**: Re-exports from cn.ts
- **workspace-drag-data.ts**: Shared DataTransfer protocol helpers for dragging workspace file paths from the file tree into chat and TUI targets.
- **workspace-drag-data.test.ts**: Regression coverage for workspace file drag payload serialization, terminal-safe quoting, and text/plain fallback.
