<!-- Once this directory changes, update this README.md -->

# Features/Chat

Protocol-driven chat feature: a singleton ChatSessionManager owns the full session lifecycle
(create, send, stream, persist) independently of any UI component mount/unmount cycle.
UI components are thin reactive subscribers that read messages and render.

## Files

- **chat-session-manager.ts**: Zustand store — protocol-driven singleton that creates ACP sessions, sends prompts, processes IPC stream chunks via `readUIMessageStream`, persists messages to DB, and exposes reactive session state
- **use-chat-session.ts**: Thin React hook — subscribes to ChatSessionManager for a given sessionId, returns `{ messages, status, sendMessage, stop, isReady }`
- **chat-view.tsx**: Read-only chat view — reads messages from useChatSession, renders MessageBubbles + Composer, auto-scrolls. Does NOT own message sending lifecycle
- **composer.tsx**: Rich input with @ path autocomplete, inline send/stop toggle, fzf fuzzy file search
- **mention-panel.tsx**: Fuzzy file picker above composer using fzf with highlighted matches
- **message-bubble.tsx**: Renders a single UIMessage with Streamdown markdown, reasoning blocks, tool call blocks, and copy action
- **model-picker.tsx**: Button-triggered Combobox with searchable list for picking the active ACP model; controlled open state so callers can open it after reconnecting
- **reasoning-block.tsx**: Collapsible thinking chain display with Streamdown markdown rendering inside
- **tool-call-block.tsx**: Collapsible tool invocation display with status icons and state machine
- **index.ts**: Barrel file re-exporting public API
