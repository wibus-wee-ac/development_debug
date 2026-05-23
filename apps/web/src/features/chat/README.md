<!-- Once this directory changes, update this README.md -->

# Features/Chat

Renderer-side view layer for chat.
Streaming updates arrive via SSE from the server. Initial hydration and reload/recovery
read message snapshots through React Query and project locally into Zustand.
The transport receives sequenced part-level delta events and applies them directly to
`UIMessage.parts` without chunk replay.

## Files

- **chat-delta-events.ts**: Renderer-owned delta types and accumulator helpers for sequenced part-level chat updates
- **chat-capabilities.ts**: Feature-owned GET boundary for `/chat/sessions/{sessionId}/capabilities`, used to load runtime-native slash commands for the composer
- **chat-response-command.ts**: Feature-owned POST boundary for `/chat/sessions/{sessionId}/response` and `/chat/sessions/{sessionId}/cancel`, shared by chat views and detached entry points that need to start or cancel a server-owned run
- **chat-view-loader.ts**: Shared lazy loader and route preload entry for the Chat tab, reused by session links, search results, and tray actions.
- **use-chat-session.ts**: Chat session hook — uses React Query for canonical snapshot rows, hydrates main messages plus subagent buckets keyed by `parentToolCallId`, passively observes run signals for reload/recovery, drives streaming responses, locally releases stop state immediately, refreshes snapshots after server-owned cancellation settles, and exposes `{ messages, status, error, sendMessage, stop, isReady }`
- **use-session-await.ts**: Session await summary hook used by the chat view to reflect pending await state with the shared interactive query refresh policy.
- **sse-chat-transport.ts**: SSE parser for sequenced chat stream events and passive run-event observation
- **chat-view.tsx**: Read-only chat view — reads from useChatSession, renders MessageBubbles + Composer, auto-scrolls, accepts workspace file drops into the composer, feeds virtua-backed scroll metrics to the minimap, records the global Chat first-render performance measure once per module lifetime, and only shows token-capacity progress when a real session-bound model context window can be resolved (otherwise safely degrades to token count only)
- **chat-minimap.tsx**: Right-edge accessible chat minimap with compact barcode-style bars, per-message reading progress, hover previews, click-to-message, and drag-to-scroll behavior; scroll progress is written through an imperative ref and transform updates instead of React state
- **chat-minimap.test.tsx**: Regression coverage for the React 19 ref prop imperative handle and accessible native minimap button behavior
- **composer.tsx**: Rich input with @ path autocomplete, workspace file drop insertion, runtime-native slash command autocomplete with inline argument hints, named send/stop icon actions, and fzf fuzzy file search
- **mention-panel.tsx**: Fuzzy file picker above composer using fzf with highlighted matches
- **slash-command-panel.tsx**: Fuzzy slash command picker above composer using runtime capabilities discovered from the active chat session, with active-row command descriptions
- **message-bubble.tsx**: Renders a single UIMessage with Streamdown markdown, reasoning blocks, tool call blocks, copy action, configurable execution-detail default expansion, and subagent message folds keyed by tool call ID; execution detail folds avoid height animation to keep streaming layout predictable
- **message-bubble.test.tsx**: Regression coverage for execution-detail default folding in the shared message renderer, including Jarvis' default-open tool call rendering path
- **reasoning-block.tsx**: Collapsible thinking chain display with Streamdown markdown rendering inside, plus stable toggle/content anchors for E2E assertions; expanded content mounts without height/auto motion animation
- **tool-ui-classifier.ts**: Central classifier for AI SDK dynamic-tool parts and Claude Agent tool IO; maps file reads, diffs, notebooks, terminal commands, search, web, subagents, task control, todos, plan approval, user questions, MCP, worktrees, and unknown tools to stable UI categories; materializes partial streaming tool input so large tool calls classify before complete JSON arrives
- **blocks/tool-call-block.tsx**: Classified tool invocation display built from `components/ui` primitives and lucide icons; renders structured previews for Claude Agent and AI SDK tool input/output, including early Edit File previews from streaming input, with raw IO fallbacks and stable E2E anchors
- **blocks/edit-file-block.tsx**: File edit preview powered by `@pierre/diffs/react` `MultiFileDiff`, with split and stacked layout switching for chat tool output; the diff pane opens without layout-triggering height animation
- **blocks/tool-call-block.test.tsx**: Regression coverage for Edit File tool IO routing, collapsed diff previews, layout switching, and `@pierre/diffs/react` option wiring
- **tool-ui-classifier.test.ts**: Regression coverage for Claude Agent and AI SDK tool classification, including MCP precedence over URL-shaped tool inputs
- **composer.test.tsx**: Regression coverage for named send/stop actions, slash command insertion, inline argument hints, active command descriptions, duplicate command-name rendering, workspace file drops, and raw `/command args` send-through
- **use-chat-session.test.ts**: Passive snapshot/reload regression tests for chat status derivation, main-message projection, subagent bucketing, and stop-action abort forwarding
- **use-chat-session-binding.test.tsx**: Hook lifecycle regression tests for session binding invalidation and stop cancellation status ownership
- **chat-streaming-handler.ts**: SSE-to-store bridge that applies per-message sequenced main/subagent deltas and reconciles streamed assistant messages with canonical server IDs
- **index.ts**: Barrel file re-exporting public API
