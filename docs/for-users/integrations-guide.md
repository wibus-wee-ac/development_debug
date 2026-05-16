# Integrations Guide

This guide is for developers integrating with Cradle from renderer code, automation scripts, or companion tools.

## 1. Integration Surfaces

Cradle exposes three primary integration surfaces:

- Renderer typed IPC proxy: `window.ipc`
- Renderer push-event bridge: `window.cradle.subscribe(...)`
- CLI JSON-RPC client: `cradle` command (`src/cli`)

For observability tools, Cradle also exposes:

- Devtool bridge: `window.ipcDevtool`

## 2. Architecture Contracts

### 2.1 Main Process as Source of Truth

Main process owns:

- Persistent data
- Runtime orchestration
- PTY and provider process boundaries
- Audit and observability event sources

Renderer owns:

- View state
- Interaction flow
- Controlled subscriptions

Do not move core orchestration behavior into renderer-side effects.

### 2.2 Typed IPC Contract

Renderer accesses typed methods through:

```ts
import { ipc } from '@renderer/lib/ipc'

const sessions = await ipc.session.list(workspaceId)
```

This is backed by `@cradle/ipc` proxy generation against main-process service declarations.

### 2.3 Push Event Contract

Cradle now has two push shapes:

1. **Chat runtime** uses HTTP + SSE directly:

```ts
const response = await fetch(`/chat/sessions/${sessionId}/response`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'Hello' }),
})

// Consume SSE events:
// - message_delta
// - subagent_message_delta
// - run_completed / run_aborted / run_failed
```

2. **Other app-owned push channels** may still use the renderer signal bridge:

- `pty:data`
- `pty:title`
- `pty:exit`
- `pty:notification`
- `pty:command-finish`
- `approval:requested`
- `approval:resolved`
- `observability:incident`

## 3. Integration Patterns

### 3.1 Query + Event Stitching

Preferred model:

1. Query initial snapshot over HTTP/IPC.
2. Subscribe to incremental SSE or signal events.
3. Keep local projection deterministic and idempotent.

Cradle chat uses this pattern as `GET /chat/sessions/:sessionId/messages` + SSE delta events.

### 3.2 Session Watch Lifecycle

For chat integrations:

1. Load the current snapshot from `GET /chat/sessions/:sessionId/messages`.
2. Start or observe a run via `POST /chat/sessions/:sessionId/response`.
3. Apply `message_delta` / `subagent_message_delta` / `run_*` events from the SSE stream.

### 3.3 PTY Lifecycle

For terminal integrations:

1. Start PTY via `ipc.pty.startPty(sessionId, cols, rows)`.
2. Subscribe to PTY push events.
3. Forward input via `ipc.pty.writePty(...)`.
4. Resize on viewport changes via `ipc.pty.resizePty(...)`.
5. Stop with `ipc.pty.stopPty(...)` when done.

## 4. Ownership and Namespace Discipline

Respect Cradle ownership boundaries:

- Read from external namespaces only when explicitly intended.
- Write only to Cradle-owned namespaces and stores.
- Keep lifecycle ownership with the feature that defines semantics.

Examples:

- Skills may be read from shared sources but lifecycle is managed in Cradle-owned stores.
- Workspace metadata and session lifecycle are owned by Cradle runtime services.

## 5. Security and Safety Considerations

### 5.1 Keep Preload Surface Minimal

Every preload method becomes part of application contract.

- Avoid exposing mutable Node primitives directly.
- Expose serializable APIs only.
- Route side effects through main-process services.

### 5.2 Local Data Expectations

Cradle is local-first:

- Session and workspace metadata are persisted locally.
- Runtime event buffers are local.
- Skills and workflow rule files are local.

Plan operational safeguards accordingly (backup, export, migration procedures).

## 6. Observability Integration

Use `window.ipcDevtool` for developer diagnostics:

- `getSnapshot` / `clear` for IPC traces
- `getAcpSnapshot` / `clearAcp`
- `getAgentContextSnapshot` / `clearAgentContext`
- `getObservabilitySnapshot` / `clearObservability`
- `flushObservability`
- `exportObservabilityBundle`

This surface is for diagnostics, not business workflows.

## 7. CLI Automation

Cradle CLI uses JSON-RPC over a local domain socket.

- Works when Cradle desktop app is running.
- Designed for scripting workspace/kanban/issue/agent operations.

Use cases:

- Batch issue creation/movement.
- Delegation workflows from CI-like scripts on local machines.
- Automated project state snapshots.

See [CLI Reference](./cli-reference.md) for full command list.

## 8. Backward-Compatible Extension Strategy

When extending integrations:

1. Add methods in owning namespace only.
2. Keep old methods stable unless explicit migration is provided.
3. Prefer additive payload evolution.
4. Validate integration behavior with focused tests in owning feature.
5. Update this docs set in the same change.
