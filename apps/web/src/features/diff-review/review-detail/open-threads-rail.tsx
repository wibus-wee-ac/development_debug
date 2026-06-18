import { MessagesSquareIcon } from 'lucide-react'

import { cn } from '~/lib/cn'

import type { CradleDiffReview, ReviewFile, ReviewThread } from '../shared/types'

interface OpenThreadsRailProps {
  review: CradleDiffReview
  files: ReviewFile[]
  onJumpToThread: (thread: ReviewThread) => void
}

export function OpenThreadsRail({ review, files, onJumpToThread }: OpenThreadsRailProps) {
  const fileById = new Map(files.map(file => [file.id, file]))
  const openThreads = review.threads.filter(thread => thread.state !== 'resolved')
  const staleThreads = review.threads.filter(thread => thread.state === 'stale')

  return (
    <aside className="hidden min-h-0 w-72 shrink-0 flex-col border-l border-border/60 bg-sidebar xl:flex" data-testid="open-threads-rail">
      <div className="flex h-8 shrink-0 items-center gap-2 px-3">
        <MessagesSquareIcon className="size-3.5 text-muted-foreground/60" aria-hidden />
        <span className="text-xs font-medium text-foreground/80">Threads</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{openThreads.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {openThreads.length === 0
          ? (
              <div className="flex h-full items-center justify-center p-4 text-center">
                <p className="text-xs text-muted-foreground">No open threads.</p>
              </div>
            )
          : (
              <div className="space-y-1">
                {openThreads.map((thread) => {
                  const file = thread.fileId ? fileById.get(thread.fileId) : null
                  const last = thread.comments.at(-1)
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => onJumpToThread(thread)}
                      className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'size-1.5 shrink-0 rounded-full',
                            thread.state === 'stale' ? 'bg-amber-500' : 'bg-orange-500',
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
                          {file?.path ?? 'Review thread'}
                        </span>
                        {thread.anchor && (
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            L
{thread.anchor.startLine}
                          </span>
                        )}
                      </div>
                      {last && (
                        <p className="mt-0.5 line-clamp-2 pl-2.5 text-[10px] leading-relaxed text-muted-foreground">
                          {last.bodyMarkdown}
                        </p>
                      )}
                      <div className="mt-0.5 flex items-center gap-1.5 pl-2.5 text-[10px] text-muted-foreground/70">
                        <span>
{thread.comments.length}
{' '}
comment
{thread.comments.length === 1 ? '' : 's'}
                        </span>
                        {thread.state === 'stale' && <span className="text-amber-600 dark:text-amber-400">stale</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

        {staleThreads.length > 0 && (
          <div className="mt-3 border-t border-border/60 pt-2 text-[10px] text-muted-foreground/70">
            {staleThreads.length}
{' '}
stale thread
{staleThreads.length === 1 ? '' : 's'}
{' '}
need re-review
          </div>
        )}
      </div>
    </aside>
  )
}
