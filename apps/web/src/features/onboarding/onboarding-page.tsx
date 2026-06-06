import {
  ArrowRightIcon,
  BotIcon,
  CheckIcon,
  CodeIcon,
  FileIcon,
  FolderIcon,
  GitBranchIcon,
  MessageSquareIcon,
  SearchIcon,
  Settings2Icon,
  TerminalIcon,
  XIcon,
} from 'lucide-react'
import { AnimatePresence, m, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { useI18n } from '~/i18n/i18n-context'
import { localeOptions, normalizeLocale } from '~/i18n/locales'
import type { SupportedLocale } from '~/i18n/locales'
import { cn } from '~/lib/cn'

import onboardingBackgroundUrl from './assets/onboarding-abstract-field.svg'
import { ONBOARDING_TOTAL_STEPS, useOnboardingStore } from './onboarding-store'

type OnboardingKey = keyof typeof import('~/locales/default').default.onboarding

const LOCALE_LABEL_KEYS: Record<SupportedLocale, OnboardingKey> = {
  'en-US': 'locale.enUS',
  'zh-CN': 'locale.zhCN',
  'ja-JP': 'locale.jaJP',
  'es-ES': 'locale.esES',
}

function isSelectKeyboardEventTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-slot^="select"]') !== null
}

const CRADLE_ICON_URL = '/icon.png'

const WELCOME_PARTICLES = [
  { id: 0, startX: -56, startY: -28, delay: 0.04 },
  { id: 1, startX: 46, startY: -42, delay: 0.1 },
  { id: 2, startX: -34, startY: 54, delay: 0.16 },
  { id: 3, startX: 58, startY: 34, delay: 0.22 },
  { id: 4, startX: -76, startY: 8, delay: 0.08 },
  { id: 5, startX: 74, startY: -2, delay: 0.2 },
  { id: 6, startX: -12, startY: -72, delay: 0.14 },
  { id: 7, startX: 18, startY: 72, delay: 0.26 },
  { id: 8, startX: -70, startY: -58, delay: 0.0 },
  { id: 9, startX: 70, startY: 60, delay: 0.18 },
  { id: 10, startX: 6, startY: -48, delay: 0.28 },
  { id: 11, startX: -4, startY: 48, delay: 0.12 },
] as const

const WORKSPACE_FILES = [
  { name: 'apps/', indent: 0, icon: FolderIcon },
  { name: 'web/', indent: 1, icon: FolderIcon },
  { name: 'onboarding-page.tsx', indent: 2, icon: FileIcon },
  { name: 'kanban-board.tsx', indent: 2, icon: FileIcon },
  { name: 'server/', indent: 1, icon: FolderIcon },
  { name: 'packages/', indent: 0, icon: FolderIcon },
  { name: 'design-system/', indent: 1, icon: FolderIcon },
] as const

const WORKSPACE_INDENT_CLASSES = ['pl-3', 'pl-7', 'pl-11'] as const

const AGENT_STEPS = [
  { icon: SearchIcon, text: '> Checking workspace files...', success: false },
  { icon: CodeIcon, text: '> Editing onboarding-page.tsx', success: false },
  { icon: TerminalIcon, text: '> tsc --noEmit', success: false },
  { icon: CheckIcon, text: 'OK All checks passed', success: true },
] as const

// ─── Ambient mouse-follow glow ─────────────────────────────────────────────────
function AmbientGlow() {
  const x = useMotionValue(0.5)
  const y = useMotionValue(0.5)
  const sx = useSpring(x, { stiffness: 40, damping: 25 })
  const sy = useSpring(y, { stiffness: 40, damping: 25 })
  const bg = useTransform(
    [sx, sy],
    ([px, py]) =>
      `radial-gradient(760px circle at ${Number(px) * 100}% ${Number(py) * 100}%, color-mix(in srgb, var(--foreground) 4%, transparent), transparent 58%)`,
  )
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) return
      const r = ref.current.getBoundingClientRect()
      x.set((e.clientX - r.left) / r.width)
      y.set((e.clientY - r.top) / r.height)
    }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [x, y])

  return <m.div ref={ref} className="pointer-events-none absolute inset-0" style={{ background: bg }} />
}

// ─── Keyboard shortcut hint ────────────────────────────────────────────────────
function KeyHint() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 4000)
    return () => clearTimeout(t)
  }, [])
  return (
    <AnimatePresence>
      {visible && (
        <m.div
          className="pointer-events-none absolute bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.3 }}
        >
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">←</kbd>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">→</kbd>
          <span>to navigate</span>
        </m.div>
      )}
    </AnimatePresence>
  )
}

// ─── Progress bar (thin line) ──────────────────────────────────────────────────
function ProgressLine({ step }: { step: number }) {
  const progress = ((step + 1) / ONBOARDING_TOTAL_STEPS) * 100
  return (
    <div className="absolute top-12 right-0 left-0 z-30 h-px bg-border">
      <m.div
        className="h-full bg-foreground"
        initial={{ width: '0%' }}
        animate={{ width: `${progress}%` }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      />
    </div>
  )
}

// ─── Main orchestrator ─────────────────────────────────────────────────────────
export function OnboardingPage() {
  const { t, i18n } = useTranslation('onboarding')
  const { switchLang } = useI18n()
  const { step, nextStep, prevStep, complete } = useOnboardingStore()
  const [direction, setDirection] = useState(1)

  const isLast = step === ONBOARDING_TOTAL_STEPS - 1
  const isFirst = step === 0
  const activeLocale = normalizeLocale(i18n.language)

  const handleNext = useCallback(() => {
    setDirection(1)
    if (isLast) complete()
    else nextStep()
  }, [isLast, complete, nextStep])

  const handlePrev = useCallback(() => {
    setDirection(-1)
    prevStep()
  }, [prevStep])

  const handleLangChange = useCallback(
    (lang: string) => { void switchLang(normalizeLocale(lang)) },
    [switchLang],
  )

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isSelectKeyboardEventTarget(e.target)) {
      return
    }

    if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext()
    else if (e.key === 'ArrowLeft' && !isFirst) handlePrev()
    else if (e.key === 'Escape') complete()
  }, [handleNext, isFirst, handlePrev, complete])

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-9999 flex flex-col overflow-hidden bg-background text-foreground"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <AmbientGlow />
      <ProgressLine step={step} />
      <KeyHint />

      {/* Header */}
      <m.header
        className="relative z-20 flex h-12 shrink-0 items-center justify-end px-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        <div className="flex items-center gap-3">
          <Select value={activeLocale} onValueChange={handleLangChange}>
            <SelectTrigger size="sm" className="h-7 w-24 border-transparent bg-transparent text-xs text-muted-foreground shadow-none hover:bg-muted">
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
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t('nav.skip')}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <XIcon className="size-3.5" />
          </m.button>
        </div>
      </m.header>

      {/* Step content */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6">
        <AnimatePresence mode="wait" custom={direction}>
          <m.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="flex w-full max-w-xl flex-col items-center"
          >
            {step === 0 && <StepWelcome t={t} />}
            {step === 1 && <StepChat t={t} />}
            {step === 2 && <StepWorkspace t={t} />}
            {step === 3 && <StepAgents t={t} />}
            {step === 4 && <StepDone t={t} onComplete={complete} />}
          </m.div>
        </AnimatePresence>
      </main>

      {/* Footer */}
      <m.footer
        className="relative z-20 flex h-14 shrink-0 items-center justify-between px-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.3 }}
      >
        <m.div whileTap={{ x: -3 }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrev}
            disabled={isFirst}
            className="gap-1 text-xs text-muted-foreground"
          >
            ← {t('nav.back')}
          </Button>
        </m.div>

        <div className="flex items-center gap-1.5">
          {Array.from({ length: ONBOARDING_TOTAL_STEPS }).map((_, i) => (
            <button
              key={i}
              onClick={() => {
                setDirection(i > step ? 1 : -1)
                useOnboardingStore.getState().goToStep(i)
              }}
              aria-label={`Step ${i + 1}`}
              className="group p-0.5"
            >
              <m.div
                className="rounded-full bg-foreground"
                animate={{
                  width: i === step ? 20 : 5,
                  height: 5,
                  opacity: i === step ? 1 : i < step ? 0.35 : 0.12,
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
          ))}
        </div>

        <m.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97, x: 2 }}>
          <Button
            size="sm"
            onClick={handleNext}
            className="gap-1.5 text-xs"
          >
            {isLast ? t('nav.getStarted') : t('nav.next')}
            <m.span
              className="inline-flex"
              animate={isLast ? { x: [0, 3, 0] } : {}}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ArrowRightIcon className="size-3" />
            </m.span>
          </Button>
        </m.div>
      </m.footer>
    </div>
  )
}

// ─── Transition variants ───────────────────────────────────────────────────────
const slideVariants = {
  enter: (d: number) => ({
    opacity: 0,
    x: d * 100,
    scale: 0.92,
    filter: 'blur(10px)',
  }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, stiffness: 220, damping: 26, mass: 0.9 },
  },
  exit: (d: number) => ({
    opacity: 0,
    x: d * -100,
    scale: 0.92,
    filter: 'blur(10px)',
    transition: { duration: 0.22 },
  }),
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 0: Welcome
// ─── Design: Geometric constellation of dots that coalesce into the logo.
// Then the headline writes itself char-by-char. Features float up as pills.
// ═══════════════════════════════════════════════════════════════════════════════
function StepWelcome({ t }: { t: (key: OnboardingKey) => string }) {
  // Generate random starting positions for constellation effect
  const particles = useMemo(() =>
    Array.from({ length: 12 }, (_, i) => ({
      id: i,
      startX: (Math.random() - 0.5) * 120,
      startY: (Math.random() - 0.5) * 120,
      delay: Math.random() * 0.3,
    })),
  [])

  return (
    <div className="flex flex-col items-center text-center">
      {/* Constellation → Logo */}
      <div className="relative mb-10 flex size-20 items-center justify-center">
        {/* Particles that converge */}
        {particles.map(p => (
          <m.div
            key={p.id}
            className="absolute size-1 rounded-full bg-foreground"
            initial={{ x: p.startX, y: p.startY, opacity: 0, scale: 0 }}
            animate={{ x: 0, y: 0, opacity: [0, 0.6, 0], scale: [0, 1.5, 0] }}
            transition={{
              duration: 1.2,
              delay: p.delay,
              ease: [0.16, 1, 0.3, 1],
            }}
          />
        ))}
        {/* Logo materializes after particles converge */}
        <m.div
          className="absolute flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-background shadow-sm ring-1 ring-black/10 dark:ring-white/10"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.8, type: 'spring', stiffness: 200, damping: 15 }}
        >
          <m.img
            src={CRADLE_ICON_URL}
            alt=""
            className="size-full object-cover"
            draggable={false}
            initial={{ scale: 0.82, opacity: 0, filter: 'blur(4px)' }}
            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
            transition={{ delay: 1.0, type: 'spring', stiffness: 300, damping: 20 }}
          />
        </m.div>
        {/* Subtle pulse ring after logo appears */}
        <m.div
          className="absolute size-16 rounded-2xl border border-foreground/10"
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: [1, 1.5, 1.8], opacity: [0, 0.3, 0] }}
          transition={{ delay: 1.1, duration: 1.5, ease: 'easeOut' }}
        />
      </div>

      <m.p
        className="mb-2 text-[11px] font-medium tracking-widest text-muted-foreground"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2 }}
      >
        {t('step.welcome.eyebrow')}
      </m.p>

      <TypewriterHeadline text={t('step.welcome.headline')} startDelay={1400} />

      <m.p
        className="mt-4 max-w-sm text-[14px] leading-relaxed text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.2, duration: 0.8 }}
      >
        {t('step.welcome.description')}
      </m.p>

      {/* Feature pills — stagger from different y positions */}
      <m.div
        className="mt-8 flex flex-wrap justify-center gap-2"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.1, delayChildren: 2.6 } } }}
      >
        {(['step.welcome.feature.1', 'step.welcome.feature.2', 'step.welcome.feature.3'] as const).map((key, i) => (
          <m.span
            key={key}
            className="rounded-full border border-border px-3 py-1.5 text-[12px] text-foreground"
            variants={{
              hidden: { opacity: 0, y: 16 + i * 4, scale: 0.85, filter: 'blur(4px)' },
              show: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
            }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            whileHover={{ scale: 1.05, borderColor: 'hsl(var(--foreground) / 0.2)' }}
          >
            {t(key)}
          </m.span>
        ))}
      </m.div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Chat
// ─── Design: A realistic composer with typing → send → AI response streaming.
// Full conversation round-trip so user sees the core loop in action.
// ═══════════════════════════════════════════════════════════════════════════════
function StepChat({ t }: { t: (key: OnboardingKey) => string }) {
  const [phase, setPhase] = useState<'typing' | 'sent' | 'responding' | 'done'>('typing')
  const [typedText, setTypedText] = useState('')
  const [responseText, setResponseText] = useState('')
  const userMessage = 'Review onboarding and fix responsiveness'
  const aiResponse = 'I\'ll trace the layout, check breakpoints, and fix the overflow issues. Running TypeScript checks now...'

  // Phase 1: User types
  useEffect(() => {
    let i = 0
    const interval = setInterval(() => {
      if (i <= userMessage.length) {
        setTypedText(userMessage.slice(0, i))
        i++
      } else {
        clearInterval(interval)
        setTimeout(() => setPhase('sent'), 400)
      }
    }, 35)
    return () => clearInterval(interval)
  }, [])

  // Phase 2→3: After send, AI responds
  useEffect(() => {
    if (phase !== 'sent') return
    const timeout = setTimeout(() => {
      setPhase('responding')
      let i = 0
      const interval = setInterval(() => {
        if (i <= aiResponse.length) {
          setResponseText(aiResponse.slice(0, i))
          i++
        } else {
          clearInterval(interval)
          setPhase('done')
        }
      }, 20)
      return () => clearInterval(interval)
    }, 600)
    return () => clearTimeout(timeout)
  }, [phase])

  return (
    <div className="flex w-full flex-col items-center text-center">
      <m.p
        className="mb-2 text-[11px] font-medium tracking-widest text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {t('step.chat.eyebrow')}
      </m.p>
      <m.h1
        className="mb-3 text-[28px] font-semibold leading-[1.15] tracking-[-0.03em]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        {t('step.chat.headline')}
      </m.h1>
      <m.p
        className="mb-8 max-w-sm text-[14px] leading-relaxed text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {t('step.chat.description')}
      </m.p>

      {/* Composer + Chat mock */}
      <m.div
        className="w-full max-w-md overflow-hidden rounded-xl border border-border"
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.3, type: 'spring', stiffness: 280, damping: 24 }}
      >
        {/* Top bar */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <m.div
            className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
          >
            <BotIcon className="size-3" />
            <span>Codex</span>
          </m.div>
          <m.div
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.7 }}
          >
            <FileIcon className="size-3" />
            <span>onboarding.tsx</span>
          </m.div>
        </div>

        {/* Messages area */}
        <div className="flex flex-col gap-2 px-3 py-3">
          {/* User message / typing input */}
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-xl rounded-br-sm bg-foreground px-3 py-2 text-left text-[12px] text-background">
              {phase === 'typing' ? (
                <>
                  {typedText}
                  <m.span
                    className="inline-block h-[1em] w-0.5 translate-y-px bg-background/60"
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                  />
                </>
              ) : (
                userMessage
              )}
            </div>
          </div>

          {/* AI response */}
          <AnimatePresence>
            {(phase === 'responding' || phase === 'done') && (
              <m.div
                className="flex justify-start"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              >
                <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-border px-3 py-2 text-left text-[12px] text-foreground">
                  {/* Thinking shimmer */}
                  {phase === 'responding' && responseText.length === 0 && (
                    <m.div
                      className="flex items-center gap-1"
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      <span className="size-1 rounded-full bg-muted-foreground" />
                      <span className="size-1 rounded-full bg-muted-foreground" />
                      <span className="size-1 rounded-full bg-muted-foreground" />
                    </m.div>
                  )}
                  {responseText}
                  {phase === 'responding' && responseText.length > 0 && (
                    <m.span
                      className="inline-block h-[1em] w-0.5 translate-y-px bg-foreground/40"
                      animate={{ opacity: [1, 0] }}
                      transition={{ duration: 0.4, repeat: Infinity }}
                    />
                  )}
                </div>
              </m.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <div className="flex items-center gap-2 text-muted-foreground/40">
            <SearchIcon className="size-3.5" />
            <CodeIcon className="size-3.5" />
          </div>
          <m.div
            className={cn(
              'flex size-6 items-center justify-center rounded-md',
              phase === 'typing' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
            )}
            animate={phase === 'typing' ? { scale: [1, 1.05, 1] } : {}}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <ArrowRightIcon className="size-3" />
          </m.div>
        </div>
      </m.div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Workspace
// ─── Design: File tree grows, then a scan pass highlights each file,
// showing the workspace can be inspected without implying hidden project analysis.
// ═══════════════════════════════════════════════════════════════════════════════
function StepWorkspace({ t }: { t: (key: OnboardingKey) => string }) {
  const [scanIndex, setScanIndex] = useState(-1)

  const files = [
    { name: 'apps/', indent: 0, icon: FolderIcon },
    { name: 'web/', indent: 1, icon: FolderIcon },
    { name: 'onboarding-page.tsx', indent: 2, icon: FileIcon },
    { name: 'kanban-board.tsx', indent: 2, icon: FileIcon },
    { name: 'server/', indent: 1, icon: FolderIcon },
    { name: 'packages/', indent: 0, icon: FolderIcon },
    { name: 'design-system/', indent: 1, icon: FolderIcon },
  ]

  // Start scan animation after tree appears
  useEffect(() => {
    const start = setTimeout(() => {
      let i = 0
      const interval = setInterval(() => {
        setScanIndex(i)
        i++
        if (i >= files.length) clearInterval(interval)
      }, 300)
      return () => clearInterval(interval)
    }, 1800)
    return () => clearTimeout(start)
  }, [files.length])

  return (
    <div className="flex w-full flex-col items-center text-center">
      <m.p
        className="mb-2 text-[11px] font-medium tracking-widest text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {t('step.workspace.eyebrow')}
      </m.p>
      <m.h1
        className="mb-3 text-[28px] font-semibold leading-[1.15] tracking-[-0.03em]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        {t('step.workspace.headline')}
      </m.h1>
      <m.p
        className="mb-8 max-w-sm text-[14px] leading-relaxed text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {t('step.workspace.description')}
      </m.p>

      {/* File tree with scan effect */}
      <m.div
        className="w-full max-w-xs overflow-hidden rounded-xl border border-border"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 25 }}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-1.5">
            <GitBranchIcon className="size-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">main</span>
          </div>
          <div className="flex items-center gap-1.5">
            <m.div
              className="size-1.5 rounded-full bg-emerald-500"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <m.span
              className="text-[10px] text-muted-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: scanIndex >= 0 ? 1 : 0 }}
            >
              checking
            </m.span>
          </div>
        </div>
        <div className="flex flex-col py-1">
          {files.map((file, i) => (
            <m.div
              key={i}
              className={cn(
                'relative flex items-center gap-2 py-1.5 text-left transition-colors duration-200',
                scanIndex === i && 'bg-foreground/5',
              )}
              style={{ paddingLeft: `${12 + file.indent * 14}px`, paddingRight: 12 }}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.12, type: 'spring', stiffness: 400, damping: 25 }}
            >
              {/* Scan flash */}
              {scanIndex === i && (
                <m.div
                  className="absolute inset-0 bg-foreground/5"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 0.4 }}
                />
              )}
              <file.icon className={cn(
                'relative size-3.5 shrink-0 transition-colors duration-200',
                scanIndex >= i ? 'text-foreground' : 'text-muted-foreground',
              )} />
              <span className={cn(
                'relative text-[12px] transition-colors duration-200',
                scanIndex >= i ? 'text-foreground' : 'text-muted-foreground',
              )}>
                {file.name}
              </span>
              {scanIndex >= i && (
                <m.div
                  className="ml-auto"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                >
                  <CheckIcon className="size-3 text-emerald-500" />
                </m.div>
              )}
            </m.div>
          ))}
        </div>
        {/* File check progress */}
        <div className="border-t border-border px-3 py-2">
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <m.div
              className="h-full rounded-full bg-foreground"
              animate={{ width: `${Math.max(0, ((scanIndex + 1) / files.length) * 100)}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            />
          </div>
        </div>
      </m.div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: Agents
// ─── Design: Terminal-style output that streams live. Agent reads files,
// makes edits, runs checks. A diff preview appears inline. Feels alive.
// ═══════════════════════════════════════════════════════════════════════════════
function StepAgents({ t }: { t: (key: OnboardingKey) => string }) {
  const [visibleSteps, setVisibleSteps] = useState(0)

  const agentSteps = [
    { icon: SearchIcon, text: '→ Checking workspace files...', color: 'text-muted-foreground' },
    { icon: CodeIcon, text: '→ Editing onboarding-page.tsx', color: 'text-muted-foreground' },
    { icon: TerminalIcon, text: '→ tsc --noEmit', color: 'text-muted-foreground' },
    { icon: CheckIcon, text: '✓ All checks passed', color: 'text-emerald-500' },
  ]

  useEffect(() => {
    let step = 0
    const interval = setInterval(() => {
      step++
      setVisibleSteps(step)
      if (step >= agentSteps.length) clearInterval(interval)
    }, 800)
    return () => clearInterval(interval)
  }, [agentSteps.length])

  return (
    <div className="flex w-full flex-col items-center text-center">
      <m.p
        className="mb-2 text-[11px] font-medium tracking-widest text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {t('step.agents.eyebrow')}
      </m.p>
      <m.h1
        className="mb-3 text-[28px] font-semibold leading-[1.15] tracking-[-0.03em]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        {t('step.agents.headline')}
      </m.h1>
      <m.p
        className="mb-8 max-w-sm text-[14px] leading-relaxed text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {t('step.agents.description')}
      </m.p>

      {/* Terminal-style agent output */}
      <m.div
        className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-[--color-sidebar]"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 25 }}
      >
        {/* Terminal header */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <div className="flex gap-1.5">
            <div className="size-2 rounded-full bg-border" />
            <div className="size-2 rounded-full bg-border" />
            <div className="size-2 rounded-full bg-border" />
          </div>
          <div className="flex flex-1 items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <BotIcon className="size-3" />
            <span>Codex · agent run</span>
          </div>
          <m.div
            className="flex items-center gap-1"
            animate={visibleSteps < agentSteps.length ? { opacity: [0.5, 1, 0.5] } : { opacity: 1 }}
            transition={{ duration: 1, repeat: visibleSteps < agentSteps.length ? Infinity : 0 }}
          >
            <span className={cn(
              'size-1.5 rounded-full',
              visibleSteps >= agentSteps.length ? 'bg-emerald-500' : 'bg-amber-400',
            )} />
          </m.div>
        </div>

        {/* Output lines */}
        <div className="flex flex-col gap-0 px-3 py-2 font-mono text-[11px]">
          {agentSteps.slice(0, visibleSteps).map((s, i) => (
            <m.div
              key={i}
              className={cn('flex items-center gap-2 py-1', s.color)}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            >
              <s.icon className="size-3 shrink-0" />
              <span>{s.text}</span>
            </m.div>
          ))}
          {/* Cursor blink if not done */}
          {visibleSteps < agentSteps.length && (
            <m.div
              className="flex items-center gap-1 py-1 text-muted-foreground"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            >
              <span className="text-foreground">▊</span>
            </m.div>
          )}
        </div>

        {/* Inline diff preview after completion */}
        <AnimatePresence>
          {visibleSteps >= agentSteps.length && (
            <m.div
              className="border-t border-border px-3 py-2"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 25 }}
            >
              <div className="rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-[10px]">
                <div className="text-red-400/80 line-through">- static preview mock</div>
                <div className="text-emerald-500">+ real component with live data</div>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </m.div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: Done
// ─── Design: Cards appear from radial positions (not just vertically).
// Each card has 3D tilt. Clicking a card triggers a ripple before dismiss.
// ═══════════════════════════════════════════════════════════════════════════════
function StepDone({ t, onComplete }: { t: (key: OnboardingKey) => string; onComplete: () => void }) {
  const actions = [
    { icon: MessageSquareIcon, titleKey: 'step.done.action.newChat' as const, descKey: 'step.done.action.newChat.description' as const, angle: -15 },
    { icon: FolderIcon, titleKey: 'step.done.action.addWorkspace' as const, descKey: 'step.done.action.addWorkspace.description' as const, angle: 0 },
    { icon: Settings2Icon, titleKey: 'step.done.action.settings' as const, descKey: 'step.done.action.settings.description' as const, angle: 15 },
  ]

  const handleActionClick = useCallback(() => {
    // Small delay for visual feedback before dismissing
    setTimeout(onComplete, 200)
  }, [onComplete])

  return (
    <div className="flex w-full flex-col items-center text-center">
      {/* Success icon with converging rings */}
      <m.div
        className="relative mb-6 flex size-14 items-center justify-center"
        initial={{ scale: 0, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.1 }}
      >
        {/* Rings */}
        {[0, 1, 2].map(i => (
          <m.div
            key={i}
            className="absolute inset-0 rounded-full border border-foreground/10"
            initial={{ scale: 2 + i * 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: [0, 0.5, 0] }}
            transition={{ delay: 0.2 + i * 0.15, duration: 1.2 }}
          />
        ))}
        <m.div
          className="relative flex size-14 items-center justify-center rounded-full border border-border"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <m.div
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.6, duration: 0.4 }}
          >
            <CheckIcon className="size-6 text-foreground" />
          </m.div>
        </m.div>
      </m.div>

      <m.p
        className="mb-2 text-[11px] font-medium tracking-widest text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {t('step.done.eyebrow')}
      </m.p>
      <m.h1
        className="mb-3 text-[28px] font-semibold leading-[1.15] tracking-[-0.03em]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
      >
        {t('step.done.headline')}
      </m.h1>
      <m.p
        className="mb-8 max-w-sm text-[14px] leading-relaxed text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        {t('step.done.description')}
      </m.p>

      {/* Action cards — appear from slight rotation */}
      <div className="flex w-full max-w-md flex-col gap-2.5">
        {actions.map(({ icon: Icon, titleKey, descKey, angle }, i) => (
          <TiltCard key={titleKey} index={i} initialRotate={angle} onClick={handleActionClick}>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <div className="text-[13px] font-medium text-foreground">{t(titleKey)}</div>
              <div className="text-[12px] text-muted-foreground">{t(descKey)}</div>
            </div>
            <m.div
              className="shrink-0 text-muted-foreground/30 transition-colors group-hover:text-foreground/50"
              whileHover={{ x: 3 }}
            >
              <ArrowRightIcon className="size-3.5" />
            </m.div>
          </TiltCard>
        ))}
      </div>
    </div>
  )
}

// ─── Typewriter headline ───────────────────────────────────────────────────────
function TypewriterHeadline({ text, startDelay = 400 }: { text: string; startDelay?: number }) {
  const [revealed, setRevealed] = useState(0)

  useEffect(() => {
    let frame: number
    let start: number | null = null
    const duration = text.length * 25

    const tick = (ts: number) => {
      if (!start) start = ts
      const elapsed = ts - start
      const progress = Math.min(elapsed / duration, 1)
      setRevealed(Math.floor(progress * text.length))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }

    const timeout = setTimeout(() => {
      frame = requestAnimationFrame(tick)
    }, startDelay)

    return () => {
      clearTimeout(timeout)
      cancelAnimationFrame(frame)
    }
  }, [text, startDelay])

  return (
    <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-foreground sm:text-[32px]">
      <span>{text.slice(0, revealed)}</span>
      {revealed < text.length && (
        <m.span
          className="inline-block h-[0.85em] w-0.5 translate-y-0.5 bg-foreground"
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.5, repeat: Infinity }}
        />
      )}
    </h1>
  )
}

// ─── 3D Tilt card ──────────────────────────────────────────────────────────────
function TiltCard({ children, index, initialRotate = 0, onClick }: {
  children: React.ReactNode
  index: number
  initialRotate?: number
  onClick?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const srx = useSpring(rx, { stiffness: 300, damping: 20 })
  const sry = useSpring(ry, { stiffness: 300, damping: 20 })

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    rx.set((e.clientY - rect.top - rect.height / 2) / 14)
    ry.set((e.clientX - rect.left - rect.width / 2) / -14)
  }, [rx, ry])

  const handleMouseLeave = useCallback(() => {
    rx.set(0)
    ry.set(0)
  }, [rx, ry])

  return (
    <m.div
      ref={ref}
      className="group flex cursor-pointer items-center gap-3.5 rounded-xl border border-border px-4 py-3.5 transition-colors hover:border-foreground/10"
      style={{ rotateX: srx, rotateY: sry, transformPerspective: 800 }}
      initial={{ opacity: 0, y: 20, rotate: initialRotate }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ delay: 0.6 + index * 0.12, type: 'spring', stiffness: 280, damping: 22 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
    >
      {children}
    </m.div>
  )
}
