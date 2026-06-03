# Bang Command (`!`) in Composer

**Status**: Implemented
**Created**: 2026-06-03
**Updated**: 2026-06-03

## Goal

Allow users to type `!git status` in the Composer to execute a shell command. The command runs on the server, and the output is injected as a message in the chat conversation so the AI sees it as context for subsequent turns.

## Motivation

Users often need to run quick shell commands (check git status, list files, run tests) during an AI-assisted coding session. Currently they must switch to a separate terminal panel, and the output is disconnected from the chat context. The `!` prefix brings shell execution into the conversation flow — the AI can see the output and reason about it.

## Non-goals

- Interactive TUI programs (vim, htop) — V1 uses `spawn` with buffered output, not a full PTY
- Approval flow — the `!` prefix is an explicit user action; no approval needed for V1
- Streaming output — V1 collects output at completion; streaming can be added later

## Progress

- [x] (2026-06-03 11:19Z) Resolved the three open questions: only `!cmd` triggers, multi-line input does not trigger, and bang is a separate chat send-path interception rather than a slash command kind.
- [x] (2026-06-03 11:19Z) Moved server ownership into Chat Runtime and implemented `apps/server/src/modules/chat-runtime/bang-command.ts`, request/response schemas, and `POST /chat/sessions/:sessionId/bang-command`.
- [x] (2026-06-03 11:19Z) Added Chat Runtime message metadata helpers for `metadata.cradle.bangCommand` and `metadata.cradle.bangResult`.
- [x] (2026-06-03 11:19Z) Added web-side bang parsing, HTTP command execution, send-path interception, temporary local command row handling, and canonical message insertion from the server response.
- [x] (2026-06-03 11:19Z) Added terminal-style bang result rendering through `BangCommandBlock` and metadata detection in both store-backed and direct message bubble renderers.
- [x] (2026-06-03 11:19Z) Updated Chat Runtime and Chat feature READMEs for the new route, files, metadata, and rendering behavior.
- [x] (2026-06-03 11:23Z) Verified server and web typechecks plus focused chat-runtime and message-bubble tests.
- [x] (2026-06-03 11:30Z) Added Composer trigger-state UI: the send button switches to a terminal icon and the action bar shows a compact shell-command pill while `!cmd` is active.

## Surprises & Discoveries

- Observation: The initial server route response type was too wide because AI SDK `UIMessage.role` is broader than the route schema's `user | assistant` union.
  Evidence: `pnpm typecheck:server` failed on `BangCommandExecutionResult`; narrowing returned bang messages to `Omit<UIMessage, 'role'> & { role: 'user' | 'assistant' }` fixed the route typing.

- Observation: The broad Vitest command `pnpm --filter @cradle/web test -- bang-command message-bubble` matched unrelated tests under `src`.
  Evidence: it ran 58 test files and failed in unrelated `agent-management`, `mention-panel`, `kanban`, and `system-agent` tests. The precise command `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chat/message-bubble.test.tsx` passed.

## Design

### Flow

```
User types "!git status" + Enter
  → composer.tsx detects `!` prefix, calls bang command path
  → POST /chat/sessions/:id/bang-command { command: "git status" }
  → Chat Runtime spawns the command with a shell, captures stdout/stderr/exitCode
  → server persists two messages to DB (user + result)
  → returns output to client
  → client inserts both messages into Zustand store
  → AI sees the result message in context on next turn
```

### Message format

Two messages are persisted per bang command:

**User message** (role: `user`):
```
Text: "!git status"
Metadata: { cradle: { bangCommand: { command: "git status" } } }
```

**Result message** (role: `user`, with structured parts):
```
Parts: [{ type: "text", text: "<stdout, stderr fallback, or no-output fallback>" }]
Metadata: { cradle: { bangResult: { command: "git status", stdout, stderr, exitCode: 0, durationMs: 142, timedOut: false } } }
```

Using `role: "user"` for the result (not `assistant`) ensures every runtime provider (Claude Agent SDK, Codex, future providers) sees it as user-provided context without confusion.
The result text is intentionally bash-like: stdout is the provider-visible text when present. If stdout is empty and stderr exists, stderr becomes the provider-visible text so failed commands are still useful context. If both streams are empty, the provider-visible text says the command exited with no output.

### CWD resolution

Use the session's workspace path, resolved server-side by Chat Runtime from the session/workspace rows. The host `process.env` is forwarded so PATH, NVM_DIR, etc. are available.

## Implementation

### Phase 1: Server — execution service + route

**1. New file: `apps/server/src/modules/chat-runtime/bang-command.ts`**

- `executeBangCommand(sessionId, command)` → `{ stdout, stderr, exitCode, durationMs, timedOut }`
- Uses `child_process.spawn` with `{ shell: true, cwd, env: process.env }`
- Captures stdout/stderr into buffers (max 100KB each)
- Enforces 30s timeout via `setTimeout` + `child.kill()`
- Resolves cwd from the Chat Runtime session workspace context

**2. Modify: `apps/server/src/modules/chat-runtime/model.ts`**

TypeBox schemas for request/response validation.

**3. Modify: `apps/server/src/modules/chat-runtime/index.ts`**

Elysia route: `POST /chat/sessions/:sessionId/bang-command`

- Validates body `{ command: string }`
- Calls `executeBangCommand`
- Persists two messages using the `createDraftTurn` pattern (see `service.ts:601-664`): a user message for the command, and a result message with output
- Returns `{ stdout, stderr, exitCode, durationMs, timedOut, userMessageId, resultMessageId }`

**4. Modify: `apps/server/src/modules/chat-runtime/message-snapshots.ts`**

Add small metadata helpers for `metadata.cradle.bangCommand` and `metadata.cradle.bangResult`.

### Phase 2: Client — detection + API

**5. New file: `apps/web/src/features/chat/bang-command.ts`**

```typescript
export function readBangCommand(text: string): string | null
```

- `!git status` → `"git status"`
- `!` alone → `null`
- `! ` (with space after `!`) → `null` (avoids accidental execution)
- any newline in the text → `null` (V1 only accepts single-line commands)

Follows the `readCodexGoalCommandObjective` pattern in `use-chat-session.ts:116-127`.

**6. New file: `apps/web/src/features/chat/bang-command-api.ts`**

```typescript
export async function executeBangCommandApi(sessionId: string, command: string): Promise<BangCommandResult>
```

This was implemented in the existing `apps/web/src/features/chat/chat-response-command.ts` HTTP boundary instead of a separate file, because that file already owns chat command endpoints.

**7. Modify: `apps/web/src/features/chat/use-chat-session.ts`**

In `sendMessage` (line ~417), before the normal send flow:

```typescript
const bangCmd = readBangCommand(trimmedText)
if (bangCmd && sessionId) {
  await executeBangCommand(sessionId, bangCmd)
  return
}
```

`executeBangCommand`:
1. Append optimistic user message to store (with `bangCommand` metadata)
2. Set streaming state
3. Call `executeBangCommandApi`
4. Append result message to store (with `bangResult` metadata and provider-visible result text)
5. Clear streaming state

### Phase 3: Client — rendering

**8. New file: `apps/web/src/features/chat/blocks/bang-command-block.tsx`**

Collapsible component:
- Header: terminal icon + command text + exit code badge (green/red) + duration
- Body: pre-formatted stdout/stderr, collapsible
- Reuses `readTerminalOutputSections` from `terminal-tool-details.ts` for formatting

**9. Modify: `apps/web/src/features/chat/message-bubble.tsx`**

In the message rendering pipeline, check `metadata.cradle.bangResult` and route to `BangCommandBlock` instead of the default text renderer. This follows the same pattern as goal message detection.

### Phase 4: Polish

**10. Modify: `apps/web/src/features/chat/composer.tsx`**

When input starts with `!`, show a terminal icon badge and change placeholder to "Enter shell command...".

Implemented: when the current draft is a valid bang command, the send button changes from the normal send arrow to a terminal icon and the action bar shows a compact terminal pill with the command preview.

**11. Edge cases**
- Empty `!` → treat as normal text
- Timeout → show timeout indicator in result block
- Very long output → truncate at 50KB with "truncated" notice
- Cancel → wire AbortController through the existing stop button

## Files summary

| Action | File |
|--------|------|
| Create | `apps/server/src/modules/chat-runtime/bang-command.ts` |
| Modify | `apps/server/src/modules/chat-runtime/model.ts` |
| Modify | `apps/server/src/modules/chat-runtime/index.ts` |
| Modify | `apps/server/src/modules/chat-runtime/message-snapshots.ts` |
| Create | `apps/web/src/features/chat/bang-command.ts` |
| Modify | `apps/web/src/features/chat/chat-response-command.ts` |
| Modify | `apps/web/src/features/chat/use-chat-session.ts` |
| Create | `apps/web/src/features/chat/blocks/bang-command-block.tsx` |
| Modify | `apps/web/src/features/chat/message-bubble.tsx` |
| Modify | `apps/web/src/features/chat/composer.tsx` |

## Open questions

1. **`!` vs `! ` (space)**: Resolved: only `!command` with no space triggers. `! git status` remains ordinary text because local command execution has a high accidental-trigger cost.
2. **Multi-line**: Resolved: multi-line input does not trigger V1 bang command execution. Silently taking only the first line would drop user-authored text.
3. **Slash command vs bang**: Resolved: keep `!` as a separate interception in the chat send path. It is not a slash command catalog item, has no autocomplete panel, and its semantics are Chat Runtime transcript injection rather than provider command text.

## Decision Log

- Decision: Own bang command execution under Chat Runtime instead of adding a top-level `bang-command` server module.
  Rationale: The feature writes two `messages.message_json` snapshots into the chat transcript and resolves session workspace context, so Chat Runtime owns its semantics, lifecycle, and persistence.
  Date/Author: 2026-06-03 / Codex

- Decision: Result message text is stdout-first, then stderr, then a no-output fallback.
  Rationale: This matches shell-tool expectations while ensuring failed commands with stderr-only output remain visible to providers that only consume message text.
  Date/Author: 2026-06-03 / Codex

- Decision: Only single-line `!cmd` with no space after `!` triggers execution.
  Rationale: Local command execution should avoid ambiguous prose and should not silently discard multi-line user input.
  Date/Author: 2026-06-03 / Codex

- Decision: Keep the web HTTP function in `chat-response-command.ts` instead of adding `bang-command-api.ts`.
  Rationale: `chat-response-command.ts` already owns the feature-side HTTP command boundary for session response, stream, cancel, permission, and queue endpoints; adding bang there avoids a parallel API style.
  Date/Author: 2026-06-03 / Codex

- Decision: Add Composer trigger-state UI for bang commands.
  Rationale: Local shell execution is materially different from ordinary chat submission, so the Composer should show an explicit mode change before the user presses Enter or clicks send.
  Date/Author: 2026-06-03 / Codex

## Validation and Acceptance

Validation completed from `/Users/wibus/dev/Cradle`:

    pnpm typecheck:server
    # passed

    pnpm --filter @cradle/web typecheck
    # passed

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chat/message-bubble.test.tsx
    # Test Files 1 passed; Tests 17 passed

    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts
    # Test Files 1 passed; Tests 20 passed

An earlier broad web test command was not accepted as focused validation because it matched unrelated test files:

    pnpm --filter @cradle/web test -- bang-command message-bubble
    # failed in unrelated agent-management, mention-panel, kanban, and system-agent tests

## Outcomes & Retrospective

V1 is implemented. Typing a single-line `!cmd` with no space after `!` in a chat session now calls Chat Runtime, executes the command in the session workspace, persists the visible command and result as two complete user messages, and renders the result with terminal-style stdout/stderr details. The provider-visible result text is stdout-first, stderr fallback, then no-output fallback, so future AI turns can naturally read the command output as user context.

Composer-specific visual polish is included: valid bang drafts switch the send button to a terminal icon and show a compact command preview pill in the action bar.

Revision note: updated 2026-06-03 to record resolved open questions, move server ownership into `apps/server/src/modules/chat-runtime`, document implementation deviations, and add validation outcomes.
