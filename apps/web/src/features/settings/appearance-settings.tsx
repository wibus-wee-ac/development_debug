import { CheckIcon } from 'lucide-react'
import { startTransition, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'
import { useI18n } from '~/i18n/client'
import { localeOptions, normalizeLocale, type SupportedLocale } from '~/i18n/locales'
import { useStreamdownStore } from '~/store/streamdown'
import type { ThemeMode } from '~/store/theme'
import { useThemeStore } from '~/store/theme'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

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

const THEME_OPTIONS: Array<{ value: ThemeMode, labelKey: SettingsKey }> = [
  { value: 'light', labelKey: 'appearance.theme.light' },
  { value: 'dark', labelKey: 'appearance.theme.dark' },
  { value: 'system', labelKey: 'appearance.theme.system' },
]

const ANIMATION_PRESETS = [
  { value: 'minimal', labelKey: 'streaming.preset.minimal.label', descriptionKey: 'streaming.preset.minimal.description' },
  { value: 'balanced', labelKey: 'streaming.preset.balanced.label', descriptionKey: 'streaming.preset.balanced.description' },
  { value: 'dramatic', labelKey: 'streaming.preset.dramatic.label', descriptionKey: 'streaming.preset.dramatic.description' },
] as const satisfies Array<{ value: string, labelKey: SettingsKey, descriptionKey: SettingsKey }>

const GRANULARITY_OPTIONS = [
  { value: 'word', labelKey: 'streaming.granularity.word' },
  { value: 'char', labelKey: 'streaming.granularity.char' },
] as const satisfies Array<{ value: string, labelKey: SettingsKey }>

const LOCALE_LABEL_KEYS = {
  'en-US': 'appearance.language.option.en-US',
  'zh-CN': 'appearance.language.option.zh-CN',
  'ja-JP': 'appearance.language.option.ja-JP',
  'es-ES': 'appearance.language.option.es-ES',
} as const satisfies Record<SupportedLocale, SettingsKey>

export function AppearanceSettings() {
  const { t } = useTranslation('settings')
  const mode = useThemeStore(s => s.mode)
  const setMode = useThemeStore(s => s.setMode)
  const settingsAppearanceReady = THEME_OPTIONS.length > 0 && ANIMATION_PRESETS.length > 0

  return (
    <div
      className="flex flex-col gap-1"
      data-testid="appearance-settings"
      data-settings-appearance-ready={settingsAppearanceReady ? 'true' : 'false'}
    >
      <SettingsSectionHeader title={t('appearance.page.title')} description={t('appearance.page.description')} />
      <SettingsDivider />

      <SettingsRow
        label={t('appearance.theme.label')}
        description={t('appearance.theme.description')}
        info={t('appearance.theme.info')}
      >
        <div className="flex gap-3">
          {THEME_OPTIONS.map(({ value, labelKey }) => {
            const selected = mode === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                data-testid={`appearance-theme-${value}`}
                data-theme-selected={selected ? 'true' : 'false'}
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
                  {t(labelKey)}
                </span>
              </button>
            )
          })}
        </div>
      </SettingsRow>

      <SettingsDivider />
      <LanguageSettings />
      <SettingsDivider />
      <SettingsSectionHeader title={t('streaming.section.title')} description={t('streaming.section.description')} />
      <SettingsDivider />

      <StreamdownSettings />
    </div>
  )
}

function LanguageSettings() {
  const { t } = useTranslation('settings')
  const { i18n, switchLang } = useI18n()
  const [activeLocale, setActiveLocale] = useState<SupportedLocale>(() => normalizeLocale(i18n.language))
  const [pendingLocale, setPendingLocale] = useState<SupportedLocale | null>(null)

  useEffect(() => {
    const syncLocale = (locale: string): void => {
      setActiveLocale(normalizeLocale(locale))
    }

    i18n.on('languageChanged', syncLocale)
    return () => {
      i18n.off('languageChanged', syncLocale)
    }
  }, [i18n])

  function selectLocale(locale: SupportedLocale): void {
    if (pendingLocale || locale === activeLocale) {
      return
    }

    setPendingLocale(locale)
    startTransition(() => {
      void switchLang(locale).finally(() => {
        setPendingLocale(null)
      })
    })
  }

  return (
    <SettingsRow
      label={t('appearance.language.label')}
      description={pendingLocale ? t('appearance.language.pending') : t('appearance.language.description')}
    >
      <div className="flex gap-1 rounded-lg border border-border p-0.5">
        {localeOptions.map(option => {
          const selected = activeLocale === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => selectLocale(option.value)}
              aria-pressed={selected}
              disabled={pendingLocale !== null}
              className={cn(
                'h-7 rounded-md px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                selected ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(LOCALE_LABEL_KEYS[option.value])}
            </button>
          )
        })}
      </div>
    </SettingsRow>
  )
}

function StreamdownSettings() {
  const { t } = useTranslation('settings')
  const { animationPreset, animateMode, showCursor, setAnimationPreset, setAnimateMode, setShowCursor } = useStreamdownStore()

  return (
    <>
      <SettingsRow
        label={t('streaming.preset.label')}
        description={t('streaming.preset.description')}
      >
        <div className="flex gap-2">
          {ANIMATION_PRESETS.map(({ value, labelKey, descriptionKey }) => {
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
                  {t(labelKey)}
                </span>
                <span className="text-[10px] text-muted-foreground/70">{t(descriptionKey)}</span>
              </button>
            )
          })}
        </div>
      </SettingsRow>

      <SettingsRow
        label={t('streaming.granularity.label')}
        description={t('streaming.granularity.description')}
      >
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {GRANULARITY_OPTIONS.map(({ value, labelKey }) => {
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
                {t(labelKey)}
              </button>
            )
          })}
        </div>
      </SettingsRow>

      <SettingsRow
        label={t('streaming.cursor.label')}
        description={t('streaming.cursor.description')}
      >
        <button
          type="button"
          onClick={() => setShowCursor(!showCursor)}
          aria-label={t('streaming.cursor.toggle')}
          aria-pressed={showCursor}
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
