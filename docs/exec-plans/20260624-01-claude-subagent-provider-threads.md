# Implement Claude Agent Subagent Provider Threads

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is intentionally self-contained so a future contributor can continue without prior conversation context.

## Purpose / Big Picture

Users should be able to click Claude Agent subagents in the right runtime panel and read the nested subagent transcript in the existing Browser Panel detail view. Today that view calls Chat Runtime's provider-thread API, but the Claude Agent provider does not implement provider-thread reads, so a Claude Agent subagent row opens an error panel. The Claude Agent SDK does persist subagent transcripts under the parent provider session, so Cradle should expose those SDK-owned transcripts through Chat Runtime's provider-thread boundary.

After this change, `GET /chat/sessions/:sessionId/provider-threads` for a Claude Agent session returns provider-thread records backed by Claude subagent IDs, `GET /provider-threads/:threadId/turns` returns projected `UIMessage` records from the subagent transcript, and the right runtime panel can open either a real Claude subagent ID or the existing `call_...` tool-call ID alias while Cradle resolves it to the correct transcript.

## Progress

- [x] (2026-06-24 13:46 +08) Read the ExecPlan, server-app-development, and Claude runtime SDK skills; confirmed this work is complex enough for an ExecPlan because it changes provider ownership, SDK transcript reads, and right-panel behavior.
- [x] (2026-06-24 13:48 +08) Verified the SDK supports `listSubagents()` and `getSubagentMessages()`, and verified local desktop data for provider session `92839edc-17ee-4081-bba5-7ade6ead39b9` maps three Claude subagent IDs back to `call_...` parent tool-use IDs.
- [x] (2026-06-24 15:50 +08) Implemented Claude Agent provider-thread list/read/turns in `provider.ts` using `listSubagents()` and `getSubagentMessages()`. The read and turns methods accept both real SDK `agentId` values and current UI `call_...` aliases by scanning `parent_tool_use_id`.
- [x] (2026-06-24 15:52 +08) Updated Claude crew projection so completion updates preserve non-null prompt/model/reasoning fields and completed calls remain visible as clickable agents. Updated Web label helpers to prefer preview/message before formatting raw IDs.
- [x] (2026-06-24 15:55 +08) Added focused provider tests for listing SDK transcript-backed subagent threads and reading turns through a parent tool-call alias.
- [x] (2026-06-24 15:57 +08) Ran focused validation: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/provider.test.ts src/modules/chat-runtime-providers/claude-agent/event-to-chunk-mapper.test.ts` passed with 51 tests; `pnpm --filter @cradle/server typecheck` passed.
- [x] (2026-06-24 16:00 +08) Verified against real Desktop Application Support data for session `4698f68a-8857-43c9-8346-50426187af23`: the new provider listed three SDK subagent IDs and resolved `call_619efb5ce70d4f5f9c3868aa` to `a09d3e20830604ad2` with 29 projected messages.

## Surprises & Discoveries

- Observation: The SDK can read Claude subagent transcript files even though Cradle's Claude provider currently returns `chat_provider_threads_not_supported`.
  Evidence: Running `pnpm --filter @cradle/server exec node --input-type=module` with `listSubagents('92839edc-17ee-4081-bba5-7ade6ead39b9', { dir: '/Users/wibus/dev/Cradle' })` returned `a09d3e20830604ad2`, `ac0e8180cc7aef5fc`, and `ac25c19e25f9af72c`; `getSubagentMessages()` for each returned messages whose `parent_tool_use_id` matched the three `call_...` tool calls shown in the UI.
- Observation: Current Claude crew projection stores `call_...` as `RuntimeCrewAgentItem.threadId`.
  Evidence: Desktop `backend_session_bindings.backend_state_snapshot` for session `4698f68a-8857-43c9-8346-50426187af23` contains `claudeAgent.crewCalls[].id` values `call_619...`, `call_521...`, and `call_4f4...`, while the SDK transcript directory stores subagent IDs separately as `agent-<agentId>.jsonl`.
- Observation: The existing Web runtime panel can keep passing `call_...` IDs if the server resolves those IDs through `parent_tool_use_id`.
  Evidence: A direct provider invocation with Desktop data returned `threadId: "a09d3e20830604ad2"` and `messageCount: 29` for input thread ID `call_619efb5ce70d4f5f9c3868aa`.

## Decision Log

- Decision: Implement Claude Agent transcript reads inside the server Chat Runtime provider instead of making Web call the Claude SDK or read Application Support files.
  Rationale: Chat Runtime owns runtime capability semantics and already exposes provider-native thread detail. Web should remain a consumer of Cradle APIs, not of Claude's filesystem namespace.
  Date/Author: 2026-06-24 / Codex
- Decision: Reuse the existing provider-thread API for Claude subagents.
  Rationale: The existing Browser Panel is already built around `provider-threads/:threadId` and `provider-threads/:threadId/turns`. Claude's backing storage differs from Codex, but the user-visible shape is still a provider-native subagent transcript.
  Date/Author: 2026-06-24 / Codex
- Decision: Keep the Web runtime panel compatible with current `call_...` crew rows by resolving them server-side to SDK `agentId` values.
  Rationale: The live crew snapshot only knows the parent Agent tool-call ID. The SDK transcript store is the authoritative source for the child `agentId`, so the provider boundary is the right place to map aliases without teaching Web about Claude's filesystem layout.
  Date/Author: 2026-06-24 / Codex
- Decision: Project historical Claude subagent messages conservatively into text and reasoning UI parts while keeping the raw SDK message in each provider-thread turn item.
  Rationale: Text and thinking blocks are stable and enough for right-panel reading. Raw transcript items preserve diagnostics for future richer tool rendering without inventing a new Cradle tool projection.
  Date/Author: 2026-06-24 / Codex

## Outcomes & Retrospective

Implemented and validated. Claude Agent now supports Chat Runtime provider-thread list/read/turns for SDK subagent transcripts. The historical desktop session that previously hit `chat_provider_threads_not_supported` can now enumerate the three subagent transcripts and read message parts through a `call_...` alias. Remaining improvement opportunity: if the live SDK stream later exposes the child `agentId` at crew-call time, the crew snapshot can store that real ID directly, but this is no longer required for the Browser Panel to read completed subagent output.

## Context and Orientation

The relevant server owner is `apps/server/src/modules/chat-runtime`. A "provider thread" is Chat Runtime's runtime-neutral representation of a provider-owned child thread or subagent transcript. Codex backs provider threads with Codex app-server `thread/list` and `thread/turns/list`. Claude Agent backs subagents with SDK transcript files stored under the Cradle-owned Claude config directory.

The Claude Agent provider is implemented in `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts`. It already streams live messages with `forwardSubagentText: true` from `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts`, so live subagent text reaches Cradle during a run. The persistent right-panel read path is missing: `ClaudeAgentProvider` does not implement `listProviderThreads`, `readProviderThread`, or `listProviderThreadTurns`.

The right runtime panel is `apps/web/src/features/chat/runtime/runtime-session-panel.tsx`. It reads `RuntimeCrewUiSlotState`, builds subagent rows, and calls `openSubagentTab()` with `agent.threadId`. The Browser Panel detail is `apps/web/src/features/browser/subagent-output-panel.tsx`; it reads provider-thread metadata and turns from server routes.

The SDK functions to use are `listSubagents(parentProviderSessionId, { dir })` and `getSubagentMessages(parentProviderSessionId, agentId, { dir, limit, offset })` from `@anthropic-ai/claude-agent-sdk`. `parentProviderSessionId` is `runtimeSession.providerSessionId`. The `dir` option must be the Claude runtime working directory, resolved from Cradle's workspace and agent context via `resolveClaudeAgentRuntimeContext()`.

## Plan of Work

First, add imports and helper types in `provider.ts` so the Claude Agent provider can list subagent transcript IDs and read transcript messages. Create projection helpers that convert SDK `SessionMessage` values into Chat Runtime `ProviderThreadTurn` and AI SDK `UIMessage` values. Keep the projection conservative: text and thinking blocks become assistant message parts, user text becomes user message text, and raw tool blocks remain in turn `items` for diagnostic fidelity.

Second, implement `listProviderThreads`, `readProviderThread`, and `listProviderThreadTurns` on `ClaudeAgentProvider`. The `threadId` for Claude provider threads is the SDK subagent `agentId`, not the parent `call_...` tool-call ID. Each listed thread should include a preview and `threadSource` that records the parent tool-use ID when it can be read from transcript messages.

Third, adjust Claude crew projection so completed agent rows remain visible after streaming and preserve labels by not overwriting existing non-null crew call fields with null completion fields. The current live snapshot still stores `call_...` as the row `threadId`; the provider-thread read path resolves that alias to the persisted SDK `agentId`.

Fourth, add focused tests in `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.test.ts` that mock `listSubagents` and `getSubagentMessages`, then assert provider-thread list/read/turns behavior. Existing tests in this file already mock the SDK and can be extended.

## Concrete Steps

Work from `/Users/wibus/dev/Cradle`.

1. Inspect the current dirty files before editing:

       git diff -- apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts apps/server/src/modules/chat-runtime-providers/claude-agent/provider.test.ts apps/web/src/features/chat/runtime/runtime-session-panel.tsx

   Expect existing unrelated Claude auth/usage changes to remain in place.

2. Edit `provider.ts` to import `listSubagents`, `getSubagentMessages`, and provider-thread contract types. Add methods to `ClaudeAgentProvider` and helper functions near the existing provider-thread related code.

3. Edit `state-projector.ts` to preserve existing crew-call fields during upsert and to make completed Claude Agent crew rows visible with labels. Edit Web runtime panel label helpers so the UI uses preview/message before falling back to a raw formatted ID.

4. Update or add tests in `provider.test.ts`.

5. Run focused tests and typecheck:

       pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/provider.test.ts src/modules/chat-runtime-providers/claude-agent/event-to-chunk-mapper.test.ts
       pnpm --filter @cradle/server typecheck

## Validation and Acceptance

The primary acceptance behavior is server-observable. For a Claude Agent session with a persisted provider session, `GET /chat/sessions/:sessionId/provider-threads` should return a non-empty `threads` array where `id` values are Claude agent IDs such as `a09d3e20830604ad2`, not `call_...`. `GET /provider-threads/:agentId/turns` should return `messages` suitable for `MessageBubble`.

The specific historical desktop session used during debugging is Cradle chat session `4698f68a-8857-43c9-8346-50426187af23`, whose provider session is `92839edc-17ee-4081-bba5-7ade6ead39b9`. In a running desktop server, the following command should produce Claude subagent threads instead of HTTP 501:

    curl -sS 'http://127.0.0.1:21423/chat/sessions/4698f68a-8857-43c9-8346-50426187af23/provider-threads?limit=20' | jq '.threads[].id'

Focused tests must pass. If full server typecheck fails due to unrelated dirty worktree changes, record the failing files and keep the focused tests passing.

Actual validation on 2026-06-24:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/provider.test.ts src/modules/chat-runtime-providers/claude-agent/event-to-chunk-mapper.test.ts
    -> Test Files 2 passed (2), Tests 51 passed (51)

    pnpm --filter @cradle/server typecheck
    -> tsc --noEmit completed successfully

    CRADLE_DATA_DIR='/Users/wibus/Library/Application Support/@cradle/desktop/data' pnpm --filter @cradle/server exec tsx --eval '<direct provider invocation>'
    -> listed a09d3e20830604ad2, ac25c19e25f9af72c, and ac0e8180cc7aef5fc; reading call_619efb5ce70d4f5f9c3868aa returned threadId a09d3e20830604ad2 with 29 messages.

## Idempotence and Recovery

All code changes are additive or local rewrites and can be reapplied safely. The implementation reads Claude SDK transcript files but does not write to Claude's namespace; Cradle only writes its own provider state snapshot. If a test mock conflicts with existing SDK mock setup, restore the mock to include all functions used by existing tests and rerun only the Claude Agent provider tests.

## Artifacts and Notes

Local SDK verification transcript:

    listSubagents('92839edc-17ee-4081-bba5-7ade6ead39b9', { dir: '/Users/wibus/dev/Cradle' })
    -> ["a09d3e20830604ad2", "ac0e8180cc7aef5fc", "ac25c19e25f9af72c"]

    getSubagentMessages(..., "a09d3e20830604ad2", { dir, limit: 2 })[0].parent_tool_use_id
    -> "call_619efb5ce70d4f5f9c3868aa"

## Interfaces and Dependencies

Use `@anthropic-ai/claude-agent-sdk` functions:

    listSubagents(sessionId: string, options?: { dir?: string }): Promise<string[]>
    getSubagentMessages(sessionId: string, agentId: string, options?: { dir?: string; limit?: number; offset?: number }): Promise<SessionMessage[]>

At the end of the change, `ClaudeAgentProvider` in `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` implements:

    listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult>
    readProviderThread(input: ProviderThreadReadInput): Promise<ProviderThreadReadResult>
    listProviderThreadTurns(input: ProviderThreadTurnsInput): Promise<ProviderThreadTurnsResult>

Revision note 2026-06-24 13:50 +08: Initial plan created before implementation to capture the SDK transcript-backed design and validation target.

Revision note 2026-06-24 16:02 +08: Updated after implementation to record server-side `call_...` alias resolution, completed crew row visibility, focused tests, typecheck, and real Desktop data validation.
