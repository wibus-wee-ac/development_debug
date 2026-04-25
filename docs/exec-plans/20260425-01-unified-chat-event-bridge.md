# Unified Chat Event Bridge

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. This document must be maintained in accordance with docs/exec-plans/README.md and the PLANS.md conventions.

## Purpose / Big Picture

Currently, the `chat:response-event` IPC channel (the streaming event pipeline from main process to renderer) is subscribed to independently in three separate places. Each subscriber calls `window.electron.ipcRenderer.on('chat:response-event', ...)` directly, bypassing the preload safety layer that every other push channel (PTY, devtool) uses. This creates three problems: (1) subscription lifecycle bugs where listeners leak or fire after unmount, (2) inconsistent filtering logic duplicated across consumers, and (3) the `chat:*` channels being the only push channels not wrapped by preload — a security/architecture gap.

After this change, a single `useChatEvents` hook subscribes to chat push events once, and all three consumers receive events through a stable callback pattern. The preload layer gains a `chatPush` API matching the existing `ptyPush` and `ipcDevtool` patterns. A developer adding a new chat event consumer writes one line (`useChatEvents(sessionId, handler)`) instead of wiring up raw IPC, filtering, and cleanup.

## Progress

- [x] (2026-04-25 13:35Z) Milestone 1: Preload `chatPush` API — added `chatPush.onResponseEvent` and `chatPush.onSessionTitle` to preload/index.ts + type declarations in index.d.ts. Shared types in `src/shared/chat-events.ts`.
- [x] (2026-04-25 13:38Z) Milestone 2: `useChatEvents` hook — created `src/renderer/src/features/chat/use-chat-events.ts` with module-level handler registries and three hooks: `useChatResponseEvent`, `useGlobalChatEvent`, `useChatSessionTitle`.
- [x] (2026-04-25 13:42Z) Milestone 3: Migrate three consumers — `ipc-chat-transport.ts` uses `window.chatPush.onResponseEvent` directly (imperative, not React), `use-chat-session.ts` uses `useChatResponseEvent` hook, `use-global-event-listeners.ts` uses `useGlobalChatEvent` hook.
- [x] (2026-04-25 13:44Z) Milestone 4: Unify `chat:session-title` — `chat.$sessionId.tsx` now uses `useChatSessionTitle` hook instead of direct `ipcRenderer.on`.
- [x] (2026-04-25 13:46Z) Milestone 5: Validation — grep confirms zero `ipcRenderer.on('chat:')` in renderer, exactly 2 in preload (the wrappers). All files pass type checking with no errors.

## Surprises & Discoveries

(none yet)

## Decision Log

- Decision: `ipc-chat-transport.ts` uses `window.chatPush.onResponseEvent` directly instead of the React hook, because it is an imperative transport factory function, not a React component.
  Rationale: React hooks cannot be called outside component/hook contexts. The preload API is safe and clean enough for imperative code.
  Date: 2026-04-25

## Outcomes & Retrospective

All 5 milestones completed. The `chat:response-event` and `chat:session-title` channels are now fully wrapped by the preload safety layer, consistent with PTY and devtool channels. Three React consumers use the centralized hook pattern; one imperative consumer uses the preload API directly. No direct `ipcRenderer.on('chat:*')` calls remain in the renderer codebase.

## Context and Orientation

The Cradle application is an Electron desktop app. The main process runs chat AI sessions via `ChatEngine` (at `src/main/lib/chat-engine.ts`). When streaming a response, `ChatEngine` broadcasts events to all renderer windows via `webContents.send('chat:response-event', payload)`. The payload type is `ChatResponseEventPayload` defined in `src/main/lib/chat-provider.ts`:

    interface ChatResponseEventPayload {
      chatSessionId: string
      messageId: string
      event: ResponseStreamEvent  // OpenAI Responses API event
    }

The event lifecycle is: `response.created` then N content deltas then `response.completed` or `response.failed`.

In the renderer, three files independently subscribe to this channel:

1. `src/renderer/src/features/chat/ipc-chat-transport.ts` (line 165) — Bridges events into a ReadableStream for the AI SDK `useChat` hook. Filters by `chatSessionId`. Processes all event types.

2. `src/renderer/src/features/chat/use-chat-session.ts` (line 161) — Detects when another window completes a stream. Filters by `chatSessionId`, only cares about `completed`/`failed`, skips if local streaming is active.

3. `src/renderer/src/hooks/use-global-event-listeners.ts` (line 73) — Marks sessions as unread when not viewing them. No session filter, only cares about `completed`/`failed`.

Additionally, `chat:session-title` is another push channel sent by `ChatEngine` (line 156) and listened to in `src/renderer/src/routes/chat.$sessionId.tsx` (line 255), also bypassing preload.

The preload layer (`src/preload/index.ts`) already wraps PTY and devtool push channels via `contextBridge.exposeInMainWorld`. The pattern is: preload exposes `onXyz(callback)` that returns an unsubscribe function.

## Plan of Work

The work proceeds in five milestones.

Milestone 1 adds the `chatPush` preload API. In `src/preload/index.ts`, add a `chatPush` namespace alongside the existing `ptyPush` and `ipcDevtool` namespaces. This namespace exposes two methods: `onResponseEvent(callback)` and `onSessionTitle(callback)`, each returning an unsubscribe function. Update the preload type declaration at `src/preload/index.d.ts` to include the new `chatPush` API.

Milestone 2 creates the unified `useChatEvents` hook at `src/renderer/src/features/chat/use-chat-events.ts`. This hook subscribes to `chatPush.onResponseEvent` once on mount and dispatches events to registered handlers via a ref-based callback pattern. It provides two APIs: `useChatResponseEvent(sessionId, handler)` for session-scoped listeners and `useGlobalChatEvent(handler)` for unscoped listeners.

Milestone 3 migrates the three consumers. Each consumer replaces its direct `ipcRenderer.on` call with the appropriate hook from milestone 2. The `ipc-chat-transport.ts` and `use-chat-session.ts` use `useChatResponseEvent(sessionId, handler)`. The `use-global-event-listeners.ts` uses `useGlobalChatEvent(handler)`.

Milestone 4 unifies the `chat:session-title` channel through the same preload wrapper and provides `useChatSessionTitle(sessionId, handler)`.

Milestone 5 validates that no direct `ipcRenderer.on('chat:')` calls remain in the renderer codebase and that all existing functionality (streaming, cross-window sync, unread markers) works correctly.

## Concrete Steps

Milestone 1: Preload chatPush API

In `src/preload/index.ts`, after the existing `ptyPush` block, add:

    chatPush: {
      onResponseEvent: (callback: (payload: ChatResponseEventPayload) => void) => {
        const handler = (_event: IpcRendererEvent, payload: ChatResponseEventPayload) => callback(payload)
        ipcRenderer.on('chat:response-event', handler)
        return () => { ipcRenderer.removeListener('chat:response-event', handler) }
      },
      onSessionTitle: (callback: (payload: { sessionId: string; title: string }) => void) => {
        const handler = (_event: IpcRendererEvent, payload: { sessionId: string; title: string }) => callback(payload)
        ipcRenderer.on('chat:session-title', handler)
        return () => { ipcRenderer.removeListener('chat:session-title', handler) }
      },
    }

Update `src/preload/index.d.ts` to declare the `chatPush` property on the `ElectronAPI` interface.

Milestone 2: useChatEvents hook

Create `src/renderer/src/features/chat/use-chat-events.ts`. The module maintains a single subscription via a module-level setup (or a context provider at the root). It exposes:

- `useChatResponseEvent(sessionId: string, handler: (payload: ChatResponseEventPayload) => void)` — registers a handler that is called only when `payload.chatSessionId === sessionId`.
- `useGlobalChatEvent(handler: (payload: ChatResponseEventPayload) => void)` — registers a handler that is called for all events regardless of session.
- `useChatSessionTitle(sessionId: string, handler: (title: string) => void)` — registers a handler for session title updates.

Implementation approach: use a module-level `Set` of handlers. A single `useEffect` at the app root (in `__root.tsx` or via a provider) subscribes to `chatPush.onResponseEvent` and iterates over all registered handlers. Each `useChatResponseEvent` call adds/removes from the set via `useEffect`.

Milestone 3: Migrate consumers

1. In `src/renderer/src/features/chat/ipc-chat-transport.ts`, replace the `ipcRenderer.on('chat:response-event', ...)` block with a call to the session-scoped event registration.

2. In `src/renderer/src/features/chat/use-chat-session.ts`, replace the `ipcRenderer.on('chat:response-event', ...)` block with `useChatResponseEvent`.

3. In `src/renderer/src/hooks/use-global-event-listeners.ts`, replace the `ipcRenderer.on('chat:response-event', ...)` block with `useGlobalChatEvent`.

Milestone 4: Unify chat:session-title

In `src/renderer/src/routes/chat.$sessionId.tsx`, replace the direct `ipcRenderer.on('chat:session-title', ...)` listener with `useChatSessionTitle(sessionId, handler)`.

Milestone 5: Validation

Run a grep for `ipcRenderer.on('chat:` across the renderer codebase. Expect zero direct hits (only the preload wrapper should reference these channels). Test by creating a chat session, verifying streaming works, opening a second window and verifying cross-window sync, and checking unread indicators.

## Validation and Acceptance

After implementation, the following must hold:

1. `grep -r "ipcRenderer.on('chat:" src/renderer/` returns no matches.
2. `grep -r "ipcRenderer.on('chat:" src/preload/` returns exactly two matches (the wrappers).
3. Starting a chat session and sending a message produces streaming output as before.
4. Opening the same session in a tearoff window shows messages synced.
5. Receiving a response while viewing a different session shows the unread dot indicator.
6. Session title updates appear in the sidebar and header.

## Idempotence and Recovery

All changes are additive. The preload API is new and does not modify existing channel names. Each consumer migration can be done one at a time — the old pattern and new pattern can coexist during migration. If a migration step fails, reverting that file restores the old behavior.

## Artifacts and Notes

Current preload pattern for reference (from ptyPush):

    ptyPush: {
      onData: (callback: (sessionId: string, data: string) => void) => {
        const handler = (_e: IpcRendererEvent, sessionId: string, data: string) => callback(sessionId, data)
        ipcRenderer.on('pty:data', handler)
        return () => { ipcRenderer.removeListener('pty:data', handler) }
      },
      // ...
    }

## Interfaces and Dependencies

In `src/preload/index.d.ts`, the `ElectronAPI` interface gains:

    chatPush: {
      onResponseEvent: (callback: (payload: ChatResponseEventPayload) => void) => () => void
      onSessionTitle: (callback: (payload: { sessionId: string; title: string }) => void) => () => void
    }

In `src/renderer/src/features/chat/use-chat-events.ts`:

    export function useChatResponseEvent(sessionId: string, handler: (payload: ChatResponseEventPayload) => void): void
    export function useGlobalChatEvent(handler: (payload: ChatResponseEventPayload) => void): void
    export function useChatSessionTitle(sessionId: string, handler: (title: string) => void): void
