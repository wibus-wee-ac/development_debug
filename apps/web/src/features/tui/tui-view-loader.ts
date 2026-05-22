// Output: Shared lazy loader and preload hook for CLI-TUI chat sessions.
// Input: Chat tab runtime metadata indicating a cli-tui session.
// Position: Owned by TUI so chat tab registration can defer terminal UI code without eager implementation imports.

export function loadTuiView() {
  return import('~/features/tui/tui-view').then(module => ({ default: module.TuiView }))
}

export function preloadTuiView(): void {
  void loadTuiView()
}
