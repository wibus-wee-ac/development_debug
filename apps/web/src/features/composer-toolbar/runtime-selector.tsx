import { ChevronDownIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { PROVIDER_ICONS } from '~/features/agent-management/provider-icons'
import { cn } from '~/lib/cn'
import type { RuntimeKind } from '~/lib/types'

import { RUNTIME_KIND_OPTIONS } from './constants'

type CommonKey = keyof typeof import('~/locales/default').default.common
type RuntimeOptionKind = (typeof RUNTIME_KIND_OPTIONS)[number]['value']

const RUNTIME_ICON_KEYS: Record<RuntimeKind, string> = {
  'standard': 'custom',
  'claude-agent': 'claude-agent',
  'codex': 'codex',
  'cli-tui': 'claude-cli',
  'jar-core': 'anthropic',
  'acp-chat': 'custom',
}

const runtimeLabelKeys = {
  standard: 'runtime.standard.label',
  'claude-agent': 'runtime.claudeAgent.label',
  codex: 'runtime.codex.label',
  'cli-tui': 'runtime.cliTui.label',
} satisfies Record<RuntimeOptionKind, CommonKey>

const runtimeDescriptionKeys = {
  standard: 'runtime.standard.description',
  'claude-agent': 'runtime.claudeAgent.description',
  codex: 'runtime.codex.description',
  'cli-tui': 'runtime.cliTui.description',
} satisfies Record<RuntimeOptionKind, CommonKey>

interface RuntimeSelectorProps {
  value: RuntimeKind
  onChange: (kind: RuntimeKind) => void
}

export function RuntimeSelector({ value, onChange }: RuntimeSelectorProps) {
  const { t } = useTranslation('common')
  const current = RUNTIME_KIND_OPTIONS.find(o => o.value === value) ?? RUNTIME_KIND_OPTIONS[0]
  const Icon = PROVIDER_ICONS[RUNTIME_ICON_KEYS[value]] ?? PROVIDER_ICONS.custom!

  return (
    <Menu>
      <MenuTrigger
        render={(
          <Button variant="ghost" size="xs" data-testid="runtime-selector" />
        )}
      >
        <Icon className="size-3.5 shrink-0" />
        <span>{t(runtimeLabelKeys[current.value])}</span>
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
