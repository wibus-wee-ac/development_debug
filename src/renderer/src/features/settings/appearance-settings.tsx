// Input: useThemeStore, ThemeMode from @renderer/store/theme
// Output: AppearanceSettings component with macOS-style theme preview cards
// Position: Settings feature section — appearance/theme preferences

import { cn } from '@renderer/lib/cn'
import type { ThemeMode } from '@renderer/store/theme'
import { useThemeStore } from '@renderer/store/theme'
import { CheckIcon } from 'lucide-react'

/** Mini UI preview that simulates the look of each theme */
function ThemePreview({ theme }: { theme: 'light' | 'dark' }) {
  const isDark = theme === 'dark'
  const bg = isDark ? 'bg-neutral-900' : 'bg-white'
  const sidebar = isDark ? 'bg-neutral-800' : 'bg-neutral-100'
  const border = isDark ? 'border-neutral-700' : 'border-neutral-200'
  const bar = isDark ? 'bg-neutral-700' : 'bg-neutral-300'
  const barLight = isDark ? 'bg-neutral-600' : 'bg-neutral-200'
  const dot = isDark ? 'bg-neutral-500' : 'bg-neutral-300'

  return (
    <div className={cn('flex h-full w-full overflow-hidden rounded-lg border', border, bg)}>
      {/* Sidebar area */}
      <div className={cn('flex w-1/3 flex-col gap-1.5 p-2', sidebar)}>
        {/* Fake traffic lights */}
        <div className="flex gap-1">
          <div className="size-1.5 rounded-full bg-red-400/80" />
          <div className="size-1.5 rounded-full bg-yellow-400/80" />
          <div className="size-1.5 rounded-full bg-green-400/80" />
        </div>
        {/* Fake nav items */}
        <div className={cn('h-1.5 w-4/5 rounded-sm', bar)} />
        <div className={cn('h-1.5 w-3/5 rounded-sm', barLight)} />
        <div className={cn('h-1.5 w-4/5 rounded-sm', barLight)} />
      </div>
      {/* Main content area */}
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <div className={cn('h-2 w-3/4 rounded-sm', bar)} />
        <div className={cn('h-1.5 w-full rounded-sm', barLight)} />
        <div className={cn('h-1.5 w-5/6 rounded-sm', barLight)} />
        <div className="mt-auto flex gap-1">
          <div className={cn('size-2 rounded-full', dot)} />
          <div className={cn('size-2 rounded-full', dot)} />
        </div>
      </div>
    </div>
  )
}

function SystemThemePreview() {
  return (
    <div className="flex h-full w-full overflow-hidden rounded-lg">
      {/* Light half */}
      <div className="flex w-1/2 flex-col overflow-hidden border border-r-0 border-neutral-200 bg-white">
        <div className="flex flex-col gap-1 p-1.5">
          <div className="flex gap-0.5">
            <div className="size-1 rounded-full bg-red-400/80" />
            <div className="size-1 rounded-full bg-yellow-400/80" />
            <div className="size-1 rounded-full bg-green-400/80" />
          </div>
          <div className="h-1 w-4/5 rounded-sm bg-neutral-300" />
          <div className="h-1 w-3/5 rounded-sm bg-neutral-200" />
          <div className="h-1 w-4/5 rounded-sm bg-neutral-200" />
        </div>
      </div>
      {/* Dark half */}
      <div className="flex w-1/2 flex-col overflow-hidden border border-l-0 border-neutral-700 bg-neutral-900">
        <div className="flex flex-col gap-1 p-1.5">
          <div className="flex gap-0.5">
            <div className="size-1 rounded-full bg-red-400/80" />
            <div className="size-1 rounded-full bg-yellow-400/80" />
            <div className="size-1 rounded-full bg-green-400/80" />
          </div>
          <div className="h-1 w-4/5 rounded-sm bg-neutral-700" />
          <div className="h-1 w-3/5 rounded-sm bg-neutral-600" />
          <div className="h-1 w-4/5 rounded-sm bg-neutral-600" />
        </div>
      </div>
    </div>
  )
}

const THEME_OPTIONS: Array<{ value: ThemeMode, label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '自动' },
]

export function AppearanceSettings() {
  const mode = useThemeStore(s => s.mode)
  const setMode = useThemeStore(s => s.setMode)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="font-heading text-base font-semibold">外观</h3>
        <p className="text-sm text-muted-foreground">选择应用的外观主题</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {THEME_OPTIONS.map(({ value, label }) => {
          const selected = mode === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className="group flex flex-col items-center gap-2"
            >
              {/* Preview card */}
              <div
                className={cn(
                  'relative aspect-4/3 w-full overflow-hidden rounded-xl p-1 transition-all duration-200',
                  selected
                    ? 'ring-1 ring-foreground/30 ring-offset-2 ring-offset-background'
                    : 'ring-1 ring-border/60 hover:ring-border',
                )}
              >
                {value === 'system'
                  ? <SystemThemePreview />
                  : <ThemePreview theme={value} />}

                {/* Check badge */}
                {selected && (
                  <div className="absolute right-1.5 bottom-1.5 flex size-4 items-center justify-center rounded-full bg-foreground/80 text-background shadow-sm">
                    <CheckIcon className="size-2.5" aria-hidden="true" />
                  </div>
                )}
              </div>

              {/* Label */}
              <span
                className={cn(
                  'text-xs font-medium transition-colors',
                  selected ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
