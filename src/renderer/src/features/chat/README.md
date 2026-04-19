<!-- Once this directory changes, update this README.md -->

# Features/Chat

Renderer-side view layer for chat.
All orchestration lives in the main-process `ChatEngine`
(`src/main/lib/chat-engine.ts`); this directory only subscribes to chat:* broadcasts and
sends one-shot commands via `ipc.chat`.
Streaming is driven by `UIMessageChunk` events
assembled locally with AI SDK's `readUIMessageStream`.

## Files

- **use-chat-session.ts**: Hook — loads initial snapshot via `ipc.chat.getMessages`, subscribes to `chat:message-created|chunk|finalized` events, assembles streaming drafts with `readUIMessageStream`, exposes `{ messages, status, error, sendMessage, stop, isReady }`
- **chat-view.tsx**: Read-only chat view — reads from useChatSession, renders MessageBubbles + Composer, auto-scrolls
- **composer.tsx**: Rich input with @ path autocomplete, inline send/stop toggle, fzf fuzzy file search
- **mention-panel.tsx**: Fuzzy file picker above composer using fzf with highlighted matches
- **message-bubble.tsx**: Renders a single UIMessage with Streamdown markdown, reasoning blocks, tool call blocks, and copy action
- **model-picker.tsx**: Button-triggered Combobox with searchable list for picking the active ACP model; controlled open state so callers can open it after reconnecting
- **reasoning-block.tsx**: Collapsible thinking chain display with Streamdown markdown rendering inside
- **tool-call-block.tsx**: Collapsible tool invocation display with status icons and state machine
- **index.ts**: Barrel file re-exporting public API
