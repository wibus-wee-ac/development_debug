import { AgentList } from '~/features/agent-management/agent-list'
import { AgentRuntimeSettings } from '~/features/agent-management/agent-runtime-settings'
import { ChronicleSettings } from '~/features/chronicle/chronicle-settings'
import { GlobalSkillsSettings } from '~/features/skills/global-skills-settings'
import { cn } from '~/lib/cn'

import { AppearanceSettings } from './appearance-settings'
import { ChatSettings } from './chat-settings'
import { DesktopUpdateSettings } from './desktop-update-settings'
import { ExternalWorkImportSettings } from './external-work-import-settings'
import { JarvisSettings } from './jarvis-settings'
import { ModelRegistrySettings } from './model-registry-settings'
import { SupportSettings } from './support-settings'

const SECTION_MAP: Record<string, React.ComponentType> = {
  appearance: AppearanceSettings,
  providers: AgentRuntimeSettings,
  registry: ModelRegistrySettings,
  agents: AgentList,
  chat: ChatSettings,
  jarvis: JarvisSettings,
  chronicle: ChronicleSettings,
  skills: GlobalSkillsSettings,
  desktop: DesktopUpdateSettings,
  import: ExternalWorkImportSettings,
  support: SupportSettings,
}

const FIXED_HEIGHT_SECTIONS = new Set(['import'])

interface SettingsContentProps {
  section: string
}

export function SettingsContent({ section }: SettingsContentProps) {
  const ActiveSection = SECTION_MAP[section] ?? AppearanceSettings
  const fixedHeight = FIXED_HEIGHT_SECTIONS.has(section)

  return (
    <div className="h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden">
      <div
        className={cn(
          'box-border h-full w-full min-w-0 px-8 pt-10',
          fixedHeight ? 'overflow-hidden' : 'overflow-y-auto pb-10',
        )}
      >
        <ActiveSection />
      </div>
    </div>
  )
}
