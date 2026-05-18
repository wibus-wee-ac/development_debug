// Input: File path, old content, new content for rendering a file edit diff
// Output: A @pierre/diffs-powered diff view with split and stacked layout switching
// Position: apps/web/src/features/chat/blocks/edit-file-block.tsx

import type { FileContents, MultiFileDiffProps } from '@pierre/diffs/react'
import { MultiFileDiff } from '@pierre/diffs/react'
import { Columns2Icon, FilePenLineIcon, Rows3Icon } from 'lucide-react'
import { m } from 'motion/react'
import { useMemo, useState } from 'react'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'

interface EditFileBlockProps {
  filePath: string
  oldContent: string
  newContent: string
}

type DiffLayout = 'split' | 'stacked'
type DiffsDiffStyle = 'split' | 'unified'
type DiffOptions = NonNullable<MultiFileDiffProps<undefined>['options']>

const DIFF_LAYOUT_OPTIONS: Array<{
  value: DiffLayout
  label: string
  icon: typeof Columns2Icon
}> = [
  { value: 'split', label: 'Split', icon: Columns2Icon },
  { value: 'stacked', label: 'Stacked', icon: Rows3Icon },
]

const layoutDiffStyles: Record<DiffLayout, DiffsDiffStyle> = {
  split: 'split',
  stacked: 'unified',
}

const DIFF_THEMES = {
  dark: 'pierre-dark',
  light: 'pierre-light',
} as const

function diffCacheKey(prefix: string, filePath: string, content: string): string {
  return `${prefix}:${filePath}:${content.length}:${content.slice(0, 64)}:${content.slice(-64)}`
}

export function EditFileBlock({ filePath, oldContent, newContent }: EditFileBlockProps) {
  const [layout, setLayout] = useState<DiffLayout>('split')

  const oldFile = useMemo<FileContents>(
    () => ({
      name: filePath,
      contents: oldContent,
      cacheKey: diffCacheKey('old', filePath, oldContent),
    }),
    [filePath, oldContent],
  )

  const newFile = useMemo<FileContents>(
    () => ({
      name: filePath,
      contents: newContent,
      cacheKey: diffCacheKey('new', filePath, newContent),
    }),
    [filePath, newContent],
  )

  const diffOptions = useMemo<DiffOptions>(
    () => ({
      theme: DIFF_THEMES,
      themeType: 'system',
      diffStyle: layoutDiffStyles[layout],
      disableFileHeader: true,
      disableBackground: false,
      diffIndicators: 'bars',
      hunkSeparators: 'line-info-basic',
      lineDiffType: 'word' as const,
      overflow: 'scroll' as const,
      parseDiffOptions: {
        context: 3,
      },
    }),
    [layout],
  )

  return (
    <m.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="grid gap-2 py-2"
      data-testid="chat-edit-file-block"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FilePenLineIcon className="size-3.5" aria-hidden />
          </span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={filePath}>
            {filePath}
          </span>
        </div>
        <ToggleGroup
          type="single"
          value={layout}
          onValueChange={(nextLayout) => {
            if (nextLayout === 'split' || nextLayout === 'stacked') {
              setLayout(nextLayout)
            }
          }}
          variant="outline"
          size="sm"
          className="shrink-0 bg-background/80 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          aria-label="Diff layout"
        >
          {DIFF_LAYOUT_OPTIONS.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={`${label} diff layout`}
              title={`${label} diff layout`}
              className="min-w-10 active:scale-[0.96]"
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div
        className={cn(
          'overflow-hidden rounded-md bg-background shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1)]',
          layout === 'split' && 'min-w-0',
        )}
      >
        <MultiFileDiff
          oldFile={oldFile}
          newFile={newFile}
          options={diffOptions}
          className="max-h-[32rem] overflow-auto [--diffs-font-size:11px] [--diffs-line-height:18px]"
        />
      </div>
    </m.div>
  )
}
