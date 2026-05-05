<!-- Once this directory changes, update this README.md -->

# Renderer/Hooks

Cross-feature renderer hooks live here.
Use this directory for app-shell side effects and environment queries that are reused outside a single feature.
Keep feature-owned hooks inside their feature folders unless multiple domains truly depend on them.

## Files

- **use-global-event-listeners.ts**: App-shell side-effect hook wiring PTY pushes, chat timeline completion notifications, and keyboard shortcuts
- **use-media-query.ts**: Media-query subscription helper for responsive UI behavior
- **use-mobile.ts**: Mobile breakpoint helper derived from shared media-query logic
- **use-shortcut.ts**: Keyboard shortcut registration helper for renderer components