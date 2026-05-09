# Pty Module

Provides session-owned terminal runtime for `cli-tui` chat sessions, including start-or-attach, SSE output streaming, input, resize, buffer replay, and cleanup on session deletion.

## Files

- `pty.module.ts`: Tsuki module registration.
- `pty.controller.ts`: HTTP endpoints under `/terminal-sessions/*`.
- `pty.service.ts`: session/profile/workspace resolution, terminal lifecycle semantics, and Zod-backed cli-tui config parsing.
- `pty.store.ts`: DB-backed session/workspace/profile lookups.
- `pty.manager.ts`: child-process runtime manager with buffer replay and SSE subscribers.
