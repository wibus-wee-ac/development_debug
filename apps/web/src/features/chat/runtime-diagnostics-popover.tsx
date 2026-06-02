// Output: Dev-only runtime diagnostics popover for chat provider environment metadata.
// Input: Provider-owned runtime UI slot capabilities and latest slot states.
// Position: Chat feature floating diagnostics surface; provider semantics stay owned by the runtime provider.

import { Settings2Icon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'

import type { ChatRuntimeUiSlot, ChatRuntimeUiSlotState } from './chat-capabilities'
import { RuntimeUiSlotPanel } from './runtime-ui-slot-panel'

interface RuntimeDiagnosticsPopoverProps {
  slots: ChatRuntimeUiSlot[]
  states: ChatRuntimeUiSlotState[]
}

const DIAGNOSTIC_STATE_KINDS = new Set<ChatRuntimeUiSlotState['kind']>([
  'config',
  'mcp',
  'model',
  'plugin',
  'reasoning',
  'skills',
  'status',
  'usage',
])

const DIAGNOSTIC_SLOT_NAMES = new Set([
  'config',
  'mcp',
  'model',
  'plugin',
  'plugins',
  'reasoning',
  'skills',
  'status',
  'usage',
])

export function RuntimeDiagnosticsPopover({ slots, states }: RuntimeDiagnosticsPopoverProps) {
  if (!import.meta.env.DEV) {
    return null
  }

  const diagnosticStates = states.filter(state => DIAGNOSTIC_STATE_KINDS.has(state.kind))
  const diagnosticSlotIds = new Set(diagnosticStates.map(state => state.slotId))
  const diagnosticSlots = slots.filter(slot => (
    diagnosticSlotIds.has(slot.id)
    || DIAGNOSTIC_SLOT_NAMES.has(slot.name)
    || (slot.iconKey ? DIAGNOSTIC_SLOT_NAMES.has(slot.iconKey) : false)
  ))
  const activeCount = diagnosticStates.length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-10 rounded-lg bg-background/85 text-muted-foreground shadow-sm ring-1 ring-foreground/10 backdrop-blur-sm transition-transform hover:text-foreground active:scale-[0.96]"
          aria-label="Runtime diagnostics"
          title="Runtime diagnostics"
          data-testid="runtime-diagnostics-trigger"
        >
          <Settings2Icon className="size-4" aria-hidden="true" />
          {activeCount > 0 && (
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary ring-2 ring-background" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[min(680px,calc(100vh-7rem))] w-80 gap-0 overflow-auto p-3"
        data-testid="runtime-diagnostics-popover"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">Runtime diagnostics</h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {activeCount > 0 ? `${activeCount} environment states` : 'No environment state'}
            </p>
          </div>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            Dev
          </span>
        </div>
        <div className="space-y-3">
          <RuntimeUiSlotPanel slots={diagnosticSlots} states={diagnosticStates} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
