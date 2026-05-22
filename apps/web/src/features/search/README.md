<!-- Once this directory changes, update this README.md -->

# features/search

Global search UI — command-palette-style dialog that queries thread, Chronicle,
Issue, file, and command sources. Triggered from the sidebar 搜索 button or
⌘K / Ctrl+K shortcut. Results group by source, preserve workspace labels when
available, and highlight matched spans in titles and snippets.

## Files

- **global-search-actions.ts**: Search result action helpers — keeps command result side effects testable; file results open the workspace detail tab and copy the relative path when possible
- **global-search-actions.test.ts**: Unit coverage for file-result selection behavior and clipboard failure fallback
- **chronicle-search-normalize.test.ts**: Boundary tests for Chronicle search result defaults and malformed identity rejection
- **chronicle-search-normalize.ts**: Boundary normalizer for `/search/chronicle` results so the command palette can render memory and knowledge hits safely
- **global-search-dialog.tsx**: `GlobalSearchDialog` — 当前真实搜索入口，作为 app-shell 热路径挂载，统一聚合线程 / Chronicle 记忆与知识 / 文件 / Issue / 命令结果；线程和 Chronicle 结果会渲染标题高亮与片段高亮，Chronicle 结果打开 Settings > Chronicle 并聚焦具体 memory/knowledge card，文件结果会打开 Workspace 并复制相对路径，并记录 command palette open/query 的 Cradle performance marks 与 measures；命令、对话、Chronicle、Issue 和文件结果使用 memoized row，父级只传稳定 select-by-id/path handlers
- **global-search-performance.ts**: Global search intent performance mark/open helper，供 shell-level 打开处理器记录 command palette open intent 并同步打开 app-wide dialog store
- **global-search-store.ts**: Search-owned app-wide command palette open state，供 `App` 中的 single host 和 home/workspace/desktop tray open handlers 共享
- **index.ts**: Barrel re-exports for the search feature
- **highlighted-text.tsx**: HighlightedText — renders a string with main-provided MatchRange spans wrapped in styled `<mark>`
- **thread-search-groups.test.ts**: Regression tests for the workspace-grouping data shape consumed by Base UI autocomplete collections
- **thread-search-groups.ts**: Pure grouping helper that normalizes search hits into Base UI's `{ value, label, items }` group contract
- **thread-search-normalize.test.ts**: Regression tests for renderer-side coercion of partial or malformed IPC search payloads
- **thread-search-normalize.ts**: Boundary normalizers that fill default arrays/strings so search UI can render safely across IPC data shape drift，并清理 FTS 返回的 `<mark>` 标签以便统一高亮渲染
- **thread-search-dialog.tsx**: ThreadSearchDialog — command-palette dialog (Dialog primitive) with debounced query, workspace-grouped results, keyboard navigation (↑↓/Enter/Esc), and navigation to `/chat/$sessionId`
- **use-chronicle-search.ts**: useChronicleSearch hook — 150ms debounced TanStack Query against `/search/chronicle`, normalizes Chronicle memory/knowledge hits, and contributes pending state to command palette query performance measurement
- **use-thread-search.ts**: useThreadSearch hook — 150ms debounced TanStack Query against `ipc.search.searchThreads`, normalizes IPC hits for UI safety, and keeps debounce time visible in the pending state consumed by command palette query performance measurement
