<!-- Once this directory changes, update this README.md -->

# Components/Layout

Core layout primitives for the application shell.
These components define the spatial structure (sidebar, center, aside, panel).
Place domain-specific content components in `features/` instead.

## Files

- **app-footer.tsx**: Slim footer bar mirroring the AppHeader chrome pattern; accepts `children` for custom content; hidden when settings overlay is active
- **app-header.tsx**: Slim breadcrumb header (`workspace / title`) with bottom-panel and right-aside toggles; doubles as a macOS window-drag region
- **app-layout.tsx**: Pure three-column layout shell — sidebar (via AppSidebar), center column (header/main/footer/panel), and aside.
  Accepts `header`, `aside`, `panel`, and `children` as composition props. No feature dependencies.
- **app-sidebar.tsx**: Workspace sidebar wrapper with settings navigation button. Handles keyboard shortcuts for toggling settings route and returns to the launcher with an explicit empty workspace selection when leaving settings.
  Extracted from AppLayout to keep layout concerns separate from sidebar orchestration.
- **dev-bottom-bar.tsx**: Dev-only slim footer inside `AppLayout` with a single button that opens the IPC devtool second window
- **resize-handle.tsx**: Draggable handle for resizing sidebar, aside, and panel widths/heights.
