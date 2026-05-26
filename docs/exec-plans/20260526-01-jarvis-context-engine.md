# Build a best-in-class Jarvis context engine

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a future contributor should be able to continue from this file without reading the chat that created it.

## Purpose / Big Picture

After this work, Jarvis will understand what the user is actually paying attention to inside Cradle, not just which tab is active. A user will be able to scroll to an older chat message, peek an issue, focus a terminal or select text, ask Jarvis “what about this”, and receive an answer grounded in that specific active surface and entity. The system will also expose a trace of which context items were included or dropped, so context quality can be inspected instead of guessed.

This plan replaces the current one-shot `SystemAgentContext` snapshot with a feature-owned semantic context engine. The target architecture is inspired by modern IDE assistants such as VS Code Copilot and Cursor: context is assembled from implicit active state, explicit user references, workspace/code retrieval, conversation history, and tool outputs, all under a context budget.

## Progress

- [x] (2026-05-26 07:34Z) Audited the current renderer-side Jarvis Context implementation in `apps/web/src/features/system-agent/`.
- [x] (2026-05-26 07:34Z) Audited adjacent existing signals in Chat, Kanban, tabs-next scroll restoration, composer action context, and layout stores.
- [x] (2026-05-26 07:34Z) Reviewed modern assistant context patterns from VS Code Copilot, GitHub Copilot, and Cursor public documentation.
- [x] (2026-05-26 07:34Z) Created `docs/specs/jarvis-context-engine.md` as the product and architecture specification for this work.
- [x] (2026-05-26 07:34Z) Implemented the typed context item model, client-side context registry, legacy snapshot projection adapter, and registry unit tests under `apps/web/src/features/system-agent/`.
- [x] (2026-05-26 07:42Z) Ran focused system-agent tests for the new context registry and existing display redaction; 2 test files and 6 tests passed.
- [x] (2026-05-26 07:48Z) Replaced Jarvis send-time context collection with typed `ContextEnvelope` collection while preserving the legacy snapshot formatter as a migration fallback.
- [x] (2026-05-26 07:58Z) Added the Chat-owned semantic attention provider, wired ChatView viewport/focus signals into it, and added focused unit coverage for chat attention context publication.
- [x] (2026-05-26 08:07Z) Ran focused context tests for system-agent registry, formatter, display redaction, and chat attention; 4 test files and 9 tests passed.
- [x] (2026-05-26 08:20Z) Added the Kanban-owned semantic attention provider, wired `KanbanView` selected/open/peek/focus/hover/filter state into it, and validated the focused context suite; 5 test files and 10 tests passed.
- [x] (2026-05-26 08:30Z) Added the renderer-side explicit context attachment boundary, selected-text attachment command, Jarvis attachment chips, and explicit context unit coverage.
- [x] (2026-05-26 08:58Z) Removed the accidental DB/server transport direction: no chat runtime `contextEnvelope`, no context DB column, no generated migration, and no queue/run trace context persistence.
- [x] (2026-05-26 08:56Z) Re-ran the focused renderer context suite after removing DB/server transport; 6 test files and 12 tests passed.
- [ ] Add selected chat message explicit references.
- [ ] Add explicit reference capture for chat messages, issues, workspace files, and terminal output.
- [ ] Add renderer-side prompt assembly with budget management, source provenance, include/drop decisions, and `<cradle_context>` prompt-block formatting.
- [ ] Add retrieval orchestration for workspace files, issues, chat history, and Chronicle memory search.
- [ ] Add context trace observability for renderer prompt assembly in tests and a developer-facing inspection surface.
- [ ] Update affected directory READMEs and user/developer docs.
- [ ] Validate with unit, integration, and browser-level scenarios.

## Surprises & Discoveries

- Observation: The existing `SystemAgentContext` claims awareness of what the user is seeing and doing, but the schema only contains tab, chat summary, layout, active profile, and unread sessions.
  Evidence: `apps/web/src/features/system-agent/context-schema.ts` has no fields for focus, selection, viewport, visible entity, scroll intent, or explicit references.

- Observation: Chat already computes useful attention signals but keeps them local to rendering behavior.
  Evidence: `apps/web/src/features/chat/chat-view.tsx` tracks viewport offset, scroll height, viewport height, near-bottom state, minimap progress, and virtualizer scroll callbacks.

- Observation: Kanban already owns rich active entity state that is currently invisible to Jarvis.
  Evidence: `apps/web/src/features/kanban/index.tsx` keeps `selectedIssueIds`, `selectionAnchorId`, `peekIssueId`, `focusedIndex`, `hoveredIssueId`, and `visibleIssuesRef`.

- Observation: `tabs-next` scroll restoration is useful for UI persistence but should not become the Jarvis semantic context API.
  Evidence: `packages/tabs-next/src/components/tab-renderer.tsx` stores scroll candidates as `root` and `node:<index>`, which are DOM implementation details rather than feature-owned meaning.

- Observation: The `system-agent` README listed `format-context.test.ts`, but that file is absent in the current tree.
  Evidence: `sed -n '1,260p' apps/web/src/features/system-agent/format-context.test.ts` returned `No such file or directory`. The README was updated while adding the new context files.

- Observation: `pnpm --filter @cradle/web test -- system-agent` does not scope to only system-agent tests in the current script shape; it still ran unrelated Chat and AppShot tests that are failing in the existing worktree.
  Evidence: The command ran 45 files and failed in `src/features/chat/chat-streaming-handler.test.ts`, `src/features/chat/composer.test.tsx`, and `src/features/chat/tool-ui-classifier.test.ts`. A direct vitest invocation against `src/features/system-agent/context-registry.test.ts` and `src/features/system-agent/display-context.test.ts` passed.

- Observation: `pnpm --filter @cradle/web exec tsc --noEmit` currently fails before reaching this feature because `apps/web/tsconfig.json` excludes Node types while `scripts/i18n-workflow/utils.ts` imports `node:fs/promises`, `node:path`, and uses `process`.
  Evidence: TypeScript reported missing `node:fs/promises`, `node:path`, and `process` types.

- Observation: A later `tsc --noEmit --pretty false --skipLibCheck` run is still blocked by existing non-context issues.
  Evidence: The command reported the same Node script type errors and an unrelated `src/features/search/global-search-dialog.tsx` `string | null | undefined` assignment. Focused context tests passed.

- Observation: Jarvis has its own popover input instead of using the shared Chat composer, so selected-text attachment needs a system-agent-owned attachment boundary first.
  Evidence: `apps/web/src/features/system-agent/jarvis-popover.tsx` owns its own `<textarea>` and send path, while shared Chat composer context bars live under `apps/web/src/features/chat/composer.tsx`.

- Observation: Turn-time Jarvis context must not be modeled as Chat Runtime DB state.
  Evidence: Cradle has historically sent Jarvis context by prepending a `<cradle_context>` block to user message text. Introducing `contextEnvelopeJson` columns or Chat Runtime request fields creates a second protocol that conflicts with that boundary and makes transient UI attention look like durable chat data.

## Decision Log

- Decision: Create a new canonical ExecPlan instead of mutating `docs/exec-plans/20260515-01-system-agent-architecture.md`.
  Rationale: The older plan contains historical references to pre-snapshot chat streaming and server paths that no longer match the current implementation. A new self-contained plan avoids mixing obsolete and current architecture.
  Date/Author: 2026-05-26 / Codex.

- Decision: Context must be feature-owned and semantic, not globally inferred from DOM.
  Rationale: Cradle's repository principle is ownership and namespace clarity. Chat owns chat attention semantics, Kanban owns issue attention semantics, and System Agent should aggregate them without writing into or depending on private DOM structure.
  Date/Author: 2026-05-26 / Codex.

- Decision: Keep Chat Runtime context transport DB-free and prompt-block based.
  Rationale: The current Jarvis flow prepends `<cradle_context>` to the user message, and that remains the correct transport boundary for now. Typed context envelopes are the renderer-side source of truth for collection, ranking, budgeting, and formatting; they are not Chat Runtime API fields and must not be persisted through DB columns. Future runtime-specific structured context, if needed, belongs inside a runtime adapter and must not redefine Chat Runtime's public contract.
  Date/Author: 2026-05-26 / Codex.

- Decision: Explicit references outrank implicit attention context.
  Rationale: Modern IDE assistants let users explicitly attach files, selections, terminal output, or codebase references. This reduces ambiguity and avoids overfitting on accidental focus or scroll state.
  Date/Author: 2026-05-26 / Codex.

- Decision: Raw scroll offsets, pixel geometry, and mouse movement history are not first-class prompt context.
  Rationale: They are noisy, unstable, and hard for a model to use. The useful context is derived state such as `visible range: messages 12-18`, `manual scroll away from bottom`, or `focused issue detail`.
  Date/Author: 2026-05-26 / Codex.

- Decision: `Include context` controls implicit context only; explicit user-attached context still sends with the next Jarvis turn.
  Rationale: Explicit attachments are an affirmative user instruction, and dropping them because the user disabled ambient context would be surprising.
  Date/Author: 2026-05-26 / Codex.

## Outcomes & Retrospective

No implementation milestone has completed yet. The initial outcome is a checked-in target spec and this execution plan. The next outcome should be a working typed context registry with unit tests that can represent the current legacy snapshot and at least one new attention item.

2026-05-26 update: Milestone 1 is implemented in the renderer. `context-items.ts` defines typed semantic context contracts, `context-registry.ts` collects provider output into a `ContextEnvelope`, and `legacy-context-items.ts` projects the current snapshot into the new model. The next implementation outcome should make Jarvis collect an envelope instead of only the legacy snapshot.

Focused validation for Milestone 1 passed with:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/system-agent/context-registry.test.ts src/features/system-agent/display-context.test.ts

The result was 2 test files passed and 6 tests passed. Broader web validation is blocked by existing unrelated Chat/AppShot test failures and an existing Node-types issue in the web TypeScript config.

2026-05-26 update: Milestone 2 is implemented in the renderer. `collectContextEnvelope()` now combines legacy snapshot projection with registered feature provider items, and `JarvisPopover` formats the typed envelope before sending. The legacy `formatContextForAgent()` remains available and tested while the runtime migration continues.

2026-05-26 update: The first slice of Milestone 3 is implemented. `apps/web/src/features/chat/chat-context.ts` owns chat attention snapshots and registers a provider with the Jarvis context registry. `ChatView` now publishes message count, visible message index range from `virtua`, scroll progress, near-bottom/manual-scroll state, and composer focus. This does not yet include selected message or selected text explicit references; those remain a separate milestone item.

Focused validation after Chat attention passed with:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/system-agent/context-registry.test.ts src/features/system-agent/format-context.test.ts src/features/system-agent/display-context.test.ts src/features/chat/chat-context.test.ts

The result was 4 test files passed and 9 tests passed.

2026-05-26 update: Milestone 4 is implemented in the renderer. `apps/web/src/features/kanban/kanban-context.ts` owns Kanban attention snapshots and registers a provider with the Jarvis context registry. `KanbanView` now publishes selected, open, peeked, focused, hovered, visible, search, filter, and layout state as a compact semantic item with issue references.

Focused validation after Kanban attention passed with:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/system-agent/context-registry.test.ts src/features/system-agent/format-context.test.ts src/features/system-agent/display-context.test.ts src/features/chat/chat-context.test.ts src/features/kanban/kanban-context.test.ts

The result was 5 test files passed and 10 tests passed.

2026-05-26 update: The first slice of Milestone 5 is implemented in the renderer. `apps/web/src/features/system-agent/explicit-context.ts` owns explicit Jarvis attachments and exposes a provider that emits them as high-priority `selection` context items. `JarvisPopover` can attach the current browser text selection, shows removable context chips, preserves explicit attachments even when implicit context is disabled, and clears attachments after a successful send. Selected chat messages, issue references, workspace files, and terminal output remain open.

2026-05-26 update: A mistaken DB/server transport branch was removed. Chat Runtime no longer receives or stores typed `contextEnvelope` payloads, the generated `0045_chat_context_envelope` migration files were deleted, and the plan now treats `<cradle_context>` prompt-block rendering as the transport boundary. This preserves the stronger typed renderer-side context model without turning transient UI attention into durable DB state.

Focused validation after the transport correction passed with:

    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/system-agent/context-registry.test.ts src/features/system-agent/format-context.test.ts src/features/system-agent/display-context.test.ts src/features/system-agent/explicit-context.test.ts src/features/chat/chat-context.test.ts src/features/kanban/kanban-context.test.ts

The result was 6 test files passed and 12 tests passed.

## Context and Orientation

Jarvis is the renderer-facing System Agent feature. Its current UI and context code live in `apps/web/src/features/system-agent/`. The most relevant files are:

- `apps/web/src/features/system-agent/context-schema.ts`: Defines the current `SystemAgentContext`.
- `apps/web/src/features/system-agent/use-context-snapshot.ts`: Reads Zustand stores and returns the current snapshot.
- `apps/web/src/features/system-agent/format-context.ts`: Converts the snapshot to a `<cradle_context>` text block.
- `apps/web/src/features/system-agent/display-context.ts`: Removes `<cradle_context>` text from messages when rendering.
- `apps/web/src/features/system-agent/jarvis-popover.tsx`: Calls `collectContextSnapshot()` when sending a Jarvis message.

Chat is rendered by `apps/web/src/features/chat/chat-view.tsx`. It already owns useful scroll and viewport signals. The function `readScrollMetrics()` returns offset, scroll height, and viewport height. `isAtBottomRef` records whether the user is near the bottom. `handleVirtScroll()` updates that state from virtualized scrolling.

Kanban is rendered by `apps/web/src/features/kanban/index.tsx`. It already owns selected issues, peeked issues, focused issue index, hovered issue id, and visible issue order. These should become Kanban-owned context items, not System Agent guesses.

Tabs are managed by `packages/tabs-next/`. `packages/tabs-next/src/components/tab-renderer.tsx` captures scroll positions for retained tab restoration. Those values use DOM candidate indexes and must stay a UI restoration detail. They are not stable enough for agent context.

The current chat runtime is the server-owned snapshot plus sequenced SSE delta runtime documented in `docs/exec-plans/20260516-03-message-snapshot-chat-runtime.md`. Do not reintroduce old chunk replay assumptions from historical plans.

The target product and architecture spec for this work is `docs/specs/jarvis-context-engine.md`. It defines context item kinds, feature provider ownership, prompt assembly rules, observability expectations, and non-goals. This ExecPlan is the implementation guide for that spec.

## Plan of Work

Milestone 1 creates the typed context model and registry. Add new files under `apps/web/src/features/system-agent/`, such as `context-items.ts`, `context-registry.ts`, and `context-assembler.ts`. Define `ContextItem`, `ContextReference`, `ContextProvider`, and `ContextEnvelope`. Keep all names in English. Provide a default provider that adapts the legacy `SystemAgentContext` into the new item model so existing behavior remains representable.

Milestone 2 moves the current snapshot collector onto provider aggregation. Update `collectContextSnapshot()` or replace it with `collectContextEnvelope()` so Jarvis can gather context items from registered providers. Keep `formatContextForAgent()` temporarily, but make it accept the typed envelope or a projection of it. Add tests proving the old tab/chat/layout/profile/unread context still appears in the formatted fallback.

Milestone 3 adds Chat attention context. The Chat feature should own a small store or registry bridge that records current visible range, at-bottom state, focused composer state, selected message id if present, and selected text preview if present. Avoid reading the DOM from System Agent. Chat should update its own context state from `chat-view.tsx` and composer events. The provider should emit items such as `attention: chat visible messages`, `attention: manual scroll away from bottom`, and `entity: active chat session`.

Milestone 4 adds Kanban attention context. Kanban should publish selected, peeked, focused, hovered, and visible issue context. The provider should emit stable issue references and short summaries. It should not include full issue descriptions unless explicitly referenced or retrieved.

Milestone 5 adds explicit references. Add a feature-owned model for user-attached context references. The user should be able to attach selected text, a chat message, an issue, a workspace file, and terminal output to Jarvis. The initial UI can be small and direct: use existing context menus or composer chips rather than inventing a large new surface. Explicit references must outrank implicit context in assembly.

Milestone 6 adds renderer-side prompt assembly and budget management. Implement an assembler under `apps/web/src/features/system-agent/` that receives the user message, selected typed `ContextEnvelope`, explicit references, attention context, retrieved context, and short history summaries. It should include high-priority items first, estimate tokens conservatively, and record include/drop decisions. The assembler renders the selected items into the existing `<cradle_context>` block that is prepended to the user message. Chat Runtime continues to receive ordinary message text and does not receive a typed context field.

Milestone 7 adds context trace observability for the renderer prompt assembly path. Record an inspectable trace object before sending the Jarvis turn. The trace should include the envelope id, item count, included item ids, dropped item ids, token estimate, and final prompt-block preview. This trace can live in renderer memory or developer tooling; it should not require a database table.

Milestone 8 adds retrieval orchestration. Based on the user message and active context, run workspace file search, issue lookup, chat history search, and Chronicle memory search when useful. Retrieval results must become `ContextItem` objects with provenance and token estimates. Do not fetch entire workspaces or full terminal buffers by default.

Milestone 9 adds validation. Add unit tests for providers and prompt assembly, plus a devtool or debug trace that shows included and dropped context items. Add browser-level tests for the main user scenarios: scroll to old chat messages, peek an issue, select text, attach a file or terminal output, ask Jarvis, and inspect context trace.

## Concrete Steps

Start by reading the current files:

    cd /Users/wibus/dev/Cradle
    sed -n '1,220p' apps/web/src/features/system-agent/context-schema.ts
    sed -n '1,260p' apps/web/src/features/system-agent/use-context-snapshot.ts
    sed -n '1,260p' apps/web/src/features/system-agent/format-context.ts
    sed -n '470,640p' apps/web/src/features/chat/chat-view.tsx
    sed -n '1,280p' apps/web/src/features/kanban/index.tsx

Then implement Milestone 1:

    cd /Users/wibus/dev/Cradle
    touch is not required; create files with apply_patch
    add apps/web/src/features/system-agent/context-items.ts
    add apps/web/src/features/system-agent/context-registry.ts
    add apps/web/src/features/system-agent/context-envelope.test.ts

The new type module should expose:

    export type ContextItemKind =
      | 'attention'
      | 'selection'
      | 'entity'
      | 'view'
      | 'layout'
      | 'history'
      | 'retrieval'
      | 'tool-output'
      | 'memory'

    export interface ContextEnvelope {
      id: string
      capturedAt: number
      activeTabId: string | null
      activeTabType: string | null
      items: ContextItem[]
    }

Run the focused tests:

    pnpm --filter @cradle/web test -- context

If the project does not have a focused context test target, run:

    pnpm --filter @cradle/web test

Continue milestone by milestone. After each milestone, update this ExecPlan's `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` sections before stopping.

## Validation and Acceptance

Acceptance is behavioral, not just type-level.

For Milestone 1, run the web tests and confirm that typed context items can represent the legacy snapshot. The tests should prove an active chat tab, open tabs, layout, profile, unread sessions, and last chat message all appear as separate or grouped context items with owner and priority.

For Milestone 3, create or update tests so a chat session with viewport state can emit:

    owner: chat
    kind: attention
    summary: User is viewing historical messages and is not at the bottom.

Also verify that when the user is at the bottom, the context item reflects that state or is omitted if low value.

For Milestone 4, create or update tests so a Kanban board with a peeked issue emits an issue reference:

    kind: issue
    id: <issue id>
    label: <issue title or key>

For Milestone 6, add renderer tests that pass a mixed `ContextEnvelope` into the assembler and verify the generated `<cradle_context>` block includes explicit references first, then attention and active entity context, while dropping low-priority items when the token budget is exceeded.

For Milestone 7, add renderer tests that inspect the prompt assembly trace and verify included and dropped item decisions are visible without reading Chat Runtime DB state.

For Milestone 9, use browser automation to validate at least these user flows:

1. Open a chat session, scroll away from the bottom, ask Jarvis “what is happening here”, and verify the context trace contains chat attention with manual scroll state.
2. Open Kanban, peek an issue, ask Jarvis “summarize this”, and verify the context trace contains the issue reference.
3. Select text, ask Jarvis, and verify the selected text preview appears as an explicit context item.
4. Attach a workspace file or terminal output to Jarvis, ask a question, and verify explicit references outrank implicit context in the trace.

## Idempotence and Recovery

All milestones should be additive until the new engine is proven. Do not delete the legacy formatter until typed envelope transport and fallback formatting have tests. If a milestone fails, revert only the files touched by that milestone or add a narrow adapter to keep tests passing. Do not use destructive Git commands such as `git reset --hard`.

Provider registration must be idempotent. Registering the same provider twice in tests should either replace the previous provider by owner id or throw a clear test-time error. Avoid global mutable state that leaks between tests; expose a factory such as `createContextRegistry()` for tests.

The context envelope should be safe to capture repeatedly. Repeated captures should produce new envelope ids and timestamps but stable item ids where the underlying source is the same.

## Artifacts and Notes

Current source audit highlights:

    apps/web/src/features/system-agent/context-schema.ts
    - SystemAgentContext has activeTab, openTabs, chatContext, layout, activeProfileId, unreadSessionIds.
    - It has no attention, focus, selection, visible range, or explicit references.

    apps/web/src/features/system-agent/jarvis-popover.tsx
    - handleSend calls formatContextForAgent(collectContextSnapshot()) and prepends the result to the user text.

    apps/web/src/features/chat/chat-view.tsx
    - readScrollMetrics() exposes offset, scrollHeight, and viewportHeight.
    - isAtBottomRef records near-bottom state.

    apps/web/src/features/kanban/index.tsx
    - selectedIssueIds, selectionAnchorId, peekIssueId, focusedIndex, hoveredIssueId, and visibleIssuesRef already exist.

Modern product patterns embedded in this plan:

    VS Code Copilot:
    - Combines implicit context, explicit context, workspace/codebase search, conversation history, custom instructions, and tool outputs.
    - Lets users add files, selections, terminal output, source control changes, and codebase references.
    - Treats context window usage as visible budget.

    GitHub Copilot completion:
    - Sends processed prompt context around the cursor and may use snippets from open tabs.

    Cursor:
    - Uses codebase indexing and retrieval rather than sending the whole repository every turn.

## Interfaces and Dependencies

Define these renderer-side interfaces in `apps/web/src/features/system-agent/context-items.ts`:

    export type ContextItemKind =
      | 'attention'
      | 'selection'
      | 'entity'
      | 'view'
      | 'layout'
      | 'history'
      | 'retrieval'
      | 'tool-output'
      | 'memory'

    export type ContextReferenceKind =
      | 'chat-message'
      | 'chat-session'
      | 'workspace-file'
      | 'issue'
      | 'terminal-buffer'
      | 'browser-page'
      | 'chronicle-memory'

    export interface ContextReference {
      kind: ContextReferenceKind
      id: string
      label: string
      uri?: string
      range?: {
        startLine?: number
        endLine?: number
        startOffset?: number
        endOffset?: number
      }
    }

    export interface ContextItem {
      id: string
      kind: ContextItemKind
      owner: string
      title: string
      summary: string
      content?: string
      references?: ContextReference[]
      priority: number
      freshness: 'live' | 'recent' | 'stale'
      sensitivity: 'public' | 'workspace' | 'private' | 'secret'
      tokenEstimate: number
      createdAt: number
    }

    export interface ContextEnvelope {
      id: string
      capturedAt: number
      activeTabId: string | null
      activeTabType: string | null
      items: ContextItem[]
    }

Define provider registration in `apps/web/src/features/system-agent/context-registry.ts`:

    export interface ContextProviderInput {
      activeTabId: string | null
      activeTabType: string | null
      now: number
    }

    export interface ContextProvider {
      owner: string
      readContext: (input: ContextProviderInput) => ContextItem[]
    }

    export interface ContextRegistry {
      registerProvider: (provider: ContextProvider) => () => void
      collectEnvelope: () => ContextEnvelope
    }

When server transport lands, define matching TypeBox or Zod schemas in the owning server module. Use Drizzle for any durable persistence. If context traces are persisted, place schema under a Cradle-owned namespace such as chat runtime or system-agent, not under another feature's namespace.

## Revision Notes

2026-05-26: Initial plan created after auditing the current System Agent context code and writing `docs/specs/jarvis-context-engine.md`. The plan intentionally starts with typed context items and provider ownership before changing prompt transport, because that gives tests a stable semantic contract before server/runtime integration.

2026-05-26: Milestone 1 implementation added `apps/web/src/features/system-agent/context-items.ts`, `context-registry.ts`, `legacy-context-items.ts`, and `context-registry.test.ts`, then updated the system-agent README to remove a stale `format-context.test.ts` entry and list the new context engine files.

2026-05-26: Milestone 2 implementation added typed envelope prompt formatting, restored `format-context.test.ts` coverage, and switched `jarvis-popover.tsx` from `formatContextForAgent(collectContextSnapshot())` to `formatContextEnvelopeForAgent(collectContextEnvelope())`.

2026-05-26: Chat attention implementation added `apps/web/src/features/chat/chat-context.ts`, `chat-context.test.ts`, `Composer` focus reporting, and `ChatView` viewport publishing. It deliberately uses the `virtua` public handle to compute message index ranges instead of reading DOM node order.
