import { ChevronDownIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { PROVIDER_ICONS, RUNTIME_ICON_KEYS } from '~/components/common/provider-icons'
import { cn } from '~/lib/cn'
import type { RuntimeKind } from '~/lib/types'

import { RUNTIME_KIND_OPTIONS } from './constants'

type CommonKey = keyof typeof import('~/locales/default').default.common
type RuntimeOptionKind = (typeof RUNTIME_KIND_OPTIONS)[number]['value']

const runtimeLabelKeys = {
  'standard': 'runtime.standard.label',
  'claude-agent': 'runtime.claudeAgent.label',
  'codex': 'runtime.codex.label',
  'cli-tui': 'runtime.cliTui.label',
} satisfies Record<RuntimeOptionKind, CommonKey>

const runtimeDescriptionKeys = {
  'standard': 'runtime.standard.description',
  'claude-agent': 'runtime.claudeAgent.description',
  'codex': 'runtime.codex.description',
  'cli-tui': 'runtime.cliTui.description',
} satisfies Record<RuntimeOptionKind, CommonKey>

const runtimeFallbackLabels: Record<RuntimeKind, string> = {
  'standard': 'Standard',
  'claude-agent': 'Claude Agent',
  'codex': 'Codex',
  'cli-tui': 'CLI TUI',
  'jar-core': 'Jar Core',
  'acp-chat': 'ACP Chat',
}

interface RuntimeSelectorProps {
  value: RuntimeKind
  onChange: (kind: RuntimeKind) => void
  readOnly?: boolean
}

export function RuntimeSelector({ value, onChange, readOnly }: RuntimeSelectorProps) {
  const { t } = useTranslation('common')
  const current = RUNTIME_KIND_OPTIONS.find(o => o.value === value) ?? RUNTIME_KIND_OPTIONS[0]
  const Icon = PROVIDER_ICONS[RUNTIME_ICON_KEYS[value]] ?? PROVIDER_ICONS.custom!

  if (readOnly) {
    const label = current.value === value ? t(runtimeLabelKeys[current.value]) : runtimeFallbackLabels[value]

    return (
      <Button
        variant="ghost"
        size="xs"
        disabled
        data-testid="runtime-selector"
        aria-label={label}
        className="disabled:pointer-events-auto disabled:opacity-70"
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="hidden min-[480px]:inline">{label}</span>
      </Button>
    )
  }

  return (
    <Menu>
      <MenuTrigger
        render={(
          <Button variant="ghost" size="xs" data-testid="runtime-selector" />
        )}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="hidden min-[480px]:inline">{t(runtimeLabelKeys[current.value])}</span>
        <ChevronDownIcon className="size-2.5 shrink-0 text-muted-foreground/50" />
      </MenuTrigger>
      <MenuPopup align="start" side="top" sideOffset={4}>
        {RUNTIME_KIND_OPTIONS.map((opt) => {
          const OptIcon = PROVIDER_ICONS[RUNTIME_ICON_KEYS[opt.value]] ?? PROVIDER_ICONS.custom!
          return (
            <MenuItem
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(value === opt.value && 'font-medium')}
            >
              <OptIcon className="size-3.5" />
              <div className="flex flex-col">
                <span>{t(runtimeLabelKeys[opt.value])}</span>
                <span className="text-[11px] text-muted-foreground">
                  {t(runtimeDescriptionKeys[opt.value])}
                </span>
              </div>
            </MenuItem>
          )
        })}
      </MenuPopup>
    </Menu>
  )
}
