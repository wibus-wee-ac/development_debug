<!-- Once this directory changes, update this README.md -->

# Components/Layout

Core layout primitives for the application shell.
These components define the spatial structure (sidebar, center, aside, panel).
Place domain-specific content components in `features/` instead.

## Files

- **app-header.tsx**: Slim breadcrumb header (`workspace / title`) with bottom-panel and right-aside toggles; doubles as a macOS window-drag region
- **app-layout.tsx**: Main three-column layout shell — sidebar, center column, aside, and bottom panel.
  Accepts `aside` and `panel` as composition props so each page can inject its own content.
  Also renders `DevBottomBar` at the bottom in dev mode.
- **dev-bottom-bar.tsx**: Dev-only slim footer inside `AppLayout` with a single button that opens the IPC devtool second window
- **resize-handle.tsx**: Draggable handle for resizing sidebar, aside, and panel widths/heights.
