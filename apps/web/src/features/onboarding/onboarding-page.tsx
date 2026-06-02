// Output: Full-screen onboarding overlay — left guidance panel + transparent right window into real app.
// Input: OnboardingStore step, i18n translations.
// Position: Fixed overlay; the real running app is visible through the transparent right half.

import {
  ArrowRightIcon,
  BotIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
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
import { cn } from '~/lib/cn'

import { AnimatedCursorLayer } from './animated-cursor'
import type { CursorWaypoint } from './animated-cursor'
import { ONBOARDING_TOTAL_STEPS, useOnboardingStore } from './onboarding-store'

// ── Types ─────────────────────────────────────────────────────────────────────

type OnboardingKey = keyof typeof import('~/locales/default').default.onboarding

interface StepMeta {
  eyebrowKey: OnboardingKey
  headlineKey: OnboardingKey
  descriptionKey: OnboardingKey
  featureKeys: OnboardingKey[]
  icon: React.ComponentType<{ className?: string }>
  accentClass: string
}

// ── Step metadata ─────────────────────────────────────────────────────────────

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
    accentClass: 'text-blue-500',
  },
  {
    eyebrowKey: 'step.workspace.eyebrow',
    headlineKey: 'step.workspace.headline',
    descriptionKey: 'step.workspace.description',
    featureKeys: ['step.workspace.feature.1', 'step.workspace.feature.2', 'step.workspace.feature.3'],
    icon: FolderIcon,
    accentClass: 'text-amber-500',
  },
  {
    eyebrowKey: 'step.agents.eyebrow',
    headlineKey: 'step.agents.headline',
    descriptionKey: 'step.agents.description',
    featureKeys: ['step.agents.feature.1', 'step.agents.feature.2', 'step.agents.feature.3'],
    icon: BotIcon,
    accentClass: 'text-purple-500',
  },
  {
    eyebrowKey: 'step.done.eyebrow',
    headlineKey: 'step.done.headline',
    descriptionKey: 'step.done.description',
    featureKeys: [],
    icon: ZapIcon,
    accentClass: 'text-green-500',
  },
]

// ── Cursor waypoints (% of right transparent panel, calibrated to new-chat layout) ───────────
//
// The right panel starts at x = 420px (left panel width). The app renders full-width
// behind the overlay. Percentages here are relative to the right panel's width/height,
// which means cursor at x=35% ≈ viewport x of (420 + 0.35 * (vw - 420)).
// For a 1440px screen that's ≈ 777px — well inside the new-chat main content area.

const STEP_WAYPOINTS: CursorWaypoint[][] = [
  // Step 0 — Welcome: sweep to give an overview of the app shell
  [
    { x: 35, y: 25, dwell: 800 },   // top of content — workspace/greeting area
    { x: 35, y: 50, dwell: 900 },   // quick-actions grid
    { x: 35, y: 78, dwell: 1000 },  // composer at bottom
    { x: 58, y: 45, dwell: 700 },   // right side of main content
  ],
  // Step 1 — Chat: focus on the composer and model selector
  [
    { x: 35, y: 78, dwell: 1200 },  // composer text area
    { x: 18, y: 83, dwell: 700 },   // model-selector pill (left of composer)
    { x: 50, y: 78, dwell: 600 },   // send area (right of composer)
    { x: 35, y: 55, dwell: 900 },   // message/session list
  ],
  // Step 2 — Workspace: workspace selector + file-like session items
  [
    { x: 22, y: 28, dwell: 1000 },  // workspace / project pill near top
    { x: 35, y: 40, dwell: 800 },   // recent sessions
    { x: 35, y: 55, dwell: 700 },   // second session item
    { x: 35, y: 78, dwell: 800 },   // composer
  ],
  // Step 3 — Agents: quick-dispatch actions (the action cards on new-chat page)
  [
    { x: 30, y: 48, dwell: 1000 },  // first quick-action card
    { x: 42, y: 48, dwell: 800 },   // second card
    { x: 30, y: 57, dwell: 800 },   // third card
    { x: 35, y: 78, dwell: 900 },   // composer
  ],
  // Step 4 — Done: hover center then composer
  [
    { x: 35, y: 50, dwell: 1200 },
    { x: 35, y: 78, dwell: 1000 },
  ],
]

// ── Locale options ────────────────────────────────────────────────────────────

const LOCALE_OPTIONS = [
  { value: 'en-US', label: 'English' },
  { value: 'zh-CN', label: '中文' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'es-ES', label: 'Español' },
]

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Fixed overlay: left 420 px = guidance panel with bg-background;
 * right side = transparent window into the real running app.
 * The cursor animates over the real product UI.
 */
export function OnboardingPage() {
  const { t, i18n } = useTranslation('onboarding')
  const { step, nextStep, prevStep, complete } = useOnboardingStore()

  const isLast = step === ONBOARDING_TOTAL_STEPS - 1
  const isFirst = step === 0
  const stepMeta = STEPS[step]!
  const progress = ((step + 1) / ONBOARDING_TOTAL_STEPS) * 100

  const handleNext = useCallback(() => {
    if (isLast) complete()
    else nextStep()
  }, [isLast, complete, nextStep])

  const handleLangChange = useCallback(
    (lang: string) => { void i18n.changeLanguage(lang) },
    [i18n],
  )

  return (
    // Fixed overlay over the whole app. pointer-events-none lets the right panel
    // "see through" without intercepting mouse events (we add a blocker below).
    <div className="fixed inset-0 z-9999 flex pointer-events-none">

      {/* ── Left panel — guidance ──────────────────────────────────────── */}
      <div className="relative flex w-105 shrink-0 flex-col overflow-hidden border-r border-border bg-background pointer-events-auto">

        {/* Top bar */}
        <div className="flex h-12 items-center justify-between px-5">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary">
              <SparklesIcon className="size-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Cradle</span>
          </div>

          <div className="flex items-center gap-2">
            <Select value={i18n.language.slice(0, 5)} onValueChange={handleLangChange}>
              <SelectTrigger size="sm" className="w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
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
        <div className="flex flex-1 flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            <m.div
              key={step}
              className="flex flex-1 flex-col gap-6 overflow-hidden px-5 py-6"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
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
                <h1 className="text-2xl font-semibold leading-snug tracking-tight text-foreground">
                  {t(stepMeta.headlineKey)}
                </h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
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
                    'h-1 rounded-full transition-all duration-300',
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

      {/* ── Right panel — transparent window into the real running app ──────── */}
      {/*
        pointer-events-auto so user clicks on this panel are absorbed (preventing
        accidental interaction with the app behind during onboarding).
        The real app is visible through here — no fake mockups.
      */}
      <div className="relative flex-1 overflow-hidden pointer-events-auto">
        {/* Subtle dim to distinguish "guided preview" state from live use */}
        <div className="pointer-events-none absolute inset-0 z-0 bg-background/25 dark:bg-background/35" />

        {/* Edge vignette */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background: 'radial-gradient(ellipse at 40% 50%, transparent 45%, rgba(0,0,0,0.12) 100%)',
          }}
        />

        {/* Step indicator dots — bottom right of the live-app window */}
        <div className="pointer-events-none absolute bottom-5 right-5 z-20 flex items-center gap-1">
          {Array.from({ length: ONBOARDING_TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1 rounded-full transition-all duration-300',
                i === step ? 'w-5 bg-white/80' : 'w-1 bg-white/25',
              )}
            />
          ))}
        </div>

        {/* Animated cursor layer — moves over the real app UI */}
        <AnimatePresence mode="wait">
          <m.div
            key={`cursor-step-${step}`}
            className="absolute inset-0 z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <AnimatedCursorLayer
              waypoints={STEP_WAYPOINTS[step] ?? []}
              active
              startDelay={600}
            />
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
