import { ActivityIcon, ArrowDownToLineIcon, ArrowLeftIcon, BotIcon, BoxesIcon, DatabaseIcon, FlagIcon, HourglassIcon, InfoIcon, LifeBuoyIcon, MessageSquareIcon, MonitorIcon, MousePointer2Icon, PaletteIcon, PlugIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

interface SettingsNavItem {
  id: string
  labelKey: SettingsKey
  icon: typeof PaletteIcon
}

interface SettingsSection {
  labelKey: SettingsKey
  items: SettingsNavItem[]
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    labelKey: 'sidebar.section.general',
    items: [
      { id: 'appearance', labelKey: 'nav.appearance', icon: PaletteIcon },
    ],
  },
  {
    labelKey: 'sidebar.section.models',
    items: [
      { id: 'providers', labelKey: 'nav.providers', icon: PlugIcon },
      { id: 'registry', labelKey: 'nav.registry', icon: DatabaseIcon },
    ],
  },
  {
    labelKey: 'sidebar.section.runtime',
    items: [
      { id: 'agents', labelKey: 'nav.agents', icon: BotIcon },
      { id: 'chat', labelKey: 'nav.chat', icon: MessageSquareIcon },
      { id: 'await', labelKey: 'nav.await', icon: HourglassIcon },
      { id: 'jarvis', labelKey: 'nav.jarvis', icon: MousePointer2Icon },
      ...(import.meta.env.DEV
        ? [{ id: 'chronicle', labelKey: 'nav.chronicle', icon: ActivityIcon } satisfies SettingsNavItem]
        : []),
    ],
  },
  {
    labelKey: 'sidebar.section.system',
    items: [
      { id: 'desktop', labelKey: 'nav.desktop', icon: MonitorIcon },
      { id: 'features', labelKey: 'nav.features', icon: FlagIcon },
      { id: 'externalIssues', labelKey: 'nav.externalIssues', icon: BoxesIcon },
      { id: 'import', labelKey: 'nav.import', icon: ArrowDownToLineIcon },
    ],
  },
  {
    labelKey: 'sidebar.section.help',
    items: [
      { id: 'support', labelKey: 'nav.support', icon: LifeBuoyIcon },
      { id: 'about', labelKey: 'nav.about', icon: InfoIcon },
    ],
  },
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

      {/* Sectioned nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-2">
        {SETTINGS_SECTIONS.map(({ labelKey, items }) => (
          <div key={labelKey} className="flex flex-col gap-0.5">
            <span className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground select-none">
              {t(labelKey)}
            </span>
            {items.map(({ id, labelKey: itemLabelKey, icon: Icon }) => (
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
                {t(itemLabelKey)}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </div>
  )
}
