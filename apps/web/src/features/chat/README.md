<!-- Once this directory changes, update this README.md -->

# Features/Chat

Renderer-side view layer for chat.
Streaming updates arrive via SSE from the server. Initial hydration and reload/recovery
read message snapshots through React Query and project locally into Zustand.
Passive windows hydrate the current message snapshot first, then subscribe to
`GET /chat/sessions/{sessionId}/stream` for active-run deltas instead of polling
snapshots while a message is streaming.
Text/reasoning/file parts still hydrate as `UIMessage.parts`, but tool calls are now
projected into browser-owned tool entities keyed by `toolCallId`. The transport receives
sequenced part-level delta events, keeps lightweight tool anchor parts inside
`UIMessage.parts`, and patches tool entities independently so a tool block can mount on
`part_add` and update before final output arrives.
When a session is already streaming, the composer can submit a durable Chat Session
continuation item instead of starting a second run. The default mode comes from Chat
settings, `Shift+Meta+Enter` flips between `queue` and `steer` for one send, and the
visible queue controls cancel, drag/drop reorder, or button-reorder pending items through
chat-runtime endpoints.

## Files

- **chat-delta-events.ts**: Renderer-owned delta types plus dual projection helpers for sequenced part-level chat updates; message snapshots retain text/reasoning/file content while tool payload streams into store-owned tool entities
- **chat-tool-entities.ts**: Browser-owned tool entity normalization and tool-anchor helpers used by hydration, SSE projection, and message rendering
- **chat-capabilities.ts**: Feature-owned GET boundary for `/chat/sessions/{sessionId}/capabilities`, used only for runtime-native capability data such as provider slash commands
- **chat-context.ts**: Chat-owned Jarvis semantic context provider; publishes active chat attention state such as viewport range, scroll position bucket, near-bottom/manual-scroll state, and composer focus without exposing Chat DOM structure to system-agent
- **chat-context.test.ts**: Unit coverage for Chat attention snapshot publication into typed Jarvis context envelopes
- **chat-slash-commands.ts**: Web-owned slash command descriptor and merge helpers; converts runtime-native commands into raw text insertion actions, supplies fallback runtime command descriptors for pre-session composer surfaces, registers Cradle UI commands such as `/appshot`, and keeps Cradle UI commands separate from provider capabilities
- **chat-response-command.ts**: Feature-owned POST boundary for `/chat/sessions/{sessionId}/response`, GET boundary for `/chat/sessions/{sessionId}/stream`, and cancel boundary for `/chat/sessions/{sessionId}/cancel`, plus manual queue fetch helpers for `/chat/sessions/{sessionId}/queue`, carrying text plus AI SDK `FileUIPart[]` attachments for chat views and detached entry points that need to start, join, cancel, enqueue, cancel queue items, or reorder a server-owned run
- **chat-queue-list.tsx**: Shared compact continuation queue list with mode badges, drag/drop reorder, up/down button reorder, and pending-item cancellation controls.
- **chat-view-loader.ts**: Shared lazy loader and route preload entry for the Chat tab, reused by session links, search results, and tray actions.
- **appshot-attachment-model.ts**: Cradle-owned AppShot `FileUIPart` metadata helpers; creates and reads `providerMetadata.cradle.appshot` while keeping model input compatible with normal image file parts.
- **appshot-attachment.tsx**: Cradle-owned AppShot composer/thread visual card; composer rendering matches Codex's transition snapshot slot without app icon/title accessories, while thread rendering uses the final capture image with Codex-like centered image, mask, shadow, sibling icon overlay, and caption treatment.
- **use-chat-session.ts**: Chat session hook — uses React Query for canonical snapshot rows and queue items, hydrates main messages plus subagent buckets keyed by `parentToolCallId`, passively restores currently streaming assistant message ids for reload recovery, joins the active session run SSE stream after hydration, observes run signals, drives streaming responses with text plus `FileUIPart[]`, enqueues follow-up continuations while busy, locally releases stop state immediately, refreshes snapshots after server-owned cancellation settles, and exposes `{ messages, status, error, sendMessage, stop, isReady, queueItems, cancelQueueItem, reorderQueueItems }`
- **use-session-await.ts**: Session await summary hook used by the chat view to reflect pending await state with the shared interactive query refresh policy.
- **sse-chat-transport.ts**: SSE parser for sequenced chat stream events and passive run-event observation
- **chat-view.tsx**: Read-only chat view — reads from useChatSession, renders MessageBubbles + Composer, shows pending Chat Session queue items above the composer, accepts workspace file drops into the composer, consumes scroll/composer/Appshot runtimes for virtua, minimap, attention snapshots, send actions, slash commands, token usage, attachment capability, and desktop capture, and records the global Chat first-render performance measure once per module lifetime.
- **use-chat-scroll-runtime.ts**: Chat-owned scroll controller hook for ScrollArea and virtua refs, streaming keep-mounted indices, near-bottom auto-scroll, minimap progress writes, click/drag scroll actions, and Jarvis attention viewport snapshots.
- **use-chat-composer-runtime.ts**: Chat-owned composer integration runtime for session binding, runtime slash capabilities, fallback Cradle commands, model attachment capability, token usage, continuation-mode send actions, and stop state.
- **use-composer-appshot-capture.ts**: Composer-owned desktop Appshot capture runtime; keeps native hotkey subscription stable through refs, owns pending Appshot slots, measures action targets, and injects captured file parts into Composer without leaving capture orchestration in ChatView.
- **chat-share-export.tsx**: Chat-owned share dialog that renders an off-scroll Cradle-styled conversation surface, lets users export the full session or selected messages, and lazily uses `modern-screenshot` to download or copy a PNG without depending on the virtualized message list.
- **chat-share-export.test.tsx**: Regression coverage for the export dialog default all-message preview, selected-message preview scope, and PNG render/download handoff.
- **chat-minimap.tsx**: Right-edge accessible chat minimap with compact barcode-style bars, per-message reading progress, hover previews, click-to-message, and drag-to-scroll behavior; scroll progress is written through an imperative ref and transform updates instead of React state
- **chat-minimap.test.tsx**: Regression coverage for the React 19 ref prop imperative handle and accessible native minimap button behavior
- **composer-attachment-state.ts**: Shared headless attachment controller; chat owns browser file conversion, pasted-file handling, UI action file-part appends, model attachment gating, and model-switch cleanup for chat, new-chat, and workspace launcher composers
- **composer-attachments.tsx**: Shared attachment UI primitives for hidden file input, attach button, attachment chips, and AppShot pending slots, consumed by all composer surfaces without duplicating visual behavior
- **composer-action-context.ts**: Composer-owned UI action geometry reader; measures Codex-style AppShot pending slots and emits renderer-owned `viewportPixels` animation targets for native capture.
- **composer.tsx**: Shared rich input used by chat, new-chat, and workspace launcher surfaces, with grouped send/command/attachment/slot/external-signal/view props, @ path autocomplete including Tab completion, workspace file drop insertion, pasted/selected file attachments via AI SDK `FileUIPart`, web-owned slash command descriptors with inline argument hints, raw runtime passthrough, and Cradle UI action attachment results, busy-session continuation sends, `Shift+Meta+Enter` continuation mode inversion, named send/stop/attach icon actions, and fzf fuzzy file search
- **mention-panel.tsx**: Fuzzy file picker above composer using fzf with highlighted matches and the shared workspace file icon renderer for file results
- **mention-panel.test.tsx**: Regression coverage for MentionPanel file-result icon rendering through the shared sprite-backed workspace file icon component.
- **slash-command-input.ts**: Shared slash trigger parsing, active command detection, availability filtering, and trigger replacement helpers used by chat, new-chat, and workspace launcher textareas
- **slash-command-panel.tsx**: Fuzzy slash command picker above composer; renders web-owned command descriptors, disambiguates duplicate visible names by source, and does not fetch a slash command list from app-server
- **message-bubble.tsx**: Renders a single UIMessage with Streamdown markdown, file attachment previews, reasoning blocks, copy action, configurable execution-detail default expansion, idle-only per-message streaming Thinking placeholder, and tool blocks subscribed by `toolCallId`; execution detail folds avoid height animation to keep streaming layout predictable while tool entities update independently
- **message-bubble.test.tsx**: Regression coverage for execution-detail default folding and file attachment previews in the shared message renderer, including Jarvis' default-open tool call rendering path
- **reasoning-block.tsx**: Collapsible thinking chain display with Streamdown markdown rendering inside, plus stable toggle/content anchors for E2E assertions; expanded content mounts without height/auto motion animation
- **tool-ui-classifier.ts**: Central classifier for AI SDK dynamic-tool parts and Claude Agent tool IO; maps file reads, diffs, notebooks, terminal commands, search, web, subagents, task control, todos, plan approval, user questions, MCP, worktrees, and unknown tools to stable UI categories; materializes partial streaming tool input so large tool calls classify before complete JSON arrives
- **blocks/tool-call-block.tsx**: Classified tool invocation display built from `components/ui` primitives and lucide icons; renders structured previews for Claude Agent and AI SDK tool input/output, including early Edit File previews from streaming input, with raw IO fallbacks and stable E2E anchors
- **blocks/edit-file-block.tsx**: File edit preview powered by `@pierre/diffs/react` `MultiFileDiff`, with split and stacked layout switching for chat tool output; the diff pane opens without layout-triggering height animation
- **blocks/tool-call-block.test.tsx**: Regression coverage for Edit File tool IO routing, collapsed diff previews, layout switching, and `@pierre/diffs/react` option wiring
- **tool-ui-classifier.test.ts**: Regression coverage for Claude Agent and AI SDK tool classification, including MCP precedence over URL-shaped tool inputs
- **chat-slash-commands.test.ts**: Regression coverage for slash command descriptor conversion, Cradle-owned `/appshot` command registration, fallback runtime descriptor replacement, merge ordering, duplicate visible-name detection, and runtime input immutability
- **composer.test.tsx**: Regression coverage for named send/stop actions, slash command insertion, inline argument hints, active command descriptions, duplicate command-name rendering, Cradle UI command callback dispatch, unavailable UI action presentation, UI action returned file attachments, workspace file drops, selected/pasted attachments, and raw `/command args` send-through
- **use-chat-session.test.ts**: Passive snapshot/reload regression tests for chat status derivation, main-message projection, subagent bucketing, and stop-action abort forwarding
- **use-chat-session-binding.test.tsx**: Hook lifecycle regression tests for session binding invalidation and stop cancellation status ownership
- **chat-streaming-handler.ts**: SSE-to-store bridge that applies per-message sequenced main/subagent deltas, patches tool entities independently of `UIMessage.parts`, and reconciles streamed assistant messages with canonical server IDs
- **index.ts**: Barrel file re-exporting public API
