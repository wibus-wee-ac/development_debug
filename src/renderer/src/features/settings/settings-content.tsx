// Input: useSidebarNavStore, settings section components
// Output: SettingsContent component — renders active settings section in main area
// Position: Main content area when sidebar is in settings view

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { useSidebarNavStore } from '@renderer/store/sidebar-nav'

import { AppearanceSettings } from './appearance-settings'

const SECTION_MAP: Record<string, React.ComponentType> = {
  appearance: AppearanceSettings,
}

export function SettingsContent() {
  const section = useSidebarNavStore(s => s.settingsSection)
  const ActiveSection = SECTION_MAP[section] ?? AppearanceSettings

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto max-w-xl px-8 py-6">
        <ActiveSection />
      </div>
    </ScrollArea>
  )
}
