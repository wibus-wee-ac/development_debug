// Output: Compact Composer control for Claude Agent permission mode.
// Input: Current permission mode, pending state, and a mode change callback.
// Position: Chat-owned Composer accessory shared by normal and detached chat views.

import { PanelTopIcon, PenLineIcon } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'

import type { ChatPermissionMode } from './use-chat-session'

export function PermissionModeControl({
  mode,
  pending,
  disabled,
  onModeChange,
}: {
  mode: ChatPermissionMode
  pending?: boolean
  disabled?: boolean
  onModeChange: (mode: ChatPermissionMode) => void
}) {
  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(value) => {
        if (value === 'plan' || value === 'acceptEdits') {
          onModeChange(value)
        }
      }}
      variant="outline"
      size="sm"
      spacing={0}
      className="rounded-md bg-background/80 shadow-sm"
      aria-label="Runtime permission mode"
      data-testid="chat-permission-mode-control"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem
            value="plan"
            disabled={disabled || pending}
            aria-label="Plan mode"
            className="h-7 min-w-16 gap-1.5 text-[11px] data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
          >
            <PanelTopIcon className="size-3.5" aria-hidden />
            <span>Plan</span>
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent side="top">Plan mode</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem
            value="acceptEdits"
            disabled={disabled || pending}
            aria-label="Edit mode"
            className="h-7 min-w-16 gap-1.5 text-[11px] data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
          >
            <PenLineIcon className="size-3.5" aria-hidden />
            <span>Edit</span>
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent side="top">Edit mode</TooltipContent>
      </Tooltip>
    </ToggleGroup>
  )
}
