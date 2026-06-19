# Normalize Chat Tool Identity Before UI Rendering

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a contributor who has only this repository and this file should be able to understand and complete the refactor.

## Purpose / Big Picture

Cradle chat currently receives provider tool calls that already contain a canonical tool identity such as `identifier: "claude-code"` and `apiName: "Bash"`, but the web UI still re-classifies the tool by inspecting arbitrary argument fields like `description`, `name`, and `subagent_type`. This caused a real Claude Code `Bash` call in session `fc64bd5e-ffd4-485a-8a61-57c3746638d2` to render as a Bot/Subagent because the `Bash` arguments included `description: "Show working tree status"`.

After this refactor, Cradle will render tool calls according to canonical identity owned by provider adapters. A Claude Code `Bash` call will render as a terminal command even when its arguments contain a description. A Claude Code `Agent` call will render as a subagent because its `apiName` is `Agent`, not because the UI guessed from its payload. This is a breaking cleanup: raw tool calls without Cradle's canonical envelope should fall back to generic rendering rather than being guessed into terminal, subagent, file, web, or search categories.

## Progress

- [x] (2026-06-19T01:01:40Z) Read the ExecPlan rules and confirmed non-negotiables: the plan must be self-contained, living, novice-friendly, concrete about commands and files, and independently verifiable.
- [x] (2026-06-19T01:01:40Z) Researched the current Cradle UI tool classification path and the LobeHub reference design.
- [x] (2026-06-19T01:01:40Z) Confirmed session `fc64bd5e-ffd4-485a-8a61-57c3746638d2` contains 54 tool parts: 45 `tool-Bash` and 9 `tool-TodoWrite`, all with Cradle built-in tool envelopes.
- [x] (2026-06-19T01:09:10Z) Refactored web tool identity reading into canonical helpers in `apps/web/src/features/chat/rendering/chat-tool-entities.ts`, and updated `chat-render-plan.ts` to reuse those helpers.
- [x] (2026-06-19T01:09:10Z) Changed `describeToolCall` so canonical envelopes drive `ToolUiKind` through exact `identifier/apiName` rules.
- [x] (2026-06-19T01:09:10Z) Removed the `description` fallback from `subagentName`; canonical tools no longer classify from payload fields, while payload fields remain available for display details such as titles and targets.
- [x] (2026-06-19T01:09:10Z) Added focused pure function coverage proving `claude-code/Bash` with a `description` is terminal, `claude-code/Agent` is subagent, and raw non-envelope payloads remain generic.
- [x] (2026-06-19T01:09:10Z) Added Claude adapter envelope normalization in `apps/server/src/modules/chat-runtime-providers/claude-agent/tools/mapper.ts` so provider aliases such as `bash` and `read_file` are written as canonical `Bash` and `Read`.
- [x] (2026-06-19T01:09:10Z) Removed the exported `classifyToolKind` heuristic behavior by reducing it to `generic`; old private heuristic helpers were deleted so future rendering code cannot accidentally route through payload-field matching.
- [x] (2026-06-19T01:09:10Z) Ran focused web tests, Claude provider tests, web typecheck, server typecheck, and targeted ESLint successfully for the core files changed by this refactor.
- [x] (2026-06-19T01:27:56Z) Removed the remaining `TOOL_TYPE_PREFIX_PATTERN` fallback from chat rendering. Raw `tool-*` part types now remain raw display labels such as `tool-Bash`; canonical names only come from the Cradle envelope or explicit `toolName`.
- [x] (2026-06-19T01:27:56Z) Re-ran focused web tests, web typecheck, and targeted ESLint after removing the `tool-` stripping fallback.

## Surprises & Discoveries

- Observation: Cradle already has a backend-owned built-in tool envelope that contains canonical identity.
  Evidence: `apps/server/src/modules/chat-runtime-providers/tools/tool-call-payload.ts` defines `BuiltinToolCallInputPayload` and `BuiltinToolCallResultPayload` with `identifier`, `apiName`, `args`, and `result`.

- Observation: The specific bad session is not internally a subagent. It stores `tool-Bash` parts with `input.identifier = "claude-code"` and `input.apiName = "Bash"`.
  Evidence: `cradle chat messages fc64bd5e-ffd4-485a-8a61-57c3746638d2 --format json` shows `input: { type: "cradle.builtin-tool-call.input.v1", identifier: "claude-code", apiName: "Bash", args: { command: "git status", description: "Show working tree status" } }`.

- Observation: LobeHub's normalization model is not UI fuzzy matching. It encodes tool names from `identifier + apiName + type`, then resolves model tool calls back into `ChatToolPayload { identifier, apiName, id, arguments, type }`.
  Evidence: `/Users/wibus/dev/lobehub/packages/context-engine/src/engine/tools/ToolNameResolver.ts` has `generate(identifier, name, type)` and `resolve(toolCalls, manifests, offeredToolNames)`. `/Users/wibus/dev/lobehub/packages/types/src/message/common/tools.ts` defines `ChatToolPayload`.

- Observation: The Cradle frontend README mentions a `tool-ui-classifier.test.ts`, but that file is not present in the current working tree.
  Evidence: `rg --files apps/web/src | rg 'tool-ui-classifier|tool-call-block|chat-render-plan|rendering.*test|\\.test\\.tsx?$'` only found `tool-ui-classifier.ts`, `chat-render-plan.ts`, and rendering block components, not the referenced test file.

- Observation: Some Claude provider tests used raw provider names such as `bash` and `read_file`, which means backend envelope normalization was incomplete even though real stored session data already showed canonical `Bash`.
  Evidence: `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.test.ts` expected `apiName: 'bash'` and `apiName: 'read_file'` before this refactor.

- Observation: Running ESLint on `chat-render-plan.ts` as a whole reports many pre-existing style errors unrelated to this refactor.
  Evidence: `pnpm exec eslint apps/web/src/features/chat/rendering/chat-render-plan.ts` reports import sorting, member delimiter, operator linebreak, brace style, comma dangle, and arrow paren errors throughout the file. Targeted ESLint on the core changed files excluding that existing-noisy file passes.

- Observation: A remaining `TOOL_TYPE_PREFIX_PATTERN = /^tool-/` fallback still let raw AI SDK part types display as semantic-looking names such as `Bash`.
  Evidence: `chat-tool-entities.ts` used `part.type.replace(TOOL_TYPE_PREFIX_PATTERN, '')`, and `tool-ui-classifier.ts` used the same fallback before this revision.

## Decision Log

- Decision: Canonical Cradle built-in tool envelopes are the authoritative UI classification input. When a tool part contains `cradle.builtin-tool-call.input.v1` or `cradle.builtin-tool-call.result.v1`, the UI must classify using `identifier` and `apiName` only.
  Rationale: Provider adapters own tool semantics and already emit normalized identity. Letting the UI infer kind from arbitrary arguments duplicates ownership and caused `Bash` to render as `subagent`.
  Date/Author: 2026-06-19 / Codex

- Decision: Argument and result payload fields remain usable for display details but not for deciding `ToolUiKind` for canonical tools.
  Rationale: A `Bash` description is useful as a row title, but it is not a tool identity signal. A field named `description` appears in multiple unrelated tool schemas.
  Date/Author: 2026-06-19 / Codex

- Decision: Raw tool parts without Cradle's canonical envelope should default to generic rendering unless they are handled by a narrow existing runtime approval path.
  Rationale: The user explicitly requested a breaking cleanup and rejected heuristic matching. Generic fallback is safer than silently assigning a false semantic identity.
  Date/Author: 2026-06-19 / Codex

- Decision: The first implementation milestone will remain frontend-scoped because the backend provider adapters already emit canonical envelope data for Claude Code and Codex tool calls.
  Rationale: The broken behavior is in the web classifier. Backend work may follow if dynamic Codex tool identities need stronger normalization, but this session's concrete failure is fixable by making the UI honor existing backend normalization.
  Date/Author: 2026-06-19 / Codex

- Decision: Claude adapter envelope creation now normalizes known provider aliases through `ClaudeCodeToolName` before writing `apiName`.
  Rationale: The user asked for backend normalization first. Real `Bash` data was already canonical in the inspected session, but tests showed lower-case and snake-case names could still enter the envelope. The adapter owns Claude Code tool identity, so it is the correct owner for this mapping.
  Date/Author: 2026-06-19 / Codex

- Decision: Keep existing payload readers for title, target, summary, terminal details, and todo projections, but detach them from canonical kind classification.
  Rationale: The UI still needs command text, file paths, todo arrays, and result summaries. The problem was using those fields to infer identity, not reading them for display after identity is known.
  Date/Author: 2026-06-19 / Codex

- Decision: Keep `classifyToolKind` exported for now but make it return `generic`.
  Rationale: Removing the export could create a wider API churn if latent imports exist in untyped or future code paths. Returning `generic` makes the old heuristic path inert while preserving the public symbol during this refactor.
  Date/Author: 2026-06-19 / Codex

- Decision: Do not strip `tool-` from raw AI SDK part types in rendering helpers.
  Rationale: `tool-` is an AI SDK structural prefix, not a Cradle tool identity. Removing it made raw tool parts look canonical even when no Cradle envelope existed. Canonical display names must come from `identifier/apiName` envelopes or an explicit `toolName`.
  Date/Author: 2026-06-19 / Codex

## Outcomes & Retrospective

Implemented the first full milestone. Web rendering now reads Cradle built-in tool envelope identity through `chat-tool-entities.ts`, and `describeToolCall` classifies canonical tools through exact `identifier/apiName` mappings. The known failure shape `claude-code/Bash` with `args.description` now returns `terminal`. `description` is no longer copied into `subagentName`, so a command description cannot turn a command into a subagent. Claude adapter envelope creation now normalizes known provider aliases such as `bash` and `read_file` to `Bash` and `Read`. The old exported payload-heuristic classifier now returns `generic`, the private heuristic helpers were removed, and raw `tool-*` part types are no longer stripped into semantic-looking labels.

Validation passed with focused web tests, the Claude provider test file, web typecheck, and server typecheck. One remaining architectural gap is Codex dynamic MCP or dynamic tool calls whose `apiName` can contain provider-specific variable names. This refactor intentionally leaves unknown canonical identities as `generic` rather than adding frontend heuristics. If richer rendering is required for those cases, the next step should be a provider-owned Codex identity normalization change, not frontend payload guessing.

## Context and Orientation

Cradle uses the AI SDK `UIMessage` format for chat messages. A `UIMessage` contains `parts`, and tool calls appear as parts whose `type` is either `dynamic-tool` or starts with `tool-`. A tool part has fields such as `toolCallId`, `state`, `input`, `output`, `argumentsText`, and sometimes `toolName`.

The backend provider adapters already wrap provider-native tool data in a Cradle-owned envelope. The envelope lives in `apps/server/src/modules/chat-runtime-providers/tools/tool-call-payload.ts`. The input envelope shape is:

    {
      type: "cradle.builtin-tool-call.input.v1",
      identifier: string,
      apiName: string,
      args: unknown
    }

The result envelope shape is:

    {
      type: "cradle.builtin-tool-call.result.v1",
      identifier: string,
      apiName: string,
      args?: unknown,
      result: unknown
    }

For Claude Code, `identifier` is `claude-code`, and tool names such as `Bash`, `Agent`, `TodoWrite`, `TaskCreate`, `TaskUpdate`, and `WebSearch` are canonical `apiName` values. The constants live in `apps/server/src/modules/chat-runtime-providers/claude-agent/tools/identity.ts`. `apps/server/src/modules/chat-runtime-providers/claude-agent/tools/mapper.ts` writes those values into the shared envelope. `apps/server/src/modules/chat-runtime-providers/claude-agent/event-to-chunk-mapper.ts` emits AI SDK chunks containing those envelopes.

The current web UI classification lives in `apps/web/src/features/chat/rendering/tool-ui-classifier.ts`. Its exported `describeToolCall(part)` returns a `ToolUiDescriptor` with `kind`, `toolName`, `displayName`, `title`, `target`, and `summary`. Consumers include:

- `apps/web/src/features/chat/rendering/message-bubble.tsx`, which renders tool rows in chat messages.
- `apps/web/src/features/chat/rendering/chat-render-plan.ts`, which groups consecutive tool calls by `ToolUiKind`.
- `apps/web/src/features/chat/rendering/blocks/tool-call-block.tsx`, which renders a single tool row.
- `apps/web/src/features/chat/rendering/blocks/grouped-tool-call-block.tsx`, which renders grouped tool rows.
- `apps/web/src/features/chat/runtime/runtime-session-panel.tsx`, which summarizes recent tool calls.
- `apps/web/src/features/chat/capabilities/chat-todo-projection.ts`, which reads todo payloads.
- `apps/web/src/features/chat/rendering/terminal-tool-details.ts`, which reads terminal output details.

The current bug is caused by `tool-ui-classifier.ts` creating `subagentName` from `value.name ?? value.subagent_type ?? value.description ?? value.team_name`. Then `classifyToolKind` checks `isSubagentTool` before `isTerminalTool`. Because `Bash` arguments include `description`, `Bash` becomes `subagent` before the later terminal check can run.

The LobeHub reference design is useful because it treats tool identity as a protocol field. LobeHub sends provider-safe tool names generated from `identifier + apiName + type`, resolves provider responses back to `ChatToolPayload`, and lets UI renderers key off the resolved payload. Cradle should follow the same ownership principle with its existing envelope rather than adding frontend fuzzy matching.

## Plan of Work

The first milestone is to centralize canonical tool identity reading on the web side. Add or extend helpers in `apps/web/src/features/chat/rendering/chat-tool-entities.ts` so the rest of the chat rendering code can read the Cradle built-in envelope consistently. The helper should return `identifier`, `apiName`, and the underlying `args` or `result` payload. It should not create a new persisted projection or new backend type; it only reads the existing envelope.

The second milestone is to refactor `apps/web/src/features/chat/rendering/tool-ui-classifier.ts`. `describeToolCall` should read canonical identity first. If canonical identity exists, it should classify through an exact `identifier/apiName` mapping. For `claude-code/Bash`, return `terminal`. For `claude-code/Agent`, return `subagent`. For `claude-code/TodoWrite`, `TaskCreate`, `TaskList`, and `TaskUpdate`, return `todo`. For `claude-code/TaskOutput`, `TaskStop`, and `TaskGet`, return `task-control`. For `claude-code/Read`, return `file-read`. For `claude-code/Edit` and `Write`, return `file-diff`. For `claude-code/Glob`, `Grep`, and `ToolSearch`, return `search`. For `claude-code/WebFetch` and `WebSearch`, return `web`. For `claude-code/askUserQuestion`, return `question`. For `claude-code/ExitPlanMode`, return `plan`. For `claude-code/plan_implementation`, return `plan-implementation`.

For `codex/command_execution`, return `terminal`. For `codex/file_change`, return `file-diff`. For Codex approval API names, map `approval.command_execution` to `terminal`, `approval.file_change` to `file-diff`, and leave other approval calls generic unless an existing UI flow requires a more specific exact mapping. For `codex/web_search`, return `web`. For `codex/plan`, return `plan`. For `codex/plan_implementation`, return `plan-implementation`. For `codex/collab_agent`, return `subagent`. Unknown `codex` api names should be generic.

Payload readers such as `readToolPayload`, `readToolInputPayload`, `readToolTitle`, `readToolTarget`, and `readToolSummary` should continue to extract display data from `args` and `result`. They must not decide canonical tool kind. The specific `description -> subagentName` fallback should be removed or made irrelevant to canonical classification. If the kind is already `subagent`, `readToolTarget` may use `description` as a display label; that is display logic, not classification.

The third milestone is to add focused pure function coverage. Create `apps/web/src/features/chat/rendering/tool-ui-classifier.test.ts` if it does not exist. Tests should call `describeToolCall` with small in-memory `RenderableToolPart` objects. The most important test should construct a `tool-Bash` part whose input is the Cradle envelope for `claude-code/Bash` with `args: { command: "git status", description: "Show working tree status" }`, then assert `descriptor.kind === "terminal"` and `descriptor.title === "Show working tree status"`. Another test should construct `claude-code/Agent` and assert `subagent`. A third test should construct a raw non-envelope `tool-Bash` with the same payload and assert `generic` if the final policy is to stop classifying raw tools.

The fourth milestone is validation. Run the focused test file, then run web typecheck. If a focused test command cannot target a single file due to Vitest configuration, run the full web test command. Record exact commands and outputs in this plan.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Create or update this plan:

    docs/exec-plans/20260619-01-tool-identity-normalization.md

Inspect the relevant files:

    sed -n '1,220p' apps/web/src/features/chat/rendering/chat-tool-entities.ts
    sed -n '1,1220p' apps/web/src/features/chat/rendering/tool-ui-classifier.ts
    sed -n '1,140p' apps/server/src/modules/chat-runtime-providers/tools/tool-call-payload.ts
    sed -n '1,80p' apps/server/src/modules/chat-runtime-providers/claude-agent/tools/identity.ts

After editing, run focused validation:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chat/rendering/tool-ui-classifier.test.ts

Actual result after the refactor:

    Test Files  1 passed (1)
    Tests  3 passed (3)

Run the Claude provider tests because the backend mapper now normalizes Claude tool aliases:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/provider.test.ts

Actual result:

    Test Files  1 passed (1)
    Tests  28 passed (28)

Then run typecheck:

    pnpm --filter @cradle/web exec tsc --noEmit

Actual result:

    no TypeScript errors

Also run server typecheck because `apps/server/src/modules/chat-runtime-providers/claude-agent/tools/mapper.ts` changed:

    pnpm --filter @cradle/server exec tsc --noEmit

Actual result:

    no TypeScript errors

Run targeted ESLint for the core changed files that do not have pre-existing unrelated style violations:

    pnpm exec eslint apps/web/src/features/chat/rendering/chat-tool-entities.ts apps/web/src/features/chat/rendering/tool-ui-classifier.ts apps/web/src/features/chat/rendering/tool-ui-classifier.test.ts apps/server/src/modules/chat-runtime-providers/claude-agent/tools/mapper.ts apps/server/src/modules/chat-runtime-providers/claude-agent/provider.test.ts

Actual result:

    no ESLint errors

## Validation and Acceptance

The primary acceptance behavior is observable from the existing session data. After implementation, constructing a `RenderableToolPart` matching the session's actual payload must produce a terminal descriptor:

    describeToolCall({
      type: "tool-Bash",
      toolCallId: "call_c80a238f8c3a4b2fa58e0fe1",
      state: "output-available",
      input: {
        type: "cradle.builtin-tool-call.input.v1",
        identifier: "claude-code",
        apiName: "Bash",
        args: {
          command: "git status",
          description: "Show working tree status"
        }
      }
    }).kind === "terminal"

A Claude Code subagent must be classified by identity:

    describeToolCall({
      type: "tool-Agent",
      toolCallId: "toolu_agent_1",
      state: "output-available",
      input: {
        type: "cradle.builtin-tool-call.input.v1",
        identifier: "claude-code",
        apiName: "Agent",
        args: {
          description: "Investigate the issue"
        }
      }
    }).kind === "subagent"

A raw tool without Cradle's envelope must not be promoted to a semantic type by argument fields alone:

    describeToolCall({
      type: "tool-Bash",
      toolCallId: "raw_1",
      state: "output-available",
      input: {
        command: "git status",
        description: "Show working tree status"
      }
    }).kind === "generic"

For manual verification, run:

    cradle chat messages fc64bd5e-ffd4-485a-8a61-57c3746638d2 --format json

The returned data should still show `identifier: "claude-code"` and `apiName: "Bash"` for the session's `tool-Bash` parts. This command validates the stored input shape; the unit tests validate the UI classification behavior.

## Idempotence and Recovery

This refactor is safe to retry. The plan file can be edited repeatedly as progress changes. The code changes are pure TypeScript refactors and tests; no database migration or destructive data operation is required. If a change breaks grouping or rendering, revert only the local changes made for this plan and keep unrelated worktree changes intact. Do not run destructive Git commands such as `git reset --hard`.

If focused tests fail because raw tools still need a specific exact runtime path, update the exact canonical identity mapping or narrow exception and record the decision here. Do not restore broad payload heuristics.

## Artifacts and Notes

Actual session summary from `cradle chat messages fc64bd5e-ffd4-485a-8a61-57c3746638d2 --format json`:

    {
      "count": 54,
      "byType": [
        { "type": "tool-Bash", "count": 45 },
        { "type": "tool-TodoWrite", "count": 9 }
      ],
      "firstTool": {
        "type": "tool-Bash",
        "toolCallId": "call_c80a238f8c3a4b2fa58e0fe1",
        "input": {
          "type": "cradle.builtin-tool-call.input.v1",
          "identifier": "claude-code",
          "apiName": "Bash",
          "args": {
            "command": "git status",
            "description": "Show working tree status"
          }
        },
        "output": {
          "type": "cradle.builtin-tool-call.result.v1",
          "identifier": "claude-code",
          "apiName": "Bash"
        }
      }
    }

Relevant LobeHub reference snippets:

    /Users/wibus/dev/lobehub/packages/types/src/message/common/tools.ts
    ChatToolPayload has apiName, arguments, id, identifier, source, thoughtSignature, and type.

    /Users/wibus/dev/lobehub/packages/context-engine/src/engine/tools/ToolNameResolver.ts
    generate(identifier, name, type) creates provider-safe names.
    resolve(toolCalls, manifests, offeredToolNames) returns canonical ChatToolPayload objects.

Validation transcripts from this implementation:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chat/rendering/tool-ui-classifier.test.ts
    Test Files  1 passed (1)
    Tests  3 passed (3)

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/provider.test.ts
    Test Files  1 passed (1)
    Tests  28 passed (28)

    pnpm --filter @cradle/web exec tsc --noEmit
    no TypeScript errors

    pnpm --filter @cradle/server exec tsc --noEmit
    no TypeScript errors

    pnpm exec eslint apps/web/src/features/chat/rendering/chat-tool-entities.ts apps/web/src/features/chat/rendering/tool-ui-classifier.ts apps/web/src/features/chat/rendering/tool-ui-classifier.test.ts apps/server/src/modules/chat-runtime-providers/claude-agent/tools/mapper.ts apps/server/src/modules/chat-runtime-providers/claude-agent/provider.test.ts
    no ESLint errors

Additional validation after removing the `tool-` stripping fallback:

    rg -n "TOOL_TYPE_PREFIX_PATTERN|replace\\(TOOL_TYPE_PREFIX_PATTERN" apps/web/src/features/chat -S
    no matches

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chat/rendering/tool-ui-classifier.test.ts
    Test Files  1 passed (1)
    Tests  3 passed (3)

    pnpm --filter @cradle/web exec tsc --noEmit
    no TypeScript errors

    pnpm exec eslint apps/web/src/features/chat/rendering/chat-tool-entities.ts apps/web/src/features/chat/rendering/tool-ui-classifier.ts apps/web/src/features/chat/rendering/tool-ui-classifier.test.ts
    no ESLint errors

## Interfaces and Dependencies

In `apps/web/src/features/chat/rendering/chat-tool-entities.ts`, define or expose helpers equivalent to:

    interface BuiltinToolCallInputPayload {
      type: "cradle.builtin-tool-call.input.v1"
      identifier: string
      apiName: string
      args: unknown
    }

    interface BuiltinToolCallResultPayload {
      type: "cradle.builtin-tool-call.result.v1"
      identifier: string
      apiName: string
      args?: unknown
      result: unknown
    }

    interface BuiltinToolCallIdentity {
      identifier: string
      apiName: string
    }

    function readBuiltinToolCallInputPayload(value: unknown): BuiltinToolCallInputPayload | null
    function readBuiltinToolCallResultPayload(value: unknown): BuiltinToolCallResultPayload | null
    function readBuiltinToolCallIdentity(input: unknown, output: unknown): BuiltinToolCallIdentity | null

In `apps/web/src/features/chat/rendering/tool-ui-classifier.ts`, keep the exported public interface:

    export function describeToolCall(part: RenderableToolPart): ToolUiDescriptor

The implementation of `describeToolCall` must prefer canonical identity:

    const builtinIdentity = readBuiltinToolCallIdentity(part.input, part.output)
    const kind = builtinIdentity
      ? classifyCanonicalToolKind(builtinIdentity)
      : "generic"

The exact function names can differ if the surrounding code reads better, but the ownership must not change: provider adapters and their canonical envelope own tool identity; frontend payload readers own display details only.

Revision note 2026-06-19T01:01:40Z: Initial plan created after researching LobeHub's normalization design and confirming Cradle's session data. The plan intentionally chooses a breaking frontend classification cleanup based on existing backend envelopes rather than adding compatibility heuristics.

Revision note 2026-06-19T01:09:10Z: Updated after implementation. Recorded completed frontend canonical classification, backend Claude alias normalization, focused tests, typechecks, targeted ESLint, removal of the old payload heuristic path, and the remaining Codex dynamic identity gap.

Revision note 2026-06-19T01:27:56Z: Removed the remaining `tool-` stripping fallback after review. Raw tool part display now preserves the raw AI SDK part type, and tests/typecheck/targeted ESLint were re-run.
