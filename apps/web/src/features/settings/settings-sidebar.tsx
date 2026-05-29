import { ActivityIcon, ArrowDownToLineIcon, ArrowLeftIcon, BotIcon, DatabaseIcon, DownloadIcon, HourglassIcon, LifeBuoyIcon, MessageSquareIcon, MousePointer2Icon, PaletteIcon, PlugIcon, SparklesIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

interface SettingsNavItem {
  id: string
  labelKey: SettingsKey
  icon: typeof PaletteIcon
}

const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'appearance', labelKey: 'nav.appearance', icon: PaletteIcon },
  { id: 'providers', labelKey: 'nav.providers', icon: PlugIcon },
  { id: 'registry', labelKey: 'nav.registry', icon: DatabaseIcon },
  { id: 'agents', labelKey: 'nav.agents', icon: BotIcon },
  { id: 'chat', labelKey: 'nav.chat', icon: MessageSquareIcon },
  { id: 'await', labelKey: 'nav.await', icon: HourglassIcon },
  { id: 'jarvis', labelKey: 'nav.jarvis', icon: MousePointer2Icon },
  { id: 'chronicle', labelKey: 'nav.chronicle', icon: ActivityIcon },
  { id: 'skills', labelKey: 'nav.skills', icon: SparklesIcon },
  { id: 'desktop', labelKey: 'nav.desktop', icon: DownloadIcon },
  { id: 'import', labelKey: 'nav.import', icon: ArrowDownToLineIcon },
  { id: 'support', labelKey: 'nav.support', icon: LifeBuoyIcon },
]

interface SettingsSidebarProps {
  activeSection: string
  onSetSection: (section: string) => void
  onClose: () => void
}

export function SettingsSidebar({ activeSection, onSetSection, onClose }: SettingsSidebarProps) {
  const { t } = useTranslation('settings')

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Back header */}
      <div className="flex items-center gap-1.5 px-3 py-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={t('sidebar.close')}
          data-testid="settings-close"
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <span className="text-xs font-medium text-foreground select-none">{t('sidebar.title')}</span>
      </div>

      {/* Section nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-2">
        {SETTINGS_NAV.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSetSection(id)}
            data-testid={`settings-nav-${id}`}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs',
              activeSection === id
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {t(labelKey)}
          </button>
        ))}
      </nav>
    </div>
  )
}
