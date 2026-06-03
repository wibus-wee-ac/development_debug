import { BrainIcon, CpuIcon, Settings2Icon, SlidersHorizontalIcon, SparklesIcon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'

import type { ChatRuntimeUiSlot, ChatRuntimeUiSlotState } from './chat-capabilities'

interface RuntimeToolbarOptionsProps {
  slots: ChatRuntimeUiSlot[]
  states: ChatRuntimeUiSlotState[]
}

export function RuntimeToolbarOptions({ slots, states }: RuntimeToolbarOptionsProps) {
  const optionSlots = slots.filter(slot => slot.surfaces.includes('toolbarPicker'))

  if (optionSlots.length === 0) {
    return null
  }

  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="xs" aria-label="Runtime options" data-testid="runtime-toolbar-options" />}>
        <SlidersHorizontalIcon className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup side="top" align="start" className="w-64">
        <MenuGroup>
          <MenuGroupLabel>Runtime options</MenuGroupLabel>
          {optionSlots.map(slot => (
            <MenuItem key={slot.id} disabled className="items-start gap-2 py-2">
              <RuntimeOptionIcon slot={slot} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{slot.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {readOptionSummary(slot, states)}
                </span>
              </span>
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )
}

function RuntimeOptionIcon({ slot }: { slot: ChatRuntimeUiSlot }) {
  switch (slot.iconKey) {
    case 'model':
      return <CpuIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    case 'reasoning':
      return <BrainIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    case 'config':
      return <Settings2Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    case 'personality':
      return <SparklesIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    default:
      return <SlidersHorizontalIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
  }
}

function readOptionSummary(slot: ChatRuntimeUiSlot, states: ChatRuntimeUiSlotState[]): string {
  const state = states.find(candidate => candidate.slotId === slot.id)
  if (!state) {
    return slot.description
  }

  switch (state.kind) {
    case 'model':
      return [state.modelLabel ?? state.modelId, state.modelProvider].filter(Boolean).join(' · ') || slot.description
    case 'reasoning':
      return [state.effort ?? 'Default', state.summary].filter(Boolean).join(' · ')
    case 'config':
      return [state.approvalPolicy, state.sandboxMode].filter(Boolean).join(' · ') || slot.description
    default:
      return slot.description
  }
}
