import { useCallback, useEffect, useRef, useState } from 'react'

import type { KanbanIssue } from '~/lib/types'

interface IssueTitleProps {
  issue: KanbanIssue
  onUpdate: (patch: { title: string }) => void
}

export function IssueTitle({ issue, onUpdate }: IssueTitleProps) {
  const [editorKey, setEditorKey] = useState(0)

  useEffect(() => {
    setEditorKey(key => key + 1)
  }, [issue.id, issue.title])

  return (
    <IssueTitleEditor
      key={`${issue.id}:${editorKey}`}
      initialTitle={issue.title}
      onCommit={(title) => {
        if (title !== issue.title) {
          onUpdate({ title })
        }
      }}
    />
  )
}

function IssueTitleEditor({
  initialTitle,
  onCommit,
}: {
  initialTitle: string
  onCommit: (title: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    if (ref.current) {
      ref.current.style.height = '0'
      const h = ref.current.scrollHeight
      ref.current.style.height = `${h}px`
    }
  }, [])

  useEffect(() => {
    requestAnimationFrame(adjustHeight)
  }, [adjustHeight])

  const commitTitleEdit = useCallback(() => {
    const trimmed = ref.current?.value.trim() ?? ''
    if (trimmed) {
      onCommit(trimmed)
    }
  }, [onCommit])

  return (
    <div data-testid="issue-title-display">
      <textarea
        ref={ref}
        defaultValue={initialTitle}
        onChange={(e) => {
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
        className="w-full resize-none overflow-hidden border-none bg-transparent text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  )
}
