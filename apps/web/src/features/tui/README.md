<!-- Once this directory changes, update this README.md -->

# Features/Tui

Terminal UI view for cli-tui provider sessions and the bottom-panel shell.
Wraps xterm.js with FitAddon and WebglAddon; theme is derived from the app's CSS variables.
Uses HTTP only for PTY resource lifecycle (`start-or-attach`, `delete`) and a shared WebSocket live channel adapter for `snapshot` / `output` / `exit` plus `input` / `resize` / `ping`.

## Files

- **app-theme.ts**: `getAppTerminalTheme()` — reads CSS variables from the app theme at runtime to produce an xterm ITheme.
- **keyboard-handler.ts**: `attachMacKeyboardHandler()` — maps macOS shortcuts (Cmd/Option+arrows, Cmd+Delete) to ANSI sequences.
- **pty-protocol.ts**: Shared PTY WebSocket message types and JSON parser for `snapshot` / `output` / `exit` / `pong` / `error`.
- **pty-protocol.test.ts**: Unit coverage for PTY WebSocket server event parsing, invalid payload rejection, and nullable exit fields.
- **pty-channel.ts**: Shared PTY WebSocket channel adapter with reconnect, ping, and queued input / resize sends.
- **bottom-terminal-panel.tsx**: Bottom-panel terminal owner UI with right-side session tabs, new-session creation, runtime-only active session state, close-session anchors, and path/title labels from terminal metadata. It mounts only the active xterm view; inactive sessions are preserved by server PTY state, not by keeping extra xterm instances in the DOM.
- **tui-view.tsx**: TuiView component — mounts and manages an xterm.js terminal instance for a cli-tui session, including workspace file drop insertion through the shared drag payload protocol and a first-render gate after xterm mount, dimension fit, and `start-or-attach` succeed.
- **tui-view-loader.ts**: CLI-TUI chat session view 的共享 lazy loader 与 runtime metadata preload 入口，并记录 `tui-view-first-render` 的 lazy request 起点。
- **shell-api.ts**: Shell control-plane helpers for explicit start and stop; live keystrokes and resize travel on the PTY socket.
- **terminal-panel-view-loader.ts**: Bottom-panel terminal view 的共享 lazy loader 与 workspace panel preload 入口。
- **terminal-metadata.ts**: Pure helpers for parsing OSC terminal title/current-directory metadata and formatting workspace-relative path labels.
- **terminal-panel-store.ts**: Runtime-only Zustand state for bottom-panel terminal sessions scoped by chat/workspace owner; the session tab list is discarded when the app exits.
- **shell-view.tsx**: ShellView component — bottom-panel interactive shell terminal view. It owns one xterm instance at a time, mirrors PTY snapshots/output into a hidden transcript for behavior assertions, can detach without stopping the backing PTY when switching panel sessions, and reports OSC title/current-directory metadata for the panel chrome.
