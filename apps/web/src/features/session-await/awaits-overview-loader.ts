// Output: Shared lazy loader and preload hook for the awaits overview route.
// Input: Tab open and background route preload intent.
// Position: Owned by Session Await so tab registration can avoid cold lazy blanks.

export function loadAwaitsOverview() {
  return import('~/features/session-await/awaits-overview').then(module => ({ default: module.AwaitsOverview }))
}

export function preloadAwaitsOverview(): void {
  void loadAwaitsOverview()
}
