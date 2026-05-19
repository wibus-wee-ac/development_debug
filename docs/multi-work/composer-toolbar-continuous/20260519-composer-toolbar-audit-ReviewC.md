# ReviewC Composer Toolbar Audit

## Scope

- Area reviewed: `apps/web/src/features/composer-toolbar`
- Adjacent area reviewed: `apps/web/src/features/agent-runtime`
- Source edit status: no source files changed.

## Finding

Low-risk DX gap: `agent-runtime/README.md` has drifted from the actual directory contents.

The README lists `use-acp-agents.ts`, `use-acp-session-state.ts`, and `index.ts`, but those files are not present in `apps/web/src/features/agent-runtime`. The actual directory currently contains only the README, model visibility helper/test, and the three hooks for profiles, agents, and models.

This is small but worth closing because `composer-toolbar/use-composer-state.ts` depends on `agent-runtime` hooks for profile/model/agent selection. A stale file inventory can send future workers toward removed transitional APIs when auditing or extending the composer runtime path.

## Risk

- User impact: none at runtime.
- DX impact: low but recurring; stale inventory increases review friction and can mislead follow-up agents.
- Implementation risk: very low. The likely patch is confined to `apps/web/src/features/agent-runtime/README.md`.
- Compatibility risk: none if the change only removes nonexistent file entries and keeps the current model visibility ownership notes.

## Recommended Next Action

Update `apps/web/src/features/agent-runtime/README.md` so its file inventory matches the actual directory:

- Remove entries for `use-acp-agents.ts`, `use-acp-session-state.ts`, and `index.ts`.
- Keep the existing ownership note for model visibility semantics.
- Optionally order the remaining files to match the sorted directory listing for easier future audits.

Suggested validation:

```sh
find apps/web/src/features/agent-runtime -maxdepth 1 -type f -print | sort
```

No app test is required for a README-only patch.

## Exact Files Inspected

- `apps/web/src/features/composer-toolbar/README.md`
- `apps/web/src/features/composer-toolbar/cli-tui-agent-selector.tsx`
- `apps/web/src/features/composer-toolbar/composer-toolbar.tsx`
- `apps/web/src/features/composer-toolbar/constants.ts`
- `apps/web/src/features/composer-toolbar/index.ts`
- `apps/web/src/features/composer-toolbar/provider-model-menu.tsx`
- `apps/web/src/features/composer-toolbar/provider-model-picker.tsx`
- `apps/web/src/features/composer-toolbar/provider-model-selector.test.tsx`
- `apps/web/src/features/composer-toolbar/provider-model-selector.tsx`
- `apps/web/src/features/composer-toolbar/runtime-selector.tsx`
- `apps/web/src/features/composer-toolbar/types.ts`
- `apps/web/src/features/composer-toolbar/use-composer-state.ts`
- `apps/web/src/features/agent-runtime/README.md`
- `apps/web/src/features/agent-runtime/model-visibility.test.ts`
- `apps/web/src/features/agent-runtime/model-visibility.ts`
- `apps/web/src/features/agent-runtime/use-agent-models.ts`
- `apps/web/src/features/agent-runtime/use-agent-profiles.ts`
- `apps/web/src/features/agent-runtime/use-agents.ts`
