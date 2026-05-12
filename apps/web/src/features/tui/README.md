<!-- Once this directory changes, update this README.md -->

# Features/Tui

Terminal UI view for cli-tui provider sessions and the bottom-panel shell.
Wraps xterm.js with FitAddon and WebglAddon; theme is derived from the app's CSS variables.
Communicates with the main process via window.ptyPush (push) and ipc.pty (invoke).

## Files

- **app-theme.ts**: `getAppTerminalTheme()` — reads CSS variables from the app theme at runtime to produce an xterm ITheme.
- **keyboard-handler.ts**: `attachMacKeyboardHandler()` — maps macOS shortcuts (Cmd/Option+arrows, Cmd+Delete) to ANSI sequences.
- **github-theme.ts**: Static GitHub Dark/Light xterm ITheme constants (kept as reference; no longer used by views).
- **one-dark-theme.ts**: Static One Dark ITheme constant (kept as reference; no longer used).
- **tui-view.tsx**: TuiView component — mounts and manages an xterm.js terminal instance for a cli-tui session.
- **shell-view.tsx**: ShellView component — bottom-panel interactive shell terminal, session-scoped.
