import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'

export interface RuntimeUserInputOption {
  label: string
  description: string
}

export interface RuntimeUserInputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: RuntimeUserInputOption[] | null
}

interface RuntimeUserInputFormProps {
  questions: RuntimeUserInputQuestion[]
  disabled?: boolean
  className?: string
  onSubmit: (answers: Record<string, string[]>) => Promise<void> | void
}

const OTHER_OPTION_VALUE = '__cradle_other__'

export function RuntimeUserInputForm({
  questions,
  disabled = false,
  className,
  onSubmit
}: RuntimeUserInputFormProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [otherDrafts, setOtherDrafts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const updateDraft = (questionId: string, value: string) => {
    setDrafts((current) => ({ ...current, [questionId]: value }))
  }

  const updateOtherDraft = (questionId: string, value: string) => {
    setOtherDrafts((current) => ({ ...current, [questionId]: value }))
  }

  const submit = async () => {
    const answers = Object.fromEntries(
      questions.map((question) => {
        const selected = drafts[question.id]?.trim() ?? ''
        const other = otherDrafts[question.id]?.trim() ?? ''
        return [question.id, [selected === OTHER_OPTION_VALUE ? other : selected].filter(Boolean)]
      })
    )
    setSubmitting(true)
    try {
      await onSubmit(answers)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={cn('grid gap-3 border-t border-border/60 px-3 py-3', className)}
      data-testid="runtime-user-input-card"
    >
      {questions.map((question) => (
        <div key={question.id} className="grid gap-2">
          <div className="grid gap-0.5">
            {question.header && (
              <div className="text-[11px] font-medium text-muted-foreground">{question.header}</div>
            )}
            <div className="text-xs text-foreground/85">{question.question}</div>
          </div>
          {question.options && question.options.length > 0 ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-1.5">
                {question.options.map((option) => (
                  <Button
                    key={option.label}
                    type="button"
                    variant={drafts[question.id] === option.label ? 'secondary' : 'outline'}
                    size="xs"
                    disabled={disabled || submitting}
                    className="h-auto min-h-9 max-w-full flex-col items-start gap-0.5 whitespace-normal px-2.5 py-1.5 text-left"
                    onClick={() => updateDraft(question.id, option.label)}
                  >
                    <span className="max-w-full truncate font-medium">{option.label}</span>
                    {option.description && (
                      <span className="max-w-48 whitespace-normal text-[11px] leading-snug text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </Button>
                ))}
                {question.isOther && (
                  <Button
                    type="button"
                    variant={drafts[question.id] === OTHER_OPTION_VALUE ? 'secondary' : 'outline'}
                    size="xs"
                    disabled={disabled || submitting}
                    onClick={() => updateDraft(question.id, OTHER_OPTION_VALUE)}
                  >
                    Other
                  </Button>
                )}
              </div>
              {question.isOther && drafts[question.id] === OTHER_OPTION_VALUE && (
                <Input
                  value={otherDrafts[question.id] ?? ''}
                  disabled={disabled || submitting}
                  className="h-8 text-xs"
                  placeholder="Other"
                  onChange={(event) => updateOtherDraft(question.id, event.target.value)}
                />
              )}
            </div>
          ) : question.isSecret ? (
            <Input
              type="password"
              value={drafts[question.id] ?? ''}
              disabled={disabled || submitting}
              className="h-8 text-xs"
              onChange={(event) => updateDraft(question.id, event.target.value)}
            />
          ) : (
            <Textarea
              value={drafts[question.id] ?? ''}
              disabled={disabled || submitting}
              rows={3}
              className="min-h-9 resize-none text-xs"
              onChange={(event) => updateDraft(question.id, event.target.value)}
            />
          )}
        </div>
      ))}
      <div className="flex justify-end">
        <Button
          type="button"
          size="xs"
          disabled={disabled || submitting}
          onClick={() => void submit()}
        >
          Submit
        </Button>
      </div>
    </div>
  )
}
