import {
  ActivityIcon,
  ArrowRightIcon,
  BotIcon,
  CheckCircleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  GitBranchIcon,
  MessageSquareIcon,
  Settings2Icon,
  SparklesIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Separator } from '~/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { localeOptions, normalizeLocale } from '~/i18n/locales'
import type { SupportedLocale } from '~/i18n/locales'
import { cn } from '~/lib/cn'

import { ONBOARDING_TOTAL_STEPS, useOnboardingStore } from './onboarding-store'
import { OnboardingProductPreview } from './onboarding-product-preview'

type OnboardingKey = keyof typeof import('~/locales/default').default.onboarding

interface StepMeta {
  eyebrowKey: OnboardingKey
  headlineKey: OnboardingKey
  descriptionKey: OnboardingKey
  featureKeys: OnboardingKey[]
  icon: React.ComponentType<{ className?: string }>
  accentClass: string
}

const STEPS: StepMeta[] = [
  {
    eyebrowKey: 'step.welcome.eyebrow',
    headlineKey: 'step.welcome.headline',
    descriptionKey: 'step.welcome.description',
    featureKeys: ['step.welcome.feature.1', 'step.welcome.feature.2', 'step.welcome.feature.3'],
    icon: SparklesIcon,
    accentClass: 'text-primary',
  },
  {
    eyebrowKey: 'step.chat.eyebrow',
    headlineKey: 'step.chat.headline',
    descriptionKey: 'step.chat.description',
    featureKeys: ['step.chat.feature.1', 'step.chat.feature.2', 'step.chat.feature.3'],
    icon: MessageSquareIcon,
    accentClass: 'text-info',
  },
  {
    eyebrowKey: 'step.workspace.eyebrow',
    headlineKey: 'step.workspace.headline',
    descriptionKey: 'step.workspace.description',
    featureKeys: ['step.workspace.feature.1', 'step.workspace.feature.2', 'step.workspace.feature.3'],
    icon: FolderIcon,
    accentClass: 'text-warning',
  },
  {
    eyebrowKey: 'step.agents.eyebrow',
    headlineKey: 'step.agents.headline',
    descriptionKey: 'step.agents.description',
    featureKeys: ['step.agents.feature.1', 'step.agents.feature.2', 'step.agents.feature.3'],
    icon: BotIcon,
    accentClass: 'text-[var(--color-accent-agent)]',
  },
  {
    eyebrowKey: 'step.done.eyebrow',
    headlineKey: 'step.done.headline',
    descriptionKey: 'step.done.description',
    featureKeys: [],
    icon: ZapIcon,
    accentClass: 'text-success',
  },
]

const LOCALE_LABEL_KEYS: Record<SupportedLocale, OnboardingKey> = {
  'en-US': 'locale.enUS',
  'zh-CN': 'locale.zhCN',
  'ja-JP': 'locale.jaJP',
  'es-ES': 'locale.esES',
}

/**
 * Fixed overlay with a guidance rail and a mock-data product stage.
 */
export function OnboardingPage() {
  const { t, i18n } = useTranslation('onboarding')
  const { step, nextStep, prevStep, complete } = useOnboardingStore()

  const isLast = step === ONBOARDING_TOTAL_STEPS - 1
  const isFirst = step === 0
  const stepMeta = STEPS[step]!
  const progress = ((step + 1) / ONBOARDING_TOTAL_STEPS) * 100
  const activeLocale = normalizeLocale(i18n.language)

  const handleNext = useCallback(() => {
    if (isLast) complete()
    else nextStep()
  }, [isLast, complete, nextStep])

  const handleLangChange = useCallback(
    (lang: string) => { void i18n.changeLanguage(normalizeLocale(lang)) },
    [i18n],
  )

  return (
    <div className="fixed inset-0 z-9999 flex flex-col bg-background pointer-events-auto lg:flex-row">

      <div className="relative flex min-h-0 shrink-0 flex-col overflow-hidden border-b border-border bg-background lg:w-105 lg:border-b-0 lg:border-r">

        {/* Top bar */}
        <div className="flex h-12 items-center justify-between px-5">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary">
              <SparklesIcon className="size-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Cradle</span>
          </div>

          <div className="flex items-center gap-2">
            <Select value={activeLocale} onValueChange={handleLangChange}>
              <SelectTrigger size="sm" className="w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {localeOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {t(LOCALE_LABEL_KEYS[opt.value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={complete} aria-label={t('nav.skip')}>
                  <XIcon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('nav.skip')}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <Separator />

        {/* Progress */}
        <div className="px-5 pt-4">
          <Progress value={progress} className="h-0.5" />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t('nav.stepOf', { current: step + 1, total: ONBOARDING_TOTAL_STEPS })}
          </p>
        </div>

        {/* Step content — animated on step change */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            <m.div
              key={step}
              className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 py-5 lg:gap-6 lg:py-6"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: 'spring', stiffness: 600, damping: 40 }}
            >
              {/* Icon + eyebrow */}
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-xl bg-foreground/5 ring-1 ring-foreground/10">
                  <stepMeta.icon className={cn('size-4', stepMeta.accentClass)} />
                </div>
                <span className={cn('text-xs font-semibold', stepMeta.accentClass)}>
                  {t(stepMeta.eyebrowKey)}
                </span>
              </div>

              {/* Headline + description */}
              <div className="flex flex-col gap-2.5">
                <h1 className="text-2xl font-semibold leading-snug text-foreground text-balance">
                  {t(stepMeta.headlineKey)}
                </h1>
                <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                  {t(stepMeta.descriptionKey)}
                </p>
              </div>

              {/* Feature list */}
              {stepMeta.featureKeys.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {stepMeta.featureKeys.map(key => (
                    <li key={key} className="flex items-center gap-2.5 text-sm">
                      <CheckCircleIcon className={cn('size-4 shrink-0', stepMeta.accentClass)} />
                      <span className="text-foreground">{t(key)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Done step CTA list */}
              {isLast && (
                <div className="flex flex-col gap-2">
                  {[
                    { icon: MessageSquareIcon, key: 'step.done.action.newChat' as const },
                    { icon: FolderIcon, key: 'step.done.action.addWorkspace' as const },
                    { icon: Settings2Icon, key: 'step.done.action.settings' as const },
                  ].map(({ icon: Icon, key }) => (
                    <div
                      key={key}
                      className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2.5 ring-1 ring-border/50"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm text-foreground">{t(key)}</span>
                      <ArrowRightIcon className="ml-auto size-3.5 text-muted-foreground/50" />
                    </div>
                  ))}
                </div>
              )}
            </m.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="border-t border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={prevStep} disabled={isFirst} className="gap-1.5">
              <ChevronLeftIcon className="size-3.5" />
              {t('nav.back')}
            </Button>

            <div className="flex flex-1 items-center justify-center gap-1.5">
              {Array.from({ length: ONBOARDING_TOTAL_STEPS }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => useOnboardingStore.getState().goToStep(i)}
                  className={cn(
                    'h-1 rounded-full transition-[background-color,width] duration-200',
                    i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30',
                  )}
                  aria-label={`Step ${i + 1}`}
                />
              ))}
            </div>

            <Button size="sm" onClick={handleNext} className="gap-1.5">
              {isLast ? t('nav.getStarted') : t('nav.next')}
              {isLast
                ? <SparklesIcon className="size-3.5" />
                : <ChevronRightIcon className="size-3.5" />}
            </Button>
          </div>
        </div>
      </div>

      <OnboardingPreviewStage step={step} />
    </div>
  )
}

function OnboardingPreviewStage({ step }: { step: number }) {
  const { t } = useTranslation('onboarding')
  const isLast = step === ONBOARDING_TOTAL_STEPS - 1

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--color-neutral-950)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(34,211,238,0.14),transparent_38%),radial-gradient(circle_at_78%_76%,rgba(16,185,129,0.10),transparent_34%)]" />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-22 top-[10%] h-1.5 w-72 -rotate-[52deg] rounded-full bg-cyan-400/90 shadow-[0_0_24px_rgba(34,211,238,0.42)]" />
        <div className="absolute left-[16%] -top-6 h-1.5 w-68 -rotate-[58deg] rounded-full bg-teal-400/90 shadow-[0_0_24px_rgba(45,212,191,0.42)]" />
        <div className="absolute left-[42%] top-[7%] h-1.5 w-64 -rotate-[50deg] rounded-full bg-cyan-400/80 shadow-[0_0_22px_rgba(34,211,238,0.36)]" />
        <div className="absolute right-[8%] top-[17%] h-1.5 w-52 -rotate-[50deg] rounded-full bg-teal-300/90 shadow-[0_0_22px_rgba(94,234,212,0.38)]" />
        <div className="absolute -left-18 bottom-[18%] h-1.5 w-68 -rotate-[58deg] rounded-full bg-cyan-400/85 shadow-[0_0_22px_rgba(34,211,238,0.34)]" />
        <div className="absolute left-[24%] -bottom-20 h-1.5 w-76 -rotate-[60deg] rounded-full bg-teal-400/80 shadow-[0_0_22px_rgba(45,212,191,0.34)]" />
        <div className="absolute right-[24%] -bottom-18 h-1.5 w-72 -rotate-[58deg] rounded-full bg-cyan-400/80 shadow-[0_0_22px_rgba(34,211,238,0.34)]" />
        <div className="absolute -right-12 bottom-[12%] h-1.5 w-72 -rotate-[48deg] rounded-full bg-teal-300/90 shadow-[0_0_22px_rgba(94,234,212,0.36)]" />
      </div>

      <div className="relative z-10 flex h-full min-h-0 w-full items-center justify-center p-4 sm:p-6 lg:p-8">
        <AnimatePresence mode="wait" initial={false}>
          {isLast
            ? (
                <OnboardingReadyBento key="ready-bento" t={t} />
              )
            : (
                <m.div
                  key="product-preview"
                  className="relative flex h-full min-h-80 w-full max-w-[1180px] overflow-hidden rounded-[1.375rem] bg-cyan-400/90 p-1.5 shadow-[0_28px_90px_rgba(0,0,0,0.48),0_0_0_1px_rgba(255,255,255,0.10),0_0_56px_rgba(34,211,238,0.22)] md:min-h-0 lg:h-[min(760px,calc(100%_-_1rem))]"
                  initial={{ opacity: 0, scale: 0.98, y: 18, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, scale: 0.94, y: -18, filter: 'blur(8px)' }}
                  transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.9 }}
                >
                  <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-2xl bg-sidebar shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]">
                    <OnboardingProductPreview step={step} />
                  </div>
                </m.div>
              )}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none absolute bottom-5 right-5 z-20 flex items-center gap-1">
        {Array.from({ length: ONBOARDING_TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 rounded-full transition-[background-color,width] duration-200',
              i === step ? 'w-5 bg-cyan-300' : 'w-1 bg-white/30',
            )}
          />
        ))}
      </div>
    </div>
  )
}

function OnboardingReadyBento({ t }: { t: (key: OnboardingKey) => string }) {
  const items = [
    {
      icon: MessageSquareIcon,
      titleKey: 'step.done.action.newChat' as const,
      descriptionKey: 'step.done.action.newChat.description' as const,
      className: 'md:col-span-2 md:row-span-2',
      body: (
        <div className="mt-5 rounded-xl border border-border/60 bg-background px-3 py-3 shadow-xs/5">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary">
              <BotIcon className="size-3" aria-hidden="true" />
            </span>
            <span className="truncate">Codex · gpt-5.1-codex</span>
          </div>
          <div className="mt-3 min-h-18 rounded-lg bg-muted/45 px-3 py-2 text-sm leading-relaxed text-foreground text-pretty">
            {t('preview.agent.userPrompt')}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <span className="text-[11px] text-muted-foreground">18420 / 256k</span>
            <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground">
              {t('preview.ready.action.newChat')}
              <ArrowRightIcon className="size-3" aria-hidden="true" />
            </span>
          </div>
        </div>
      ),
    },
    {
      icon: FolderIcon,
      titleKey: 'step.done.action.addWorkspace' as const,
      descriptionKey: 'step.done.action.addWorkspace.description' as const,
      className: '',
      body: (
        <div className="mt-4 grid gap-2">
          {[
            ['apps/web', 'M 4'],
            ['packages/cli', 'A 1'],
            ['apps/server', 'OK'],
          ].map(([label, status]) => (
            <div key={label} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/45 px-2.5 py-2">
              <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{label}</span>
              <span className="shrink-0 rounded-md bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {status}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: ActivityIcon,
      titleKey: 'preview.ready.title' as const,
      descriptionKey: 'preview.ready.description' as const,
      className: '',
      body: (
        <div className="mt-4 grid grid-cols-3 gap-1.5">
          {[
            ['3', t('preview.metric.activeSessions')],
            ['18', t('preview.metric.toolCalls')],
            ['92%', t('preview.aside.git.ready')],
          ].map(([value, label]) => (
            <div key={label} className="rounded-lg bg-muted/45 px-2 py-2">
              <div className="font-mono text-sm font-medium tabular-nums text-foreground">{value}</div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: Settings2Icon,
      titleKey: 'step.done.action.settings' as const,
      descriptionKey: 'step.done.action.settings.description' as const,
      className: 'md:col-span-2',
      body: (
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {[
            t('preview.aside.await.github.check.typecheck'),
            t('preview.aside.await.github.check.lint'),
            t('preview.aside.await.github.check.preview'),
          ].map(label => (
            <div key={label} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/45 px-2.5 py-2 text-[12px] text-muted-foreground">
              <CheckCircle2Icon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
              <span className="min-w-0 truncate">{label}</span>
            </div>
          ))}
        </div>
      ),
    },
  ]

  return (
    <m.div
      className="flex h-full min-h-80 w-full max-w-[1040px] flex-col overflow-hidden rounded-[1.375rem] border border-white/10 bg-background/96 p-2 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur md:h-[min(720px,calc(100%_-_1rem))]"
      initial="hidden"
      animate="show"
      exit="hidden"
      variants={{
        hidden: { opacity: 0 },
        show: {
          opacity: 1,
          transition: { staggerChildren: 0.08, delayChildren: 0.08 },
        },
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-2.5">
        <div className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <SparklesIcon className="size-3" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{t('preview.ready.title')}</div>
        <span className="inline-flex h-5 items-center gap-1.5 rounded-full border border-border bg-muted/45 px-2 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
          {t('preview.aside.runtime.done')}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-min gap-2 overflow-auto p-2 md:grid-cols-4 md:auto-rows-fr">
        {items.map(({ icon: Icon, titleKey, descriptionKey, className, body }) => (
          <m.div
            key={titleKey}
            className={cn(
              'flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card p-4 text-card-foreground shadow-xs/5',
              className,
            )}
            variants={{
              hidden: { opacity: 0, y: 18, scale: 0.98, filter: 'blur(6px)' },
              show: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
            }}
            transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.9 }}
          >
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-medium leading-snug text-foreground">
                  {t(titleKey)}
                </h2>
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground text-pretty">
                  {t(descriptionKey)}
                </p>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {body}
            </div>
          </m.div>
        ))}
      </div>

      <div className="flex h-9 shrink-0 items-center justify-between border-t border-border/70 px-3 text-[11px] text-muted-foreground">
        <span className="truncate">{t('preview.aside.await.github.title')} · cradle/cradle #128</span>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">3/3</span>
          <span className="hidden h-5 items-center rounded-md bg-muted/45 px-2 sm:inline-flex">
            {t('preview.ready.action.openSettings')}
          </span>
        </div>
      </div>
    </m.div>
  )
}
