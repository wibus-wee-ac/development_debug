<!-- Once this directory changes, update this README.md -->

# Store

Zustand stores for renderer-side global state.
All stores use `persist` middleware for localStorage persistence.
Store naming convention: `use<Domain>Store`.

## Files

- **layout.ts**: Layout state — sidebar/aside/panel dimensions and visibility
- **layout-slots.ts**: Layout slot registry — pages inject content into aside/panel regions
- **theme.ts**: Theme preference state — light/dark/system mode
- **sidebar-nav.ts**: Sidebar drill-in navigation state — controls which view the sidebar shows (main / settings)
- **active-chat.ts**: Active chat session state — bridges sidebar session navigation and chat content area
