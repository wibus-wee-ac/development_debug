<!-- Once this directory changes, update this README.md -->

# Features/Tui

Terminal UI view for cli-tui provider sessions.
Wraps xterm.js with the One Dark theme, FitAddon, and WebglAddon.
Communicates with the main process via window.ptyPush (push) and ipc.pty (invoke).

## Files

- **one-dark-theme.ts**: ITheme constant for xterm.js terminal colour scheme (One Dark palette).
- **tui-view.tsx**: TuiView component — mounts and manages an xterm.js terminal instance for a Cradle session.
