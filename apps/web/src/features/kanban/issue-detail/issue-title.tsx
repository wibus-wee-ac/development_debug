import { useCallback, useEffect, useRef, useState } from 'react'

import type { KanbanIssue } from '~/lib/types'

interface IssueTitleProps {
  issue: KanbanIssue
  onUpdate: (patch: { title: string }) => void
}

export function IssueTitle({ issue, onUpdate }: IssueTitleProps) {
  const [value, setValue] = useState(issue.title)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setValue(issue.title)
  }, [issue.title])

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = `${ref.current.scrollHeight}px`
    }
  }, [value])

  const handleBlur = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== issue.title) {
      onUpdate({ title: trimmed })
    }
  }, [value, issue.title, onUpdate])

  return (
    <div data-testid="issue-title-display">
      <textarea
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        placeholder="Issue title"
        rows={1}
        data-testid="issue-title-input"
        className="w-full resize-none overflow-hidden border-none bg-transparent text-xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  )
}
