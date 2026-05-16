# Agentic Provider Foundation: Claude Agent SDK + OpenAI Codex SDK

> Historical note (2026-05-16): this plan documents an intermediate provider-layer stage that still assumed older chat transport contracts. The current canonical chat runtime contract is defined by `docs/exec-plans/20260516-03-message-snapshot-chat-runtime.md`, where durable history is stored as `messages.messageJson` snapshots and live updates stream as sequenced SSE delta events.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `docs/exec-plans/README.md` and `.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

Cradle's chat is currently "read-only awareness": the agent can think and talk but cannot act. Neither `openai-compatible` nor `acp-chat` providers support in-process tool calling connected to the local filesystem. This plan adds two new provider kinds that give agents full coding-agent capability — reading files, running commands, applying patches, and more — without Cradle having to implement any tool internals. Both agents use battle-tested tool implementations from their respective SDKs.

After this plan:
1. A **`claude-agent`** profile uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) to run Claude with all of Claude Code's built-in tools. The user provides an Anthropic API key in the credential vault, selects a model, and immediately gets a fully capable coding agent that reads, edits, and runs things autonomously within the session workspace.
2. A **`codex`** profile uses the OpenAI Codex SDK (`@openai/codex-sdk`) with the same capabilities. The user provides an OpenAI API key, and the Codex CLI binary (bundled as `@openai/codex`) handles tool execution locally.

Both providers are completely **protocol-compatible**: they emit the same `ResponseStreamEvent` wire format that the existing `ChatEngine` already handles. The renderer, database layer, and IPC infrastructure require zero changes.

The user can verify success by:
- Creating a `claude-agent` profile with an Anthropic API key
- Opening a new chat, sending "list all TypeScript files in this directory"
- Watching the agent call tools visibly in the chat and return a real file listing
- Creating a `codex` profile with an OpenAI API key
- Sending the same message and seeing the same experience — identical chat UX for both providers

## Context and Orientation

### Repository layout relevant to this plan

    src/main/agent-runtime/
      types.ts                    — ProviderKind union + shared interfaces for all providers
      catalog-instance.ts         — singleton ProviderCatalog, registers all active providers
      provider-catalog.ts         — ProviderCatalog class with .get() / .register()
      credential-vault.ts         — in-memory secret store, main-process only
      providers/
        acp-chat-provider.ts      — ACP stdio protocol provider (existing, keep)
        cli-tui-provider.ts       — CLI TUI PTY provider (existing, keep)
        openai-compatible-provider.ts — text-only OpenAI Chat Completions (existing, keep)

    src/main/lib/
      chat-engine.ts              — orchestrates turns; calls streamTurn(), builds UIMessage in DB
      chat-provider.ts            — re-exports ResponseStreamEvent type from openai package
      acp-responses-converter.ts  — converts ACP events → ResponseStreamEvent (reference impl)

    src/main/index.ts             — startup: registers providers + services

### Installed SDKs (both already in node_modules, not yet pinned in package.json)

`@anthropic-ai/claude-agent-sdk@0.2.126` — Claude Agent SDK. Bundles the Claude Code CLI binary via `@anthropic-ai/claude-code` optional dep. Entry point: `query(prompt, { options, env, abortSignal })` returns `AsyncIterable<SDKMessage>`. Auth: `ANTHROPIC_API_KEY` env var or passed explicitly via `env` option.

`@openai/codex-sdk@0.128.0` — OpenAI Codex SDK. Spawns the `@openai/codex` CLI child process and communicates over stdin/stdout JSONL. Entry point: `new Codex({ env }) → codex.startThread({ workingDirectory }) → thread.runStreamed(prompt)` which returns `{ events: AsyncGenerator<ThreadEvent> }`. Auth: `OPENAI_API_KEY` env var.

### How streaming works today

`ChatEngine.runStream()` calls `provider.streamTurn()` which returns `AsyncGenerator<ResponseStreamEvent>`. Each event is:
1. Broadcast over IPC to the renderer (`chat:response-event`)
2. Converted to AI SDK `UIMessageChunk` objects via `responsesEventToUIMessageChunks()` and piped into `readUIMessageStream()` which builds the `UIMessage` persisted to the DB

`ResponseStreamEvent` comes from `openai/resources/responses/responses`. The relevant event types for text + tool calls are:
- `response.output_item.added` — an output item (text message or function_call) starts
- `response.output_text.delta` — incremental text chunk for a text message item
- `response.output_item.done` — an output item finished; if function_call, `item.arguments` encodes `{ input, output }` as JSON string
- `response.reasoning_summary_part.added/done` / `response.reasoning_summary_text.delta` — reasoning chain
- `response.completed` — turn done; `response.failed` — turn failed

This format is already fully supported end-to-end from provider → IPC → renderer → DB. Both new providers adapt their SDK events into this established format.

### Protocol Compatibility Specification

**This is the most important constraint of this plan.** Both providers MUST produce identical event sequences for identical semantic operations. The same user prompt handled by `claude-agent` or `codex` must produce UIMessage parts that are structurally indistinguishable by the renderer and DB.

The canonical mapping:

**Text streaming:**

    semantic: text content starts
    → response.output_item.added  { item.type='message', item.id=<UUID> }

    semantic: text chunk arrives (one or more)
    → response.output_text.delta  { item_id=<UUID>, delta=<textChunk> }

    semantic: text content ends
    → response.output_item.done   { item.type='message', item.id=<UUID> }

**Tool call (Bash, Read, Write, FileChange, etc.):**

    semantic: agent invokes a tool
    → response.output_item.added  { item.type='function_call', item.call_id=<UUID>,
                                    item.name=<toolName> }

    semantic: tool execution finishes (with result)
    → response.output_item.done   { item.type='function_call', item.call_id=<UUID>,
                                    item.status='completed', item.name=<toolName>,
                                    item.arguments=JSON.stringify({ input: <inputStr>,
                                                                    output: <outputStr> }) }

The `item.arguments` JSON encoding `{ input, output }` is the existing convention from `AcpResponsesConverter`. The ChatEngine's `responsesEventToUIMessageChunks()` already decodes this into `tool-input-available` and `tool-output-available` UIMessageChunks.

**Reasoning chain:**

    response.reasoning_summary_part.added →
    response.reasoning_summary_text.delta (one or more) →
    response.reasoning_summary_part.done

**Invariants both adapters must enforce:**
- Every tool call has exactly one `output_item.added` followed by exactly one `output_item.done`. No orphaned function_call items.
- Every text item has a matching `output_item.added` and `output_item.done` pair.
- All `call_id` / `item_id` values are stable UUIDs generated at item start, reused in done.
- `item.arguments` in function_call done is always a valid JSON string with both `input` and `output` fields.
- `sequence_number` is monotonically increasing across all events in a single turn.

---

## Adapter Design: Claude Agent SDK Events

The Claude Agent SDK `query()` async iterable yields `SDKMessage` objects. The relevant types:

`SDKPartialAssistantMessage` (`type: 'stream_event'`, `event: BetaRawMessageStreamEvent`) — emitted during streaming. The `event` field is a standard Anthropic streaming event:
- `content_block_start` with `content_block.type='text'` → new text block starting
- `content_block_delta` with `delta.type='text_delta'` → text increment
- `content_block_start` with `content_block.type='tool_use'` → new tool call starting
- `content_block_delta` with `delta.type='input_json_delta'` → tool input accumulating
- `content_block_stop` → current content block ending
- `content_block_start` with `content_block.type='thinking'` / `content_block_delta` `thinking_delta` → extended thinking / reasoning

`SDKAssistantMessage` (`type: 'assistant'`, `message: BetaMessage`) — complete assistant message with all content blocks including final resolved tool_use inputs. Use this to finalize any tool calls that did not produce partial streaming.

`SDKUserMessage` (`type: 'user'`) — emitted when the SDK executes a tool. Content contains `tool_result` blocks with `tool_use_id` (matching a prior tool_use block) and the execution result.

`SDKResultMessage` (`type: 'result'`) — end of the agentic loop. If `is_error` is true or subtype is not `'success'`, throw an error.

**Adapter class `ClaudeAgentToResponsesConverter`:** One instance per `streamTurn()` call.

State:
- `outputIndex: number` — increments per new output item
- `seqNum: number` — monotonically increasing sequence number
- `openTextItemId: string | null` — UUID of the currently open text message item
- `currentToolUseId: string | null` — the `id` of the tool_use block currently being streamed
- `openToolCalls: Map<string, { callId: string; name: string; input: Record<string, unknown> }>` — keyed by Anthropic `tool_use.id`; tracks pending tool calls awaiting their result

Method `convert(message: SDKMessage): ResponseStreamEvent[]`:
- `type === 'stream_event'`: delegate to `convertStreamEvent(message.event)`
- `type === 'assistant'`: for any `tool_use` blocks in `message.message.content` that are NOT yet in `openToolCalls`, emit `output_item.added` (function_call) and record them (handles cases where partial streaming did not fire)
- `type === 'user'`: for each `tool_result` block in content, find matching tool in `openToolCalls` by `tool_use_id`, emit `output_item.done` function_call with encoded `{ input, output }`, remove from map
- `type === 'result'`: throw if error; return `[]` otherwise
- All other types: return `[]`

Method `convertStreamEvent(event: BetaRawMessageStreamEvent): ResponseStreamEvent[]`:
- `content_block_start` + `text`: if no text item open, emit `output_item.added` (message), set `openTextItemId`
- `content_block_start` + `tool_use`: generate call_id UUID, emit `output_item.added` (function_call), set `currentToolUseId`, record in `openToolCalls`
- `content_block_start` + `thinking`: emit `reasoning_summary_part.added`
- `content_block_delta` + `text_delta`: emit `output_text.delta`
- `content_block_delta` + `thinking_delta`: emit `reasoning_summary_text.delta`
- `content_block_stop`: if text was open → emit `output_item.done` (message), clear `openTextItemId`; if thinking was open → emit `reasoning_summary_part.done`; if tool_use was open → clear `currentToolUseId` (do NOT close here; wait for tool result)

---

## Adapter Design: OpenAI Codex SDK Events

The Codex SDK `thread.runStreamed(prompt)` returns `{ events: AsyncGenerator<ThreadEvent> }`. Event types:

`ItemStartedEvent` (`type: 'item.started'`) with `item`:
- `item.type='agent_message'` → text item starts (text is empty string initially)
- `item.type='reasoning'` → reasoning starts
- `item.type='command_execution'` → bash command item starts
- `item.type='file_change'` → file patch item starts

`ItemUpdatedEvent` (`type: 'item.updated'`) with `item` — carries accumulated state. For `agent_message`, `item.text` is the full accumulated text so far. Compute delta as `item.text.slice(lastSeenLength)`.

`ItemCompletedEvent` (`type: 'item.completed'`) with final `item`:
- `agent_message` → close text item
- `reasoning` → close reasoning block
- `command_execution` → emit function_call done with `{ input: item.command, output: item.aggregated_output ?? '' }`
- `file_change` → emit function_call done with `{ input: JSON.stringify(item.changes), output: item.status }`
- `error` item → throw

`TurnCompletedEvent` → no events (ChatEngine handles turn end)
`TurnFailedEvent` → throw
`ThreadErrorEvent` → throw

**Adapter class `CodexToResponsesConverter`:** One instance per `streamTurn()` call.

State:
- `outputIndex: number`, `seqNum: number`
- `openItems: Map<string, { callId: string; name: string; lastTextLength: number }>` — keyed by `item.id`

---

## Progress

- [ ] Milestone 0: Pin SDKs in package.json, extend ProviderKind, add workspacePath, DB migration
- [ ] Milestone 1: Claude Agent SDK adapter + `claude-agent` provider
- [ ] Milestone 2: OpenAI Codex SDK adapter + `codex` provider
- [ ] Milestone 3: Catalog registration and startup wiring
- [ ] Milestone 4: Tests for both adapters
- [ ] Milestone 5: Manual smoke tests with real API keys

## Surprises & Discoveries

_To be filled in during implementation._

## Decision Log

- Decision: Two new provider kinds: `claude-agent` (Claude Agent SDK) and `codex` (OpenAI Codex SDK). No custom tool implementation (no `ai-sdk` provider with Cradle-defined tools in this plan).
  Rationale: Wibus confirmed "不想自己实现一个 coding agent". Both SDKs ship all needed tools (file read/write, bash, glob, grep, etc.). The `ai-sdk` provider with Cradle-defined tools is future optional work.
  Date/Author: 2026-05-03 / Wibus + Copilot

- Decision: `ResponseStreamEvent` remains the canonical wire format between providers and ChatEngine.
  Rationale: ChatEngine, renderer, and DB already handle this format. Both new adapters produce it. Zero downstream changes needed.
  Date/Author: 2026-05-03 / Wibus + Copilot

- Decision: 100% protocol compatibility between both adapters is a hard requirement.
  Rationale: Wibus stated "注意一定要 100% 的互相兼容才行，这块务必要做好来的才行". The same prompt handled by either provider must produce identical UIMessage structure from the renderer's perspective.
  Date/Author: 2026-05-03 / Wibus + Copilot

- Decision: `workspacePath: string` added to `StreamTurnInput`.
  Rationale: Both Claude Agent SDK (`options.cwd`) and Codex SDK (`thread.startThread({ workingDirectory })`) require a working directory. The workspace path is available in ChatEngine but was not forwarded to providers. Adding it to `StreamTurnInput` is the minimal change.
  Date/Author: 2026-05-03 / Wibus + Copilot

- Decision: `claude-agent` uses `permissionMode: 'acceptEdits'` initially.
  Rationale: Full IPC-based per-tool approval dialog requires a renderer modal and async handshake — separate feature. `acceptEdits` auto-approves file ops and is reasonable for trusted local development.
  Date/Author: 2026-05-03 / Wibus + Copilot

- Decision: Codex multi-turn session uses `thread.resumeThread(threadId)` for continuity.
  Rationale: The Codex SDK persists threads to `~/.codex/sessions`. Storing the thread ID in `providerSessionId` enables true session resume across app restarts, which is the right behavior for a persistent chat history.
  Date/Author: 2026-05-03 / Wibus + Copilot

- Decision: Existing `openai-compatible`, `acp-chat`, and `cli-tui` providers are untouched.
  Rationale: No reason to break existing profiles. New providers are purely additive.
  Date/Author: 2026-05-03 / Wibus + Copilot

## Outcomes & Retrospective

_To be written upon completion._

---

## Plan of Work

### Milestone 0: Pin SDKs in package.json, extend ProviderKind, DB migration

**Goal:** Ensure both SDKs are properly recorded in `package.json` and the lockfile; extend the type system to include the two new provider kinds; make the DB schema aware of them via migration.

**Add to `dependencies` in `package.json`:**

    "@anthropic-ai/claude-agent-sdk": "^0.2.126"
    "@openai/codex-sdk": "^0.128.0"

Run `pnpm install` to update the lockfile.

**Edit `src/main/agent-runtime/types.ts`:**

Extend `ProviderKind`:

    export type ProviderKind
      = 'acp-chat'
        | 'cli-tui'
        | 'openai-compatible'
        | 'claude-agent'      // NEW: Claude Agent SDK, Anthropic API
        | 'codex'             // NEW: OpenAI Codex SDK

Add `workspacePath: string` to `StreamTurnInput` (after the `message` field):

    export interface StreamTurnInput {
      runtimeSession: RuntimeSession
      profile: AgentProfile
      message: string
      workspacePath: string        // NEW: filesystem cwd for agent tool execution
      modelId?: string
      ...
    }

**Edit `src/main/db/schema.ts`:**

Search for all occurrences of the provider kind string literal array (search for `'openai-compatible'` — there are 5 occurrences). Add `'claude-agent'` and `'codex'` to each array.

**Edit `src/main/lib/chat-engine.ts`:**

Find the `provider.streamTurn({...})` call in `runStream()`. The workspace path is already queried nearby for the `cwd` variable. Pass it through:

    provider.streamTurn({
      runtimeSession: draft.runtimeSession,
      profile,
      message: userText,
      workspacePath: cwd,    // ADD THIS
      modelId: draft.modelId,
      ...
    })

Also update `prepareTurn` callers to pass `workspacePath` where needed, or simply ensure `runStream` has `cwd` available (it already does).

**DB migration:**

    pnpm db:generate
    pnpm db:migrate

Review the generated SQL to verify `'claude-agent'` and `'codex'` appear in the constraints.

**Acceptance:** `pnpm typecheck` passes. Existing tests still pass.

---

### Milestone 1: Claude Agent SDK adapter + `claude-agent` provider

**Goal:** Implement the claude-agent-to-responses adapter and the provider class. These two files give `claude-agent` profiles full coding-agent capability.

#### 1a. Create `src/main/agent-runtime/adapters/` directory

Create the directory and add `src/main/agent-runtime/adapters/README.md`:

    <!-- Once this directory changes, update this README.md -->
    # agent-runtime/adapters

    SDK event adapters that convert third-party streaming events into the
    canonical ResponseStreamEvent format consumed by ChatEngine.
    Each file corresponds to one SDK. All adapters are stateful (one instance
    per streamTurn call) and must produce protocol-compatible output.

    ## Files

    - **claude-agent-to-responses.ts**: Converts Claude Agent SDK SDKMessage stream to ResponseStreamEvent
    - **codex-to-responses.ts**: Converts OpenAI Codex SDK ThreadEvent stream to ResponseStreamEvent

#### 1b. Create `src/main/agent-runtime/adapters/claude-agent-to-responses.ts`

File header:

    // Input: Claude Agent SDK SDKMessage stream (SDKPartialAssistantMessage, SDKAssistantMessage, SDKUserMessage, SDKResultMessage)
    // Output: ClaudeAgentToResponsesConverter — converts SDK messages to ResponseStreamEvent arrays
    // Position: Adapter in agent-runtime/adapters; must produce protocol-compatible output to CodexToResponsesConverter

Follow the adapter design documented in the Context section above. Key implementation notes:

The `BetaRawMessageStreamEvent` type comes from `@anthropic-ai/sdk/resources/beta/messages/messages.mjs`. The Claude Agent SDK re-exports it as typed stream events.

For `SDKUserMessage`, the content type is `BetaUserContent`. Tool result blocks have type `'tool_result'` with `tool_use_id` and `content` (either a string or an array of content blocks).

Helper `extractToolResultText(content: BetaToolResultBlockParam['content']): string`:
- If string: return as-is
- If array: join all blocks where `block.type === 'text'`, returning `block.text`

The `output_item.done` for function_call items emits:

    {
      type: 'response.output_item.done',
      output_index: <outputIndex>,
      sequence_number: <nextSeq>,
      item: {
        type: 'function_call',
        id: callId,
        call_id: callId,
        name: toolName,
        status: 'completed',
        arguments: JSON.stringify({ input: storedInput ?? {}, output: toolResultText }),
      }
    }

Where `storedInput` is the resolved tool input from the `SDKAssistantMessage` (complete input) or accumulated `input_json_delta` chunks. Prefer the final `SDKAssistantMessage` input since it is fully parsed.

#### 1c. Create `src/main/agent-runtime/providers/claude-agent-provider.ts`

File header:

    // Input: @anthropic-ai/claude-agent-sdk query(), profile configJson + credentialRef, ClaudeAgentToResponsesConverter
    // Output: ClaudeAgentProvider implementing ChatRuntimeProvider for claude-agent profiles
    // Position: Concrete agent-runtime provider; Anthropic API only; wraps Claude Agent SDK

**Config shape (stored in `profile.configJson`):**

    interface ClaudeAgentConfig {
      model?: string            // default: 'claude-sonnet-4-5'
      permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk'
      allowedTools?: string[]   // default: ['Read','Write','Edit','Bash','Glob','Grep','WebSearch']
      maxTurns?: number         // default: 50
    }

`probe(profile)`: Check `profile.credentialRef` is set and `readSecret(credentialRef)` returns non-empty. Return `ok: true` with `details: { model: config.model }`.

`listModels()`: Return hardcoded list of current Claude model IDs. At time of implementation verify against Anthropic docs. Starting set:

    [
      { id: 'claude-opus-4-5',    label: 'Claude Opus 4.5',    providerKind: 'claude-agent', contextWindow: 200000 },
      { id: 'claude-sonnet-4-5',  label: 'Claude Sonnet 4.5',  providerKind: 'claude-agent', contextWindow: 200000 },
      { id: 'claude-haiku-4-5',   label: 'Claude Haiku 4.5',   providerKind: 'claude-agent', contextWindow: 200000 },
    ]

`startChatSession` / `resumeChatSession`: Stateless (same pattern as `openai-compatible`). Return a `RuntimeSession` with `providerSessionId: null`.

`streamTurn(input: StreamTurnInput)`:

    async *streamTurn(input: StreamTurnInput): AsyncGenerator<ResponseStreamEvent> {
      const config = parseConfig(input.profile.configJson)
      const apiKey = input.profile.credentialRef
        ? this.deps.readSecret(input.profile.credentialRef)
        : undefined

      const prompt = buildHistoryPrompt(input.message, input.history)
      const abortController = new AbortController()
      this.activeTurns.set(input.runtimeSession.chatSessionId, abortController)

      try {
        const converter = new ClaudeAgentToResponsesConverter()

        for await (const msg of query(prompt, {
          options: {
            model: config.model ?? 'claude-sonnet-4-5',
            permissionMode: config.permissionMode ?? 'acceptEdits',
            allowedTools: config.allowedTools ?? ['Read','Write','Edit','Bash','Glob','Grep','WebSearch'],
            systemPrompt: input.systemPrompt,
            cwd: input.workspacePath,
            maxTurns: config.maxTurns ?? 50,
          },
          abortSignal: abortController.signal,
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: apiKey ?? '',
          },
        })) {
          for (const event of converter.convert(msg)) {
            yield event
          }
        }
      } finally {
        this.activeTurns.delete(input.runtimeSession.chatSessionId)
      }
    }

`buildHistoryPrompt(message, history)`: If `history` is non-empty, prepend a conversation transcript:

    Previous conversation:
    User: <first user message>
    Assistant: <first assistant message>
    ...

    Current request:
    <message>

`cancelTurn(input)`: Call `this.activeTurns.get(chatSessionId)?.abort()`.

**Check `query()` options for native API key support:** Look at the `ClaudeAgentOptions` type in the SDK for an `apiKey` field. If present, pass it directly instead of via `env`. This is cleaner and avoids env mutation.

**Acceptance:** After Milestone 3, create a `claude-agent` profile. Start a chat in the Cradle workspace. Send "what TypeScript files are in src/main/agent-runtime?". Observe tool calls appearing in the chat and a correct file listing in the response.

---

### Milestone 2: OpenAI Codex SDK adapter + `codex` provider

**Goal:** Implement the codex-to-responses adapter and the codex provider class.

#### 2a. Create `src/main/agent-runtime/adapters/codex-to-responses.ts`

File header:

    // Input: OpenAI Codex SDK ThreadEvent stream from thread.runStreamed()
    // Output: CodexToResponsesConverter — converts Codex SDK events to ResponseStreamEvent arrays
    // Position: Adapter in agent-runtime/adapters; MUST produce protocol-compatible output to ClaudeAgentToResponsesConverter

Follow the adapter design documented in the Context section above.

For `command_execution` tool name, use `'CommandExecution'` (PascalCase to distinguish from raw Bash). For `file_change`, use `'FileChange'`. The chat UI currently displays tool names as-is; these names will appear in the tool invocation card.

For `mcp_tool_call` items (when the Codex agent calls an MCP tool): emit similarly to command_execution — `output_item.added` function_call with `item.name = item.tool`, `output_item.done` with `{ input: JSON.stringify(item.arguments), output: JSON.stringify(item.result) }`.

`web_search` items: emit `output_item.added` (function_call, name='WebSearch') + `output_item.done` with `{ input: item.query, output: '(search results returned to agent)' }`.

#### 2b. Create `src/main/agent-runtime/providers/codex-provider.ts`

File header:

    // Input: @openai/codex-sdk Codex class, Thread, ThreadEvent, profile configJson + credentialRef, CodexToResponsesConverter
    // Output: CodexProvider implementing ChatRuntimeProvider for codex profiles
    // Position: Concrete agent-runtime provider; OpenAI API only; wraps OpenAI Codex SDK

**Config shape:**

    interface CodexConfig {
      model?: string             // default: let SDK pick (omit for SDK default)
      skipGitRepoCheck?: boolean // default: false
    }

`probe(profile)`: Check `credentialRef`, try instantiating `new Codex({ env: { OPENAI_API_KEY: key, PATH: process.env.PATH } })`. If construction throws (e.g. binary not found), return `ok: false` with the error message.

`listModels()`: Hardcoded list. Check `@openai/codex-sdk` README or `Codex` class docs for supported models. Starting set based on documentation:

    [
      { id: 'codex-1',      label: 'Codex 1',      providerKind: 'codex', contextWindow: null },
      { id: 'codex-1-mini', label: 'Codex 1 Mini',  providerKind: 'codex', contextWindow: null },
    ]

Verify model names against the installed SDK version.

`startChatSession(input)`:
- Create `const codex = new Codex({ env: { ...process.env, OPENAI_API_KEY: apiKey } })`
- Call `const thread = codex.startThread({ workingDirectory: input.workspacePath, skipGitRepoCheck: config.skipGitRepoCheck ?? false })`
- Store `thread` in `this.threads.set(input.chatSessionId, thread)`
- The Codex SDK persists threads to `~/.codex/sessions` and returns a thread with an `id` property
- Return `RuntimeSession { providerSessionId: thread.id ?? null, ... }`

`resumeChatSession(input)`:
- If `this.threads.has(input.runtimeSession.chatSessionId)`, return `input.runtimeSession` (thread still in memory)
- Otherwise: reconstruct `codex` client, call `codex.resumeThread(input.runtimeSession.providerSessionId)`, store in `this.threads`, return `input.runtimeSession`

`streamTurn(input)`:

    async *streamTurn(input: StreamTurnInput): AsyncGenerator<ResponseStreamEvent> {
      const thread = this.getThread(input.runtimeSession.chatSessionId)
      if (!thread) throw new Error('Codex thread not found for session')

      const abortController = new AbortController()
      this.activeTurns.set(input.runtimeSession.chatSessionId, abortController)

      try {
        const converter = new CodexToResponsesConverter()
        const prompt = buildHistoryPrompt(input.message, input.history)
        // Note: Codex SDK manages conversation history internally via the thread.
        // For initial turns, the history is prepended as context. For continued
        // sessions resumed by thread ID, history is already in the thread.
        const { events } = await thread.runStreamed(prompt, {
          signal: abortController.signal,
        })

        for await (const event of events) {
          for (const responseEvent of converter.convert(event)) {
            yield responseEvent
          }
        }
      } finally {
        this.activeTurns.delete(input.runtimeSession.chatSessionId)
      }
    }

`cancelTurn(input)`: Abort the controller.

**Multi-turn session note:** The Codex SDK already manages multi-turn continuity for a thread. Calling `thread.run()` or `thread.runStreamed()` multiple times on the same Thread instance continues the conversation. Therefore, for the `codex` provider, `buildHistoryPrompt` is used only for the FIRST turn (when the thread is freshly started), or when resuming after an app restart when the in-memory thread is lost (in which case the thread's stored history takes over). To handle this cleanly: if `input.history` is one or more turns, check if this is the thread's first `streamTurn` call (no items yet); if so, prepend history. Otherwise skip it (thread already has history).

---

### Milestone 3: Catalog registration and startup wiring

**Goal:** Register both new providers so they are active when Cradle starts.

**Edit `src/main/agent-runtime/catalog-instance.ts`:**

Import and register both providers. The catalog singleton already wires the credential vault. Add:

    import { ClaudeAgentProvider } from './providers/claude-agent-provider'
    import { CodexProvider } from './providers/codex-provider'

In the init/registration block:

    catalog.register(new ClaudeAgentProvider({ readSecret: vault.readSecret.bind(vault) }))
    catalog.register(new CodexProvider({ readSecret: vault.readSecret.bind(vault) }))

**Edit `src/main/index.ts`:**

Ensure the registration happens before `ChatEngine.initialize()`. Since catalog-instance is imported and initialized lazily on first access, verify the import order is correct.

**Acceptance:** `pnpm dev` starts. Agents settings page shows `claude-agent` and `codex` in the provider kind picker. `pnpm typecheck` passes.

---

### Milestone 4: Tests for both adapters

Write unit tests. No real API calls needed; these test the event conversion logic only.

**`src/main/agent-runtime/__tests__/claude-agent-to-responses.test.ts`:**

    describe('ClaudeAgentToResponsesConverter', () => {
      it('emits output_item.added (message) on content_block_start text', () => { ... })
      it('emits output_text.delta on content_block_delta text_delta', () => { ... })
      it('emits output_item.done (message) on content_block_stop', () => { ... })
      it('emits output_item.added (function_call) on content_block_start tool_use', () => { ... })
      it('emits output_item.done (function_call) on SDKUserMessage tool_result', () => { ... })
      it('throws on SDKResultMessage with is_error=true', () => { ... })
      it('encodes input and output in item.arguments for function_call done', () => { ... })
    })

**`src/main/agent-runtime/__tests__/codex-to-responses.test.ts`:**

    describe('CodexToResponsesConverter', () => {
      it('emits output_item.added (message) on item.started agent_message', () => { ... })
      it('emits output_text.delta on item.updated with longer text', () => { ... })
      it('emits output_item.done (message) on item.completed agent_message', () => { ... })
      it('emits output_item.added (function_call CommandExecution) on item.started command_execution', () => { ... })
      it('emits output_item.done (function_call) on item.completed command_execution', () => { ... })
      it('emits output_item.done for file_change with changes and status', () => { ... })
      it('throws on turn.failed', () => { ... })
    })

**Cross-adapter compatibility test (add to one of the above files):**

    it('produces identical event.type sequences for text streaming as ClaudeAgentToResponsesConverter', () => {
      // Build expected sequence from ClaudeAgentToResponsesConverter
      const ca = new ClaudeAgentToResponsesConverter()
      const caEvents: ResponseStreamEvent[] = [
        ...ca.convert({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, ... }),
        ...ca.convert({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }, ... }),
        ...ca.convert({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, ... }),
      ]

      // Build same sequence from CodexToResponsesConverter
      const cx = new CodexToResponsesConverter()
      const cxEvents: ResponseStreamEvent[] = [
        ...cx.convert({ type: 'item.started', item: { id: 'msg1', type: 'agent_message', text: '' } }),
        ...cx.convert({ type: 'item.updated', item: { id: 'msg1', type: 'agent_message', text: 'Hello' } }),
        ...cx.convert({ type: 'item.completed', item: { id: 'msg1', type: 'agent_message', text: 'Hello' } }),
      ]

      expect(cxEvents.map(e => e.type)).toEqual(caEvents.map(e => e.type))
    })

Run: `pnpm test`

---

### Milestone 5: Manual smoke tests

**Claude Agent SDK test:**

1. `pnpm dev`
2. Agents settings → New Profile → kind: `claude-agent`, add Anthropic API key as credential, set model to `claude-sonnet-4-5`, save.
3. New Chat → select claude-agent profile → Start Chat (in the Cradle workspace directory).
4. Send: "What TypeScript files exist in src/main/agent-runtime?"
5. Expected: agent calls Read, Glob, or Bash tool (visible as tool invocation card in chat), response lists actual files.

**OpenAI Codex SDK test:**

1. Agents settings → New Profile → kind: `codex`, add OpenAI API key as credential, save.
2. New Chat → select codex profile → Start Chat.
3. Send: "What is this project? Read the README.md."
4. Expected: agent executes a file read (CommandExecution visible in chat), response summarizes README.

**Regression test:**

5. Switch to an existing `openai-compatible` profile.
6. Send a plain message.
7. Expected: text-only response, no tool cards, no errors.

---

## Concrete Steps (summary)

1. Add both SDKs to `package.json`; run `pnpm install`
2. `types.ts`: add `'claude-agent'` and `'codex'` to `ProviderKind`; add `workspacePath` to `StreamTurnInput`
3. `db/schema.ts`: add new kinds to all 5 enum arrays
4. `chat-engine.ts`: pass `cwd` (workspace path) as `workspacePath` in `streamTurn` call
5. `pnpm db:generate && pnpm db:migrate`
6. Create `src/main/agent-runtime/adapters/` with README
7. Implement `adapters/claude-agent-to-responses.ts` (`ClaudeAgentToResponsesConverter`)
8. Implement `adapters/codex-to-responses.ts` (`CodexToResponsesConverter`)
9. Implement `providers/claude-agent-provider.ts` (`ClaudeAgentProvider`)
10. Implement `providers/codex-provider.ts` (`CodexProvider`)
11. Register both in `catalog-instance.ts`
12. Verify startup in `index.ts`
13. Write unit tests; run `pnpm test`
14. Manual smoke test with real API keys

## Validation and Acceptance

1. `pnpm typecheck` passes.
2. `pnpm test` passes (all old and new tests).
3. `pnpm dev` starts without errors.
4. `claude-agent` profile calls tools visibly in chat and returns answers grounded in real workspace files.
5. `codex` profile does the same.
6. Existing `openai-compatible` profiles still work for text-only chat.

## Idempotence and Recovery

- Both SDKs are in `node_modules` already; adding to `package.json` is non-destructive.
- If `pnpm db:generate` was run but `pnpm db:migrate` was not, just run `pnpm db:migrate`.
- Any provider file can be created alone; they are independent of each other.
- To revert: remove providers from `catalog-instance.ts`; the new ProviderKind values in the schema do no harm.

## Artifacts and Notes

**New files:**
- `src/main/agent-runtime/adapters/README.md`
- `src/main/agent-runtime/adapters/claude-agent-to-responses.ts`
- `src/main/agent-runtime/adapters/codex-to-responses.ts`
- `src/main/agent-runtime/providers/claude-agent-provider.ts`
- `src/main/agent-runtime/providers/codex-provider.ts`
- `src/main/agent-runtime/__tests__/claude-agent-to-responses.test.ts`
- `src/main/agent-runtime/__tests__/codex-to-responses.test.ts`
- New migration in `drizzle/`

**Modified files:**
- `package.json`
- `src/main/agent-runtime/types.ts`
- `src/main/db/schema.ts`
- `src/main/lib/chat-engine.ts`
- `src/main/agent-runtime/catalog-instance.ts`
- `src/main/index.ts`
- `src/main/agent-runtime/providers/README.md`

**Follow-up plans (out of scope):**
- IPC-based per-tool approval dialog for both providers
- MCP server wiring through both providers
- `ai-sdk` provider with Cradle-defined tools for multi-model support
- Session import from existing Claude Code / Codex CLI threads

## Interfaces and Dependencies

    @anthropic-ai/claude-agent-sdk  — query(), SDKMessage, BetaRawMessageStreamEvent, PermissionMode
    @openai/codex-sdk               — Codex, Thread, ThreadEvent, ThreadItem (AgentMessageItem, CommandExecutionItem, ...)
    openai                          — ResponseStreamEvent type (existing)
    zod                             — config schema validation (existing)
    src/main/agent-runtime/types.ts — ProviderKind, ChatRuntimeProvider, StreamTurnInput (modified)
    src/main/db/schema.ts           — provider kind columns (modified)
    src/main/lib/chat-engine.ts     — workspacePath forwarding (modified)
    src/main/agent-runtime/catalog-instance.ts — provider registration (modified)
