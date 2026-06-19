import { ShaderGradient, ShaderGradientCanvas } from '@shader-gradient/react'
import {
  ArrowRightLine as ArrowRightIcon,
  FolderLine as FolderIcon,
  Message1Line as MessageSquareIcon,
  Settings2Line as Settings2Icon,
  CloseLine as XIcon
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { useI18n } from '~/i18n/i18n-context'
import type { SupportedLocale } from '~/i18n/locales'
import { localeOptions, normalizeLocale } from '~/i18n/locales'
import { cn } from '~/lib/cn'
import { useResolvedThemeMode } from '~/store/theme'

import { ONBOARDING_TOTAL_STEPS, useOnboardingStore } from './onboarding-store'

type OnboardingKey = keyof typeof import('~/locales/default').default.onboarding
type T = (key: OnboardingKey) => string
type StepKey = 'welcome' | 'chat' | 'workspace' | 'agents' | 'done'

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

const HEADLINE_CLASS = 'max-w-[18ch] text-[clamp(2.4rem,5vw,4.25rem)] font-semibold leading-[1.02] text-balance drop-shadow-[0_1px_24px_var(--background)]'

function isSelectKeyboardEventTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-slot^="select"]') !== null
}

interface StepDef {
  key: StepKey
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
// Shader backdrop config — one config per step. The canvas mounts once; only these
// props change as you advance, so the gradient glides between palettes/cameras via
// the library's built-in `enableTransition` + `smoothTime` tweening (no remount).
// Grounded in the library's real preset numbers (halo/aurora). `lightType: '3d'`
// keeps it fully local — no remote HDR fetch.
// ═══════════════════════════════════════════════════════════════════════════════
interface ShaderStep {
  shader: 'defaults' | 'marble' | 'aurora'
  speed: number
  cAzimuthAngle: number
  cPolarAngle: number
  rotationZ: number
  /** [color1, color2, color3] per theme — refined, not garish. */
  light: readonly [string, string, string]
  dark: readonly [string, string, string]
}

const SHADER_STEPS: Record<StepKey, ShaderStep> = {
  welcome: {
    shader: 'aurora',
    speed: 0.35,
    cAzimuthAngle: 180,
    cPolarAngle: 90,
    rotationZ: 50,
    light: ['#c7d2fe', '#a5b4fc', '#818cf8'],
    dark: ['#1e1b4b', '#4338ca', '#6d28d9'],
  },
  chat: {
    shader: 'defaults',
    speed: 0.45,
    cAzimuthAngle: 204,
    cPolarAngle: 90,
    rotationZ: 70,
    light: ['#fed7aa', '#fdba74', '#fb923c'],
    dark: ['#7c2d12', '#c2410c', '#ea580c'],
  },
  workspace: {
    shader: 'marble',
    speed: 0.3,
    cAzimuthAngle: 158,
    cPolarAngle: 90,
    rotationZ: 40,
    light: ['#99f6e4', '#5eead4', '#2dd4bf'],
    dark: ['#134e4a', '#0f766e', '#0d9488'],
  },
  agents: {
    shader: 'aurora',
    speed: 0.42,
    cAzimuthAngle: 222,
    cPolarAngle: 90,
    rotationZ: 60,
    light: ['#bbf7d0', '#6ee7b7', '#34d399'],
    dark: ['#064e3b', '#047857', '#059669'],
  },
  done: {
    shader: 'defaults',
    speed: 0.36,
    cAzimuthAngle: 180,
    cPolarAngle: 90,
    rotationZ: 92,
    light: ['#ddd6fe', '#c4b5fd', '#f0abfc'],
    dark: ['#4c1d95', '#7e22ce', '#a21caf'],
  },
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return reduced
}

// ─── The living shader wall. Mounts once; props morph per step. ───────────────────
function ShaderStage({ stepKey }: { stepKey: StepKey }) {
  const mode = useResolvedThemeMode()
  const reduced = usePrefersReducedMotion()
  const cfg = SHADER_STEPS[stepKey]
  const [color1, color2, color3] = mode === 'dark' ? cfg.dark : cfg.light

  return (
    <div className="absolute inset-0">
      <ShaderGradientCanvas
        className="!absolute inset-0 size-full"
        pointerEvents="none"
        pixelDensity={1.5}
      >
        <ShaderGradient
          control="props"
          type="plane"
          shader={cfg.shader}
          animate={reduced ? 'off' : 'on'}
          uSpeed={reduced ? 0 : cfg.speed}
          uStrength={3.4}
          uDensity={1.3}
          uFrequency={5.5}
          uAmplitude={1}
          color1={color1}
          color2={color2}
          color3={color3}
          positionX={-1.4}
          positionY={0}
          positionZ={0}
          rotationX={0}
          rotationY={10}
          rotationZ={cfg.rotationZ}
          cAzimuthAngle={cfg.cAzimuthAngle}
          cPolarAngle={cfg.cPolarAngle}
          cDistance={3.6}
          cameraZoom={1}
          fov={45}
          lightType="3d"
          brightness={mode === 'dark' ? 1 : 1.25}
          reflection={0.1}
          grain="on"
          enableTransition
          smoothTime={0.32}
        />
      </ShaderGradientCanvas>

      {/* Frosted-glass scrim — turns the live gradient into soft Apple-style color
          clouds and guarantees text legibility in either theme. */}
      <div className="absolute inset-0 bg-background/55 backdrop-blur-2xl" />
      {/* Center pool: lets a touch more color breathe at the edges. */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(125% 125% at 50% 50%, transparent 38%, var(--background) 100%)' }}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main orchestrator — kinetic typography over a living shader wall. Each step brings
// its own headline animation and its own shader palette/camera, so no two feel alike.
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
      <ShaderStage stepKey={def.key} />

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
        {/* Layers stack absolutely so the outgoing step crossfades into the incoming
            one — no empty gap — while the shader wall morphs continuously underneath. */}
        <AnimatePresence>
          <m.div
            key={step}
            variants={stageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="absolute inset-x-0 mx-auto flex w-full max-w-3xl flex-col items-center px-6 text-center"
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

// ─── Stage crossfade — overlapping layers; the headline inside carries the motion ──
const stageVariants = {
  enter: { opacity: 0, filter: 'blur(10px)', scale: 0.99 },
  center: {
    opacity: 1,
    filter: 'blur(0px)',
    scale: 1,
    transition: { duration: 0.6, ease: EASE_OUT, delay: 0.12 },
  },
  exit: {
    opacity: 0,
    filter: 'blur(10px)',
    scale: 1.01,
    transition: { duration: 0.45, ease: EASE_IN_OUT },
  },
}

// Each step's headline resolves at its own pace; the description waits for it.
const DESC_DELAY: Record<StepKey, number> = {
  welcome: 0.95,
  chat: 1.1,
  workspace: 0.95,
  agents: 1.05,
  done: 0.6,
}

// ─── Per-step body: eyebrow rule → headline → description → content ────────────────
function StepBody({ def, t, onComplete }: { def: StepDef, t: T, onComplete: () => void }) {
  return (
    <>
      {/* Eyebrow with a hairline that draws in */}
      <div className="mb-7 flex flex-col items-center gap-3.5">
        <m.div
          className="h-px bg-foreground/30"
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

      {/* Headline — a different kinetic treatment per step */}
      <StepHeadline stepKey={def.key} text={t(def.headline)} />

      {/* Description — fades up once the headline has resolved */}
      <m.p
        className="mt-7 max-w-md text-[15px] leading-relaxed text-muted-foreground text-pretty"
        initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ delay: DESC_DELAY[def.key], duration: 0.8, ease: EASE_OUT }}
      >
        {t(def.description)}
      </m.p>

      {def.key === 'done'
        ? <DoneActions t={t} onComplete={onComplete} />
        : <FeatureList features={def.features} t={t} delay={DESC_DELAY[def.key] + 0.15} />}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEADLINE TREATMENTS — one per step, all in the same monochrome family.
// ═══════════════════════════════════════════════════════════════════════════════
function StepHeadline({ stepKey, text }: { stepKey: StepKey, text: string }) {
  switch (stepKey) {
    case 'welcome': return <RiseHeadline text={text} />
    case 'chat': return <TypeHeadline text={text} />
    case 'workspace': return <CascadeHeadline text={text} />
    case 'agents': return <FocusHeadline text={text} />
    case 'done': return <SpringHeadline text={text} />
  }
}

// Welcome → words rise out of a clip mask, blur-settle, tracking tightens as they lock.
function RiseHeadline({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <m.h1
      className={HEADLINE_CLASS}
      aria-label={text}
      initial={{ letterSpacing: '0.012em' }}
      animate={{ letterSpacing: '-0.035em' }}
      transition={{ delay: 0.3, duration: 1.1, ease: EASE_OUT }}
    >
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="inline-block overflow-hidden pb-[0.14em] align-bottom" aria-hidden>
          <m.span
            className="inline-block"
            initial={{ y: '110%', opacity: 0, filter: 'blur(8px)' }}
            animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
            transition={{ delay: 0.3 + i * 0.07, duration: 0.85, ease: EASE_OUT }}
          >
            {word}
            {i < words.length - 1 ? ' ' : ''}
          </m.span>
        </span>
      ))}
    </m.h1>
  )
}

// Chat → the headline types itself, character by character, with a live caret.
// Every glyph holds its slot (opacity only) so the centered line never reflows.
function TypeHeadline({ text }: { text: string }) {
  const [count, setCount] = useState(0)
  const chars = [...text]

  useEffect(() => {
    setCount(0)
    let i = 0
    let interval: ReturnType<typeof setInterval> | undefined
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1
        setCount(i)
        if (i >= chars.length) { clearInterval(interval) }
      }, 48)
    }, 320)
    return () => { clearTimeout(start); if (interval) { clearInterval(interval) } }
  }, [text])

  const done = count >= chars.length

  return (
    <h1 className={cn(HEADLINE_CLASS, 'tracking-[-0.035em]')} aria-label={text}>
      {chars.map((ch, i) => (
        <span key={i} className={cn('transition-opacity duration-100', i < count ? 'opacity-100' : 'opacity-0')}>
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
      <m.span
        className="ml-0.5 inline-block h-[0.78em] w-[3px] translate-y-[0.06em] rounded-full bg-foreground align-baseline"
        animate={{ opacity: done ? [1, 0] : 1 }}
        transition={done ? { duration: 0.6, repeat: Infinity } : { duration: 0.15 }}
      />
    </h1>
  )
}

// Workspace → words slide in from the left, each a step deeper, like file-tree rows.
function CascadeHeadline({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <h1 className={cn(HEADLINE_CLASS, 'tracking-[-0.035em]')} aria-label={text}>
      {words.map((word, i) => (
        <m.span
          key={`${word}-${i}`}
          className="inline-block"
          initial={{ x: -28 - i * 6, opacity: 0, filter: 'blur(6px)' }}
          animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
          transition={{ delay: 0.32 + i * 0.1, duration: 0.7, ease: EASE_OUT }}
        >
          {word}
          {i < words.length - 1 ? ' ' : ''}
        </m.span>
      ))}
    </h1>
  )
}

// Agents → each word pulls into focus out of a soft blur, settling left to right.
function FocusHeadline({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <h1 className={cn(HEADLINE_CLASS, 'tracking-[-0.035em]')} aria-label={text}>
      {words.map((word, i) => (
        <m.span
          key={`${word}-${i}`}
          className="inline-block"
          initial={{ opacity: 0, filter: 'blur(14px)', scale: 1.06 }}
          animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
          transition={{ delay: 0.3 + i * 0.11, duration: 0.85, ease: EASE_OUT }}
        >
          {word}
          {i < words.length - 1 ? ' ' : ''}
        </m.span>
      ))}
    </h1>
  )
}

// Done → the whole line springs in as one confident pop.
function SpringHeadline({ text }: { text: string }) {
  return (
    <m.h1
      className={cn(HEADLINE_CLASS, 'tracking-[-0.035em]')}
      aria-label={text}
      initial={{ opacity: 0, scale: 0.84, filter: 'blur(10px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={{ type: 'spring', stiffness: 220, damping: 18, delay: 0.15 }}
    >
      {text}
    </m.h1>
  )
}

// ─── Editorial numbered feature lines (no cards, no mockups) ──────────────────────
function FeatureList({ features, t, delay }: { features: readonly OnboardingKey[], t: T, delay: number }) {
  return (
    <m.ul
      className="mx-auto mt-9 flex w-full max-w-sm flex-col"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.09, delayChildren: delay } } }}
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

// ─── Done — a primary CTA with two quiet secondary actions, layered not flat ───────
function DoneActions({ t, onComplete }: { t: T, onComplete: () => void }) {
  const dismiss = () => setTimeout(onComplete, 180)

  const enter = {
    hidden: { opacity: 0, y: 14, filter: 'blur(5px)' },
    show: { opacity: 1, y: 0, filter: 'blur(0px)' },
  }

  return (
    <m.div
      className="mx-auto mt-11 flex w-full max-w-sm flex-col gap-3"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.09, delayChildren: 0.7 } } }}
    >
      {/* Primary CTA — the one thing we want them to do */}
      <m.button
        onClick={dismiss}
        className="group relative flex h-13 items-center gap-3 overflow-hidden rounded-2xl bg-foreground px-5 text-background shadow-[var(--shadow-lg)]"
        variants={enter}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        whileHover={{ y: -2, scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
      >
        {/* Sheen sweep on hover */}
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-background/15 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
        <MessageSquareIcon className="size-[18px] shrink-0" />
        <span className="flex-1 text-left text-[14px] font-semibold tracking-tight">{t('step.done.action.newChat')}</span>
        <m.span className="shrink-0" animate={{ x: [0, 3, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
          <ArrowRightIcon className="size-4" />
        </m.span>
      </m.button>

      {/* Two quiet secondary actions, side by side */}
      <div className="grid grid-cols-2 gap-3">
        {([
          { icon: FolderIcon, titleKey: 'step.done.action.addWorkspace' as const },
          { icon: Settings2Icon, titleKey: 'step.done.action.settings' as const },
        ]).map(({ icon: ActionIcon, titleKey }) => (
          <m.button
            key={titleKey}
            onClick={dismiss}
            className="group flex h-13 items-center justify-center gap-2.5 rounded-2xl border border-border/80 bg-card/40 text-[13px] font-medium text-foreground/90 backdrop-blur-xl transition-colors hover:border-foreground/20 hover:bg-card/70 hover:text-foreground"
            variants={enter}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
          >
            <ActionIcon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            {t(titleKey)}
          </m.button>
        ))}
      </div>
    </m.div>
  )
}
