// Input: coss UI primitives (Button, Separator), props: activeSection, onSetSection, onClose
// Output: SettingsSidebar component — section navigation for settings view
// Position: Sidebar content shown in AppSidebar when isSettings=true; fully prop-driven

import { ArrowLeftIcon, BotIcon, MousePointer2Icon, PaletteIcon, PlugIcon, SparklesIcon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

interface SettingsNavItem {
  id: string
  label: string
  icon: typeof PaletteIcon
}

const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'appearance', label: '外观', icon: PaletteIcon },
  { id: 'providers', label: 'Providers', icon: PlugIcon },
  { id: 'agents', label: 'Agents', icon: BotIcon },
  { id: 'jarvis', label: 'Jarvis', icon: MousePointer2Icon },
  { id: 'skills', label: 'Skills', icon: SparklesIcon },
]

interface SettingsSidebarProps {
  activeSection: string
  onSetSection: (section: string) => void
  onClose: () => void
}

export function SettingsSidebar({ activeSection, onSetSection, onClose }: SettingsSidebarProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Back header */}
      <div className="flex items-center gap-1.5 px-3 py-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
        >
          <ArrowLeftIcon />
        </Button>
        <span className="text-xs font-medium text-foreground select-none">设置</span>
      </div>

      {/* Section nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-2">
        {SETTINGS_NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSetSection(id)}
            data-testid={`settings-nav-${id}`}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
              activeSection === id
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
