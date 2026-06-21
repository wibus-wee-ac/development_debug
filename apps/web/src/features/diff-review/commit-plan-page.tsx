import { Link } from '@tanstack/react-router'
import {
  ArrowLeftLine as ArrowLeftIcon,
  CheckLine as CheckIcon,
  GitCommitLine as GitCommitVerticalIcon,
  ListCheckLine as ListChecksIcon,
  LoadingLine as Loader2Icon,
  PencilLine as PencilIcon,
  CloseLine as XIcon
} from '@mingcute/react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { ProviderModelSelector, useComposerState } from '~/features/composer-toolbar'
import { cn } from '~/lib/cn'
import { openChatSession } from '~/navigation/navigation-commands'

import { navigateToReview } from './shared/navigation'
import type {
  CradleDiffReview,
  EditableCommitPlanStatus,
  ReviewAgentFix,
  ReviewCommitPlan,
  ReviewCommitPlanGroup,
  ReviewFile,
} from './shared/types'
import { useReview } from './shared/use-review'

interface CommitPlanPageProps {
  workspaceId: string
  repositoryPath?: string | null
  reviewId: string
}

const PLAN_STATUSES: EditableCommitPlanStatus[] = ['draft', 'accepted', 'abandoned']

const STATUS_TONE: Record<ReviewCommitPlan['status'], string> = {
  draft: 'text-muted-foreground',
  accepted: 'text-emerald-600 dark:text-emerald-400',
  applied: 'text-sky-600 dark:text-sky-400',
  abandoned: 'text-muted-foreground/70',
}

export function CommitPlanPage({ workspaceId, repositoryPath, reviewId }: CommitPlanPageProps) {
  const {
    review,
    isLoading,
    commitPlanMutation,
    commitPlanUpdateMutation,
    commitPlanApplyMutation,
    createAgentFixMutation,
    startAgentFixMutation,
  } = useReview({ workspaceId, repositoryPath, reviewId })
  const composer = useComposerState({ context: 'new-chat' })

  const files = useMemo(() => review?.files ?? [], [review?.files])
  const plan = review?.commitPlans[0] ?? null

  const fileById = useMemo(() => new Map(files.map(file => [file.id, file])), [files])
  const [editing, setEditing] = useState(false)
  const [draftMessages, setDraftMessages] = useState<Record<string, string>>({})
  const [draftRationale, setDraftRationale] = useState('')
  const [draftStatus, setDraftStatus] = useState<EditableCommitPlanStatus>('draft')

  useEffect(() => {
    setEditing(false)
    setDraftMessages(Object.fromEntries(plan?.groups.map(group => [group.id, group.message]) ?? []))
    setDraftRationale(plan?.rationale ?? '')
    setDraftStatus(plan?.status === 'applied' ? 'accepted' : (plan?.status ?? 'draft'))
  }, [plan])

  const editable = plan != null && plan.status !== 'applied'
  const commitAgentBusy = createAgentFixMutation.isPending || startAgentFixMutation.isPending

  const resetDrafts = () => {
    if (!plan) {
      return
    }
    setDraftMessages(Object.fromEntries(plan.groups.map(group => [group.id, group.message])))
    setDraftRationale(plan.rationale)
    setDraftStatus(plan.status === 'applied' ? 'accepted' : plan.status)
  }

  const saveEdits = () => {
    if (!plan || !editable) {
      return
    }
    const groups = plan.groups.map(group => ({
      ...group,
      message: draftMessages[group.id]?.trim() || group.message,
    }))
    commitPlanUpdateMutation.mutate({
      planId: plan.id,
      groups,
      rationale: draftRationale.trim() || plan.rationale,
      status: draftStatus,
    }, {
      onSuccess: () => setEditing(false),
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2Icon className="size-4 animate-spin !text-muted-foreground/40" aria-hidden />
      </div>
    )
  }

  if (!review) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center">
        <p className="text-xs text-muted-foreground">Review unavailable</p>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden" data-testid="commit-plan-page">
      <header className="flex h-10 shrink-0 items-center gap-2 px-3">
        <Link
          to="/workspaces/$workspaceId/diffs"
          params={{ workspaceId }}
          onClick={(event) => {
            event.preventDefault()
            navigateToReview(workspaceId, reviewId, { repositoryPath })
          }}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to review
        </Link>
        <div className="h-4 w-px bg-border" />
        <GitCommitVerticalIcon className="size-3.5 !text-muted-foreground/60" aria-hidden />
        <h1 className="text-xs font-medium text-foreground">Commit plan</h1>
        {plan && (
          <span className={cn('text-[10px] font-medium', STATUS_TONE[plan.status])}>{plan.status}</span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <GitCommitVerticalIcon className="size-3.5 !text-muted-foreground/70" />
              Ask an agent to plan commits
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
              The agent reads this review, proposes commit groups, and can make the final commit sequence traceable in chat.
            </p>
            <ProviderModelSelector
              profiles={composer.profiles}
              selectedProfileId={composer.selection.profileId}
              selectedModelId={composer.selection.modelId}
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
            <Button
              type="button"
              size="sm"
              className="mt-3 w-full text-xs"
              disabled={commitAgentBusy || files.length === 0 || !composer.selection.profileId}
              onClick={async () => {
                if (!review || !composer.selection.profileId) {
                  return
                }
                const beforeIds = new Set(review.agentFixes.map(fix => fix.id))
                const createdReview = await createAgentFixMutation.mutateAsync({
                  instruction: 'Plan a clean commit sequence for this review. Propose commit messages, file groupings, dependencies, and whether the working tree is ready to commit.',
                  expectedOutput: 'commit',
                  profileId: composer.selection.profileId,
                })
                const created = latestAgentFix(createdReview, beforeIds)
                if (!created) {
                  return
                }
                const startedReview = await startAgentFixMutation.mutateAsync({
                  agentFixId: created.id,
                  providerTargetId: composer.selection.profileId,
                  modelId: composer.selection.modelId,
                })
                const started = startedReview.agentFixes.find(fix => fix.id === created.id)
                if (started?.sessionId) {
                  openChatSession(started.sessionId)
                }
              }}
            >
              {commitAgentBusy ? <Loader2Icon className="size-3.5 animate-spin" /> : <GitCommitVerticalIcon className="size-3.5" />}
              Plan with agent
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <ListChecksIcon className="size-3.5 !text-muted-foreground/70" />
              Fallback plan
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              Group the
{' '}
{files.length}
{' '}
changed file
{files.length === 1 ? '' : 's'}
{' '}
into logical commits, or squash everything into a single commit.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                className="text-xs"
                onClick={() => commitPlanMutation.mutate('rule-based-groups')}
                disabled={commitPlanMutation.isPending || files.length === 0}
              >
                {commitPlanMutation.isPending ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                Grouped commits
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => commitPlanMutation.mutate('single')}
                disabled={commitPlanMutation.isPending || files.length === 0}
              >
                Single commit
              </Button>
            </div>
          </div>

          {plan
            ? (
                <>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground">
                          {plan.strategy === 'rule-based-groups' ? 'Grouped' : plan.strategy === 'single' ? 'Single' : 'Manual'}
                        </div>
                        {editing
                          ? (
                              <Textarea
                                value={draftRationale}
                                onChange={event => setDraftRationale(event.target.value)}
                                placeholder="Why these commits?"
                                className="mt-2 min-h-16 resize-none text-[11px] leading-relaxed"
                              />
                            )
                          : (
                              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{plan.rationale}</p>
                            )}
                      </div>
                      {editable && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          onClick={() => {
                            if (editing) {
                              resetDrafts()
                              setEditing(false)
                              return
                            }
                            setEditing(true)
                          }}
                          disabled={commitPlanUpdateMutation.isPending}
                          title={editing ? 'Cancel edits' : 'Edit commit plan'}
                        >
                          {editing ? <XIcon className="size-3.5" /> : <PencilIcon className="size-3.5" />}
                        </Button>
                      )}
                    </div>

                    {editing && (
                      <div className="mt-3 flex items-center gap-1">
                        {PLAN_STATUSES.map(status => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => setDraftStatus(status)}
                            className={cn(
                              'h-6 rounded-md px-2 text-[10px] font-medium transition-colors',
                              draftStatus === status
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    {plan.groups.map((group, index) => (
                      <CommitGroup
                        key={group.id}
                        group={group}
                        index={index}
                        editing={editing}
                        draftMessage={draftMessages[group.id] ?? group.message}
                        onMessageChange={value => setDraftMessages(current => ({ ...current, [group.id]: value }))}
                        fileById={fileById}
                      />
                    ))}
                  </div>

                  {editing
                    ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="text-xs"
                            onClick={saveEdits}
                            disabled={commitPlanUpdateMutation.isPending}
                          >
                            {commitPlanUpdateMutation.isPending ? <Loader2Icon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
                            Save plan
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              resetDrafts()
                              setEditing(false)
                            }}
                            disabled={commitPlanUpdateMutation.isPending}
                          >
                            <XIcon className="size-3.5" />
                            Cancel
                          </Button>
                        </div>
                      )
                    : plan.status === 'accepted'
                      ? (
                          <Button
                            type="button"
                            size="sm"
                            className="w-full text-xs"
                            onClick={() => commitPlanApplyMutation.mutate(plan.id)}
                            disabled={commitPlanApplyMutation.isPending}
                          >
                            {commitPlanApplyMutation.isPending ? <Loader2Icon className="size-3.5 animate-spin" /> : <GitCommitVerticalIcon className="size-3.5" />}
                            Apply commits
                          </Button>
                        )
                      : null}
                </>
              )
            : (
                <div className="rounded-lg border border-dashed border-border p-6 text-center">
                  <p className="text-xs text-muted-foreground">No commit plan yet. Generate one above.</p>
                </div>
              )}
        </div>
      </div>
    </div>
  )
}

function latestAgentFix(review: CradleDiffReview, beforeIds: Set<string>): ReviewAgentFix | null {
  return review.agentFixes
    .filter(fix => !beforeIds.has(fix.id))
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
}

function CommitGroup({
  group,
  index,
  editing,
  draftMessage,
  onMessageChange,
  fileById,
}: {
  group: ReviewCommitPlanGroup
  index: number
  editing: boolean
  draftMessage: string
  onMessageChange: (value: string) => void
  fileById: Map<string, ReviewFile>
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{group.title}</span>
          </div>
          {editing
            ? (
                <Textarea
                  value={draftMessage}
                  onChange={event => onMessageChange(event.target.value)}
                  className="mt-2 min-h-16 resize-none font-mono text-[11px] leading-relaxed"
                />
              )
            : (
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-foreground/85">
                  {group.message}
                </pre>
              )}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{group.rationale}</p>
          {group.dependsOn.length > 0 && (
            <p className="mt-1 text-[10px] text-muted-foreground/80">
Depends on:
{group.dependsOn.join(', ')}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {group.fileIds.length}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {group.fileIds.map(fileId => (
          <span
            key={fileId}
            className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {fileById.get(fileId)?.path ?? fileId}
          </span>
        ))}
      </div>
    </div>
  )
}
