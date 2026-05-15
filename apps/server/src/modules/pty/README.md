# Pty Module

Provides session-owned chat PTYs plus panel-owned shell PTYs. HTTP owns resource lifecycle (`start-or-attach`, `delete`); WebSocket owns the live channel protocol (`snapshot` / `output` / `exit` and `input` / `resize` / `ping`).

## Files

- `index.ts`: Elysia HTTP + WebSocket route surface under `/terminal-sessions/*`.
- `model.ts`: TypeBox schemas for control routes and live-channel payloads.
- `protocol.ts`: Shared PTY WebSocket protocol types.
- `pty.runtime.ts`: `node-pty` runtime registry and process lifecycle hooks.
- `pty.timeline.ts`: Sequence-aware snapshots, replay windows, and exit history.
- `pty.socket.ts`: WebSocket adapter that bridges runtime/timeline to clients.
- `service.ts`: Session/profile/workspace ownership rules, shell lease cleanup, and module shutdown.
