# Exploration A Handoff: apps/src/e2e Header Comment Scope

## Assignment

Role: Exploration Agent A.

Task node: verify the cleanup scope for removing file-opening metadata comments shaped exactly as `// Input:`, `// Output:`, and `// Position:` from code files under `/Users/wibus/dev/Cradle`.

Plan File read: `docs/exec-plans/20260521-06-remove-file-header-comments.md`.

Related paths searched: `apps/`, `src/`, `e2e/`.

Source files were not edited. This handoff file is the only artifact created by this agent.

## Plan File Interpretation

The plan scopes cleanup to real code files, not historical documentation. The intended anti-pattern is a mechanical metadata header:

```text
// Input: ...
// Output: ...
// Position: ...
```

The plan says to delete these comments when they are the first non-shebang content at the top of real code files. It also says to preserve shebang lines and to distinguish documentation/plan artifacts from code matches.

## Commands Used

All searches were constrained to the assigned related paths. The source-code extension set used here was: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.rs`, `.go`.

Strict label search:

```sh
rg -n "^// (Input|Output|Position):" apps src e2e \
  --glob "*.ts" --glob "*.tsx" --glob "*.js" --glob "*.jsx" \
  --glob "*.mjs" --glob "*.cjs" --glob "*.rs" --glob "*.go"
```

Whitespace-tolerant variant search:

```sh
rg -n "^[[:space:]]*//[[:space:]]*(Input|Output|Position):" apps src e2e \
  --glob "*.ts" --glob "*.tsx" --glob "*.js" --glob "*.jsx" \
  --glob "*.mjs" --glob "*.cjs" --glob "*.rs" --glob "*.go"
```

The whitespace-tolerant search did not reveal additional indented or spacing variants beyond the strict shape.

## Summary

Matches are not only exact three-line file headers.

Within `apps/`, `src/`, and `e2e/`, there are four relevant shapes:

| Shape | Count excluding `apps/desktop/release/**` | Cleanup interpretation |
| --- | ---: | --- |
| Exact three-line header at line 1 | 364 files | Safe target for mechanical header removal. |
| Exact three-line header after shebang | 1 file | Safe target if the shebang is preserved. |
| Exact three-line group after another file-opening directive/comment/import | 48 files | Still metadata comments, but not line-1 headers. Mechanical cleanup must intentionally support leading directives such as `// @vitest-environment jsdom`, `/* eslint-disable ... */`, or imports. |
| Incomplete/non-triplet variants containing one or more labels | 4 files | Requires special handling or explicit decision; these are not exact `Input` + `Output` + `Position` triplets. |

There is also one generated/bundled artifact under `apps/desktop/release/**`:

```text
apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/server/main.js
```

That file contains embedded copies of many source comments, first seen at line 23865. It should not be treated the same as source files unless the main cleanup scope deliberately includes release artifacts.

## Stable Counts

Code files scanned under `apps/`, `src/`, and `e2e/`: 674.

Files with at least one strict label match: 418.

Files with at least one strict label match excluding `apps/desktop/release/**`: 417.

Breakdown excluding `apps/desktop/release/**`:

| Area | Exact line-1 headers | Exact after shebang | Exact triplet not at file opening | Incomplete/non-triplet |
| --- | ---: | ---: | ---: | ---: |
| `apps/desktop` | 11 | 0 | 0 | 0 |
| `apps/server` | 124 | 0 | 2 | 4 |
| `apps/web` | 207 | 0 | 46 | 0 |
| `e2e` | 21 | 0 | 0 | 0 |
| `src` | 1 | 1 | 0 | 0 |

Total excluding release artifact: 417 files.

## Shebang Case

The cleanup must preserve the shebang in:

```text
src/cli/index.ts
```

Current shape:

```text
#!/usr/bin/env tsx
// Input: Commander.js, rpc-client.ts
// Output: CLI entry point with workspace/issue/board/status subcommands
// Position: Standalone Node.js CLI for controlling Cradle via Unix domain socket
```

## Exact Triplets Not at Line 1

These are full `Input` + `Output` + `Position` groups, but they are preceded by something that should remain. The most common case is a test file with Vitest's jsdom environment directive:

```text
// @vitest-environment jsdom
//
// Input: ...
// Output: ...
// Position: ...
```

Other cases are source directives or imports before the metadata group.

Complete list excluding `apps/desktop/release/**`:

```text
apps/server/src/modules/chat-runtime/engine/compaction.ts:2
apps/server/src/modules/session-await/sources/github-api.ts:3
apps/web/src/components/editor/editor-bubble-menu.test.tsx:3
apps/web/src/components/layout/app-footer.test.tsx:3
apps/web/src/components/layout/app-header.test.tsx:3
apps/web/src/components/layout/layout-slots-context.test.tsx:3
apps/web/src/components/layout/layout-slots-context.tsx:2
apps/web/src/components/ui/autocomplete.tsx:2
apps/web/src/features/agent-management/agent-detail.test.ts:3
apps/web/src/features/agent-management/custom-models-editor.test.tsx:3
apps/web/src/features/agent-runtime/use-agent-models.test.tsx:3
apps/web/src/features/chat/blocks/tool-call-block.test.tsx:3
apps/web/src/features/chat/chat-minimap.test.tsx:3
apps/web/src/features/chat/composer.test.tsx:3
apps/web/src/features/chat/use-chat-session-binding.test.tsx:3
apps/web/src/features/composer-toolbar/provider-model-selector.test.tsx:3
apps/web/src/features/composer-toolbar/use-composer-state.test.tsx:3
apps/web/src/features/devtool/plugins/plugins-panel.test.tsx:3
apps/web/src/features/devtool/resources/resources-popover.test.tsx:3
apps/web/src/features/git/git-controls-a11y.test.tsx:3
apps/web/src/features/kanban/issue-aside-panel.test.tsx:3
apps/web/src/features/kanban/issue-detail/activity-timeline.test.tsx:3
apps/web/src/features/kanban/issue-detail/agent-activity-item.test.tsx:3
apps/web/src/features/kanban/issue-detail/agent-prompt-input.test.tsx:3
apps/web/src/features/kanban/issue-detail/agent-session-panel.test.tsx:3
apps/web/src/features/kanban/issue-detail/issue-header.test.tsx:3
apps/web/src/features/kanban/issue-detail/properties-sidebar.test.tsx:3
apps/web/src/features/kanban/issue-detail/relation-manager.test.tsx:3
apps/web/src/features/kanban/issue-detail/sub-issues-list.test.tsx:3
apps/web/src/features/kanban/kanban-group-header.test.tsx:3
apps/web/src/features/kanban/kanban-item-actions.test.tsx:3
apps/web/src/features/kanban/kanban-selection.test.ts:3
apps/web/src/features/kanban/kanban-toolbar.test.tsx:3
apps/web/src/features/new-chat/new-chat-page.test.tsx:3
apps/web/src/features/settings/settings-sidebar.test.tsx:3
apps/web/src/features/skills/skill-manager.test.tsx:3
apps/web/src/features/workspace-detail/capsule-composer.test.tsx:3
apps/web/src/features/workspace-detail/workspace-workflow-rules.tsx:3
apps/web/src/features/workspace/workspace-sidebar.test.tsx:3
apps/web/src/tabs/chat.tab.test.tsx:3
apps/web/src/tabs/chat.tab.tsx:2
apps/web/src/tabs/home.tab.tsx:2
apps/web/src/tabs/kanban-board.tab.tsx:2
apps/web/src/tabs/new-chat.tab.tsx:2
apps/web/src/tabs/plugin-panel.tab.tsx:2
apps/web/src/tabs/usage.tab.tsx:2
apps/web/src/tabs/workspace-detail.tab.test.tsx:3
apps/web/src/tabs/workspace-detail.tab.tsx:2
```

## Incomplete or Non-Triplet Variants

These files contain matching labels but are not exact three-line `Input` + `Output` + `Position` groups:

```text
apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts:3
apps/server/src/modules/chat-runtime/engine/index.ts:2
apps/server/src/modules/chat-runtime/engine/providers.ts:2
apps/server/src/modules/chat-runtime/engine/tools/index.ts:2
```

Observed shapes:

```text
// AI SDK Engine — unified agent execution using Vercel AI SDK streamText
// Yields UIMessageChunk directly — no intermediate timeline abstraction
// Position: apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts
```

```text
// Engine module index
// Position: apps/server/src/modules/chat-runtime/engine/index.ts
```

```text
// AI SDK provider factory — creates LanguageModel instances from provider config
// Position: apps/server/src/modules/chat-runtime/engine/providers.ts
```

```text
// Tool registry index
// Position: apps/server/src/modules/chat-runtime/engine/tools/index.ts
```

These are file-opening metadata comments, but they do not match the plan's exact three-label target. If the main cleanup goal is "remove noisy file-opening metadata comments" rather than only exact `Input`/`Output`/`Position` triplets, these four should be included by an explicit special case. If the implementation is strictly limited to exact triplets, these four will remain and should be recorded as intentional residual matches.

## Release Artifact Caveat

`apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/server/main.js` is inside the assigned `apps/` path and has `.js` extension, but it is a generated/bundled release artifact. It contains embedded copies of many source metadata comments. It should be excluded from source cleanup unless the main agent decides release artifacts are in scope.

Evidence:

```text
apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/server/main.js:23865
```

## Recommended Implementation Guardrails

The cleanup should not be only "delete the first three lines if they match." That would miss 49 valid exact triplets:

- 1 after a shebang.
- 48 after directives/imports/comments that must remain.

The cleanup should also avoid deleting non-metadata comments that happen to appear before these headers. For `apps/web` test files, keep the `// @vitest-environment jsdom` directive and the separating `//` line only if desired by formatter/style; delete only the metadata triplet.

Suggested post-cleanup validation for this assigned scope:

```sh
rg -n "^// (Input|Output|Position):" apps src e2e \
  --glob "*.ts" --glob "*.tsx" --glob "*.js" --glob "*.jsx" \
  --glob "*.mjs" --glob "*.cjs" --glob "*.rs" --glob "*.go" \
  --glob "!apps/desktop/release/**"
```

Expected result depends on the decision for incomplete variants:

- If only exact triplets are removed, the four `Position:`-only variants listed above will remain.
- If all file-opening metadata comments are removed, the command should return no matches outside `apps/desktop/release/**`.

## Blockers

No blocker for proceeding with cleanup.

Open decision for the main agent: whether the four incomplete/non-triplet `Position:` variants should be removed under this cleanup, since they are not exact `Input` + `Output` + `Position` triplets but are clearly the same metadata style.

## Quality Gate

- File is self-contained.
- Acceptance criteria are addressed.
- Searches were limited to `apps/`, `src/`, and `e2e/`.
- Source files were not edited.
- Variants and uncertainties are explicit.
