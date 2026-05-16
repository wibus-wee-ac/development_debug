// Input: Menu, RuntimeKind options
// Output: RuntimeSelector — pill button for Agent Runtime kind
// Position: Separate selector in the composer toolbar (rarely changed)

import { BotIcon, ChevronDownIcon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import type { RuntimeKind } from '~/lib/types'
import { cn } from '~/lib/cn'

import { RUNTIME_KIND_OPTIONS } from './constants'

interface RuntimeSelectorProps {
  value: RuntimeKind
  onChange: (kind: RuntimeKind) => void
}

export function RuntimeSelector({ value, onChange }: RuntimeSelectorProps) {
  const current = RUNTIME_KIND_OPTIONS.find(o => o.value === value) ?? RUNTIME_KIND_OPTIONS[0]

  return (
    <Menu>
      <MenuTrigger
        render={(
          <Button variant="ghost" size="xs" data-testid="runtime-selector" />
        )}
      >
        <BotIcon className="size-3 shrink-0 text-muted-foreground/70" />
        <span>{current.label}</span>
        <ChevronDownIcon className="size-2.5 shrink-0 text-muted-foreground/50" />
      </MenuTrigger>
      <MenuPopup align="start" side="top" sideOffset={4}>
        {RUNTIME_KIND_OPTIONS.map(opt => (
          <MenuItem
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(value === opt.value && 'font-medium')}
          >
            <div className="flex flex-col">
              <span>{opt.label}</span>
              <span className="text-[11px] text-muted-foreground">{opt.description}</span>
            </div>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}
