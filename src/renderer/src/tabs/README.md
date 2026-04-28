<!-- Once this directory changes, update this README.md -->

# Tabs

Cradle tab type definitions and central registry.
Each `.tab.tsx` file defines a tab type using `defineTab()` from `@cradle/tabs`.
The registry exports the store instance consumed by the rest of the app.

## Files

- **registry.ts**: Central registry mapping type strings to tab definitions; exports `useCradleTabStore`
- **home.tab.tsx**: Home/dashboard tab (pinned, no params)
- **chat.tab.tsx**: Chat session tab (params: `sessionId`)
- **new-chat.tab.tsx**: New chat creation tab (no params)
- **kanban-board.tab.tsx**: Kanban board tab (params: `boardId`, optional `issue`)
- **kanban-board-tab-content.tsx**: Wrapper component resolving board → workspace and managing issue panel
- **workspace-detail.tab.tsx**: Workspace detail tab (params: `workspaceId`)
- **usage.tab.tsx**: Usage/cost dashboard tab (no params)
