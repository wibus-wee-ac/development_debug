import { AgentList } from '~/features/agent-management/agent-list'
import { AgentRuntimeSettings } from '~/features/agent-management/agent-runtime-settings'
import { ChronicleSettings } from '~/features/chronicle/chronicle-settings'
import { GlobalSkillsSettings } from '~/features/skills/global-skills-settings'

import { AppearanceSettings } from './appearance-settings'
import { ChatSettings } from './chat-settings'
import { DesktopUpdateSettings } from './desktop-update-settings'
import { JarvisSettings } from './jarvis-settings'
import { SupportSettings } from './support-settings'

const SECTION_MAP: Record<string, React.ComponentType> = {
  appearance: AppearanceSettings,
  providers: AgentRuntimeSettings,
  agents: AgentList,
  chat: ChatSettings,
  jarvis: JarvisSettings,
  chronicle: ChronicleSettings,
  skills: GlobalSkillsSettings,
  desktop: DesktopUpdateSettings,
  support: SupportSettings,
}

interface SettingsContentProps {
  section: string
}

export function SettingsContent({ section }: SettingsContentProps) {
  const ActiveSection = SECTION_MAP[section] ?? AppearanceSettings

  return (
    <div className="h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden">
      <div className="box-border h-full w-full min-w-0 overflow-hidden px-8 pt-10">
        <ActiveSection />
      </div>
    </div>
  )
}
