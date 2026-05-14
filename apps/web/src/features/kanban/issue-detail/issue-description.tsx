import { useCallback, useEffect, useRef, useState } from 'react'

import type { KanbanIssue } from '~/lib/types'

interface IssueDescriptionProps {
  issue: KanbanIssue
  onUpdate: (patch: { description: string | null }) => void
}

export function IssueDescription({ issue, onUpdate }: IssueDescriptionProps) {
  const [value, setValue] = useState(issue.description ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    if (ref.current) {
      ref.current.style.height = '0'
      const h = Math.max(80, ref.current.scrollHeight)
      ref.current.style.height = `${h}px`
    }
  }, [])

  useEffect(() => {
    setValue(issue.description ?? '')
    requestAnimationFrame(adjustHeight)
  }, [issue.description, adjustHeight])

  const commitDescriptionEdit = useCallback(() => {
    if (value !== (issue.description ?? '')) {
      onUpdate({ description: value || null })
    }
  }, [value, issue.description, onUpdate])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        setValue(e.target.value)
        const el = e.currentTarget
        el.style.height = '0'
        const h = Math.max(80, el.scrollHeight)
        el.style.height = `${h}px`
      }}
      onBlur={commitDescriptionEdit}
      placeholder="Add description..."
      data-testid="issue-description-editor"
      className="mt-3 w-full min-h-20 resize-none border-none bg-transparent text-[13px] text-foreground/90 outline-none placeholder:text-muted-foreground/50 leading-relaxed"
    />
  )
}
