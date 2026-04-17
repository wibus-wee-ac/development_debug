// Input: useSidebarNavStore, settings section components
// Output: SettingsContent component — renders active settings section in main area
// Position: Main content area when sidebar is in settings view

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { useSidebarNavStore } from '@renderer/store/sidebar-nav'

import { AcpSettings } from './acp-settings'
import { AppearanceSettings } from './appearance-settings'

const SECTION_MAP: Record<string, React.ComponentType> = {
  appearance: AppearanceSettings,
  acp: AcpSettings,
}

export function SettingsContent() {
  const section = useSidebarNavStore(s => s.settingsSection)
  const ActiveSection = SECTION_MAP[section] ?? AppearanceSettings

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto max-w-2xl px-8 pt-10 pb-6">
        <ActiveSection />
      </div>
    </ScrollArea>
  )
}
