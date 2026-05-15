<!-- Once this directory changes, update this README.md -->

# Features/Chat

Renderer-side view layer for chat.
Streaming updates arrive via SSE from the server. Initial hydration and reload/recovery
read session timeline snapshots through React Query and project locally into Zustand.
The transport receives raw timeline events and projects `UIMessageChunk`s locally via the
shared timeline projector.

## Files

- **use-chat-session.ts**: Chat session hook — uses React Query for canonical session timeline snapshots, locally projects `UIMessage`, passively observes timeline signal for reload/recovery, drives streaming responses, and exposes `{ messages, status, error, sendMessage, stop, isReady }`
- **sse-chat-transport.ts**: `ChatTransport` implementation bridging AI SDK's useChat to SSE — sends messages via HTTP API + subscribes to SSE timeline events; renderer locally projects events into `UIMessageChunk[]` for AI SDK
- **use-chat-events.ts**: Unified chat event bridge — renderer-side session watch for timeline consumers via `useChatTimelineEvent`
- **chat-view.tsx**: Read-only chat view — reads from useChatSession, renders MessageBubbles + Composer, auto-scrolls
- **composer.tsx**: Rich input with @ path autocomplete, inline send/stop toggle, fzf fuzzy file search
- **mention-panel.tsx**: Fuzzy file picker above composer using fzf with highlighted matches
- **message-bubble.tsx**: Renders a single UIMessage with Streamdown markdown, reasoning blocks, tool call blocks, and copy action; memoized so unchanged history rows do not re-render during streaming
- **reasoning-block.tsx**: Collapsible thinking chain display with Streamdown markdown rendering inside, plus stable toggle/content anchors for E2E assertions
- **tool-call-block.tsx**: Collapsible tool invocation display with status icons and state machine; renders tool input、output（含无执行结果时的占位文案）与 stable E2E anchors
- **use-chat-session.test.ts**: Passive snapshot/reload regression tests for chat status derivation, renderer-visible state precedence, and stop-action abort forwarding
- **index.ts**: Barrel file re-exporting public API
