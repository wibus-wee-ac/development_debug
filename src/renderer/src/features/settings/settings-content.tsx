// Input: TanStack Router useSearch, settings section components
// Output: SettingsContent component — renders active settings section in main area
// Position: Main content area in /settings route

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { useSearch } from '@tanstack/react-router'

import { AcpSettings } from '@renderer/features/acp-management'
import { AppearanceSettings } from './appearance-settings'
import { CliSettings } from './cli-settings'

const SECTION_MAP: Record<string, React.ComponentType> = {
  appearance: AppearanceSettings,
  acp: AcpSettings,
  cli: CliSettings,
}

export function SettingsContent() {
  const search = useSearch({ from: '/settings' })
  const section = search.section ?? 'appearance'
  const ActiveSection = SECTION_MAP[section] ?? AppearanceSettings

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto max-w-2xl px-8 pt-10 pb-6">
        <ActiveSection />
      </div>
    </ScrollArea>
  )
}
