// Input: section prop (string), settings section components
// Output: SettingsContent component — renders active settings section in main area
// Position: Main content area rendered by AppLayout when isSettings=true

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { AgentList } from '@renderer/features/agent-management/agent-list'
import { AgentRuntimeSettings } from '@renderer/features/agent-management/agent-runtime-settings'
import { GlobalSkillsSettings } from '@renderer/features/skills/global-skills-settings'

import { AppearanceSettings } from './appearance-settings'

const SECTION_MAP: Record<string, React.ComponentType> = {
  appearance: AppearanceSettings,
  providers: AgentRuntimeSettings,
  agents: AgentList,
  skills: GlobalSkillsSettings,
}

interface SettingsContentProps {
  section: string
}

export function SettingsContent({ section }: SettingsContentProps) {
  const ActiveSection = SECTION_MAP[section] ?? AppearanceSettings

  return (
    <ScrollArea className="flex-1">
      <div className="px-8 pt-10 pb-6">
        <ActiveSection />
      </div>
    </ScrollArea>
  )
}
