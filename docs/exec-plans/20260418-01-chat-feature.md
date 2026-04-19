# Chat Feature — Conversation with ACP Agents

This ExecPlan is a living document.
The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

Maintained per docs/exec-plans/ convention and PLANS.md (at .agents/skills/execplan/references/PLANS.md).

## Purpose / Big Picture

After this change, users can have streaming conversations with ACP agents (e.g.
Claude Code) directly in Cradle.
They type a message in the Composer, the ACP agent processes it, and the response streams in real-time showing text (rendered with Streamdown), thinking/reasoning (collapsible panel), and tool calls (status cards with icons per ToolKind).
Users can also @-mention files from the workspace to provide context, with a fuzzy-search popup and inline badges.

How to see it working: open the app, select a workspace and an ACP agent, type a message, press Enter.
The assistant response streams in with text, thinking blocks, and tool call cards.
Type @ to see a file picker popup, select a file to attach it as context.

## Progress

- [x] (2026-04-18) Architecture research complete
- [x] (2026-04-18) Dependencies installed: streamdown, @streamdown/code, @ai-sdk/react
- [ ] M1: Core chat pipeline
     - [ ] DB schema migration (messages.parts JSON, messages.metadata JSON)
     - [ ] SessionService.addMessage / getMessages updated for parts
     - [ ] ACP SessionUpdate → UIMessageChunk converter
     - [ ] IPC streaming: main process forwards session updates as IPC events
     - [ ] AcpChatTransport custom ChatTransport implementation
     - [ ] Basic chat UI: message list + simple input
     - [ ] Wire everything: send prompt, receive stream, render messages
- [ ] M2: Rich rendering
- [ ] M3: Enhanced input (contenteditable, @ mentions, popup)
- [ ] M4: Polish

## Surprises & Discoveries

(none yet)

## Decision Log

- Decision: Use custom ChatTransport over IPC instead of DirectChatTransport
  Rationale: DirectChatTransport requires an in-process Agent (AI SDK ToolLoopAgent).
  Our agents are ACP processes communicating via JSON-RPC.
  A custom transport bridges IPC events to ReadableStream of UIMessageChunk.
  Date: 2026-04-18

- Decision: ACP is the only backend channel; no direct model API calls
  Rationale: User confirmed.
  Interface definitions should be clean enough to add alternatives later.
  Date: 2026-04-18

- Decision: Use contenteditable div for Composer instead of textarea
  Rationale: Need inline badge elements for @-mentioned files.
  Plain textarea can't render HTML inline.
  Date: 2026-04-18

## Outcomes & Retrospective

(pending)

## Context and Orientation

Cradle is an Electron + React desktop app for managing AI agents via ACP (Agent Client Protocol).
Key files:

- src/main/services/acp.ts — IPC service wrapping AcpConnectionManager
- src/main/lib/acp-connection.ts — ACP process + connection management, handles sessionUpdate callbacks
- src/main/services/session.ts — DB CRUD for sessions and messages
- src/main/db/schema.ts — Drizzle ORM schema (workspaces, sessions, messages, acp_agents, acp_audit_log)
- src/renderer/src/features/workspace/new-chat-home.tsx — Current Composer page (has TODO for send prompt)
- src/renderer/src/lib/ipc.ts — Typed IPC proxy for renderer→main calls
- packages/ipc/ — IPC framework with decorators and type utilities

ACP streaming: When prompt() is called, the ACP agent sends SessionUpdate notifications via the client's sessionUpdate callback.
These contain:

- agent_message_chunk (text content)
- agent_thought_chunk (reasoning/thinking)
- tool_call (tool invocation start)
- tool_call_update (tool progress/result)
- usage_update, plan, etc.

AI SDK message model: UIMessage has parts array.
Each part has a type (text, reasoning, tool-invocation, source, file).
The useChat hook manages the message list and streaming state via a ChatTransport.

## Plan of Work

### M1: Core Chat Pipeline

1. Extend DB schema: Add `parts` (TEXT/JSON) and `metadata` (TEXT/JSON) columns to messages table.
   Migrate content to parts for backwards compat.

2. Update SessionService: addMessage accepts parts array, getMessages returns parsed parts.

3. Build ACP → AI SDK converter (src/main/lib/acp-message-converter.ts): Maps SessionUpdate to UIMessageChunk format.

4. Add IPC streaming layer: Main process creates a stream channel per prompt.
   Session updates are forwarded via ipcMain events.
   Renderer listens to these events.

5. Implement AcpChatTransport (src/renderer/src/lib/acp-chat-transport.ts): Custom ChatTransport that calls IPC to send prompt and returns a ReadableStream fed by IPC events.

6. Build basic ChatView component (src/renderer/src/features/chat/): Message list rendering, simple input, wire to useChat with AcpChatTransport.

7. Integrate into NewChatHome: After session is ready, show ChatView.

### M2: Rich Rendering

Install Streamdown, render text parts.
Build ThinkingBlock (collapsible reasoning).
Build ToolCallCard (icon per ToolKind, status badge, expandable content).

### M3: Enhanced Input

Replace textarea with contenteditable Composer.
Implement @ trigger → file tree fuzzy search popup.
Arrow key navigation, Enter to select, Delete to remove badge.
Bold matching keywords in popup list.

### M4: Polish

Virtual scroll for long conversations.
Session switching.
Error recovery.
Keyboard shortcuts.

## Concrete Steps

(Updated as implementation proceeds — see M1 steps above)

## Validation and Acceptance

After M1: User can type a message, press Enter, and see the ACP agent's response appear in the message list.
Agent text, thinking, and tool calls are displayed (basic rendering).
Messages are persisted in the DB and survive app restart.

After M2: Text renders with Streamdown (syntax highlighting for code).
Thinking blocks are collapsible.
Tool calls show icons and status.

After M3: Typing @ shows a popup with workspace files.
Arrow keys navigate, Enter selects, selected file appears as a badge in the input.
Badge can be deleted.
File context is sent with the prompt.

## Idempotence and Recovery

DB migrations are additive (new columns with defaults).
Existing data unaffected.
All new files are additive.
No destructive changes.

## Artifacts and Notes

Key type mappings (ACP → AI SDK):

```
ACP SessionUpdate                    AI SDK UIMessageChunk
─────────────────                    ─────────────────────
agent_message_chunk (text)       →   text-delta
agent_thought_chunk (text)       →   reasoning-delta
tool_call (ToolCall)             →   tool-call-start + tool-call-delta
tool_call_update (ToolCallUpdate)→   tool-call-delta
usage_update                     →   (metadata, not rendered)
plan                             →   (metadata or custom part)
```

## Interfaces and Dependencies

Runtime dependencies: ai (^6.0.168), @ai-sdk/react (^3.0.170), streamdown (^2.5.0), @streamdown/code (^1.1.1)

Key interfaces to implement:

In src/main/lib/acp-message-converter.ts:

```
export function convertSessionUpdateToChunks(
  update: SessionUpdate,
  messageId: string,
): UIMessageChunk[]
```

In src/renderer/src/lib/acp-chat-transport.ts:

```
export class AcpChatTransport implements ChatTransport<UIMessage> {
  constructor(options: { agentId: string; sessionId: string })
  sendMessages(options: SendMessagesOptions): Promise<ReadableStream<UIMessageChunk>>
  reconnectToStream(): Promise<null>
}
```

In src/renderer/src/features/chat/chat-view.tsx:

```
export function ChatView(props: {
  agentId: string
  sessionId: string
  workspacePath: string
}): JSX.Element
```
