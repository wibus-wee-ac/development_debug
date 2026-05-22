// Output: Lightweight command palette open helpers and performance markers.
// Input: User intent to open the global search dialog.
// Position: Imported by shell-level open handlers without coupling them to dialog component state.

import { flushSync } from 'react-dom'

import { markCradlePerformance } from '~/lib/perf-monitor'

import { useGlobalSearchStore } from './global-search-store'

export function markCommandPaletteOpenRequested(): void {
  markCradlePerformance('cradle:command-palette-open-requested')
}

export function openCommandPalette(): void {
  markCommandPaletteOpenRequested()
  flushSync(() => {
    useGlobalSearchStore.getState().openSearch()
  })
}
