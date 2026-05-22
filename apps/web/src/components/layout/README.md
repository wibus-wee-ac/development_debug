<!-- Once this directory changes, update this README.md -->

# Components/Layout

Core layout primitives for the application shell.
These components define the spatial structure (sidebar, center, aside, panel).
Place domain-specific content components in `features/` instead.

## Files

- **app-footer.tsx**: Slim footer bar mirroring the AppHeader chrome pattern; Jarvis session tabs use sibling native buttons for activation and close actions without nested interactive controls, preload the deferred Jarvis popover on hover/focus/shortcut intent, and record the Jarvis popover first-render performance start mark when opening the popover.
- **app-footer.test.tsx**: Regression tests for AppFooter Jarvis session activation and close button semantics.
- **app-header.tsx**: Slim top chrome with tab capsule bar, Settings-mode active tab presentation, workspace/title/git breadcrumb slot rendering, and browser/bottom-panel/right-aside toggles; interactive regions are marked `no-drag`, key toggles expose accessible names / pressed states, resources diagnostics, browser panel, and bottom-panel terminal code are preloaded from header intent, the browser panel, chat Files aside, and bottom-panel shell open intents record first-render performance start marks, and stable `data-testid` anchors remain available for E2E
- **app-header.test.tsx**: Regression tests for AppHeader toggle accessible names, pressed states, callback wiring, and browser/bottom-panel shell performance intent marking.
- **app-layout.tsx**: Pure three-column layout shell — sidebar (via AppSidebar), center column (header/main/footer/panel), and aside. Reads dynamic layout slots from `LayoutSlotsContext` so active tab content can inject aside/panel/title without prop drilling, lazily mounts the Electron Browser Panel from a feature-owned loader, installs the Electron browser-use bridge for browser panel tab creation/activation/offscreen hiding, applies browser/bottom/aside size changes as immediate layout values rather than `motion` layout animations, keeps closed right-aside content unmounted so deferred panels do not run hidden work, and exposes stable `data-testid` + open-state anchors for E2E shortcut assertions. Settings content is supplied by the app shell as a tab-canvas overlay rather than owned by the layout itself.
- **app-sidebar.tsx**: Workspace sidebar wrapper with settings navigation button. Handles keyboard shortcuts for toggling settings route and sidebar collapse, preloads settings content before opening the overlay, applies collapsed width directly rather than animating layout width, and exposes stable sidebar mode / collapsed-state anchors for E2E assertions.
  Extracted from AppLayout to keep layout concerns separate from sidebar orchestration.
- **dev-bottom-bar.tsx**: Dev-only slim footer inside `AppLayout` that subscribes to the active tab route projection and exposes DevTools / hard reload actions
- **layout-geometry-context.tsx**: Explicit layout geometry contract that measures the center column and footer so overlay features can position themselves without DOM selectors or layout-tree guessing
- **layout-slots-context.tsx**: React context + `LayoutSlotsProvider` for per-tab layout slot injection (aside, panel, hasAside, hasPanel, title, workspace, gitBranch). Consumed by `AppLayout` and used by tab content components via `useRegisterLayoutSlots`.
- **resize-handle.tsx**: Draggable handle for resizing sidebar, aside, and panel widths/heights.
- **right-aside.tsx**: Tabbed right side panel with File Tree, Git, Issue, and Feed tabs; accepts workspaceId, workspacePath, and sessionId props, preloads each deferred panel from tab hover/focus/click intent, records Git, Issue, and Feed tab first-render performance start marks on user tab activation, can launch the pack-codebase dialog from the file tree flow while recording the dialog first-render start mark, and exposes stable tab/content `data-testid` anchors for E2E navigation
- **use-layout-slots.ts**: `useLayoutSlotsCtx` and `useRegisterLayoutSlots` hooks for reading and registering layout slots from tab content components.
