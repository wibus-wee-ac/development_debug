<!-- Once this directory changes, update this README.md -->

# Components/Layout

Core layout primitives for the application shell.
These components define the spatial structure (sidebar, center, aside, panel).
Place domain-specific content components in `features/` instead.

## Files

- **app-footer.tsx**: Slim footer bar mirroring the AppHeader chrome pattern; Jarvis session tabs use sibling native buttons for activation and close actions without nested interactive controls
- **app-footer.test.tsx**: Regression tests for AppFooter Jarvis session activation and close button semantics.
- **app-header.tsx**: Slim top chrome with tab capsule bar, Settings-mode active tab presentation, workspace/title/git breadcrumb slot rendering, and browser/bottom-panel/right-aside toggles; interactive regions are marked `no-drag`, key toggles expose accessible names / pressed states, and stable `data-testid` anchors remain available for E2E
- **app-header.test.tsx**: Regression tests for AppHeader toggle accessible names, pressed states, and callback wiring.
- **app-layout.tsx**: Pure three-column layout shell — sidebar (via AppSidebar), center column (header/main/footer/panel), and aside. Reads dynamic layout slots from `LayoutSlotsContext` so active tab content can inject aside/panel/title without prop drilling, installs the Electron browser-use bridge for browser panel tab creation/activation, and exposes stable `data-testid` + open-state attributes for E2E shortcut assertions. Settings content is supplied by the app shell as a tab-canvas overlay rather than owned by the layout itself.
- **app-sidebar.tsx**: Workspace sidebar wrapper with settings navigation button. Handles keyboard shortcuts for toggling settings route and sidebar collapse, and now exposes stable sidebar mode / collapsed-state anchors for E2E assertions.
  Extracted from AppLayout to keep layout concerns separate from sidebar orchestration.
- **dev-bottom-bar.tsx**: Dev-only slim footer inside `AppLayout` that subscribes to the active tab route projection and exposes DevTools / hard reload actions
- **layout-geometry-context.tsx**: Explicit layout geometry contract that measures the center column and footer so overlay features can position themselves without DOM selectors or layout-tree guessing
- **layout-slots-context.tsx**: React context + `LayoutSlotsProvider` for per-tab layout slot injection (aside, panel, hasAside, hasPanel, title, workspace, gitBranch). Consumed by `AppLayout` and used by tab content components via `useRegisterLayoutSlots`.
- **resize-handle.tsx**: Draggable handle for resizing sidebar, aside, and panel widths/heights.
- **right-aside.tsx**: Tabbed right side panel with File Tree, Git, and Issue tabs; accepts workspaceId, workspacePath, and sessionId props, can launch the pack-codebase dialog from the file tree flow, and exposes stable tab/content `data-testid` anchors for E2E navigation
- **use-layout-slots.ts**: `useLayoutSlotsCtx` and `useRegisterLayoutSlots` hooks for reading and registering layout slots from tab content components.
