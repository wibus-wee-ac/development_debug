// Output: Shared lazy loader and preload hook for CLI-TUI chat sessions.
// Input: Chat tab runtime metadata indicating a cli-tui session.
// Position: Owned by TUI so chat tab registration can defer terminal UI code without eager implementation imports.

import { markCradlePerformance } from '~/lib/perf-monitor'

let firstRequestMarked = false

export function loadTuiView() {
  if (!firstRequestMarked) {
    firstRequestMarked = true
    markCradlePerformance('cradle:tui-view-render-requested')
  }
  return import('~/features/tui/tui-view').then(module => ({ default: module.TuiView }))
}

export function preloadTuiView(): void {
  void loadTuiView()
}
