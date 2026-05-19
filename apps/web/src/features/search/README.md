<!-- Once this directory changes, update this README.md -->

# features/search

Global thread search UI — command-palette-style dialog that queries the main-process
`ThreadSearchEngine` (jieba-tokenized). Triggered from the sidebar 搜索 button or
⌘K / Ctrl+K shortcut. Results group by workspace and highlight matched spans in
both titles and message snippets.

## Files

- **global-search-actions.ts**: Search result action helpers — keeps command result side effects testable; file results open the workspace detail tab and copy the relative path when possible
- **global-search-actions.test.ts**: Unit coverage for file-result selection behavior and clipboard failure fallback
- **global-search-dialog.tsx**: `GlobalSearchDialog` — 当前真实搜索入口，统一聚合线程 / 文件 / Issue / 命令结果；线程结果会渲染标题高亮与消息片段高亮，文件结果会打开 Workspace 并复制相对路径，并暴露最小 E2E 锚点
- **index.ts**: Barrel re-exports for the search feature
- **highlighted-text.tsx**: HighlightedText — renders a string with main-provided MatchRange spans wrapped in styled `<mark>`
- **thread-search-groups.test.ts**: Regression tests for the workspace-grouping data shape consumed by Base UI autocomplete collections
- **thread-search-groups.ts**: Pure grouping helper that normalizes search hits into Base UI's `{ value, label, items }` group contract
- **thread-search-normalize.test.ts**: Regression tests for renderer-side coercion of partial or malformed IPC search payloads
- **thread-search-normalize.ts**: Boundary normalizers that fill default arrays/strings so search UI can render safely across IPC data shape drift，并清理 FTS 返回的 `<mark>` 标签以便统一高亮渲染
- **thread-search-dialog.tsx**: ThreadSearchDialog — command-palette dialog (Dialog primitive) with debounced query, workspace-grouped results, keyboard navigation (↑↓/Enter/Esc), and navigation to `/chat/$sessionId`
- **use-thread-search.ts**: useThreadSearch hook — 150ms debounced TanStack Query against `ipc.search.searchThreads`, normalizes IPC hits for UI safety, and returns `{ hits, isPending, hasQuery }`
