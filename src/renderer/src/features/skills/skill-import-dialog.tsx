// Input: useSkillSourceImport hook, SkillScope type, Dialog UI primitives, motion/react
// Output: SkillImportDialog — split-panel (left: form, right: SaaS art panel) multi-step import flow
// Position: Feature dialog triggered by the "Import" button in SkillManager

import type { DiscoveredSkill, SkillScope } from '@main/ipc-types'
import { Button } from '@renderer/components/ui/button'
import { HalftoneArt } from '@renderer/components/ui/canvas-art'
import {
  Dialog,
  DialogContent,
} from '@renderer/components/ui/dialog'
import { Spinner } from '@renderer/components/ui/spinner'
import { TruncatedText } from '@renderer/components/ui/truncated-text'
import { cn } from '@renderer/lib/cn'
import {
  CheckIcon,
  ChevronRightIcon,
  LinkIcon,
  XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useSkillSourceImport } from './use-skills'

// ── Types ──────────────────────────────────────────────────────────────────────

type DialogStep = 'input' | 'fetching' | 'select' | 'installing' | 'done'

interface FetchResult {
  sessionId: string
  sourceLabel: string
  sourceType: string
  skills: DiscoveredSkill[]
}

interface ImportResult {
  imported: number
  errors: Array<{ dir: string, error: string }>
}

// ── Step dots ──────────────────────────────────────────────────────────────────

const DOT_STEPS: DialogStep[] = ['input', 'fetching', 'select', 'done']

function StepDots({ current }: { current: DialogStep }) {
  const idx = DOT_STEPS.indexOf(current === 'installing' ? 'select' : current)
  return (
    <div className="flex items-center gap-1.5">
      {DOT_STEPS.map((step, i) => (
        <div
          key={step}
          className={cn(
            'h-1 rounded-full transition-all duration-300',
            i < idx
              ? 'w-2 bg-foreground/30'
              : i === idx
                ? 'w-5 bg-foreground/60'
                : 'w-2 bg-foreground/10',
          )}
        />
      ))}
    </div>
  )
}

// ── Right panel: generative halftone art ──────────────────────────────────────

// ── Right panel: generative art background ────────────────────────────────────
// HalftoneArt imported from @renderer/components/ui/canvas-art
// Additional art options: FlowField, GridWave, SineRipple, RainDots from same module

function RightPanelInput() {
  return (
    <div className="flex h-full flex-col justify-end px-7 pb-8">
      <p className="text-[13px] leading-relaxed text-muted-foreground" style={{ textWrap: 'pretty' }}>
        Install skills from any public git repository, GitHub shorthand, or local path.
      </p>
    </div>
  )
}

function RightPanelFetching({ source }: { source: string }) {
  return (
    <div className="flex h-full flex-col justify-end gap-3 px-7 pb-8">
      <div className="relative h-px overflow-hidden rounded-full bg-foreground/10">
        <motion.div
          className="absolute inset-y-0 w-1/3 rounded-full bg-foreground/40"
          animate={{ left: ['-33%', '100%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      <p className="truncate text-[11px] text-muted-foreground/40">{source}</p>
    </div>
  )
}

function RightPanelSelect({
  skills,
  selected,
  scope,
}: {
  skills: DiscoveredSkill[]
  selected: Set<string>
  scope: SkillScope
}) {
  return (
    <div className="flex h-full flex-col gap-5 px-7 py-8">
      {/* Count */}
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-[44px] font-bold leading-none tracking-tight text-foreground">
            {skills.length}
          </span>
          <span className="text-[13px] text-muted-foreground/50">skills found</span>
        </div>
        <p className="mt-1.5 text-[12px] text-muted-foreground/40">
          {selected.size}
          {' selected · '}
          {scope}
        </p>
      </div>

      <div className="h-px bg-foreground/6" />

      {/* Clean list */}
      <div className="flex flex-col gap-0.5 overflow-hidden">
        {skills.slice(0, 9).map((skill) => {
          const isSelected = selected.has(skill.skillDir)
          return (
            <div
              key={skill.skillDir}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-opacity',
                isSelected ? 'opacity-100' : 'opacity-20',
              )}
            >
              <CheckIcon
                className={cn(
                  'size-3 shrink-0',
                  isSelected ? 'text-emerald-500' : 'text-muted-foreground/20',
                )}
              />
              <span className="truncate text-[12px] text-foreground">{skill.name}</span>
            </div>
          )
        })}
        {skills.length > 9 && (
          <p className="px-2 text-[11px] text-muted-foreground/30">
            +
            {skills.length - 9}
            {' '}
            more
          </p>
        )}
      </div>
    </div>
  )
}

function RightPanelDone({ count }: { count: number }) {
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-8 py-10">
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="text-[56px] font-bold leading-none tracking-tight text-foreground"
      >
        {count}
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.35 }}
        className="text-[14px] text-muted-foreground/50"
      >
        {count === 1 ? 'skill' : 'skills'}
        {' installed'}
      </motion.p>
    </div>
  )
}

// ── Left panel steps ───────────────────────────────────────────────────────────

function InputForm({
  onFetch,
  isFetching,
  error,
}: {
  onFetch: (source: string) => void
  isFetching: boolean
  error: string | null
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isFetching) {
      return
    }
    onFetch(trimmed)
  }, [value, isFetching, onFetch])

  return (
    <div className="flex h-full flex-col gap-8 px-8 py-8">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[18px] font-semibold tracking-tight text-foreground">Import Skills</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground/60" style={{ textWrap: 'pretty' }}>
          Enter a source to discover and install skills into this scope.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border border-foreground/8 bg-foreground/3 px-4 py-3',
            'transition-all duration-150 focus-within:border-foreground/20 focus-within:bg-foreground/4',
            error && 'border-destructive/30',
          )}
        >
          <LinkIcon className="size-4 shrink-0 text-muted-foreground/25" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="owner/repo  or  https://github.com/..."
            className="flex-1 bg-transparent font-mono text-[13px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/25"
            disabled={isFetching}
            spellCheck={false}
            autoComplete="off"
          />
          {value && !isFetching && (
            <button
              type="button"
              onClick={() => setValue('')}
              className="flex size-5 items-center justify-center rounded text-muted-foreground/25 transition-colors hover:text-muted-foreground"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
        {error && (
          <p className="px-1 text-[12px] leading-relaxed text-destructive">{error}</p>
        )}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!value.trim() || isFetching}
        className="h-10 w-full"
      >
        {isFetching
          ? (
            <>
              <Spinner className="size-3.5" />
              Fetching…
            </>
          )
          : (
            <>
              Fetch Skills
              <ChevronRightIcon className="size-4" />
            </>
          )}
      </Button>
    </div>
  )
}

function FetchingBody({ source }: { source: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 py-12 text-center">
      <Spinner className="size-6 text-muted-foreground/40" />
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-medium text-foreground">Fetching…</span>
        <span className="max-w-64 truncate text-[12px] text-muted-foreground/50">{source}</span>
      </div>
    </div>
  )
}

function SelectBody({
  result,
  selected,
  onToggle,
  onToggleAll,
  onInstall,
  isInstalling,
}: {
  result: FetchResult
  selected: Set<string>
  onToggle: (dir: string) => void
  onToggleAll: () => void
  onInstall: () => void
  isInstalling: boolean
}) {
  if (result.skills.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
        <p className="text-[13px] text-muted-foreground/50">No skills found in this source.</p>
      </div>
    )
  }

  const allSelected = selected.size === result.skills.length

  return (
    <div className="flex h-full flex-col">
      {/* Heading */}
      <div className="flex items-baseline justify-between px-8 pb-3 pt-7">
        <h2 className="text-[16px] font-semibold text-foreground">
          {result.skills.length}
          {' '}
          skill
          {result.skills.length !== 1 ? 's' : ''}
          {' '}
          found
        </h2>
        <button
          type="button"
          onClick={onToggleAll}
          className="text-[12px] text-muted-foreground/40 transition-colors hover:text-foreground"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      {/* Skill list */}
      <div className="flex-1 overflow-y-auto px-8 pb-4">
        <div className="flex flex-col gap-1.5">
          {result.skills.map((skill) => {
            const isSelected = selected.has(skill.skillDir)
            return (
              <button
                key={skill.skillDir}
                type="button"
                onClick={() => onToggle(skill.skillDir)}
                className={cn(
                  'flex items-start gap-3.5 rounded-xl px-4 py-3.5 text-left transition-all',
                  isSelected
                    ? 'bg-foreground/6 ring-1 ring-foreground/10 hover:bg-foreground/7'
                    : 'bg-foreground/2.5 ring-1 ring-transparent hover:bg-foreground/4',
                )}
              >
                <div
                  className={cn(
                    'mt-px flex size-4 shrink-0 items-center justify-center rounded transition-all',
                    isSelected
                      ? 'bg-foreground ring-1 ring-foreground'
                      : 'ring-1 ring-foreground/20 hover:ring-foreground/40',
                  )}
                >
                  {isSelected && <CheckIcon className="size-2.5 stroke-[2.5] text-background" />}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-foreground">{skill.name}</span>
                  {skill.description && (
                    <TruncatedText maxLines={2} className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/55">
                      {skill.description}
                    </TruncatedText>
                  )}
                  {skill.relativePath !== '.' && (
                    <span className="mt-1 block font-mono text-[10px] text-muted-foreground/25">
                      {skill.relativePath}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-foreground/6 px-8 py-5">
        <Button
          onClick={onInstall}
          disabled={selected.size === 0 || isInstalling}
          className="h-10 w-full"
        >
          {isInstalling
            ? (
              <>
                <Spinner className="size-3.5" />
                Installing…
              </>
            )
            : (
              <>
                Install
                {' '}
                {selected.size}
                {' '}
                skill
                {selected.size !== 1 ? 's' : ''}
              </>
            )}
        </Button>
      </div>
    </div>
  )
}

function DoneBody({
  result,
  onClose,
}: {
  result: ImportResult
  onClose: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-8 py-12 text-center">
      <div className="flex flex-col gap-1.5">
        <span className="text-[17px] font-semibold text-foreground">
          Done!
        </span>
        <span className="text-[13px] text-muted-foreground/55">
          {result.imported}
          {' '}
          skill
          {result.imported !== 1 ? 's' : ''}
          {' '}
          installed successfully
        </span>
      </div>

      {result.errors.length > 0 && (
        <div className="w-full rounded-xl bg-destructive/6 px-4 py-3.5 text-left">
          <span className="mb-2 block text-[12px] font-medium text-destructive">
            {result.errors.length}
            {' '}
            failed
          </span>
          {result.errors.map(e => (
            <div key={e.dir} className="border-t border-destructive/10 py-1.5">
              <span className="block font-mono text-[10px] text-muted-foreground/40">{e.dir}</span>
              <span className="block text-[11px] text-destructive/70">{e.error}</span>
            </div>
          ))}
        </div>
      )}

      <Button onClick={onClose} variant="outline" className="h-10 w-full">
        Done
      </Button>
    </div>
  )
}

// ── Main dialog ────────────────────────────────────────────────────────────────

export function SkillImportDialog({
  open,
  onOpenChange,
  editableScope,
  workspaceId,
  agentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editableScope: SkillScope
  workspaceId?: string | null
  agentId?: string | null
}) {
  const { fetchSource, importFromFetch, cancelFetch } = useSkillSourceImport({ workspaceId, agentId })

  const [step, setStep] = useState<DialogStep>('input')
  const [sourceInput, setSourceInput] = useState('')
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setStep('input')
      setSourceInput('')
      setFetchResult(null)
      setSelected(() => new Set())
      setImportResult(null)
      setFetchError(null)
    }
  }, [open])

  const handleClose = useCallback(() => {
    if (fetchResult?.sessionId && step !== 'done') {
      cancelFetch.mutate(fetchResult.sessionId)
    }
    onOpenChange(false)
  }, [fetchResult, step, cancelFetch, onOpenChange])

  const handleFetch = useCallback(async (source: string) => {
    setSourceInput(source)
    setFetchError(null)
    setStep('fetching')
    try {
      const result = await fetchSource.mutateAsync(source)
      setFetchResult({
        sessionId: result.sessionId,
        sourceLabel: result.source.label,
        sourceType: result.source.type,
        skills: result.skills,
      })
      setSelected(() => new Set(result.skills.map(s => s.skillDir)))
      setStep('select')
    }
    catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err))
      setStep('input')
    }
  }, [fetchSource])

  const handleToggle = useCallback((skillDir: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(skillDir)) {
        next.delete(skillDir)
      }
      else {
        next.add(skillDir)
      }
      return next
    })
  }, [])

  const handleToggleAll = useCallback(() => {
    if (!fetchResult) {
      return
    }
    setSelected(() => selected.size === fetchResult.skills.length
      ? new Set()
      : new Set(fetchResult.skills.map(s => s.skillDir)))
  }, [fetchResult, selected])

  const handleInstall = useCallback(async () => {
    if (!fetchResult || selected.size === 0) {
      return
    }
    setStep('installing')
    try {
      const result = await importFromFetch.mutateAsync({
        sessionId: fetchResult.sessionId,
        selectedDirs: Array.from(selected),
        scope: editableScope,
        overwrite: false,
      })
      setImportResult({ imported: result.imported.length, errors: result.errors })
      setStep('done')
    }
    catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err))
      setStep('select')
    }
  }, [fetchResult, selected, importFromFetch, editableScope])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-240 overflow-hidden p-0"
        showCloseButton={false}
      >
        <div className="flex h-130">
          {/* ── Left panel: interactive content ──────────────────────── */}
          <div className="relative flex w-[58%] flex-col overflow-hidden border-r border-foreground/6">
            {/* Title bar */}
            <div className="flex shrink-0 items-center justify-between border-b border-foreground/6 px-8 py-4">
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-foreground">Import Skills</span>
                <StepDots current={step} />
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close"
                className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/30 transition-colors hover:bg-foreground/6 hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>

            {/* Step content */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
                {step === 'input' && (
                  <motion.div
                    key="input"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <InputForm
                      onFetch={source => void handleFetch(source)}
                      isFetching={fetchSource.isPending}
                      error={fetchError}
                    />
                  </motion.div>
                )}

                {step === 'fetching' && (
                  <motion.div
                    key="fetching"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <FetchingBody source={sourceInput} />
                  </motion.div>
                )}

                {(step === 'select' || step === 'installing') && fetchResult && (
                  <motion.div
                    key="select"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <SelectBody
                      result={fetchResult}
                      selected={selected}
                      onToggle={handleToggle}
                      onToggleAll={handleToggleAll}
                      onInstall={() => void handleInstall()}
                      isInstalling={step === 'installing'}
                    />
                  </motion.div>
                )}

                {step === 'done' && importResult && (
                  <motion.div
                    key="done"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <DoneBody result={importResult} onClose={() => onOpenChange(false)} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ── Right panel: contextual art ───────────────────────────── */}
          <div className="relative flex w-[42%] flex-col overflow-hidden bg-foreground/2" style={{ boxShadow: 'inset 1px 0 0 oklch(from var(--foreground) l c h / 0.05)' }}>
            {/* Particle constellation — full-panel background */}
            <div
              className={cn(
                'pointer-events-none absolute inset-0 transition-opacity duration-700',
                step === 'input' ? 'opacity-50' : step === 'fetching' ? 'opacity-25' : 'opacity-0',
              )}
            >
              <HalftoneArt />
            </div>

            {/* Content */}
            <div className="relative z-10 flex h-full flex-col">
              <AnimatePresence mode="wait">
                {step === 'input' && (
                  <motion.div
                    key="right-input"
                    className="h-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <RightPanelInput />
                  </motion.div>
                )}

                {step === 'fetching' && (
                  <motion.div
                    key="right-fetching"
                    className="h-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <RightPanelFetching source={sourceInput} />
                  </motion.div>
                )}

                {(step === 'select' || step === 'installing') && fetchResult && (
                  <motion.div
                    key="right-select"
                    className="h-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <RightPanelSelect
                      skills={fetchResult.skills}
                      selected={selected}
                      scope={editableScope}
                    />
                  </motion.div>
                )}

                {step === 'done' && importResult && (
                  <motion.div
                    key="right-done"
                    className="h-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <RightPanelDone count={importResult.imported} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
