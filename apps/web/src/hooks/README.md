<!-- Once this directory changes, update this README.md -->

# Renderer/Hooks

Cross-feature renderer hooks live here.
Use this directory for app-shell side effects and environment queries that are reused outside a single feature.
Keep feature-owned hooks inside their feature folders unless multiple domains truly depend on them.

## Files

- **use-global-event-listeners.ts**: App-shell side-effect hook wiring PTY pushes, keyboard shortcuts, visible-chat ownership, and global chat activity → unread reconciliation; macOS-sensitive chords like `Ctrl+\`` and `⌘⌥B` match on both `key` and `code` so layout / Option-modified keyboards stay reliable, and the chat right-aside Files shortcut shares the same first-render performance start mark as the header button.
- **use-media-query.ts**: Media-query subscription helper for responsive UI behavior
- **use-mobile.ts**: Mobile breakpoint helper derived from shared media-query logic
- **use-shortcut.ts**: Keyboard shortcut registration helper for renderer components
