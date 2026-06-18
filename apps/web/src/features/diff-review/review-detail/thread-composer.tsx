import { MessageSquarePlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'

import type { CodeViewLineSelection } from '../shared/diff-items'
import { formatSelectedReviewRange, getSelectedReviewRange } from '../shared/diff-items'
import type { ReviewFile } from '../shared/types'

interface ThreadComposerProps {
  selection: CodeViewLineSelection
  files: ReviewFile[]
  itemIdToPath: Map<string, string>
  onClose: () => void
  onCreate: (input: { fileId: string, anchor: { fileId: string, side: 'base' | 'head', startLine: number, endLine: number }, bodyMarkdown: string }) => void
  pending: boolean
}

export function ThreadComposer({
  selection,
  files,
  itemIdToPath,
  onClose,
  onCreate,
  pending,
}: ThreadComposerProps) {
  const [draft, setDraft] = useState('')
  const range = getSelectedReviewRange(selection, files, itemIdToPath)

  if (!range) {
    return null
  }

  return (
    <div
      className="absolute inset-x-3 bottom-3 z-20 mx-auto max-w-xl rounded-lg border border-border bg-background shadow-lg"
      data-testid="thread-composer"
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5">
        <MessageSquarePlusIcon className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {formatSelectedReviewRange(range)}
        </span>
        <Button type="button" variant="ghost" size="icon" className="size-6" onClick={onClose} aria-label="Cancel">
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <div className="p-2.5">
        <Textarea
          autoFocus
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Comment on this line…"
          className="min-h-16 resize-none text-xs"
        />
        <div className="mt-2 flex items-center justify-end">
          <Button
            type="button"
            size="sm"
            className="text-xs"
            disabled={!draft.trim() || pending}
            onClick={() => {
              const body = draft.trim()
              if (!body) {
                return
              }
              onCreate({
                fileId: range.file.id,
                anchor: {
                  fileId: range.file.id,
                  side: range.side,
                  startLine: range.startLine,
                  endLine: range.endLine,
                },
                bodyMarkdown: body,
              })
            }}
          >
            Comment
          </Button>
        </div>
      </div>
    </div>
  )
}
