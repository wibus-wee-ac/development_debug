// Input: section prop (string), settings section components
// Output: SettingsContent component — renders active settings section in main area
// Position: Main content area rendered by AppLayout when isSettings=true

import { AgentList } from '~/features/agent-management/agent-list'
import { AgentRuntimeSettings } from '~/features/agent-management/agent-runtime-settings'
import { ChronicleSettings } from '~/features/chronicle/chronicle-settings'
import { GlobalSkillsSettings } from '~/features/skills/global-skills-settings'

import { AppearanceSettings } from './appearance-settings'
import { JarvisSettings } from './jarvis-settings'

const SECTION_MAP: Record<string, React.ComponentType> = {
  appearance: AppearanceSettings,
  providers: AgentRuntimeSettings,
  agents: AgentList,
  jarvis: JarvisSettings,
  chronicle: ChronicleSettings,
  skills: GlobalSkillsSettings,
}

interface SettingsContentProps {
  section: string
}

export function SettingsContent({ section }: SettingsContentProps) {
  const ActiveSection = SECTION_MAP[section] ?? AppearanceSettings

  return (
    <div className="flex-1 min-h-0 overflow-y-auto h-full">
      <div className="px-8 pt-10 h-full">
        <ActiveSection />
      </div>
    </div>
  )
}
