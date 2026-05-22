import { CheckIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { cn } from '~/lib/cn'
import { markCradlePerformance, measureCradlePerformance } from '~/lib/perf-monitor'
import { useStreamdownStore } from '~/store/streamdown'
import type { ThemeMode } from '~/store/theme'
import { useThemeStore } from '~/store/theme'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'

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
      <div className={cn('flex w-1/3 flex-col gap-1.5 p-2', sidebar)}>
        <div className="flex gap-1">
          <div className="size-1.5 rounded-full bg-red-400/80" />
          <div className="size-1.5 rounded-full bg-yellow-400/80" />
          <div className="size-1.5 rounded-full bg-green-400/80" />
        </div>
        <div className={cn('h-1.5 w-4/5 rounded-sm', bar)} />
        <div className={cn('h-1.5 w-3/5 rounded-sm', barLight)} />
        <div className={cn('h-1.5 w-4/5 rounded-sm', barLight)} />
      </div>
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
  const firstRenderedRef = useRef(false)
  const mode = useThemeStore(s => s.mode)
  const setMode = useThemeStore(s => s.setMode)
  const settingsAppearanceReady = THEME_OPTIONS.length > 0 && ANIMATION_PRESETS.length > 0

  useEffect(() => {
    if (!settingsAppearanceReady || firstRenderedRef.current) {
      return
    }

    firstRenderedRef.current = true
    markCradlePerformance('cradle:first-settings-appearance-rendered')
    measureCradlePerformance(
      'cradle:settings-appearance-first-render',
      'cradle:settings-appearance-render-requested',
      'cradle:first-settings-appearance-rendered',
    )
  }, [settingsAppearanceReady])

  return (
    <div
      className="flex flex-col gap-1"
      data-testid="appearance-settings"
      data-settings-appearance-ready={settingsAppearanceReady ? 'true' : 'false'}
    >
      <SettingsSectionHeader title="外观" description="自定义应用的视觉风格" />
      <SettingsDivider />

      <SettingsRow
        label="主题"
        description="选择应用的外观主题"
        info="浅色和深色主题适合不同环境。自动模式将跟随系统设置切换。"
      >
        <div className="flex gap-3">
          {THEME_OPTIONS.map(({ value, label }) => {
            const selected = mode === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className="group flex flex-col items-center gap-1.5"
              >
                <div
                  className={cn(
                    'relative aspect-4/3 w-36 overflow-hidden rounded-lg p-0.5 transition-[box-shadow,outline-color] duration-150',
                    selected
                      ? 'ring-1 ring-foreground/30 ring-offset-2 ring-offset-background'
                      : 'ring-1 ring-border/60 hover:ring-border',
                  )}
                >
                  {value === 'system'
                    ? <SystemThemePreview />
                    : <ThemePreview theme={value} />}

                  {selected && (
                    <div className="absolute right-1 bottom-1 flex size-3.5 items-center justify-center rounded-full bg-foreground text-background">
                      <CheckIcon className="size-2" aria-hidden="true" />
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    'text-[11px]',
                    selected ? 'text-foreground font-medium' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      </SettingsRow>

      <SettingsDivider />
      <SettingsSectionHeader title="流式动画" description="自定义 AI 回复的流式渲染效果" />
      <SettingsDivider />

      <StreamdownSettings />
    </div>
  )
}

const ANIMATION_PRESETS = [
  { value: 'minimal', label: '极简', description: '快速淡入，无特效' },
  { value: 'balanced', label: '平衡', description: '柔和淡入 + 区块光晕' },
  { value: 'dramatic', label: '戏剧', description: '慢淡入 + 光晕 + 光标拖尾 + 入场动画' },
] as const

const GRANULARITY_OPTIONS = [
  { value: 'word', label: '逐词' },
  { value: 'char', label: '逐字' },
] as const

function StreamdownSettings() {
  const { animationPreset, animateMode, showCursor, setAnimationPreset, setAnimateMode, setShowCursor } = useStreamdownStore()

  return (
    <>
      <SettingsRow
        label="动画预设"
        description="控制流式文字出现时的视觉效果强度"
      >
        <div className="flex gap-2">
          {ANIMATION_PRESETS.map(({ value, label, description }) => {
            const selected = animationPreset === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => setAnimationPreset(value)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-[background-color,border-color] duration-150',
                  selected
                    ? 'border-foreground/20 bg-foreground/5'
                    : 'border-border hover:border-foreground/10',
                )}
              >
                <span className={cn('text-xs font-medium', selected ? 'text-foreground' : 'text-muted-foreground')}>
                  {label}
                </span>
                <span className="text-[10px] text-muted-foreground/70">{description}</span>
              </button>
            )
          })}
        </div>
      </SettingsRow>

      <SettingsRow
        label="动画粒度"
        description="文字逐词或逐字动画"
      >
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {GRANULARITY_OPTIONS.map(({ value, label }) => {
            const selected = animateMode === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => setAnimateMode(value)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  selected ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </SettingsRow>

      <SettingsRow
        label="显示光标"
        description="流式输入时在文本末尾显示闪烁光标"
      >
        <button
          type="button"
          onClick={() => setShowCursor(!showCursor)}
          className={cn(
            'relative h-5 w-9 rounded-full transition-colors',
            showCursor ? 'bg-foreground' : 'bg-border',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 size-4 rounded-full bg-background transition-transform',
              showCursor && 'translate-x-4',
            )}
          />
        </button>
      </SettingsRow>
    </>
  )
}
