# Chat Slash Command Registry

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not have a repo-local `PLANS.md`; this plan follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`, which requires a self-contained plan that a novice can execute from the current working tree.

## Purpose / Big Picture

Cradle needs a slash command experience that is close to Codex Desktop in shape but simpler in ownership. The research result is concrete: Codex Desktop does not receive a slash command list from `app-server`; its webview owns the command registry and calls app-server only for backing operations. Cradle should follow that boundary. The composer owns the visible command list, runtime providers may contribute runtime-native raw commands, and Cradle features may contribute UI commands only when Cradle already owns the backing behavior.

After this work, a user can open a chat session, type `/`, see a combined slash command panel, pick a runtime-native command such as a Claude Agent SDK command, and have the raw `/command arguments` text sent unchanged to the provider. Cradle-owned UI commands can be added through one typed registry without introducing a fake app-server command list or treating `/goal` as a special runtime concept.

## Progress

- [x] (2026-05-24 18:10Z) Read the ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.
- [x] (2026-05-24 18:10Z) Verified the Codex Desktop research result: slash command registry lives in the webview bundle, and `codex app-server` rejects `slashCommands/list` as an unknown request while accepting known methods such as `model/list` and `skills/list`.
- [x] (2026-05-24 18:10Z) Inspected Cradle's current chat slash command code in `apps/web/src/features/chat/composer.tsx`, `apps/web/src/features/chat/slash-command-panel.tsx`, `apps/web/src/features/chat/chat-capabilities.ts`, `apps/web/src/features/chat/chat-view.tsx`, `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`, `apps/server/src/modules/chat-runtime/service.ts`, and `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts`.
- [x] (2026-05-24 18:10Z) Created this ExecPlan to define a simple, feature-owned implementation path before code changes.
- [x] (2026-05-24 18:42Z) Implemented the web-owned slash command descriptor and merge layer in `apps/web/src/features/chat/chat-slash-commands.ts`.
- [x] (2026-05-24 18:42Z) Updated `SlashCommandPanel`, `Composer`, and `ChatView` to consume `ChatComposerSlashCommand` descriptors, preserve runtime raw slash passthrough, keep duplicate visible names selectable, and leave the Cradle UI command list empty until a backing UI action is registered.
- [x] (2026-05-24 18:42Z) Added focused tests for merge order, duplicate names, runtime raw send-through, leading-whitespace slash replacement, and UI-command callback dispatch.
- [x] (2026-05-24 18:42Z) Updated `apps/web/src/features/chat/README.md` to document runtime capability ownership, web-owned slash command descriptors, and panel rendering boundaries.
- [x] (2026-05-24 18:42Z) Ran focused validation commands:
      `pnpm --filter @cradle/web exec vitest run --environment jsdom src/features/chat/chat-slash-commands.test.ts src/features/chat/composer.test.tsx` passed with 2 files and 10 tests.
      `pnpm --filter @cradle/web exec tsc --noEmit --pretty false --project tsconfig.json` passed.
- [x] (2026-05-24 18:42Z) Completed reviewer subagent round 1 for architecture and ownership. Result: no architecture blocker; noted that `onSlashCommandAction` only needs `ChatView` wiring when Cradle registers a non-empty UI command list.
- [x] (2026-05-24 18:44Z) Tightened slash detection to allow leading spaces and tabs without allowing newline-prefixed commands, then reran focused validation:
      `pnpm --filter @cradle/web exec vitest run --environment jsdom src/features/chat/chat-slash-commands.test.ts src/features/chat/composer.test.tsx` passed with 2 files and 11 tests.
      `pnpm --filter @cradle/web exec tsc --noEmit --pretty false --project tsconfig.json` passed.
- [x] (2026-05-24 18:50Z) Completed reviewer subagent round 2 for Codex-like UX behavior and fixed findings:
      no-result slash panels no longer invisibly intercept Enter, Cradle UI commands are hidden unless an action handler is present, UI commands no longer modify the textarea unless the callback explicitly returns inserted text, and duplicate-name source labels are not repeated in subtitles.
      Reran `pnpm --filter @cradle/web exec vitest run --environment jsdom src/features/chat/chat-slash-commands.test.ts src/features/chat/composer.test.tsx`; it passed with 2 files and 14 tests.
      Reran `pnpm --filter @cradle/web exec tsc --noEmit --pretty false --project tsconfig.json`; it passed.
- [x] (2026-05-24 19:00Z) Completed reviewer subagent round 3 for tests, types, and regression risk. Fixed the reported medium-risk issues by deriving slash panel results synchronously in `Composer`, adding immediate Enter regression tests, and preventing delayed UI action insertions from overwriting later user edits. Also added textarea/listbox active-option accessibility wiring.
- [x] (2026-05-24 19:00Z) Ran final validation commands after all reviewer rounds:
      `pnpm --filter @cradle/web exec vitest run --environment jsdom src/features/chat/chat-slash-commands.test.ts src/features/chat/composer.test.tsx` passed with 2 files and 18 tests.
      `pnpm --filter @cradle/web exec tsc --noEmit --pretty false --project tsconfig.json` passed.
      `git diff --check` passed.
      `rg -n "slashCommands/list|commands/list|command/list" apps packages --glob '!**/*.test.ts' --glob '!**/*.test.tsx'` returned no matches, confirming no app/server slash command list API was added.

## Surprises & Discoveries

- Observation: Codex Desktop's slash command list is a webview registry, not an app-server method.
  Evidence: The extracted bundle at `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-asar-extracted/webview/assets/local-remote-selection-BW4jGi0B.js` contains `var V=f([])` as the command list atom and `function W(e)` as the registration function, exported as `V as i` and `W as c`. The composer bundle imports those exports as `Ci` and `xi` and calls `xi({...})` for commands such as `chat`, `compact`, `fork`, `goal`, `model`, and `side`.
- Observation: Codex `app-server` does not expose `slashCommands/list`, `commands/list`, `command/list`, or `supportedCommands`.
  Evidence: A newline-delimited stdio probe successfully called `initialize`, `model/list`, and `skills/list`; the same probe received `Invalid request: unknown variant slashCommands/list` for `slashCommands/list`.
- Observation: Cradle already has a runtime capability surface for slash commands.
  Evidence: `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` defines `RuntimeSlashCommand` and `ChatRuntimeCapabilities`; `apps/server/src/modules/chat-runtime/index.ts` exposes `GET /chat/sessions/:sessionId/capabilities`; `apps/web/src/features/chat/chat-view.tsx` passes `runtimeCapabilities?.slashCommands ?? []` into `Composer`.
- Observation: The current Cradle composer can display runtime-native commands and send raw slash text unchanged, but the visible list is only runtime-provided.
  Evidence: `apps/web/src/features/chat/composer.tsx` inserts `/${command.name} ` on selection, keeps inline argument hints, and sends the trimmed textarea text through the ordinary `onSend` path.

## Decision Log

- Decision: Do not add a server-side slash command list API.
  Rationale: The authoritative Codex Desktop behavior keeps slash command list ownership in the UI. Cradle's app-server equivalent should expose business capabilities, not a second registry that mirrors UI actions and drifts from the composer.
  Date/Author: 2026-05-24 / Codex
- Decision: Keep `GET /chat/sessions/:sessionId/capabilities` for runtime-native provider commands.
  Rationale: Runtime providers such as Claude Agent SDK really do know their supported raw slash commands. That is different from Cradle UI commands. The current capability endpoint already captures this boundary cleanly.
  Date/Author: 2026-05-24 / Codex
- Decision: Add a small web-owned merge layer instead of a plugin-style command framework.
  Rationale: The immediate product need is a composer panel that combines Cradle UI commands and runtime-native raw commands. A typed merge function and a command descriptor are enough; a lifecycle registry, dependency injection container, or server registry would add migration cost without solving a current problem.
  Date/Author: 2026-05-24 / Codex
- Decision: Do not treat `/goal` specially.
  Rationale: A goal command is just one possible Cradle UI command if Cradle owns goal state, or one possible runtime-native raw command if a provider reports it. The command pipeline should route by descriptor source and action, not by hard-coded command names.
  Date/Author: 2026-05-24 / Codex

## Outcomes & Retrospective

Current outcome as of 2026-05-24 19:00Z: the implementation is complete for this slice. Cradle now has one feature-owned web module for command descriptors and merging, while preserving the existing provider capability endpoint. Runtime-native commands are converted into `insertText` actions and sent unchanged through the normal chat path. Cradle UI commands are represented by the same descriptor type with `uiAction`, hidden unless a handler is present, and may explicitly return inserted text without silently clearing the composer. No Cradle UI command is registered yet because no backing chat composer action has been selected for this slice.

## Context and Orientation

Cradle's chat UI lives under `apps/web/src/features/chat`. A chat session page renders `ChatView` from `apps/web/src/features/chat/chat-view.tsx`. `ChatView` loads runtime capabilities through `getChatRuntimeCapabilities` from `apps/web/src/features/chat/chat-capabilities.ts`, then passes the resulting `slashCommands` to `Composer` in `apps/web/src/features/chat/composer.tsx`. `Composer` owns the textarea, detects a leading `/`, opens `SlashCommandPanel`, inserts `/${command.name} ` when a command is selected, and sends the final text with normal chat submission.

The server side lives under `apps/server/src/modules/chat-runtime`. `apps/server/src/modules/chat-runtime/index.ts` exposes `GET /chat/sessions/:sessionId/capabilities`. `apps/server/src/modules/chat-runtime/service.ts` resolves the active runtime session and calls `runtime.getCapabilities` when the provider implements it. `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` calls Claude Agent SDK `supportedCommands()` and maps each SDK command to `RuntimeSlashCommand`.

In this plan, a runtime-native command means a command provided by the active chat runtime, such as a Claude Agent SDK slash command. Cradle should not execute it locally. It should insert raw slash text and send it unchanged to the runtime.

In this plan, a Cradle UI command means a command owned by the web UI or another Cradle feature, such as opening an existing model picker. Cradle should execute it locally through a typed UI action. A Cradle UI command should only be registered when the backing UI behavior already exists or is implemented in the same slice. Do not add placeholder commands that show in the panel but do nothing.

## Plan of Work

First, introduce a web-owned command descriptor type in a new file `apps/web/src/features/chat/chat-slash-commands.ts`. This type should be distinct from the wire type in `chat-capabilities.ts`. The wire type describes only server-returned runtime capabilities. The UI type should include an `id`, `name`, `description`, `argumentHint`, optional `aliases`, a `source` value of `runtime` or `cradle`, and an `action` value. The two initial actions are `insertText` for runtime-native commands and `uiAction` for Cradle-owned commands.

Second, add a pure merge function in the same file. It should accept runtime commands from `ChatRuntimeCapabilities` and a list of Cradle command descriptors. It should return a stable array for the composer panel. Runtime commands should be converted to `source: runtime` and `action: insertText` with an inserted prefix of `/${name} `. Cradle commands should keep their own action. The function must not mutate the input arrays.

Third, define a simple conflict rule. Command `id` is unique and is used as the React key. Command `name` is display text and may duplicate across sources. If a Cradle UI command and a runtime command have the same `name`, show both rows with their source-specific subtitle; selecting the runtime row inserts raw text, while selecting the Cradle row runs the UI action. This avoids hiding provider-native commands and avoids special-casing names such as `goal`.

Fourth, update `apps/web/src/features/chat/slash-command-panel.tsx` to render the UI command descriptor rather than the server wire type. Keep the visual design almost unchanged. Add a small source label only when duplicate visible names exist or when it is needed to disambiguate rows. The panel should keep fuzzy matching across `name`, `description`, `argumentHint`, `aliases`, and source label.

Fifth, update `apps/web/src/features/chat/composer.tsx` so it accepts UI command descriptors. Selection should switch on `command.action.kind`. For `insertText`, keep the current behavior: insert `/${command.name} ` and leave the cursor after the space. For `uiAction`, call an `onSlashCommandAction` callback passed from `ChatView` or `ChatComposerSection`, then close the panel without modifying the textarea unless the action explicitly returns inserted text. Keep Enter, Escape, and arrow behavior unchanged.

Sixth, wire the merge in `apps/web/src/features/chat/chat-view.tsx`. Build Cradle-owned commands close to the feature that owns the UI action. For the first implementation slice, do not invent goal, compact, memory, or model commands unless their backing UI action is already exposed as a callable callback. It is acceptable for the initial Cradle command list to be empty while the merge layer is added, because runtime-native commands remain visible and functional. The important implementation result is that adding a Cradle command later requires adding one descriptor and one callback, not changing server protocol.

Seventh, keep the server unchanged unless a provider capability bug is found. `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`, `model.ts`, `service.ts`, and the Claude Agent provider already express runtime-native command discovery. Do not add `slashCommands/list`, `commands/list`, or app-server compatibility routes.

Eighth, update tests. Extend `apps/web/src/features/chat/composer.test.tsx` to cover runtime command insertion, raw send-through, and a Cradle UI command that calls a callback without sending raw text. Add a small unit test file for `chat-slash-commands.ts` if the merge function has enough logic to justify direct tests. Existing Claude Agent provider tests should continue to verify `supportedCommands()` mapping.

Ninth, update `apps/web/src/features/chat/README.md` after implementation to explain that `chat-capabilities.ts` is runtime-native capability loading, `chat-slash-commands.ts` is the web-owned merge/descriptor layer, and `slash-command-panel.tsx` is rendering only.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

1. Inspect the current files before editing:

       sed -n '1,220p' apps/web/src/features/chat/chat-capabilities.ts
       sed -n '1,240p' apps/web/src/features/chat/slash-command-panel.tsx
       sed -n '1,580p' apps/web/src/features/chat/composer.tsx
       sed -n '300,630p' apps/web/src/features/chat/chat-view.tsx
       sed -n '1,140p' apps/server/src/modules/chat-runtime/index.ts

2. Add `apps/web/src/features/chat/chat-slash-commands.ts` with these exported shapes. The exact names may be adjusted during implementation, but the source/action separation must remain:

       export type ChatSlashCommandSource = 'runtime' | 'cradle'

       export type ChatSlashCommandAction =
         | { kind: 'insertText'; text: string }
         | { kind: 'uiAction'; actionId: string }

       export interface ChatComposerSlashCommand {
         id: string
         name: string
         description: string
         argumentHint: string
         aliases?: string[]
         source: ChatSlashCommandSource
         action: ChatSlashCommandAction
       }

       export function createRuntimeSlashCommand(command: ChatSlashCommand): ChatComposerSlashCommand
       export function mergeChatSlashCommands(input: {
         runtimeCommands: ChatSlashCommand[]
         cradleCommands: ChatComposerSlashCommand[]
       }): ChatComposerSlashCommand[]

3. Update `slash-command-panel.tsx` to import `ChatComposerSlashCommand` from `chat-slash-commands.ts`. Keep `Fzf`, keyboard handling, and row layout. Use `command.id` for stable keys. Keep duplicate names visible rather than deduplicating by `name`.

4. Update `composer.tsx` to accept `ChatComposerSlashCommand[]` as `slashCommands`. Preserve the current runtime behavior for `action.kind === 'insertText'`. Add an optional prop:

       onSlashCommandAction?: (command: ChatComposerSlashCommand) => void | Promise<void>

   Use it only for `action.kind === 'uiAction'`.

5. Update `chat-view.tsx` to call `mergeChatSlashCommands`. Pass `runtimeCapabilities?.slashCommands ?? []` as runtime commands. Pass an empty Cradle command list at first if no existing UI command callback is ready. This keeps the implementation honest: no visible command should be registered without behavior.

6. Add or update tests:

       pnpm --filter @cradle/web exec vitest run --environment jsdom src/features/chat/composer.test.tsx

   If a direct merge unit test is added:

       pnpm --filter @cradle/web exec vitest run --environment jsdom src/features/chat/chat-slash-commands.test.ts

7. Run type checking after focused tests:

       pnpm typecheck:apps-web

8. Update `apps/web/src/features/chat/README.md` after code changes. Mention the new file in the file inventory and state that Cradle does not fetch slash command lists from app-server.

## Validation and Acceptance

The implementation is accepted when these behaviors are true.

When a runtime returns a command such as `{ name: 'compact', description: 'Compact the conversation', argumentHint: '' }`, opening a chat and typing `/` shows `/compact` in the panel. Selecting it inserts `/compact ` into the textarea. Sending the message sends the raw text `/compact` or `/compact arguments` through the normal chat response path without client-side interpretation.

When two commands have the same visible `name` but different `id` or source, both rows are visible in the panel and can be selected independently. The runtime row inserts raw slash text. The Cradle row calls `onSlashCommandAction`. This proves the design does not hide provider-native commands and does not special-case `/goal`.

When no runtime provides commands and no Cradle command is registered, typing `/` should not show a broken empty panel. Existing ordinary chat input, file mentions, attachments, send, stop, and busy-session queue behavior should continue to work.

The focused web test command passes:

       pnpm --filter @cradle/web exec vitest run --environment jsdom src/features/chat/composer.test.tsx

If a merge unit test is added, it passes:

       pnpm --filter @cradle/web exec vitest run --environment jsdom src/features/chat/chat-slash-commands.test.ts

The web typecheck passes:

       pnpm typecheck:apps-web

## Idempotence and Recovery

All changes are normal source edits and can be inspected with `git diff`. Do not use `git reset --hard` or checkout files to recover, because the worktree may contain unrelated user changes.

The merge function must be pure. Running it repeatedly with the same runtime and Cradle command arrays should produce equivalent output without modifying either input array. Runtime capability fetches should remain owned by React Query in `chat-view.tsx`; no new global mutable registry should be introduced.

If a planned Cradle UI command lacks a callable backing behavior, leave it unregistered and document the missing backing action in this plan. A missing command is better than a visible command that silently does nothing.

If tests fail in files unrelated to chat slash commands, record the exact failure in `Surprises & Discoveries` and run the focused chat tests to separate local regressions from pre-existing failures.

## Artifacts and Notes

Codex app-server stdio probe evidence from the research phase:

       initialize -> result keys: userAgent, codexHome, platformFamily, platformOs
       slashCommands/list -> error code -32600, unknown variant slashCommands/list
       model/list -> result keys: data, nextCursor
       skills/list -> result keys: data

Current Cradle server method surface relevant to this plan:

       GET /chat/sessions/:sessionId/capabilities

Current Cradle runtime capability wire shape:

       interface RuntimeSlashCommand {
         name: string
         description: string
         argumentHint: string
         aliases?: string[]
       }

Revision note, 2026-05-24 18:10Z: Initial plan created after verifying Codex Desktop app-server does not provide a slash command list and after inspecting Cradle's existing chat capability, composer, and slash panel code.

Revision note, 2026-05-24 18:42Z: Updated after implementing the descriptor/merge layer, focused tests, chat README documentation, and first reviewer subagent round.

## Interfaces and Dependencies

Use React, TypeScript, React Query, `fzf`, and the existing `cn` helper from `~/lib/cn`. Do not add a new state management library, command bus, plugin lifecycle system, or server route for slash command list discovery.

`apps/web/src/features/chat/chat-capabilities.ts` remains the wire boundary for server-returned runtime capabilities. Its `ChatSlashCommand` type should continue to represent only data returned by `GET /chat/sessions/:sessionId/capabilities`.

`apps/web/src/features/chat/chat-slash-commands.ts` should own these UI-facing exports:

       export type ChatSlashCommandSource = 'runtime' | 'cradle'

       export type ChatSlashCommandAction =
         | { kind: 'insertText'; text: string }
         | { kind: 'uiAction'; actionId: string }

       export interface ChatComposerSlashCommand {
         id: string
         name: string
         description: string
         argumentHint: string
         aliases?: string[]
         source: ChatSlashCommandSource
         action: ChatSlashCommandAction
       }

       export function createRuntimeSlashCommand(command: ChatSlashCommand): ChatComposerSlashCommand

       export function mergeChatSlashCommands(input: {
         runtimeCommands: ChatSlashCommand[]
         cradleCommands: ChatComposerSlashCommand[]
       }): ChatComposerSlashCommand[]

`apps/web/src/features/chat/composer.tsx` should accept `ChatComposerSlashCommand[]` and optional `onSlashCommandAction`. It should not import server model types directly.

`apps/server/src/modules/chat-runtime` should remain unchanged unless existing capability mapping has a defect. Runtime providers may implement `getCapabilities`; the web composer consumes those capabilities as raw runtime commands.
