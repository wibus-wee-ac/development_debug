/**
 * Output: Codex-style feedback dialog for provider-native feedback upload.
 * Input: Slash command UI action state and a submit callback owned by ChatView.
 * Position: Chat feature UI for Codex app-server feedback actions.
 */

import { CheckIcon, PlusIcon } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'

export interface CodexFeedbackPayload {
  classification: string
  reason: string | null
  includeLogs: boolean
}

interface CodexFeedbackOption {
  id: string
  label: string
}

interface CodexFeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: CodexFeedbackPayload) => Promise<boolean | void> | boolean | void
}

const CODEX_FEEDBACK_OPTIONS: CodexFeedbackOption[] = [
  { id: 'bug', label: 'Bug' },
  { id: 'bad-result', label: 'Bad result' },
  { id: 'good-result', label: 'Good result' },
  { id: 'safety_check', label: 'Safety check' },
  { id: 'other', label: 'Other' },
]

export function CodexFeedbackDialog({
  open,
  onOpenChange,
  onSubmit,
}: CodexFeedbackDialogProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [details, setDetails] = useState('')
  const [includeLogs, setIncludeLogs] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const trimmedDetails = details.trim()
  const canSubmit = selectedOptionId !== null && trimmedDetails.length > 0 && !submitting

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    setSubmitting(true)
    try {
      const shouldClose = await onSubmit({
        classification: selectedOptionId,
        reason: trimmedDetails,
        includeLogs,
      })
      if (shouldClose !== false) {
        onOpenChange(false)
      }
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-2rem))] max-w-none gap-3 rounded-xl p-4" data-testid="codex-feedback-dialog">
        <form className="grid gap-3" onSubmit={submitFeedback}>
          <DialogHeader>
            <DialogTitle>Share feedback</DialogTitle>
            <DialogDescription>
              Send feedback about the current Codex session.
            </DialogDescription>
          </DialogHeader>

          <div role="radiogroup" aria-label="Feedback options" className="flex flex-wrap gap-2">
            {CODEX_FEEDBACK_OPTIONS.map((option) => {
              const selected = selectedOptionId === option.id
              const Icon = selected ? CheckIcon : PlusIcon
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSelectedOptionId(option.id)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-[background-color,border-color,color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                    selected
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-background text-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-3" aria-hidden="true" />
                  <span>{option.label}</span>
                </button>
              )
            })}
          </div>

          <Textarea
            autoFocus
            value={details}
            onChange={event => setDetails(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.metaKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            aria-label="Share details"
            placeholder="Share details (required)"
            className="min-h-30 resize-y rounded-xl"
            required
          />

          <label className="flex min-h-10 items-center gap-2 rounded-lg px-1 text-xs text-muted-foreground">
            <Checkbox
              checked={includeLogs}
              onCheckedChange={checked => setIncludeLogs(checked === true)}
              aria-label="Include logs"
            />
            <span>Include logs for the current Codex session</span>
          </label>

          <DialogFooter variant="bare" className="pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? 'Submitting...' : 'Submit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
