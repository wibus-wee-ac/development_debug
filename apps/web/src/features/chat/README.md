<!-- Once this directory changes, update this README.md -->

# Features/Chat

Renderer-side view layer for chat.
Streaming updates arrive via SSE from the server. Initial hydration and reload/recovery
read message snapshots through React Query and project locally into Zustand.
The transport receives sequenced part-level delta events and applies them directly to
`UIMessage.parts` without chunk replay.

## Files

- **chat-delta-events.ts**: Renderer-owned delta types and accumulator helpers for sequenced part-level chat updates
- **chat-response-command.ts**: Feature-owned POST startup boundary for `/chat/sessions/{sessionId}/response`, shared by the main chat view and detached entry points that need to kick off a run before navigation
- **use-chat-session.ts**: Chat session hook — uses React Query for canonical snapshot rows, hydrates main messages plus subagent buckets keyed by `parentToolCallId`, passively observes run signals for reload/recovery, drives streaming responses, and exposes `{ messages, status, error, sendMessage, stop, isReady }`
- **sse-chat-transport.ts**: SSE parser for sequenced chat stream events and passive run-event observation
- **chat-view.tsx**: Read-only chat view — reads from useChatSession, renders MessageBubbles + Composer, auto-scrolls, and only shows token-capacity progress when a real session-bound model context window can be resolved (otherwise safely degrades to token count only)
- **composer.tsx**: Rich input with @ path autocomplete, inline send/stop toggle, fzf fuzzy file search
- **mention-panel.tsx**: Fuzzy file picker above composer using fzf with highlighted matches
- **message-bubble.tsx**: Renders a single UIMessage with Streamdown markdown, reasoning blocks, tool call blocks, copy action, and subagent message folds keyed by tool call ID
- **reasoning-block.tsx**: Collapsible thinking chain display with Streamdown markdown rendering inside, plus stable toggle/content anchors for E2E assertions
- **tool-call-block.tsx**: Collapsible tool invocation display with status icons and state machine; renders tool input、output（含无执行结果时的占位文案）与 stable E2E anchors
- **use-chat-session.test.ts**: Passive snapshot/reload regression tests for chat status derivation, main-message projection, subagent bucketing, and stop-action abort forwarding
- **chat-streaming-handler.ts**: SSE-to-store bridge that applies per-message sequenced main/subagent deltas and reconciles streamed assistant messages with canonical server IDs
- **index.ts**: Barrel file re-exporting public API
