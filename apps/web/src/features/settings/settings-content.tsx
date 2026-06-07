import { AgentList } from '~/features/agent-management/agent-list'
import { AgentRuntimeSettings } from '~/features/agent-management/agent-runtime-settings'
import { ChronicleSettings } from '~/features/chronicle/chronicle-settings'
import { cn } from '~/lib/cn'

import { AboutSettings } from './about-settings'
import { AppearanceSettings } from './appearance-settings'
import { AwaitSettings } from './await-settings'
import { ChatSettings } from './chat-settings'
import { DesktopUpdateSettings } from './desktop-update-settings'
import { ExternalWorkImportSettings } from './external-work-import-settings'
import { JarvisSettings } from './jarvis-settings'
import { ModelRegistrySettings } from './model-registry-settings'
import { ShortcutsSettings } from './shortcuts-settings'
import { SupportSettings } from './support-settings'

const SECTION_MAP: Record<string, React.ComponentType> = {
  appearance: AppearanceSettings,
  providers: AgentRuntimeSettings,
  registry: ModelRegistrySettings,
  agents: AgentList,
  chat: ChatSettings,
  shortcuts: ShortcutsSettings,
  await: AwaitSettings,
  jarvis: JarvisSettings,
  chronicle: ChronicleSettings,
  desktop: DesktopUpdateSettings,
  import: ExternalWorkImportSettings,
  support: SupportSettings,
  about: AboutSettings,
}

const FIXED_HEIGHT_SECTIONS = new Set(['import', 'registry'])

interface SettingsContentProps {
  section: string
}

export function SettingsContent({ section }: SettingsContentProps) {
  const activeSection = !import.meta.env.DEV && section === 'chronicle' ? 'appearance' : section
  const ActiveSection = SECTION_MAP[activeSection] ?? AppearanceSettings
  const fixedHeight = FIXED_HEIGHT_SECTIONS.has(activeSection)

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
