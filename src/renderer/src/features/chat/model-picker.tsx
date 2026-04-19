// Input: SessionModelState + ModelInfo from ACP SDK, Combobox primitives from components/ui
// Output: ModelPicker component — button-triggered combobox with searchable model list
// Position: Shared composer toolbar widget used by NewChatHome and the chat session route

import type { ModelInfo, SessionModelState } from '@agentclientprotocol/sdk'
import { Button } from '@renderer/components/ui/button'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPrimitive,
} from '@renderer/components/ui/combobox'
import { cn } from '@renderer/lib/utils'
import { ChevronDownIcon, SearchIcon } from 'lucide-react'
import { useMemo } from 'react'

interface ModelPickerProps {
  models: SessionModelState
  onSelect: (modelId: string) => void | Promise<void>
  disabled?: boolean
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ModelPicker({
  models,
  onSelect,
  disabled,
  className,
  open,
  onOpenChange,
}: ModelPickerProps) {
  const currentModel = useMemo(
    () => models.availableModels.find(m => m.modelId === models.currentModelId) ?? null,
    [models.availableModels, models.currentModelId],
  )

  const triggerLabel = currentModel?.name ?? models.currentModelId

  return (
    <Combobox<ModelInfo>
      items={models.availableModels}
      value={currentModel}
      itemToStringLabel={m => m.name}
      isItemEqualToValue={(a, b) => a.modelId === b.modelId}
      open={open}
      onOpenChange={onOpenChange ? next => onOpenChange(next) : undefined}
      onValueChange={(next) => {
        if (next && next.modelId !== models.currentModelId) {
          void onSelect(next.modelId)
        }
      }}
    >
      <ComboboxPrimitive.Trigger
        disabled={disabled}
        render={(
          <Button
            variant="ghost"
            size="xs"
            className={cn('text-muted-foreground/70 hover:text-foreground', className)}
          />
        )}
      >
        {triggerLabel}
        <ChevronDownIcon aria-hidden="true" />
      </ComboboxPrimitive.Trigger>
      <ComboboxPopup aria-label="选择模型" className="min-w-60">
        <div className="border-b p-2">
          <ComboboxInput
            size="sm"
            showTrigger={false}
            startAddon={<SearchIcon />}
            placeholder="搜索模型..."
            className="rounded-md before:rounded-[calc(var(--radius-md)-1px)]"
          />
        </div>
        <ComboboxEmpty>未找到匹配的模型</ComboboxEmpty>
        <ComboboxList>
          {(item: ModelInfo) => (
            <ComboboxItem key={item.modelId} value={item}>
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{item.name}</span>
                {item.description
? (
                  <span className="truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                )
: null}
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  )
}
