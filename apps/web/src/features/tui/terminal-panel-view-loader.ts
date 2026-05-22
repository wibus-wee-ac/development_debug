// Output: Shared lazy loader and preload hook for the TUI terminal bottom panel.
// Input: Chat tab workspace panel intent.
// Position: Owned by TUI so chat tab registration can defer terminal panel code without eager implementation imports.

export function loadTerminalPanelView() {
  return import('~/features/tui/bottom-terminal-panel').then(module => ({ default: module.BottomTerminalPanel }))
}

export function preloadTerminalPanelView(): void {
  void loadTerminalPanelView()
}
