<!-- Once this directory changes, update this README.md -->

# Features/Git

Git integration feature: branch status, commit graph, branch switching, and fetch.
The `GitPanel` renders in the right aside "Git" tab; `GitBranchControl` renders in the AppHeader breadcrumb.
All git operations go through `GitService` (main process IPC), which uses `simple-git` under the hood.
The first real UI-driven E2E coverage enters this feature from `new-chat` → chat tab, then drives the header branch control and right-aside Git panel without seeding app-owned state directly.

## Files

- **use-git.ts**: TanStack Query hooks — `useGitStatus`, `useGitBranches`, `useGitGraph` with exported query-key builders for external invalidation
- **graph-layout.ts**: Pure `computeGraphLayout` function — assigns lane numbers, per-row visible lane counts, and SVG line metadata to each commit using a classic open-slots algorithm
- **graph-layout.test.ts**: Unit coverage for `computeGraphLayout` linear history, merge lane convergence, compact mainline row width, and empty graph behavior
- **git-controls-a11y.test.tsx**: Regression tests for named GitPanel / BranchPicker fetch and branch-create controls.
- **git-graph-row.tsx**: Memoized row component — SVG swimlane column + Gravatar avatar + shortSha badge + message + ref labels + relative date; each rendered row exposes stable commit metadata attributes for E2E assertions
- **git-panel-loader.ts**: Git panel 的共享 lazy loader 与 intent preload 入口，供 right aside Git tab 使用
- **git-panel.tsx**: Full panel component — status bar (branch button, ahead/behind badges, named fetch button) + virtualized commit graph (`VList` from virtua); records the right-aside Git first-render mark after status and graph queries are both successful; panel, branch trigger, fetch button, readiness, and graph wrapper expose stable `data-testid` anchors
- **branch-picker.tsx**: Popover listing local and remote branches with search, checkout-on-click, inline branch creation, and named fetch/cancel controls; branch options and create controls expose stable `data-testid` anchors, and this component now owns the full branch switching/creation interaction flow
- **git-branch-control.tsx**: Compact branch button for AppHeader — shows `⎇ branch ↑N ↓N`, opens `BranchPicker` on click, and now renders through the AppHeader breadcrumb slot with a stable E2E anchor
- **index.ts**: Barrel re-exporting `GitPanel` and `GitBranchControl`
