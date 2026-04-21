// Input: SettingsSidebar, SettingsContent from settings feature, TanStack Router
// Output: Settings page route — full-page two-column settings layout
// Position: Route for /settings; replaces the shell-state-based settings view

import { SettingsContent } from '@renderer/features/settings/settings-content'
import { SettingsSidebar } from '@renderer/features/settings/settings-sidebar'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    section: (search.section as string | undefined) ?? 'appearance',
  }),
})

function SettingsPage() {
  return (
    <div className="flex h-screen w-screen overflow-hidden text-foreground bg-sidebar">
      {/* Narrow nav sidebar */}
      <aside
        className="flex flex-col w-55 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground overflow-hidden"
      >
        <div className="h-11 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <SettingsSidebar />
      </aside>

      {/* Main content area */}
      <main className="flex-1 bg-background overflow-hidden">
        <SettingsContent />
      </main>
    </div>
  )
}
