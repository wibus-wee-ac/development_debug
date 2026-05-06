<!-- Once this directory changes, update this README.md -->

# Features/Chat

Renderer-side view layer for chat.
All orchestration lives in the main-process `ChatEngine`
(`src/main/features/chat/chat-engine.ts`); this directory is a thin view that drives
AI SDK's `useChat` through a custom `ChatTransport` which forwards to `ipc.chat`.
Streaming updates now arrive as typed timeline payloads plus projected `UIMessageChunk`s
on the session-scoped `chat:timeline-event` IPC channel, consumed through the preload
`chatPush` wrapper and the unified `use-chat-events` hook. The transport no longer knows
backend-native event shapes; it simply consumes chat projection chunks after registering a
main-process watch for the active session, while reload/reconnect paths fall back to
persisted snapshot observation so mid-flight refreshes do not corrupt the active assistant message.

## Files

- **use-chat-session.ts**: Hook wrapping `useChat` — loads initial snapshot via `ipc.chat.getMessages`, keeps reload/reconnect views in sync by passively observing persisted streaming drafts, refetches on timeline events when this renderer is not the active stream owner, forwards stop actions to both local `useChat` and `ipc.chat.abort`, throttles streamed UI updates, logs raw `useChat` errors, and exposes `{ messages, status, error, sendMessage, stop, isReady }`
- **ipc-chat-transport.ts**: `ChatTransport` implementation bridging AI SDK's useChat to our IPC — `sendMessages` → `ipc.chat.send` + session watch registration + subscribe to `chatPush.onTimelineEvent`; guards stream teardown races so late IPC events from an old page do not throw after navigation; consumes projected `UIMessageChunk`s directly
- **use-chat-events.ts**: Unified chat event bridge — renderer-side session watch registration for timeline consumers, plus global terminal activity dispatch via `useGlobalChatSessionActivityEvent`
- **chat-view.tsx**: Read-only chat view — reads from useChatSession, renders MessageBubbles + Composer, auto-scrolls
- **composer.tsx**: Rich input with @ path autocomplete, inline send/stop toggle, fzf fuzzy file search
- **mention-panel.tsx**: Fuzzy file picker above composer using fzf with highlighted matches
- **message-bubble.tsx**: Renders a single UIMessage with Streamdown markdown, reasoning blocks, tool call blocks, and copy action; memoized so unchanged history rows do not re-render during streaming
- **model-picker.tsx**: Button-triggered Combobox with searchable list for picking the active ACP model; controlled open state so callers can open it after reconnecting
- **reasoning-block.tsx**: Collapsible thinking chain display with Streamdown markdown rendering inside, plus stable toggle/content anchors for E2E assertions
- **tool-call-block.tsx**: Collapsible tool invocation display with status icons and state machine; renders tool input、output（含无执行结果时的占位文案）与 stable E2E anchors
- **use-chat-session.test.ts**: Passive snapshot/reload regression tests for chat status derivation, renderer-visible state precedence, and stop-action abort forwarding
- **index.ts**: Barrel file re-exporting public API
