// Output: Shared lazy loader and preload hook for the usage dashboard route.
// Input: Tab open and background route preload intent.
// Position: Owned by Usage so tab registration can avoid cold lazy blanks.

export function loadUsageDashboard() {
  return import('~/features/usage/usage-dashboard').then(module => ({ default: module.UsageDashboard }))
}

export function preloadUsageDashboard(): void {
  void loadUsageDashboard()
}
