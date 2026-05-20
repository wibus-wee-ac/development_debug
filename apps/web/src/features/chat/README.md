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
- **chat-response-command.ts**: Feature-owned POST startup boundary for `/chat/sessions/{sessionId}/response`, shared by the main chat view and detached entry points that need to kick off a run before navigation
- **use-chat-session.ts**: Chat session hook — uses React Query for canonical snapshot rows, hydrates main messages plus subagent buckets keyed by `parentToolCallId`, passively observes run signals for reload/recovery, drives streaming responses, routes stop through the active local driver, and exposes `{ messages, status, error, sendMessage, stop, isReady }`
- **sse-chat-transport.ts**: SSE parser for sequenced chat stream events and passive run-event observation
- **chat-view.tsx**: Read-only chat view — reads from useChatSession, renders MessageBubbles + Composer, auto-scrolls, feeds virtua-backed scroll metrics to the minimap, and only shows token-capacity progress when a real session-bound model context window can be resolved (otherwise safely degrades to token count only)
- **chat-minimap.tsx**: Right-edge accessible chat minimap with compact barcode-style bars, per-message reading progress, hover previews, click-to-message, and drag-to-scroll behavior
- **chat-minimap.test.tsx**: Regression coverage for the React 19 ref prop imperative handle and accessible native minimap button behavior
- **composer.tsx**: Rich input with @ path autocomplete, runtime-native slash command autocomplete with inline argument hints, named send/stop icon actions, and fzf fuzzy file search
- **mention-panel.tsx**: Fuzzy file picker above composer using fzf with highlighted matches
- **slash-command-panel.tsx**: Fuzzy slash command picker above composer using runtime capabilities discovered from the active chat session, with active-row command descriptions
- **message-bubble.tsx**: Renders a single UIMessage with Streamdown markdown, reasoning blocks, tool call blocks, copy action, and subagent message folds keyed by tool call ID
- **reasoning-block.tsx**: Collapsible thinking chain display with Streamdown markdown rendering inside, plus stable toggle/content anchors for E2E assertions
- **tool-ui-classifier.ts**: Central classifier for AI SDK dynamic-tool parts and Claude Agent tool IO; maps file reads, diffs, notebooks, terminal commands, search, web, subagents, task control, todos, plan approval, user questions, MCP, worktrees, and unknown tools to stable UI categories
- **blocks/tool-call-block.tsx**: Classified tool invocation display built from `components/ui` primitives and lucide icons; renders structured previews for Claude Agent and AI SDK tool input/output with raw IO fallbacks and stable E2E anchors
- **blocks/edit-file-block.tsx**: File edit preview powered by `@pierre/diffs/react` `MultiFileDiff`, with split and stacked layout switching for chat tool output
- **blocks/tool-call-block.test.tsx**: Regression coverage for Edit File tool IO routing, collapsed diff previews, layout switching, and `@pierre/diffs/react` option wiring
- **tool-ui-classifier.test.ts**: Regression coverage for Claude Agent and AI SDK tool classification, including MCP precedence over URL-shaped tool inputs
- **composer.test.tsx**: Regression coverage for named send/stop actions, slash command insertion, inline argument hints, active command descriptions, duplicate command-name rendering, and raw `/command args` send-through
- **use-chat-session.test.ts**: Passive snapshot/reload regression tests for chat status derivation, main-message projection, subagent bucketing, and stop-action abort forwarding
- **chat-streaming-handler.ts**: SSE-to-store bridge that applies per-message sequenced main/subagent deltas and reconciles streamed assistant messages with canonical server IDs
- **index.ts**: Barrel file re-exporting public API
