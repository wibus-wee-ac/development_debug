import {
  ArrowRightIcon,
  FolderIcon,
  MessageSquareIcon,
  Settings2Icon,
  XIcon,
} from 'lucide-react'
import { AnimatePresence, m, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { useI18n } from '~/i18n/i18n-context'
import type { SupportedLocale } from '~/i18n/locales'
import { localeOptions, normalizeLocale } from '~/i18n/locales'
import { cn } from '~/lib/cn'

import { ONBOARDING_TOTAL_STEPS, useOnboardingStore } from './onboarding-store'

type OnboardingKey = keyof typeof import('~/locales/default').default.onboarding
type T = (key: OnboardingKey) => string

const LOCALE_LABEL_KEYS: Record<SupportedLocale, OnboardingKey> = {
  'en-US': 'locale.enUS',
  'zh-CN': 'locale.zhCN',
  'ja-JP': 'locale.jaJP',
  'es-ES': 'locale.esES',
}

// Strong, intentional easing curves (Emil Kowalski). The built-in CSS easings lack punch.
const EASE_OUT = [0.22, 1, 0.36, 1] as const
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const

const CRADLE_ICON_URL = '/icon.png'

function isSelectKeyboardEventTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-slot^="select"]') !== null
}

interface StepDef {
  key: 'welcome' | 'chat' | 'workspace' | 'agents' | 'done'
  eyebrow: OnboardingKey
  headline: OnboardingKey
  description: OnboardingKey
  features: readonly OnboardingKey[]
}

const STEPS: readonly StepDef[] = [
  {
    key: 'welcome',
    eyebrow: 'step.welcome.eyebrow',
    headline: 'step.welcome.headline',
    description: 'step.welcome.description',
    features: ['step.welcome.feature.1', 'step.welcome.feature.2', 'step.welcome.feature.3'],
  },
  {
    key: 'chat',
    eyebrow: 'step.chat.eyebrow',
    headline: 'step.chat.headline',
    description: 'step.chat.description',
    features: ['step.chat.feature.1', 'step.chat.feature.2', 'step.chat.feature.3'],
  },
  {
    key: 'workspace',
    eyebrow: 'step.workspace.eyebrow',
    headline: 'step.workspace.headline',
    description: 'step.workspace.description',
    features: ['step.workspace.feature.1', 'step.workspace.feature.2', 'step.workspace.feature.3'],
  },
  {
    key: 'agents',
    eyebrow: 'step.agents.eyebrow',
    headline: 'step.agents.headline',
    description: 'step.agents.description',
    features: ['step.agents.feature.1', 'step.agents.feature.2', 'step.agents.feature.3'],
  },
  {
    key: 'done',
    eyebrow: 'step.done.eyebrow',
    headline: 'step.done.headline',
    description: 'step.done.description',
    features: [],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════════
// Main orchestrator — a single centered stage where kinetic typography is the hero.
// No mock UI. Words rise out of a mask, light breathes behind them.
// ═══════════════════════════════════════════════════════════════════════════════
export function OnboardingPage() {
  const { t, i18n } = useTranslation('onboarding')
  const { switchLang } = useI18n()
  const { step, nextStep, prevStep, complete } = useOnboardingStore()

  const isLast = step === ONBOARDING_TOTAL_STEPS - 1
  const isFirst = step === 0
  const activeLocale = normalizeLocale(i18n.language)
  const def = STEPS[step]

  const handleNext = () => {
    if (isLast) { complete() }
    else { nextStep() }
  }

  const handleLangChange = (lang: string) => { void switchLang(normalizeLocale(lang)) }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isSelectKeyboardEventTarget(e.target)) { return }
    if (e.key === 'ArrowRight' || e.key === 'Enter') { handleNext() }
    else if (e.key === 'ArrowLeft' && !isFirst) { prevStep() }
    else if (e.key === 'Escape') { complete() }
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-9999 flex flex-col overflow-hidden bg-background text-foreground"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <AmbientField />

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <header className="relative z-20 flex h-16 shrink-0 items-center justify-between px-6 sm:px-9">
        <m.div
          className="flex items-center gap-2.5"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        >
          <div className="flex size-7 items-center justify-center overflow-hidden rounded-lg bg-background ring-1 ring-black/10 dark:ring-white/10">
            <img src={CRADLE_ICON_URL} alt="" className="size-full object-cover" draggable={false} />
          </div>
          <span className="text-[13px] font-medium tracking-tight">Cradle</span>
        </m.div>

        <m.div
          className="flex items-center gap-2"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.05 }}
        >
          <Select value={activeLocale} onValueChange={handleLangChange}>
            <SelectTrigger
              size="sm"
              className="h-7 w-24 border-transparent bg-transparent text-xs text-muted-foreground shadow-none hover:bg-muted"
            >
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
          <m.button
            onClick={complete}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('nav.skip')}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            <XIcon className="size-3.5" />
          </m.button>
        </m.div>
      </header>

      {/* ── Center stage ──────────────────────────────────────────────────── */}
      <main className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6">
        <AnimatePresence mode="wait">
          <m.div
            key={step}
            variants={stageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="flex w-full max-w-2xl flex-col items-center text-center"
          >
            <StepBody def={def} t={t} onComplete={complete} />
          </m.div>
        </AnimatePresence>
      </main>

      {/* ── Navigation ────────────────────────────────────────────────────── */}
      <m.footer
        className="relative z-20 flex h-20 shrink-0 items-center justify-between px-6 sm:px-10"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.6, ease: EASE_OUT }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={prevStep}
          disabled={isFirst}
          className="-ml-2 gap-1 text-xs text-muted-foreground"
        >
          {t('nav.back')}
        </Button>

        <div className="flex items-center gap-1.5">
          {Array.from({ length: ONBOARDING_TOTAL_STEPS }).map((_, i) => (
            <button
              key={i}
              onClick={() => useOnboardingStore.getState().goToStep(i)}
              aria-label={t('nav.stepOf').replace('{{current}}', String(i + 1)).replace('{{total}}', String(ONBOARDING_TOTAL_STEPS))}
              className="group p-1"
            >
              <m.div
                className="rounded-full bg-foreground"
                animate={{
                  width: i === step ? 18 : 5,
                  opacity: i === step ? 1 : i < step ? 0.4 : 0.15,
                }}
                style={{ height: 5 }}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              />
            </button>
          ))}
        </div>

        <m.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
          <Button size="sm" onClick={handleNext} className="gap-1.5 text-xs">
            {isLast ? t('nav.getStarted') : t('nav.next')}
            <m.span
              className="inline-flex"
              animate={isLast ? { x: [0, 3, 0] } : {}}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ArrowRightIcon className="size-3" />
            </m.span>
          </Button>
        </m.div>
      </m.footer>
    </div>
  )
}

// ─── Stage crossfade (blur dissolve; the words inside carry the motion) ───────────
const stageVariants = {
  enter: { opacity: 0, filter: 'blur(12px)' },
  center: { opacity: 1, filter: 'blur(0px)', transition: { duration: 0.5, ease: EASE_OUT } },
  exit: { opacity: 0, filter: 'blur(12px)', transition: { duration: 0.28, ease: EASE_IN_OUT } },
}

// ─── Per-step body: eyebrow rule → kinetic headline → description → content ───────
function StepBody({ def, t, onComplete }: { def: StepDef, t: T, onComplete: () => void }) {
  const isDone = def.key === 'done'

  return (
    <>
      {/* Eyebrow with a hairline that draws in */}
      <div className="mb-6 flex flex-col items-center gap-3.5">
        <m.div
          className="h-px bg-foreground/25"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 44, opacity: 1 }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
        />
        <m.p
          className="text-[11px] font-medium tracking-[0.24em] text-muted-foreground uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.6, ease: EASE_OUT }}
        >
          {t(def.eyebrow)}
        </m.p>
      </div>

      {/* Kinetic headline — the hero */}
      <WordReveal
        text={t(def.headline)}
        delay={0.3}
        className="max-w-[16ch] text-[clamp(2.1rem,4.4vw,3.5rem)] leading-[1.04] font-semibold text-balance"
      />

      {/* Description */}
      <m.p
        className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground text-pretty"
        initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ delay: 0.55, duration: 0.8, ease: EASE_OUT }}
      >
        {t(def.description)}
      </m.p>

      {isDone
        ? <DoneActions t={t} onComplete={onComplete} />
        : <FeatureList features={def.features} t={t} />}
    </>
  )
}

// ─── Word-by-word masked rise with blur settle + letter-spacing tighten ───────────
// The signature Apple-keynote move: each word slides up from behind a clip edge,
// resolving from blur to sharp, while the whole line tightens its tracking.
function WordReveal({ text, className, delay = 0 }: { text: string, className?: string, delay?: number }) {
  const words = text.split(' ')
  return (
    <m.h1
      className={cn('font-semibold', className)}
      aria-label={text}
      initial={{ letterSpacing: '0.01em' }}
      animate={{ letterSpacing: '-0.035em' }}
      transition={{ delay, duration: 1.1, ease: EASE_OUT }}
    >
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="inline-block overflow-hidden pb-[0.14em] align-bottom" aria-hidden>
          <m.span
            className="inline-block"
            initial={{ y: '110%', opacity: 0, filter: 'blur(8px)' }}
            animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
            transition={{ delay: delay + i * 0.06, duration: 0.85, ease: EASE_OUT }}
          >
            {word}
            {i < words.length - 1 ? ' ' : ''}
          </m.span>
        </span>
      ))}
    </m.h1>
  )
}

// ─── Editorial numbered feature lines (no cards, no mockups) ──────────────────────
function FeatureList({ features, t }: { features: readonly OnboardingKey[], t: T }) {
  return (
    <m.ul
      className="mx-auto mt-9 flex w-full max-w-sm flex-col"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.09, delayChildren: 0.7 } } }}
    >
      {features.map((key, i) => (
        <m.li
          key={key}
          className="flex items-center gap-4 border-b border-border/70 py-3 text-left last:border-b-0"
          variants={{
            hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
            show: { opacity: 1, y: 0, filter: 'blur(0px)' },
          }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
        >
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
            {String(i + 1).padStart(2, '0')}
          </span>
          <span className="text-[14px] text-foreground/90">{t(key)}</span>
        </m.li>
      ))}
    </m.ul>
  )
}

// ─── Done — three understated action rows; no heavy bento cards ───────────────────
function DoneActions({ t, onComplete }: { t: T, onComplete: () => void }) {
  const actions = [
    {
      icon: MessageSquareIcon,
      titleKey: 'step.done.action.newChat' as const,
      descKey: 'step.done.action.newChat.description' as const,
    },
    {
      icon: FolderIcon,
      titleKey: 'step.done.action.addWorkspace' as const,
      descKey: 'step.done.action.addWorkspace.description' as const,
    },
    {
      icon: Settings2Icon,
      titleKey: 'step.done.action.settings' as const,
      descKey: 'step.done.action.settings.description' as const,
    },
  ]

  return (
    <m.div
      className="mx-auto mt-10 flex w-full max-w-md flex-col gap-2.5"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.7 } } }}
    >
      {actions.map(({ icon: ActionIcon, titleKey, descKey }) => (
        <m.button
          key={titleKey}
          onClick={() => setTimeout(onComplete, 180)}
          className="group flex items-center gap-3.5 rounded-2xl border border-border bg-card/40 px-4 py-3 text-left backdrop-blur-sm transition-colors hover:border-foreground/15 hover:bg-card"
          variants={{
            hidden: { opacity: 0, y: 14, filter: 'blur(4px)' },
            show: { opacity: 1, y: 0, filter: 'blur(0px)' },
          }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
            <ActionIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-foreground">{t(titleKey)}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{t(descKey)}</div>
          </div>
          <m.div
            className="shrink-0 text-muted-foreground/30 transition-colors group-hover:text-foreground/60"
            whileHover={{ x: 3 }}
          >
            <ArrowRightIcon className="size-3.5" />
          </m.div>
        </m.button>
      ))}
    </m.div>
  )
}

// ─── Living ambient light — slow-drifting soft blobs + faint grid + pointer glow ──
function AmbientField() {
  const x = useMotionValue(0.5)
  const y = useMotionValue(0.35)
  const sx = useSpring(x, { stiffness: 40, damping: 25 })
  const sy = useSpring(y, { stiffness: 40, damping: 25 })
  const pointerLight = useTransform(
    [sx, sy],
    ([px, py]) =>
      `radial-gradient(720px circle at ${Number(px) * 100}% ${Number(py) * 100}%, color-mix(in srgb, var(--foreground) 5%, transparent), transparent 60%)`,
  )
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) { return }
      const r = ref.current.getBoundingClientRect()
      x.set((e.clientX - r.left) / r.width)
      y.set((e.clientY - r.top) / r.height)
    }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [x, y])

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Drifting soft light, top-left */}
      <m.div
        className="absolute -top-[12%] -left-[8%] size-[55vw] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--foreground) 7%, transparent), transparent 70%)' }}
        animate={{ x: [0, 70, -30, 0], y: [0, -50, 40, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Drifting soft light, bottom-right (offset phase) */}
      <m.div
        className="absolute -right-[10%] -bottom-[14%] size-[50vw] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--foreground) 6%, transparent), transparent 70%)' }}
        animate={{ x: [0, -60, 30, 0], y: [0, 40, -30, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Faint dot grid, masked to fade at the edges */}
      <div
        className="absolute inset-0 opacity-50 [background-image:radial-gradient(circle_at_center,var(--border)_1px,transparent_1px)] [background-size:28px_28px]"
        style={{ maskImage: 'radial-gradient(ellipse at center, black, transparent 78%)' }}
      />
      {/* Pointer-reactive highlight */}
      <m.div className="absolute inset-0" style={{ background: pointerLight }} />
    </div>
  )
}
