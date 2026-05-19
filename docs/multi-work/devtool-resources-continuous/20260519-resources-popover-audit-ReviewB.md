# ReviewB Resources Popover Audit

## Scope

- Area reviewed: `apps/web/src/features/devtool/resources`
- Allowed adjacent references reviewed: `apps/web/src/features/devtool/README.md`, resource test reference, and AppHeader integration point.
- Source edit status: no source files changed.

## Finding

Low-risk UX/test gap: terminal executable labels only appear to be normalized for POSIX-style paths.

`ResourcesPopover` renders terminal rows through `basename(item.executable)`. The current helper splits only on `/`, so a Windows-style executable path such as `C:\Program Files\node\node.exe` would render as the full path instead of the expected compact `node.exe` label. This is a small UX issue in a constrained diagnostic popover because long paths are truncated and make process rows less scannable.

The existing test file already covers partial endpoint failures, but it does not lock the terminal label normalization behavior. Adding a regression test would close both the UX and DX gap with minimal blast radius.

## Risk

- User impact: low to moderate for anyone inspecting terminal resource rows from Windows-style paths or cross-platform process metadata.
- Implementation risk: low. The likely fix is confined to `basename()` in `resources-popover.tsx` plus one focused test case in `resources-popover.test.tsx`.
- Compatibility risk: low. Existing POSIX path behavior should remain unchanged if the helper splits on both `/` and `\`.

## Recommended Next Action

Add a focused regression test that renders a terminal item with a Windows-style `executable` path and asserts only the filename is shown. Then update `basename()` to normalize both separators.

Suggested implementation shape:

```ts
function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}
```

Suggested validation:

```sh
pnpm --filter web test -- src/features/devtool/resources/resources-popover.test.tsx
```

## Exact Files Inspected

- `apps/web/src/features/devtool/resources/resources-popover.tsx`
- `apps/web/src/features/devtool/resources/resources-popover.test.tsx`
- `apps/web/src/features/devtool/resources/README.md`
- `apps/web/src/features/devtool/README.md`
- `apps/web/src/components/layout/app-header.tsx`
- `apps/web/package.json`
- `package.json`
