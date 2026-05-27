// Output: Shared lazy loader and preload hook for the automation dashboard route.
// Input: Tab open and background route preload intent.
// Position: Owned by Automation so tab registration can avoid cold lazy blanks.

export function loadAutomationDashboard() {
  return import('~/features/automation').then(module => ({ default: module.AutomationDashboard }))
}

export function preloadAutomationDashboard(): void {
  void loadAutomationDashboard()
}
