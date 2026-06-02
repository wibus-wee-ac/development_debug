# Output: Baseline results from persistent ast-grep legacy cleanup and facade audit scans.
# Input: `ast-grep scan` over apps, packages, and plugins with generated/build artifacts excluded.
# Position: Owned by repository tooling as the current review queue for removable compatibility surfaces.

# Wrapper And Compatibility Scan

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

These are the strongest cleanup candidates found by the default rules:

- `apps/server/src/modules/chat-runtime-providers/codex/app-server-tool-payload.ts:1`: compatibility re-export for Codex tool payload projection.
- `apps/server/src/modules/chat-runtime/chat-turn-context.ts:40`: backwards-compatible class shim for old DI consumers.
- `apps/web/src/env.d.ts:54`: deprecated legacy subscribe API.
- `apps/web/src/features/agent-management/avatar-url.ts:1`: compatibility export from Agent Management to Agent Runtime avatar helper.
- `apps/web/src/features/chat/use-chat-session.ts:34`: compatibility exports used by tests.
- `apps/web/src/features/system-agent/legacy-context-items.ts:3`: transitional System Agent adapter until feature-owned providers replace the monolithic snapshot.
- `packages/streamdown/src/hooks/use-block-animation-meta.ts:1`: deprecated no-op hook.

## Needed Facades

Several earlier broad matches are intentionally kept because they encode ownership boundaries:

- API SDK facades such as `apps/web/src/features/tui/shell-api.ts` keep generated OpenAPI names out of feature UI code.
- React Query hooks such as `apps/web/src/features/git/use-git.ts` own query refresh policy, enablement, and feature-specific selection.
- Route/tab loader and preload modules own lazy-loading boundaries for feature tabs.
- Elysia plugin factories in `apps/server/src/http/*` own HTTP plugin composition names and lifecycle.
- Provider/runtime compatibility modules own product semantics, not legacy migration shims.
- Codex app-server protocol files are generated/external protocol surfaces and are excluded from the default cleanup scan.

## Optional Facade Audit

Run this only when reviewing ownership boundaries; these matches are not cleanup findings by default:

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
| generated-api-call-wrapper | 3 |

These are facade/ownership audit results. Most are expected to remain unless a specific feature boundary is collapsed.
