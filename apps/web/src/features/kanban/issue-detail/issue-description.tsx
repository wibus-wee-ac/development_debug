import { MarkdownEditor } from '~/components/editor/markdown-editor'
import type { KanbanIssue } from '~/lib/types'

interface IssueDescriptionProps {
  issue: KanbanIssue
  onUpdate: (patch: { description: string | null }) => void
}

export function IssueDescription({ issue, onUpdate }: IssueDescriptionProps) {
  return (
    <MarkdownEditor
      content={issue.description ?? ''}
      onSave={(md) => {
        if (md !== (issue.description ?? '')) {
          onUpdate({ description: md || null })
        }
      }}
      placeholder="Add description..."
    />
  )
}
