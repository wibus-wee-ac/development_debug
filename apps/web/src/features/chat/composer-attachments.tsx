/**
 * Output: Shared UI primitives for chat composer file attachments.
 * Input: Attachment state from composer-attachment-state.
 * Position: Chat feature owns visual attachment controls consumed by all composer surfaces.
 */

import type { FileUIPart } from 'ai'
import { FileIcon, PaperclipIcon, XIcon } from 'lucide-react'
import type { ChangeEvent, RefObject } from 'react'

import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

interface ComposerAttachmentInputProps {
  fileInputRef: RefObject<HTMLInputElement | null>
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  supportsAttachments: boolean
  testId?: string
}

interface ComposerAttachmentButtonProps {
  disabled?: boolean
  className?: string
  iconClassName?: string
  onPickFiles: () => void
  supportsAttachments: boolean
  testId?: string
}

interface ComposerAttachmentListProps {
  attachments: FileUIPart[]
  onRemove: (index: number) => void
  className?: string
}

export function ComposerAttachmentInput({
  fileInputRef,
  onFilesSelected,
  supportsAttachments,
  testId = 'chat-file-input',
}: ComposerAttachmentInputProps) {
  return (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept={supportsAttachments ? undefined : ''}
      className="hidden"
      tabIndex={-1}
      aria-label="Attach files"
      onChange={onFilesSelected}
      data-testid={testId}
    />
  )
}

export function ComposerAttachmentButton({
  disabled,
  className,
  iconClassName,
  onPickFiles,
  supportsAttachments,
  testId = 'chat-attach-btn',
}: ComposerAttachmentButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled || !supportsAttachments}
          onClick={onPickFiles}
          aria-label="Attach files"
          className={className}
          data-testid={testId}
        >
          <PaperclipIcon className={cn('size-3.5', iconClassName)} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">
        {supportsAttachments ? 'Attach files' : 'Current model does not accept file input'}
      </TooltipContent>
    </Tooltip>
  )
}

export function ComposerAttachmentList({
  attachments,
  onRemove,
  className,
}: ComposerAttachmentListProps) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <div className={cn('flex flex-wrap gap-1.5 border-t border-border/40 px-3 py-2', className)}>
      {attachments.map((attachment, index) => {
        const label = attachment.filename ?? attachment.mediaType
        const isImage = attachment.mediaType.startsWith('image/')
        return (
          <div
            key={`${attachment.url}-${attachment.filename ?? attachment.mediaType}`}
            className="flex max-w-64 items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
            data-testid="chat-attachment-chip"
          >
            {isImage
              ? (
                  <img
                    src={attachment.url}
                    alt={label}
                    className="size-10 shrink-0 rounded-[4px] object-cover shadow-[inset_0_0_0_1px_rgba(0,0,0,0.10)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
                    data-testid="chat-attachment-image-preview"
                  />
                )
              : <FileIcon className="size-3.5 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 truncate">{label}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="-mr-1 size-5"
              onClick={() => onRemove(index)}
              aria-label={`Remove ${label}`}
              data-testid="chat-remove-attachment-btn"
            >
              <XIcon className="size-3" aria-hidden="true" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
