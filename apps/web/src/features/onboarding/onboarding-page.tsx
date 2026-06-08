import {
  BarChart3Icon,
  BriefcaseIcon,
  CheckIcon,
  CodeIcon,
  GraduationCapIcon,
  LanguagesIcon,
  LineChartIcon,
  MegaphoneIcon,
  PaletteIcon,
  Settings2Icon,
  SparklesIcon,
  XIcon,
} from 'lucide-react'
import { m } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { useI18n } from '~/i18n/i18n-context'
import type { SupportedLocale } from '~/i18n/locales'
import { localeOptions, normalizeLocale } from '~/i18n/locales'
import { cn } from '~/lib/cn'

import { useOnboardingStore } from './onboarding-store'

type OnboardingKey = keyof typeof import('~/locales/default').default.onboarding

const CRADLE_ICON_URL = '/icon.png'

const LOCALE_LABEL_KEYS: Record<SupportedLocale, OnboardingKey> = {
  'en-US': 'locale.enUS',
  'zh-CN': 'locale.zhCN',
  'ja-JP': 'locale.jaJP',
  'es-ES': 'locale.esES',
}

const ROLE_OPTIONS = [
  { id: 'engineering', icon: CodeIcon, labelKey: 'role.engineering' },
  { id: 'product', icon: BriefcaseIcon, labelKey: 'role.product' },
  { id: 'data', icon: BarChart3Icon, labelKey: 'role.data' },
  { id: 'design', icon: PaletteIcon, labelKey: 'role.design' },
  { id: 'marketing', icon: MegaphoneIcon, labelKey: 'role.marketing' },
  { id: 'operations', icon: Settings2Icon, labelKey: 'role.operations' },
  { id: 'finance', icon: LineChartIcon, labelKey: 'role.finance' },
  { id: 'student', icon: GraduationCapIcon, labelKey: 'role.student' },
] as const satisfies ReadonlyArray<{
  id: string
  icon: React.ComponentType<{ className?: string }>
  labelKey: OnboardingKey
}>

function RoleOption({
  icon: Icon,
  label,
  selected,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'relative flex h-10 min-w-0 items-center justify-center gap-2 overflow-hidden rounded-xl border px-3 text-sm',
        'transition-colors duration-150 active:scale-[0.96]',
        selected
          ? 'border-foreground/20 bg-foreground/[0.06] text-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{label}</span>
      {selected && <CheckIcon className="absolute left-2 size-3.5 text-foreground" aria-hidden="true" />}
    </button>
  )
}

export function OnboardingPage() {
  const { t, i18n } = useTranslation('onboarding')
  const { switchLang } = useI18n()
  const complete = useOnboardingStore(s => s.complete)
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(() => new Set(['engineering']))
  const [personalizedSuggestions, setPersonalizedSuggestions] = useState(true)
  const activeLocale = normalizeLocale(i18n.language)

  const toggleRole = (roleId: string) => {
    setSelectedRoles((current) => {
      const next = new Set(current)
      if (next.has(roleId)) {
        next.delete(roleId)
      }
      else {
        next.add(roleId)
      }
      return next
    })
  }

  const handleContinue = () => {
    complete({
      roles: [...selectedRoles],
      personalizedSuggestionsEnabled: personalizedSuggestions,
    })
  }

  const handleSkip = () => {
    complete({
      roles: [],
      personalizedSuggestionsEnabled: false,
    })
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-9999 flex flex-col overflow-hidden bg-background text-foreground">
      <header className="relative z-20 flex h-12 shrink-0 items-center justify-between px-5">
        <div className="flex items-center gap-2">
          <img
            src={CRADLE_ICON_URL}
            alt=""
            className="size-6 rounded-md object-cover shadow-sm ring-1 ring-black/10 dark:ring-white/10"
            draggable={false}
          />
          <span className="text-sm font-medium">{t('welcome.brand')}</span>
        </div>
        <div className="flex items-center gap-2">
          <Select value={activeLocale} onValueChange={lang => void switchLang(normalizeLocale(lang))}>
            <SelectTrigger
              size="sm"
              className="h-8 w-28 border-transparent bg-transparent text-xs text-muted-foreground shadow-none hover:bg-muted"
            >
              <LanguagesIcon className="size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10000]">
              {localeOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {t(LOCALE_LABEL_KEYS[opt.value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={handleSkip}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96]"
            aria-label={t('nav.skip')}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6 py-8">
        <m.section
          className="flex w-full max-w-[400px] flex-col items-center text-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <SparklesIcon className="size-6 text-foreground" />
          </div>
          <h1 className="mt-4 text-[28px] font-normal leading-[34px] text-foreground text-balance">
            {t('welcome.title')}
          </h1>
          <p className="mt-2 max-w-[320px] text-[15px] leading-6 text-muted-foreground text-pretty">
            {t('welcome.subtitle')}
          </p>

          <div className="mt-8 grid w-full grid-cols-2 gap-2">
            {ROLE_OPTIONS.map(option => (
              <RoleOption
                key={option.id}
                icon={option.icon}
                label={t(option.labelKey)}
                selected={selectedRoles.has(option.id)}
                onClick={() => toggleRole(option.id)}
              />
            ))}
          </div>

          <div className="mt-7 flex items-center justify-center gap-2">
            <Switch
              checked={personalizedSuggestions}
              onCheckedChange={setPersonalizedSuggestions}
              aria-label={t('personalizedSuggestions.toggle')}
            />
            <div className="min-w-0 text-left">
              <button
                type="button"
                className="text-sm font-normal text-foreground transition-colors duration-150 hover:text-foreground/80"
                aria-pressed={personalizedSuggestions}
                onClick={() => setPersonalizedSuggestions(value => !value)}
              >
                {t('personalizedSuggestions.title')}
              </button>
              <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                {t('personalizedSuggestions.description')}
              </p>
            </div>
          </div>

          <div className="mt-8 flex w-full max-w-xs flex-col items-center gap-3">
            <Button
              className="w-full justify-center rounded-full"
              onClick={handleContinue}
              disabled={selectedRoles.size === 0}
            >
              {t('nav.getStarted')}
            </Button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center px-2 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground active:scale-[0.96]"
              onClick={handleSkip}
            >
              {t('nav.skip')}
            </button>
          </div>
        </m.section>
      </main>
    </div>
  )
}
