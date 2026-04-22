<!-- Once this directory changes, update this README.md -->

# Features/Git

Git integration feature: branch status, commit graph, branch switching, and fetch.
The `GitPanel` renders in the right aside "Git" tab; `GitBranchControl` renders in the AppHeader breadcrumb.
All git operations go through `GitService` (main process IPC), which uses `simple-git` under the hood.

## Files

- **use-git.ts**: TanStack Query hooks — `useGitStatus`, `useGitBranches`, `useGitGraph` with exported query-key builders for external invalidation
- **graph-layout.ts**: Pure `computeGraphLayout` function — assigns lane numbers and SVG line metadata to each commit using a classic open-slots algorithm
- **git-graph-row.tsx**: Memoized row component — SVG swimlane column + Gravatar avatar + shortSha badge + message + ref labels + relative date
- **git-panel.tsx**: Full panel component — status bar (branch button, ahead/behind badges, fetch button) + virtualized commit graph (`VList` from virtua)
- **branch-picker.tsx**: Popover listing local and remote branches with search, checkout-on-click, and fetch button
- **create-branch-dialog.tsx**: Dialog for creating a new branch; uses imperative `CreateBranchDialogHandle` ref so BranchPicker can open it
- **git-branch-control.tsx**: Compact branch button for AppHeader — shows `⎇ branch ↑N ↓N`, opens `BranchPicker` on click
- **index.ts**: Barrel re-exporting `GitPanel` and `GitBranchControl`
