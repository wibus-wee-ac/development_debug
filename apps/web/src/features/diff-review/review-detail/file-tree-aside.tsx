import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react'
import { CheckIcon, ListIcon, ListTreeIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'

import type { ReviewFile } from '../shared/types'

interface FileListAsideProps {
  visibleFiles: ReviewFile[]
  selectedFileId: string | null
  onSelectFile: (file: ReviewFile) => void
  onToggleViewed: (file: ReviewFile) => void
  viewedPending: boolean
  hiddenWhitespaceFileCount: number
  hiddenGeneratedFileCount: number
}

type ListMode = 'flat' | 'tree'

const STATUS_ORDER: ReviewFile['status'][] = ['modified', 'added', 'deleted', 'renamed', 'untracked']
const STATUS_LABEL: Record<ReviewFile['status'], string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'Untracked',
}
const STATUS_DOT: Record<ReviewFile['status'], string> = {
  modified: 'bg-orange-500',
  added: 'bg-emerald-500',
  deleted: 'bg-red-500',
  renamed: 'bg-sky-500',
  untracked: 'bg-violet-500',
}

export function FileListAside({
  visibleFiles,
  selectedFileId,
  onSelectFile,
  onToggleViewed,
  viewedPending,
  hiddenWhitespaceFileCount,
  hiddenGeneratedFileCount,
}: FileListAsideProps) {
  const [mode, setMode] = useState<ListMode>('flat')

  const grouped = useMemo(() => {
    const map = new Map<ReviewFile['status'], ReviewFile[]>()
    for (const file of visibleFiles) {
      const list = map.get(file.status) ?? []
      list.push(file)
      map.set(file.status, list)
    }
    return STATUS_ORDER
      .filter(status => map.has(status))
      .map(status => ({ status, files: map.get(status)! }))
  }, [visibleFiles])

  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-sidebar lg:flex" data-testid="file-list-aside">
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <span className="text-xs font-medium text-foreground/80">Files</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{visibleFiles.length}</span>
        <div className="flex-1" />
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value === 'flat' || value === 'tree') {
              setMode(value)
            }
          }}
          variant="outline"
          size="sm"
          className="h-6 gap-px"
          aria-label="File list mode"
        >
          <ToggleGroupItem value="flat" aria-label="Flat list" className="h-6 px-1.5">
            <ListIcon className="size-3" />
          </ToggleGroupItem>
          <ToggleGroupItem value="tree" aria-label="Directory tree" className="h-6 px-1.5">
            <ListTreeIcon className="size-3" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {mode === 'tree'
          ? <TreeMode files={visibleFiles} selectedFileId={selectedFileId} onSelectFile={onSelectFile} />
          : (
              <div className="space-y-3">
                {grouped.map(group => (
                  <section key={group.status}>
                    <h2 className="flex items-center gap-1.5 px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      <span className={cn('size-1.5 rounded-full', STATUS_DOT[group.status])} />
                      {STATUS_LABEL[group.status]}
                      <span className="tabular-nums">{group.files.length}</span>
                    </h2>
                    <div className="space-y-px">
                      {group.files.map(file => (
                        <FileRow
                          key={file.id}
                          file={file}
                          selected={file.id === selectedFileId}
                          onSelect={() => onSelectFile(file)}
                          onToggleViewed={() => onToggleViewed(file)}
                          viewedPending={viewedPending}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {(hiddenWhitespaceFileCount > 0 || hiddenGeneratedFileCount > 0) && (
                  <p className="px-1 pt-1 text-[10px] leading-relaxed text-muted-foreground/70">
                    {hiddenWhitespaceFileCount > 0 && (
<>
{hiddenWhitespaceFileCount}
{' '}
whitespace-only hidden
<br />
</>
)}
                    {hiddenGeneratedFileCount > 0 && (
<>
{hiddenGeneratedFileCount}
{' '}
generated hidden
</>
)}
                  </p>
                )}
              </div>
            )}
      </div>
    </aside>
  )
}

function FileRow({
  file,
  selected,
  onSelect,
  onToggleViewed,
  viewedPending,
}: {
  file: ReviewFile
  selected: boolean
  onSelect: () => void
  onToggleViewed: () => void
  viewedPending: boolean
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
        selected ? 'bg-muted' : 'hover:bg-muted/50',
      )}
    >
      <button
        type="button"
        onClick={onToggleViewed}
        disabled={viewedPending}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
          file.isViewed
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-border text-transparent hover:border-muted-foreground',
        )}
        aria-label={file.isViewed ? 'Mark unviewed' : 'Mark viewed'}
        title={file.isViewed ? 'Mark unviewed' : 'Mark viewed'}
      >
        <CheckIcon className="size-2.5" />
      </button>

      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">{file.path}</span>
      </button>

      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums">
        <span className="text-emerald-600 dark:text-emerald-400">
+
{file.additions}
        </span>
        <span className="text-red-600 dark:text-red-400">
−
{file.deletions}
        </span>
      </span>
    </div>
  )
}

function TreeMode({
  files,
  selectedFileId,
  onSelectFile,
}: {
  files: ReviewFile[]
  selectedFileId: string | null
  onSelectFile: (file: ReviewFile) => void
}) {
  const paths = useMemo(() => files.map(file => file.path), [files])
  const fileByPath = useMemo(() => new Map(files.map(file => [file.path, file])), [files])
  const gitStatus = useMemo(
    () => files.map(file => ({ path: file.path, status: file.status })),
    [files],
  )
  const preparedInput = useMemo(() => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }), [paths])

  const { model } = useFileTree({
    preparedInput,
    density: 'compact',
    gitStatus,
    icons: { set: 'complete', colored: true },
    initialExpansion: 'open',
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths[0]
      if (!path) {
        return
      }
      const file = fileByPath.get(path)
      if (file) {
        onSelectFile(file)
      }
    },
  })

  // Keep the selected path visually in sync in tree mode.
  void selectedFileId

  return <PierreFileTree model={model} className="h-full" />
}
