import { useCallback, useEffect, useRef, useState } from 'react'

import type { KanbanIssue } from '~/lib/types'

interface IssueTitleProps {
  issue: KanbanIssue
  onUpdate: (patch: { title: string }) => void
}

export function IssueTitle({ issue, onUpdate }: IssueTitleProps) {
  const [value, setValue] = useState(issue.title)
  const ref = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    if (ref.current) {
      ref.current.style.height = '0'
      const h = ref.current.scrollHeight
      ref.current.style.height = `${h}px`
    }
  }, [])

  useEffect(() => {
    setValue(issue.title)
    requestAnimationFrame(adjustHeight)
  }, [issue.title, adjustHeight])

  const commitTitleEdit = useCallback(() => {
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
        onChange={(e) => {
          setValue(e.target.value)
          const el = e.currentTarget
          el.style.height = '0'
          const h = el.scrollHeight
          el.style.height = `${h}px`
        }}
        onBlur={commitTitleEdit}
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
