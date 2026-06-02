# Output: Baseline results from persistent architecture cleanup, facade audit, and text scans.
# Input: `ast-grep scan` and persisted text scans over apps, packages, plugins, and repository tooling with generated/build artifacts excluded.
# Position: Owned by repository tooling as the current review queue for removable compatibility, formatter, facade, and ownership-comment smell surfaces.

# Wrapper And Bad-Smell Scan

## Default Cleanup Scan

Command:

```sh
ast-grep scan apps packages plugins \
  --globs '!apps/web/src/api-gen/**' \
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --globs '!**/node_modules/**' \
  --globs '!**/dist/**' \
  --globs '!apps/desktop/release/**' \
  --report-style short
```

Current default cleanup baseline:

| Rule | Matches |
|---|---:|
| compatibility-comment-marker | 7 |
| nullable-display-fallback-formatter-tsx | 4 |
| generated-api-call-wrapper | 3 |
| formatter-delegation-wrapper-tsx | 3 |
| threshold-unit-formatter-tsx | 2 |
| formatter-delegation-wrapper | 1 |
| local-intl-number-formatter | 1 |
| local-number-formatter-tsx | 1 |
| nullable-display-fallback-formatter | 1 |
| threshold-unit-formatter | 1 |

Current default findings:

- `apps/server/src/modules/chat-runtime-providers/codex/app-server-tool-payload.ts:1`: compatibility re-export for Codex tool payload projection.
- `apps/server/src/modules/chat-runtime/chat-turn-context.ts:40`: backwards-compatible class shim for old DI consumers.
- `apps/web/src/env.d.ts:54`: deprecated legacy subscribe API.
- `apps/web/src/features/agent-management/avatar-url.ts:1`: compatibility export from Agent Management to Agent Runtime avatar helper.
- `apps/web/src/features/chat/use-chat-session.ts:34`: compatibility exports used by tests.
- `apps/web/src/features/system-agent/legacy-context-items.ts:3`: transitional System Agent adapter until feature-owned providers replace the monolithic snapshot.
- `packages/streamdown/src/hooks/use-block-animation-meta.ts:1`: deprecated no-op hook.
- `apps/server/src/modules/acp/service.ts:294`: generated SDK pass-through `getAuditLog`.
- `apps/web/src/features/tui/shell-api.ts:6`: generated SDK pass-through `startShell`.
- `apps/web/src/features/tui/shell-api.ts:12`: generated SDK pass-through `stopShell`.
- `apps/server/src/modules/chronicle/service.ts:6077`: formatter helper only delegates to another helper.
- `apps/web/src/features/chat/runtime-ui-slot-panel.tsx:856`: formatter helper only delegates to `formatStatusLike`.
- `apps/web/src/features/chat/runtime-ui-slot-panel.tsx:860`: formatter helper only delegates to `formatStatusLike`.
- `apps/web/src/features/kanban/index.tsx:36`: read helper only delegates to `formatIssueId`.
- `apps/web/src/features/chat/runtime-ui-slot-panel.tsx:864`: nullable boolean formatter hides null behind `unknown`.
- `apps/web/src/features/chat/runtime-ui-slot-panel.tsx:871`: nullable percent formatter hides null behind `unknown`.
- `apps/web/src/features/chat/runtime-ui-slot-panel.tsx:875`: nullable number formatter hides null behind `unknown`.
- `apps/web/src/features/devtool/tabs/tabs-panel.tsx:10`: nullable timestamp formatter hides missing value behind a display fallback.
- `apps/web/src/features/kanban/issue-detail/milestone-progress.ts:47`: nullable due-date formatter hides null behind a display fallback.
- `apps/web/src/features/chat/chat-slash-commands.ts:541`: local `Intl.NumberFormat` wrapper.
- `apps/web/src/features/devtool/tabs/tabs-panel.tsx:6`: local `String`/`toFixed` number formatter.
- `apps/web/src/features/chat/tool-ui-classifier.ts:1350`: local threshold/unit byte formatter.
- `apps/web/src/features/chat/message-bubble.tsx:204`: local threshold/unit duration formatter.
- `apps/web/src/features/chronicle/chronicle-settings.tsx:2943`: local threshold/unit duration formatter.

## Optional Facade Audit

Run this when reviewing ownership boundaries and SDK pass-through surfaces. These matches are kept out of `sgconfig.yml` only because they are broader and noisier than the default structural cleanup queue:

```sh
ast-grep scan -c ast-grep/audit-sgconfig.yml apps packages plugins \
  --globs '!apps/web/src/api-gen/**' \
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --globs '!**/node_modules/**' \
  --globs '!**/dist/**' \
  --globs '!apps/desktop/release/**' \
  --report-style short
```

Current optional audit baseline:

| Rule | Matches |
|---|---:|
| generated-query-wrapper | 23 |
| service-pass-through-wrapper | 10 |
| preload-only-wrapper | 7 |
| lazy-component-loader-wrapper | 7 |
| generated-query-wrapper-tsx | 5 |

These are facade/ownership audit results. Generated SDK facades and low-semantics pass-through functions are cleanup candidates by default; feature-owned hooks/loaders still need owner review before collapsing them.

## Language-Agnostic Ownership Header Text Scan

Command:

```sh
ast-grep/scripts/scan-ownership-headers.sh
```

Rule:

```regex
^[[:space:][:punct:]]*(Output|Input|Position):
```

Current text scan baseline:

| Metric | Count |
|---|---:|
| Matched lines | 1510 |
| Files with matches | 451 |

Files with matches by extension:

| Extension | Files |
|---|---:|
| ts | 214 |
| md | 148 |
| tsx | 62 |
| yml | 19 |
| mjs | 5 |
| sh | 2 |
| html | 1 |

Sample output:

```text
AGENTS.md:6:# Output: ...
ast-grep/README.md:1:# Output: ...
apps/server/src/modules/...:1:// Output: ...
```

This scan is the authoritative all-language detector for `Output:`, `Input:`, and `Position:` header comments. It is intentionally text-based because ast-grep cannot parse every repository file type with one language rule, and it does not depend on enumerating comment delimiters.
