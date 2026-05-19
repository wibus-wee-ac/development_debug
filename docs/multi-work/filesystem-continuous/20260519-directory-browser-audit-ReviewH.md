# ReviewH: Directory Browser Filesystem UX Audit

## Verdict

Fail.

The pure helper test passes, and the new `description` text is rendered visually. The current directory-list keyboard and ARIA model still need fixes before this node should pass, mainly because focus, selected state, and Enter behavior can diverge.

## Findings

### P1 - Enter on a focused directory row can open the wrong directory

- File: `apps/web/src/features/filesystem/directory-browser-dialog.tsx`
- Lines: 118-151, 212-234, 528-533

The listing container handles `Enter` for every keydown that bubbles from its descendants. Because each `DirectoryRow` is also a real focusable `<button>`, a keyboard user can tab directly to a row button and press `Enter`. In that path, `handleListingKeyDown` still uses `selectedEntry ?? directories[0]?.path`, not the focused row path, so it can navigate to the first directory or a stale selected directory instead of the focused button.

This is also why the keyboard model feels inconsistent: the visual selection is stored on the container, while browser focus can be on either the container or any row button.

Suggested fix:

- Choose one focus model.
- If the container owns keyboard selection, make rows unfocusable and expose the active row with `aria-activedescendant`.
- If rows remain buttons, handle Enter on the row itself or ignore bubbled Enter from row buttons with `event.target !== event.currentTarget`.

### P2 - The `tree` semantics do not match the rendered structure

- File: `apps/web/src/features/filesystem/directory-browser-dialog.tsx`
- Lines: 212-234, 528-570

The container is declared as `role="tree"`, but its direct children include directory `treeitem` buttons and file `<div>` rows with no tree role. A tree should own valid tree items or groups, and the active item should be represented through roving focus or `aria-activedescendant`. Currently arrow keys only update React state; they do not move DOM focus or expose the active item from the focused tree container.

This can cause screen readers to announce a tree without a coherent active item model, while keyboard users see a highlighted row that is not actually focused.

Suggested fix:

- Prefer `role="listbox"` / `role="option"` for a single-level selectable directory list, or remove composite roles and keep it as ordinary buttons.
- If keeping `tree`, use valid owned roles for every rendered row and implement one ARIA focus pattern consistently.
- Mark non-selectable file rows outside the tree semantics or as presentational/disabled items in the chosen pattern.

### P2 - Visible title and description are not wired into the dialog accessibility contract

- File: `apps/web/src/features/filesystem/directory-browser-dialog.tsx`
- Lines: 156-168

The `description` prop is displayed visually in the sidebar, so the visual requirement is met. However, the visible title and description are plain `<p>` elements inside `DialogContent`; they are not `DialogTitle` / `DialogDescription`, nor connected through `aria-labelledby` / `aria-describedby`.

For Radix dialog semantics this leaves the dialog without a proper accessible name/description, and the new description is not announced as the dialog description.

Suggested fix:

- Render `DialogTitle` and `DialogDescription` for the title/description, visually styled to match the sidebar layout, or
- Add stable IDs and connect `DialogContent` with `aria-labelledby` and `aria-describedby`.

## Checked Items

- PathBar input suggestions: no direct interference found. The listing key handler is attached to the listing subtree, while the PathBar input and suggestions are rendered outside it.
- `description` prop: visually rendered when provided.
- Pure logic tests: present for `selectDirectoryByOffset` and cover empty list, unselected first/last behavior, and bounded movement.
- Static Tailwind: no dynamic Tailwind class construction found in the reviewed diff.
- AGENTS new-file header: `directory-browser-dialog.test.ts` has the required header comment. `README.md` was added for the feature directory.
- Code language in new changes: reviewed new test/README content is English. Existing Chinese UI literals remain in `directory-browser-dialog.tsx`, but the audited diff did not introduce new Chinese code literals.

## Verification

Ran:

```bash
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/filesystem/directory-browser-dialog.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```
