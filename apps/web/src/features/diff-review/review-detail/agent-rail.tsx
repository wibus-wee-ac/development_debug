import {
  CheckCircleLine as CheckCircleIcon,
  CloseLine as XIcon,
  LoadingLine as Loader2Icon,
  PlayCircleLine as PlayCircleIcon,
  Refresh1Line as RefreshCwIcon,
  Message3Line as MessageCircleIcon,
  RobotLine as BotIcon,
} from '@mingcute/react'
import { useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { ProviderModelSelector, useComposerState } from '~/features/composer-toolbar'
import { cn } from '~/lib/cn'
import { openChatSession } from '~/navigation/navigation-commands'

import { formatTimestamp } from '../shared/diff-items'
import type { CradleDiffReview, ReviewAgentFix, ReviewThreadAnchorInput } from '../shared/types'

interface AgentRailProps {
  review: CradleDiffReview
  selectedAnchor: ReviewThreadAnchorInput | null
  selectedLabel: string | null
  createPending: boolean
  startPending: boolean
  cancelPending: boolean
  rerunPending: boolean
  onCreate: (input: {
    anchor?: ReviewThreadAnchorInput | null
    threadId?: string | null
    instruction: string
    profileId?: string | null
    expectedOutput: 'commit' | 'working-tree-change' | 'patch-artifact'
  }) => Promise<CradleDiffReview>
  onStart: (input: {
    agentFixId: string
    providerTargetId?: string | null
    modelId?: string | null
  }) => Promise<CradleDiffReview>
  onCancel: (agentFixId: string) => void
  onRerun: (input: {
    agentFixId: string
    providerTargetId?: string | null
    modelId?: string | null
  }) => Promise<CradleDiffReview>
  onCollapse: () => void
  width: number
}

const STATUS_TONE: Record<ReviewAgentFix['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
}

function latestAgentFix(review: CradleDiffReview, beforeIds: Set<string>): ReviewAgentFix | null {
  return review.agentFixes
    .filter(fix => !beforeIds.has(fix.id))
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
}

export function AgentRail({
  review,
  selectedAnchor,
  selectedLabel,
  createPending,
  startPending,
  cancelPending,
  rerunPending,
  onCreate,
  onStart,
  onCancel,
  onRerun,
  onCollapse,
  width,
}: AgentRailProps) {
  const composer = useComposerState({ context: 'new-chat' })
  const [instruction, setInstruction] = useState('')
  const [scope, setScope] = useState<'selection' | 'review'>(selectedAnchor ? 'selection' : 'review')
  const [error, setError] = useState<string | null>(null)

  const targetAnchor = scope === 'selection' ? selectedAnchor : null
  const profileId = composer.selection.profileId
  const modelId = composer.selection.modelId
  const busy = createPending || startPending
  const canRun = Boolean(profileId) && Boolean(instruction.trim()) && !busy

  const sortedFixes = useMemo(
    () => [...review.agentFixes].sort((left, right) => right.createdAt - left.createdAt),
    [review.agentFixes],
  )

  const createAndStart = async () => {
    const body = instruction.trim()
    if (!body || !profileId || busy) {
      return
    }
    setError(null)
    const beforeIds = new Set(review.agentFixes.map(fix => fix.id))
    try {
      const createdReview = await onCreate({
        anchor: targetAnchor,
        instruction: body,
        profileId,
        expectedOutput: 'working-tree-change',
      })
      const created = latestAgentFix(createdReview, beforeIds)
      if (!created) {
        throw new Error('Agent work order was not created')
      }
      const startedReview = await onStart({
        agentFixId: created.id,
        providerTargetId: profileId,
        modelId,
      })
      const started = startedReview.agentFixes.find(fix => fix.id === created.id)
      if (started?.sessionId) {
        openChatSession(started.sessionId)
      }
      setInstruction('')
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <aside
      className="flex min-h-0 shrink-0 flex-col border-l border-border/60 bg-background"
      style={{ width }}
      data-testid="agent-rail"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-3">
        <BotIcon className="size-3.5 !text-muted-foreground/60" aria-hidden />
        <span className="text-[12px] font-medium text-foreground/70">Agent</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/60">{review.agentFixes.length}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCollapse}
          className="flex size-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Hide agent"
        >
          <XIcon className="size-3" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 border-b border-border/60 p-3">
          <div className="flex rounded-md bg-muted/60 p-0.5">
            <ScopeButton active={scope === 'selection'} disabled={!selectedAnchor} onClick={() => setScope('selection')}>
              Selection
            </ScopeButton>
            <ScopeButton active={scope === 'review'} onClick={() => setScope('review')}>
              Review
            </ScopeButton>
          </div>

          <div className="space-y-1.5">
            <p className="truncate text-[11px] text-muted-foreground">
              {targetAnchor ? selectedLabel : 'Use the full current review as context'}
            </p>
            <Textarea
              value={instruction}
              onChange={event => setInstruction(event.target.value)}
              placeholder="Ask the agent what to change..."
              className="min-h-20 resize-none text-[12px]"
            />
          </div>

          <ProviderModelSelector
            profiles={composer.profiles}
            selectedProfileId={profileId}
            selectedModelId={modelId}
            models={composer.models}
            modelsByProfileId={composer.modelsByProfileId}
            loadingProfileIds={composer.loadingProfileIds}
            thinkingEffort={composer.selection.thinkingEffort}
            isLoadingModels={composer.isLoadingModels}
            requestProfileModels={composer.requestProfileModels}
            onSelectProfile={composer.setProfileId}
            onSelectModel={composer.setModelId}
            onSelectThinkingEffort={composer.setThinkingEffort}
          />

          {error && (
            <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <Button
            type="button"
            size="sm"
            className="h-7 w-full text-[12px]"
            disabled={!canRun}
            onClick={createAndStart}
          >
            {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : <PlayCircleIcon className="size-3.5" />}
            Start agent
          </Button>
        </div>

        <div className="py-1">
          {sortedFixes.length === 0
            ? (
                <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
                  <BotIcon className="size-4 !text-muted-foreground/30" aria-hidden />
                  <p className="text-[11px] text-muted-foreground/60">No agent work yet</p>
                </div>
              )
            : sortedFixes.map(fix => (
                <AgentFixRow
                  key={fix.id}
                  fix={fix}
                  startPending={startPending}
                  cancelPending={cancelPending}
                  rerunPending={rerunPending}
                  providerTargetId={profileId}
                  modelId={modelId}
                  onStart={onStart}
                  onCancel={onCancel}
                  onRerun={onRerun}
                />
              ))}
        </div>
      </div>
    </aside>
  )
}

function ScopeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-6 flex-1 rounded-[5px] text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function AgentFixRow({
  fix,
  startPending,
  cancelPending,
  rerunPending,
  providerTargetId,
  modelId,
  onStart,
  onCancel,
  onRerun,
}: {
  fix: ReviewAgentFix
  startPending: boolean
  cancelPending: boolean
  rerunPending: boolean
  providerTargetId: string | null
  modelId: string | null
  onStart: AgentRailProps['onStart']
  onCancel: AgentRailProps['onCancel']
  onRerun: AgentRailProps['onRerun']
}) {
  const canStart = fix.status === 'pending' && Boolean(providerTargetId)
  const canCancel = fix.status === 'running'
  const canRerun = fix.status === 'completed' || fix.status === 'failed' || fix.status === 'cancelled'

  return (
    <div className="border-b border-border/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5">
        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_TONE[fix.status])}>
          {fix.status}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/50">{formatTimestamp(fix.createdAt)}</span>
      </div>
      <p className="line-clamp-2 text-[12px] leading-relaxed text-foreground/85">{fix.instruction}</p>
      {fix.errorMessage && (
        <p className="mt-1 rounded bg-red-500/10 px-1.5 py-1 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
          {fix.errorMessage}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {fix.sessionId && (
          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={() => openChatSession(fix.sessionId!)}>
            <MessageCircleIcon className="size-3" />
            Open chat
          </Button>
        )}
        {canStart && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            disabled={startPending}
            onClick={() => onStart({ agentFixId: fix.id, providerTargetId, modelId })}
          >
            {startPending ? <Loader2Icon className="size-3 animate-spin" /> : <PlayCircleIcon className="size-3" />}
            Start
          </Button>
        )}
        {canCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            disabled={cancelPending}
            onClick={() => onCancel(fix.id)}
          >
            <XIcon className="size-3" />
            Cancel
          </Button>
        )}
        {canRerun && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            disabled={rerunPending || !providerTargetId}
            onClick={() => onRerun({ agentFixId: fix.id, providerTargetId, modelId })}
          >
            <RefreshCwIcon className="size-3" />
            Rerun
          </Button>
        )}
        {fix.status === 'completed' && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <CheckCircleIcon className="size-3" />
            Done
          </span>
        )}
      </div>
    </div>
  )
}
