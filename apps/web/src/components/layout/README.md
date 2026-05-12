<!-- Once this directory changes, update this README.md -->

# Components/Layout

Core layout primitives for the application shell.
These components define the spatial structure (sidebar, center, aside, panel).
Place domain-specific content components in `features/` instead.

## Files

- **app-footer.tsx**: Slim footer bar mirroring the AppHeader chrome pattern; accepts `children` for custom content; hidden when settings overlay is active
- **app-header.tsx**: Slim top chrome with tab capsule bar, workspace/title/git breadcrumb slot rendering, and bottom-panel/right-aside toggles; interactive regions are marked `no-drag`, and key toggles expose stable `data-testid` anchors for E2E
- **app-layout.tsx**: Pure three-column layout shell — sidebar (via AppSidebar), center column (header/main/footer/panel), and aside. Reads dynamic layout slots from `LayoutSlotsContext` so active tab content can inject aside/panel/title without prop drilling, and the panel / aside shells expose stable `data-testid` + open-state attributes for E2E shortcut assertions.
- **app-sidebar.tsx**: Workspace sidebar wrapper with settings navigation button. Handles keyboard shortcuts for toggling settings route and sidebar collapse, and now exposes stable sidebar mode / collapsed-state anchors for E2E assertions.
  Extracted from AppLayout to keep layout concerns separate from sidebar orchestration.
- **dev-bottom-bar.tsx**: Dev-only slim footer inside `AppLayout` with a single button that opens the IPC devtool second window
- **layout-slots-context.tsx**: React context + `LayoutSlotsProvider` for per-tab layout slot injection (aside, panel, hasAside, hasPanel, title, workspace, gitBranch). Consumed by `AppLayout` and used by tab content components via `useRegisterLayoutSlots`.
- **resize-handle.tsx**: Draggable handle for resizing sidebar, aside, and panel widths/heights.
- **right-aside.tsx**: Tabbed right side panel with File Tree, Git, and Issue tabs; accepts workspaceId, workspacePath, and sessionId props, can launch the pack-codebase dialog from the file tree flow, and exposes stable tab/content `data-testid` anchors for E2E navigation
- **use-layout-slots.ts**: `useLayoutSlotsCtx` and `useRegisterLayoutSlots` hooks for reading and registering layout slots from tab content components.
