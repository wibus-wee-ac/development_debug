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
- **tui-view.tsx**: TuiView component — mounts and manages an xterm.js terminal instance for a cli-tui session.
- **shell-api.ts**: Shell control-plane helpers for explicit start and stop; live keystrokes and resize travel on the PTY socket.
- **shell-view.tsx**: ShellView component — bottom-panel interactive shell terminal, panel-owned and explicitly stopped on cleanup.
