<!-- Once this directory changes, update this README.md -->

# Features/Home

Dashboard hub feature for the root index route.
Replaces the chat-composer entry point with an activity-first hub view.
Place chat-related components in `features/chat/` or `features/new-chat/` instead.
User-facing dashboard chrome, relative-time labels, quick action labels, and automation status copy are owned by the `home` i18n namespace.

## Files

- **home-dashboard-loader.ts**: Home dashboard tab 的共享 lazy loader 与 route preload 入口。
- **home-dashboard.tsx**: Dashboard component — search bar, recent sessions across all workspaces, projects list, fresh-install empty states, localized quick action routing to new chat, and the Home projection/entry point for the automation registry.
