<!-- Once this directory changes, update this README.md -->

# Features/Chat

Renderer-side view layer for chat.
Main-process orchestration now lives behind a thin `ChatEngine` shell plus explicit
timeline query / watch-registry modules; this directory rebuilds `UIMessage` state from
raw timeline groups and streaming `UIMessageChunk`s rather than trusting a backend UI snapshot.
Streaming updates arrive on the session-scoped `chat:timeline-event` signal, while initial
hydration and reload/recovery both pull `ipc.chat.getSessionTimeline()` and project locally.
The transport now receives raw timeline events and projects `UIMessageChunk`s locally via the
shared timeline projector after registering a main-process watch for the active session; reconnect
checks use the explicit `ipc.chat.hasActiveTurn()` probe instead of legacy message rows.

## Files

- **use-chat-session.ts**: Hook wrapping `useChat` — 以 `ipc.chat.getSessionTimeline()` 作为唯一 hydration 读模型，在 renderer 本地投影 `UIMessage`，被动观察 timeline signal 做 reload/recovery，同步 stop 到 `ipc.chat.abort`，并暴露 `{ messages, status, error, sendMessage, stop, isReady }`
- **ipc-chat-transport.ts**: `ChatTransport` implementation bridging AI SDK's useChat to our IPC — `sendMessages` → `ipc.chat.send` + session watch registration + subscribe to raw `chat:timeline-event`；renderer 本地把单个 event 投影成 `UIMessageChunk[]` 再喂给 AI SDK，reconnect 通过 `ipc.chat.hasActiveTurn()` 判断是否仍有活跃 turn
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
