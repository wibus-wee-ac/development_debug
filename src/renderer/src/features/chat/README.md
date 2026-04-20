<!-- Once this directory changes, update this README.md -->

# Features/Chat

Renderer-side view layer for chat.
All orchestration lives in the main-process `ChatEngine`
(`src/main/lib/chat-engine.ts`); this directory is a thin view that drives
AI SDK's `useChat` through a custom `ChatTransport` which forwards to `ipc.chat`.
Streaming events arrive as OpenAI Responses API-style `ResponseStreamEvent` objects
on the `chat:response-event` IPC channel; the transport converts them to `UIMessageChunk`
for `useChat` assembly.

## Files

- **use-chat-session.ts**: Hook wrapping `useChat` — loads initial snapshot via `ipc.chat.getMessages`, resumes in-flight drafts via `chat.resumeStream()`, refetches on Turn-end from other windows, throttles streamed UI updates to avoid render storms, logs raw `useChat` errors to the renderer console for debugging, exposes `{ messages, status, error, sendMessage, stop, isReady }`
- **ipc-chat-transport.ts**: `ChatTransport` implementation bridging AI SDK's useChat to our IPC — `sendMessages` → `ipc.chat.send` + subscribe to `chat:response-event`; `reconnectToStream` resumes a streaming draft; converts `ResponseStreamEvent` to `UIMessageChunk` via a stateful converter
- **chat-view.tsx**: Read-only chat view — reads from useChatSession, renders MessageBubbles + Composer, auto-scrolls
- **composer.tsx**: Rich input with @ path autocomplete, inline send/stop toggle, fzf fuzzy file search
- **mention-panel.tsx**: Fuzzy file picker above composer using fzf with highlighted matches
- **message-bubble.tsx**: Renders a single UIMessage with Streamdown markdown, reasoning blocks, tool call blocks, and copy action; memoized so unchanged history rows do not re-render during streaming
- **model-picker.tsx**: Button-triggered Combobox with searchable list for picking the active ACP model; controlled open state so callers can open it after reconnecting
- **reasoning-block.tsx**: Collapsible thinking chain display with Streamdown markdown rendering inside
- **tool-call-block.tsx**: Collapsible tool invocation display with status icons and state machine
- **index.ts**: Barrel file re-exporting public API
