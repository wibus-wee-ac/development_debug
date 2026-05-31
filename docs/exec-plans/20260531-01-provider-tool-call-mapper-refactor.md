# Refactor Provider Tool Call Mapping

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`: it is self-contained, keeps progress and decisions current, and defines observable validation for the finished behavior.

## Purpose / Big Picture

Cradle streams tool calls from several runtimes, including Claude Agent SDK and Codex app-server. Today each provider mapper directly decides the user-visible tool name, input payload, output payload, and some tool-specific state such as `TodoWrite` progress. That makes it hard to evolve the tool model because provider protocol parsing and builtin tool identity are coupled in the same files.

After this refactor, provider protocol mappers still own provider event parsing, but their tool-call output is a stable Cradle builtin-tool envelope: `{ identifier, apiName, args, result }`. The AI SDK chunk still carries `toolName` for transport compatibility, but the real Cradle-owned identity lives in the builtin envelope stored in tool `input` and `output`. The outcome is visible through unchanged chat behavior: Claude Agent `TodoWrite` still persists todo progress, Codex command/file/MCP/web tool calls still render, and tests prove provider adapters now emit the stable builtin tool payload contract.

## Progress

- [x] (2026-05-31 15:42Z) Read Cradle chat-runtime provider mapper files, current UI tool consumption, and lobehub's `@lobechat/builtin-tool-claude-code` package structure.
- [x] (2026-05-31 15:42Z) Corrected the architectural goal: the core contract is provider adapters emitting stable builtin tool identity, not merely extracting helper functions.
- [x] (2026-05-31 16:05Z) Added the provider tool envelope under `chat-runtime-providers/tools` and provider-specific tool mappers under `claude-agent/tools` and `codex/tools`.
- [x] (2026-05-31 16:05Z) Made Claude Agent tool calls emit Claude Code builtin envelopes and preserve TodoWrite plugin state under `result.pluginState`.
- [x] (2026-05-31 16:05Z) Made Codex app-server tool calls emit Codex builtin envelopes.
- [x] (2026-05-31 16:05Z) Made Cradle's existing chat UI classifier and Codex transcript projector unwrap builtin envelopes so behavior is preserved.
- [x] (2026-05-31 16:05Z) Updated READMEs to reflect the ownership boundary.
- [x] (2026-05-31 16:05Z) Ran focused provider tests: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/mapper.test.ts src/modules/chat-runtime-providers/codex/provider.test.ts`, 2 files passed and 16 tests passed.
- [x] (2026-05-31 16:05Z) Ran server typecheck: `pnpm typecheck:server`, passed.
- [x] (2026-05-31 16:14Z) Ran focused web classifier test: `pnpm --filter @cradle/web exec vitest run src/features/chat/tool-ui-classifier.test.ts`, 1 file passed and 6 tests passed.
- [x] (2026-05-31 16:14Z) Ran web typecheck: `pnpm typecheck:apps-web`, blocked by pre-existing unrelated web/package typing errors outside the builtin envelope change.

## Surprises & Discoveries

- Observation: lobehub treats Claude Code as a builtin tool package rather than as incidental provider mapper logic. It has stable identifiers and API names in `packages/builtin-tool-claude-code/src/types.ts`, then separate Inspector, Render, Streaming, and Intervention registries under `src/client`.
  Evidence: `ClaudeCodeIdentifier = 'claude-code'`, `ClaudeCodeApiName` lists native names such as `Agent`, `Bash`, `Read`, `TodoWrite`, and client registries map those API names to components.
- Observation: Cradle already has a stable internal transport boundary: providers emit AI SDK `UIMessageChunk` events, and `apps/server/src/modules/chat-runtime/service.ts` projects those into stored `UIMessage.parts`.
  Evidence: provider mapper files emit `tool-input-start`, `tool-input-available`, `tool-output-available`, and `tool-output-error`; chat runtime consumes exactly those events.
- Observation: The current worktree already had uncommitted changes in chat runtime and Codex provider files before this refactor began.
  Evidence: `git status --short` showed modified `apps/server/src/modules/chat-runtime-providers/codex/provider.ts`, `apps/server/src/modules/chat-runtime/service.ts`, and related web files.
- Observation: Codex app-server `item/completed` notifications may omit the original started-item arguments.
  Evidence: The focused Codex streaming test completed a `commandExecution` item with no `command`, so the result envelope initially had `args.command = ""` until `app-server-mapper.ts` cached started-item args by tool id.
- Observation: `pnpm typecheck:apps-web` is not currently a clean validation signal for this change.
  Evidence: It failed in unrelated files such as `src/features/agent-management/agent-list.tsx`, `src/features/workspace-detail/workspace-detail-page.tsx`, `src/tabs/chat.tab.tsx`, and `../../packages/streamdown/src/plugins/remark-incomplete.ts` before touching the builtin envelope classifier path.

## Decision Log

- Decision: Do not rewrite the frontend tool rendering registry in this first milestone.
  Rationale: The stable server boundary is AI SDK `UIMessageChunk`. Moving server-side tool semantics first reduces risk and lets later UI work consume a cleaner tool identity model without changing streaming behavior at the same time.
  Date/Author: 2026-05-31 / Codex
- Decision: Put the shared envelope under `apps/server/src/modules/chat-runtime-providers/tools`, and put provider-specific tool identity/mappers under each provider's own `tools/` directory.
  Rationale: The envelope is Cradle-owned and shared by all chat runtime providers, while Claude Code and Codex semantics should be maintained next to the provider protocols they adapt. This follows Cradle's existing module structure without forcing maintainers to cross unrelated modules.
  Date/Author: 2026-05-31 / Codex
- Decision: Keep AI SDK `toolName` as a compatibility field, but treat `input.identifier` and `input.apiName` as the canonical Cradle identity.
  Rationale: AI SDK chunks require `toolName`, and existing renderer code still reads it. The architectural seam should nevertheless move to `{ identifier, apiName, args, result }` so later UI registries can stop classifying by strings.
  Date/Author: 2026-05-31 / Codex

## Outcomes & Retrospective

This section will be updated after validation. The expected outcome is a passing focused server test suite with no user-visible chat regression and a clearer owner for provider tool-call mapping.

2026-05-31: The first milestone is implemented. Provider adapters now emit builtin tool envelopes for Claude Code and Codex while existing renderer classification and Codex history reconstruction unwrap the envelope for compatibility. Focused provider tests pass.

2026-05-31: Server typecheck and focused web classifier tests pass. Full web typecheck remains blocked by unrelated existing typing errors in agent management, workspace, tabs, and streamdown modules.

## Context and Orientation

The server chat runtime lives in `apps/server/src/modules/chat-runtime`. It owns HTTP routes, run lifecycle, database writes, and AI SDK `UIMessageChunk` SSE streaming. Concrete provider adapters live in `apps/server/src/modules/chat-runtime-providers`.

The term "provider protocol mapper" means code that reads raw provider events, such as Claude Agent SDK messages or Codex app-server JSON-RPC notifications, and emits AI SDK `UIMessageChunk` events. The current Claude mapper is `apps/server/src/modules/chat-runtime-providers/claude-agent/mapper.ts`. The current Codex mapper is `apps/server/src/modules/chat-runtime-providers/codex/app-server-mapper.ts`.

The term "builtin tool envelope" means the Cradle-owned shape stored on tool input and output payloads. Input payloads use `{ type: 'cradle.builtin-tool-call.input.v1', identifier, apiName, args }`. Output payloads use `{ type: 'cradle.builtin-tool-call.result.v1', identifier, apiName, args, result }`. Provider adapters are allowed to know enough provider-specific details to fill this envelope, but downstream code should not need to guess the tool family from provider names.

Lobehub's architecture is the reference style. In `/Users/wibus/dev/lobehub/packages/builtin-tool-claude-code`, Claude Code has its own package with canonical tool names in `src/types.ts`, then client registries for inspectors, renders, streaming views, and interventions. Cradle should learn from the ownership shape, but the first milestone should adapt it to Cradle's current server boundary instead of copying lobehub's package layout wholesale.

## Plan of Work

Create `apps/server/src/modules/chat-runtime-providers/tools`. Add a `README.md` explaining that this namespace owns Cradle's shared provider tool envelope contract. Add `tool-call-payload.ts` for the shared input/result envelope and helpers that wrap and unwrap payloads.

Add `apps/server/src/modules/chat-runtime-providers/claude-agent/tools` for the Claude Code identifier (`claude-code`), canonical Claude Code API names, TodoWrite projection, and helpers to create input/result envelopes. Claude Agent protocol mapping should emit `tool-input-available.input` as a Claude Code input envelope. When a `tool_result` arrives, it should emit `tool-output-available.output` as a Claude Code result envelope and preserve `TodoWrite` plugin state inside `result.pluginState`.

Add `apps/server/src/modules/chat-runtime-providers/codex/tools` for the Codex identifier (`codex`) and API names such as `command_execution`, `file_change`, `web_search`, and `plan`. Codex app-server protocol mapping should emit Codex envelopes for input and output.

Make current consumers envelope-aware without a full frontend registry rewrite. `apps/web/src/features/chat/tool-ui-classifier.ts` should unwrap builtin input envelopes to `args` and output envelopes to `result` before classifying. `apps/server/src/modules/chat-runtime-providers/codex/transcript-projector.ts` should send envelope `apiName` as the function-call name, `args` as function-call arguments, and `result` as function-call output when reconstructing history.

Run focused validation from `/Users/wibus/dev/Cradle`: `pnpm --filter @cradle/server vitest run src/modules/chat-runtime-providers/claude-agent/mapper.test.ts src/modules/chat-runtime-providers/codex/provider.test.ts` and `pnpm typecheck:server`. If typecheck fails from unrelated existing work, capture the exact failing files and still report the focused test result.

## Concrete Steps

From `/Users/wibus/dev/Cradle`, create the shared `chat-runtime-providers/tools` envelope namespace and provider-local `tools/` mapper namespaces, then edit the Claude and Codex mappers to wrap provider-native tool records into envelopes. The changes are idempotent: rerunning tests or typecheck does not mutate source files.

Expected focused test command:

    pnpm --filter @cradle/server vitest run src/modules/chat-runtime-providers/claude-agent/mapper.test.ts src/modules/chat-runtime-providers/codex/provider.test.ts

Expected result is a successful Vitest run for those files. The exact test count may grow as this plan adds coverage.

Expected typecheck command:

    pnpm typecheck:server

Expected result is TypeScript success. If there are pre-existing unrelated errors, record them in this plan and in the final response.

## Validation and Acceptance

Acceptance is met when the focused tests pass and prove these behaviors:

Claude Agent `TodoWrite` emits a terminal `tool-output-available` chunk whose output is a builtin result envelope with `identifier: 'claude-code'`, `apiName: 'TodoWrite'`, and `result.pluginState.todos` using Cradle's shared statuses `todo`, `processing`, and `completed`.

Claude Agent subagent preliminary output throttling and terminal output preservation still pass, proving the new mapper layer did not disturb parent/child tool-call projection.

Codex provider tests still pass, proving Codex app-server item projection still produces the same `thread/inject_items` transcript and tool streaming behavior expected by the existing provider adapter.

The README files identify `chat-runtime-providers/tools` as the owner for the shared `{ identifier, apiName, args, result }` envelope and provider-local `tools/` directories as the owners for provider-specific tool semantics, so future work does not add new tool semantics back into raw event mappers.

## Idempotence and Recovery

The refactor is source-only and has no database migrations. If a test fails, inspect the generated chunks in the failing test and compare them with the pre-refactor expected payloads. The safest recovery path is to keep the new namespace but temporarily re-export the old helper functions from the old file path so imports can be migrated one provider at a time.

Because the worktree already contains unrelated uncommitted changes, do not run destructive git commands. Do not reset or checkout modified files. Only patch the files named in this plan, and if an unrelated modified file blocks typecheck, report it instead of reverting it.

## Artifacts and Notes

Important source references:

    apps/server/src/modules/chat-runtime-providers/claude-agent/mapper.ts
    apps/server/src/modules/chat-runtime-providers/claude-agent/tools/todo-plugin-state.ts
    apps/server/src/modules/chat-runtime-providers/codex/app-server-mapper.ts
    apps/server/src/modules/chat-runtime-providers/codex/app-server-tool-payload.ts
    apps/server/src/modules/chat-runtime/service.ts
    apps/web/src/features/chat/chat-tool-entities.ts
    apps/web/src/features/chat/chat-todo-projection.ts
    /Users/wibus/dev/lobehub/packages/builtin-tool-claude-code/src/types.ts
    /Users/wibus/dev/lobehub/packages/builtin-tool-claude-code/src/client/Inspector/index.ts
    /Users/wibus/dev/lobehub/packages/builtin-tool-claude-code/src/client/Render/index.ts
    /Users/wibus/dev/lobehub/packages/builtin-tool-claude-code/src/client/Streaming/index.ts

## Interfaces and Dependencies

In `apps/server/src/modules/chat-runtime-providers/tools/tool-call-payload.ts`, define provider-agnostic payload types:

    export interface BuiltinToolCallInputPayload { type: 'cradle.builtin-tool-call.input.v1'; identifier: string; apiName: string; args: unknown }
    export interface BuiltinToolCallResultPayload { type: 'cradle.builtin-tool-call.result.v1'; identifier: string; apiName: string; args?: unknown; result: unknown }
    export function createBuiltinToolCallInputPayload(...)
    export function createBuiltinToolCallResultPayload(...)
    export function readBuiltinToolCallInputPayload(...)
    export function readBuiltinToolCallResultPayload(...)

In `apps/server/src/modules/chat-runtime-providers/claude-agent/tools/identity.ts` and `mapper.ts`, export:

    export const ClaudeCodeToolIdentifier = 'claude-code'
    export enum ClaudeCodeToolName { ... }
    export function createClaudeCodeToolInputPayload(...)
    export function createClaudeCodeToolResultPayload(...)

In `apps/server/src/modules/chat-runtime-providers/codex/tools/identity.ts` and `mapper.ts`, export:

    export interface CodexAppServerItem { ... }
    export function readCodexToolName(item: CodexAppServerItem): string
    export function buildCodexToolInput(item: CodexAppServerItem): BuiltinToolCallInputPayload
    export function buildCodexToolOutput(item: CodexAppServerItem, bufferedCommandOutput?: string, bufferedCommand?: string): BuiltinToolCallResultPayload
    export function readCodexToolError(item: CodexAppServerItem): string | null

Revision note, 2026-05-31: Initial ExecPlan created after reading Cradle mapper code, the chat runtime projection layer, and lobehub's Claude Code builtin package.

Revision note, 2026-05-31: Corrected the plan after user clarification. The core goal is now the lobehub-style builtin tool identity architecture: provider adapters map raw provider tool calls into stable `{ identifier, apiName, args, result }` envelopes.

Revision note, 2026-05-31: Updated progress and discoveries after implementing the first milestone and passing focused provider tests.

Revision note, 2026-05-31: Added server typecheck, focused web classifier validation, and the unrelated full-web typecheck blocker.

Revision note, 2026-05-31: Adjusted the file layout to the Cradle-native structure requested by the user: shared envelope in `chat-runtime-providers/tools`, Claude Code semantics in `claude-agent/tools`, and Codex semantics in `codex/tools`.
