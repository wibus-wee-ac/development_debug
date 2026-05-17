import { LinkIcon, PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'

import { useDeleteRelation, useRelations } from '../use-kanban'

interface RelationManagerProps {
  issueId: string
}

const relationTypeLabels: Record<string, string> = {
  blocks: 'Blocks',
  duplicates: 'Duplicates',
  relates_to: 'Related to',
}

export function RelationManager({ issueId }: RelationManagerProps) {
  const { data: relations = [] } = useRelations(issueId)
  const deleteRelation = useDeleteRelation()
  const [_addOpen, setAddOpen] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted-foreground">Relations</span>
        <Popover open={_addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground transition-colors">
            <PlusIcon className="size-3" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-2">
            <p className="text-[12px] text-muted-foreground mb-1">Add relation (coming soon)</p>
          </PopoverContent>
        </Popover>
      </div>

      {relations.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {relations.map((rel) => {
            const isSource = rel.sourceIssueId === issueId
            const targetId = isSource ? rel.targetIssueId : rel.sourceIssueId
            const typeLabel = isSource
              ? relationTypeLabels[rel.type] ?? rel.type
              : rel.type === 'blocks' ? 'Blocked by' : (relationTypeLabels[rel.type] ?? rel.type)

            return (
              <div key={rel.id} className="flex items-center gap-2 py-1 group">
                <LinkIcon className="size-3 text-muted-foreground/60" />
                <span className="text-[12px] text-muted-foreground">{typeLabel}</span>
                <span className="flex-1 truncate text-[12px] text-foreground font-mono">
                  {targetId.slice(0, 8)}
                </span>
                <button
                  type="button"
                  onClick={() => deleteRelation.mutate({ id: rel.id, issueId })}
                  className="hidden size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground group-hover:flex transition-colors"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {relations.length === 0 && (
        <p className="mt-2 text-[12px] text-muted-foreground/50">No relations</p>
      )}
    </div>
  )
}
