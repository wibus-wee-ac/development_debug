import { StaticRender } from '@cradle/streamdown'
import { ArrowLeftIcon, ExternalLinkIcon, GitBranchIcon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import type { ExternalIssueItem, KanbanStatus } from '~/features/kanban/types'
import { LabelChip } from './shared/label-chip'
import { StatusIcon } from './shared/status-icon'

interface ExternalIssueDetailProps {
  item: ExternalIssueItem
  statuses: KanbanStatus[]
  onMoveStatus: (statusId: string) => void
  onBack: () => void
}

function formatSourceDate(value: string | null): string | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

export function ExternalIssueDetail({ item, statuses, onMoveStatus, onBack }: ExternalIssueDetailProps) {
  const status = statuses.find(candidate => candidate.id === item.statusId)

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="external-issue-detail-panel">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to Kanban">
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
          </Button>
          <span className="inline-flex items-center gap-1.5 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <GitBranchIcon className="size-3" aria-hidden="true" />
            GitHub
          </span>
          <span className="truncate font-mono text-[12px] text-muted-foreground">{item.externalKey}</span>
          <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {item.sourceState}
          </span>
        </div>
        {item.externalUrl && (
          <Button variant="ghost" size="xs" asChild>
            <a href={item.externalUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              GitHub
            </a>
          </Button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto px-10 py-6">
          <h1 className="text-2xl font-semibold leading-tight text-foreground">{item.title}</h1>

          {item.labels.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {item.labels.map(label => <LabelChip key={label} label={label} />)}
            </div>
          )}

          <div className="mt-6 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
            GitHub owns this issue content. Cradle only stores the Kanban status overlay.
          </div>

          {item.body
            ? (
                <div className="mt-6 text-[14px] leading-relaxed text-foreground/90">
                  <StaticRender content={item.body} />
                </div>
              )
            : (
                <p className="mt-6 text-[13px] text-muted-foreground">No description from GitHub.</p>
              )}
        </main>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-border px-4 py-6">
          <div className="space-y-5">
            <div>
              <label className="text-[11px] font-medium uppercase text-muted-foreground" htmlFor="external-issue-status">
                Status
              </label>
              <div className="mt-2 flex items-center gap-2">
                {status && <StatusIcon category={status.category} size={15} />}
                <select
                  id="external-issue-status"
                  value={item.statusId ?? ''}
                  onChange={event => onMoveStatus(event.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px] text-foreground"
                >
                  {statuses.map(candidate => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2 text-[12px]">
              <Meta label="Repository" value={`${item.repositoryOwner}/${item.repositoryName}`} />
              <Meta label="Milestone" value={item.milestone ?? 'None'} />
              <Meta label="Assignees" value={item.assignees.length > 0 ? item.assignees.join(', ') : 'Unassigned'} />
              <Meta label="GitHub updated" value={formatSourceDate(item.sourceUpdatedAt) ?? 'Unknown'} />
              <Meta label="Last synced" value={new Date(item.lastSeenAt * 1000).toLocaleString()} />
              <Meta label="Sync status" value={item.syncStatus} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string, value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-foreground">{value}</div>
    </div>
  )
}
