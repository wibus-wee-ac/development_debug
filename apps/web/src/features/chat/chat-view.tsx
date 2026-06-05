import { useQueryClient } from '@tanstack/react-query'
import { AlertCircleIcon, ExternalLinkIcon, LoaderCircleIcon } from 'lucide-react'
import { m } from 'motion/react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtualizer } from 'virtua'

import { postChatSessionsBySessionIdCodexAppServerInvoke } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Textarea } from '~/components/ui/textarea'
import { toastManager } from '~/components/ui/toast'
import { getServerUrl } from '~/lib/electron'
import type { ModelDescriptor, RuntimeKind } from '~/lib/types'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'
import { useLayoutStore } from '~/store/layout'

import type { ChatRuntimeGoalUiSlotState } from './chat-capabilities'
import { runtimeUiSlotStatesQueryKey } from './chat-capabilities'
import { ChatMinimap } from './chat-minimap'
import { ChatQueueList } from './chat-queue-list'
import type { ChatComposerSlashCommand } from './chat-slash-commands'
import { CODEX_REVIEW_SLASH_ACTION_ID, CODEX_USAGE_SLASH_ACTION_ID, CRADLE_APPSHOT_SLASH_ACTION_ID } from './chat-slash-commands'
import { Composer } from './composer'
import type { ComposerSlashCommandActionContext, ComposerSlashCommandActionResult, ComposerSlashCommandActionTools } from './composer-action-context'
import type { ComposerReviewSlotActions, ComposerUsageSlotActions } from './composer-slot-states'
import { ComposerSlotStates } from './composer-slot-states'
import type { MentionItem } from './mention-panel'
import { MessageBubbleById } from './message-bubble'
import {
  registerChatComposerFileIngressHandler,
  registerChatPromptIngressHandler,
} from './prompt-ingress'
import { RuntimeDiagnosticsPopover } from './runtime-diagnostics-popover'
import { RuntimeToolbarOptions } from './runtime-toolbar-options'
import type { SkillMentionItem } from './skill-mention-panel'
import type { ChatComposerRuntime } from './use-chat-composer-runtime'
import { useChatComposerRuntime } from './use-chat-composer-runtime'
import type { ChatScrollRuntime } from './use-chat-scroll-runtime'
import { useChatScrollRuntime } from './use-chat-scroll-runtime'
import type { ChatQueueItem } from './use-chat-session'
import { useChatSession } from './use-chat-session'
import type { ComposerAppshotRuntime } from './use-composer-appshot-capture'
import { useComposerAppshotCapture } from './use-composer-appshot-capture'
import { useSessionAwaitSummary } from './use-session-await'

interface ChatViewProps {
  sessionId: string | null
  /** Available files for @ mention */
  availableFiles?: MentionItem[]
  /** Lazy workspace file search for @ mention */
  searchFiles?: (query: string, signal?: AbortSignal) => Promise<MentionItem[]>
  /** Lazy skill search for $ mention */
  searchSkills?: (query: string, signal?: AbortSignal) => Promise<SkillMentionItem[]>
  /** Custom toolbar rendered in the composer left slot */
  composerToolbar?: React.ReactNode
  /** Ref to read per-message overrides (modelId, thinkingEffort) before sending */
  sendOverridesRef?: React.MutableRefObject<{
    providerTargetId?: string
    modelId?: string
    thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'auto' | null
  }>
  /** Currently selected composer model, including provider-switched chat sessions before the first run persists. */
  composerModel?: ModelDescriptor | null
  /** Custom context bar rendered before the send button */
  composerContextBar?: React.ReactNode
  /** Placeholder text for composer */
  placeholder?: string
  runtimeKind?: RuntimeKind
  workspaceId?: string | null
  onSideChatCreated?: (sessionId: string) => void
}

const EMPTY_FILES: MentionItem[] = []

const ChatMessageListPane = memo(({
  sessionId,
  messageIds,
  messageCount,
  status,
  error,
  isReady,
  scrollRuntime,
  onToolApprovalResponse,
}: {
  sessionId: string | null
  messageIds: ReturnType<typeof useChatSession>['messageIds']
  messageCount: ReturnType<typeof useChatSession>['messageCount']
  status: ReturnType<typeof useChatSession>['status']
  error: ReturnType<typeof useChatSession>['error']
  isReady: boolean
  scrollRuntime: ChatScrollRuntime
  onToolApprovalResponse: ReturnType<typeof useChatSession>['respondToToolApproval']
}) => {
  const { t } = useTranslation('chat')

  return (
    <div ref={scrollRuntime.scrollContainerRef} className="relative min-h-0 flex-1 overflow-hidden">
      <ScrollArea
        viewportRef={scrollRuntime.viewportRef}
        className="h-full **:data-[slot=scroll-area-scrollbar]:flex **:data-[slot=scroll-area-scrollbar]:opacity-100 **:data-[slot=scroll-area-thumb]:bg-foreground/25"
      >
        <div className="mx-auto max-w-208 px-4 pr-12 pt-4">
          {messageCount === 0 && isReady && (
            <div className="flex h-full items-center justify-center py-32">
              <p className="select-none text-sm text-muted-foreground">
                {t('empty.startConversation')}
              </p>
            </div>
          )}

          <Virtualizer
            ref={scrollRuntime.virtualizerRef}
            scrollRef={scrollRuntime.viewportRef}
            startMargin={24}
            keepMounted={scrollRuntime.keepMountedIndices}
            onScroll={scrollRuntime.handleVirtualScroll}
          >
            {messageIds.map(messageId => (
              <MessageBubbleById
                key={messageId}
                sessionId={sessionId}
                messageId={messageId}
                onToolApprovalResponse={onToolApprovalResponse}
              />
            ))}
          </Virtualizer>

          {status === 'error' && (
            <m.div
              data-testid="chat-error-banner"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
              className="flex items-start gap-2 pl-1 pt-4"
            >
              <AlertCircleIcon className="size-3.5 shrink-0 text-destructive/70" aria-hidden="true" />
              <span className="min-w-0 break-all text-xs text-destructive/70">
                {error ?? t('error.loadMessages')}
              </span>
            </m.div>
          )}

          <div className="h-6" aria-hidden="true" />
        </div>
      </ScrollArea>

      <ChatMinimap
        ref={scrollRuntime.minimapRef}
        sessionId={sessionId}
        messageIds={messageIds}
        scrollHeight={scrollRuntime.metrics.scrollHeight}
        viewportHeight={scrollRuntime.metrics.viewportHeight}
        onScrollToIndex={scrollRuntime.scrollToMessageIndex}
        onScrollTo={scrollRuntime.scrollToOffset}
      />
    </div>
  )
})
ChatMessageListPane.displayName = 'ChatMessageListPane'

function ChatAwaitBanner({
  awaitSummary,
}: {
  awaitSummary: Awaited<ReturnType<typeof useSessionAwaitSummary>['data']>
}) {
  const { t } = useTranslation('chat')

  if (!awaitSummary?.awaiting) {
    return null
  }

  return (
    <div className="mb-2 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
      <span className="min-w-0 truncate">
        {(awaitSummary.reason as string) ?? t('await.waitingFor', { source: (awaitSummary.primarySource as string) ?? t('await.source.event') })}
      </span>
      <button
        type="button"
        onClick={() => useLayoutStore.getState().openAsideTab('await')}
        className="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ExternalLinkIcon className="size-3" />
        <span>{t('await.action.view')}</span>
      </button>
    </div>
  )
}

function ChatComposerSection({
  awaitSummary,
  queueItems,
  onCancelQueueItem,
  onReorderQueueItems,
  onSlashCommandAction,
  composerRuntime,
  appshotRuntime,
  placeholder,
  availableFiles,
  searchFiles,
  searchSkills,
  toolbar,
  contextBar,
  droppedPath,
  goalActions,
  reviewSlot,
  usageSlot,
  onComposerFocusChange,
}: {
  awaitSummary: Awaited<ReturnType<typeof useSessionAwaitSummary>['data']>
  queueItems: ChatQueueItem[]
  onCancelQueueItem: (queueItemId: string) => void
  onReorderQueueItems: (queueItemIds: string[]) => void
  onSlashCommandAction?: (command: ChatComposerSlashCommand, context: ComposerSlashCommandActionContext, tools?: ComposerSlashCommandActionTools) => Promise<void | ComposerSlashCommandActionResult> | void | ComposerSlashCommandActionResult
  composerRuntime: ChatComposerRuntime
  appshotRuntime: ComposerAppshotRuntime
  placeholder?: string
  availableFiles: MentionItem[]
  searchFiles?: (query: string, signal?: AbortSignal) => Promise<MentionItem[]>
  searchSkills?: (query: string, signal?: AbortSignal) => Promise<SkillMentionItem[]>
  toolbar?: React.ReactNode
  contextBar?: React.ReactNode
  droppedPath: { text: string, ts: number } | null
  goalActions: {
    busy: boolean
    onEdit: (state: ChatRuntimeGoalUiSlotState) => void
    onPause: (state: ChatRuntimeGoalUiSlotState) => void
    onResume: (state: ChatRuntimeGoalUiSlotState) => void
    onClear: (state: ChatRuntimeGoalUiSlotState) => void
  }
  reviewSlot: ComposerReviewSlotActions
  usageSlot: ComposerUsageSlotActions
  onComposerFocusChange?: (focused: boolean) => void
}) {
  return (
    <div className="shrink-0 bg-tra px-4 pb-3">
      <div className="mx-auto max-w-208">
        <ChatAwaitBanner awaitSummary={awaitSummary} />
        <ChatQueueList
          items={queueItems}
          onCancel={onCancelQueueItem}
          onReorder={onReorderQueueItems}
          className="mb-2"
        />
        <ComposerSlotStates
          slots={composerRuntime.uiSlots}
          states={composerRuntime.slotStates}
          actions={goalActions}
          review={reviewSlot}
          usage={usageSlot}
        />
        <Composer
          send={{
            submit: composerRuntime.send,
            stop: composerRuntime.stop,
            isStreaming: composerRuntime.isStreaming,
            disabled: composerRuntime.disabled,
          }}
          commands={{
            commands: composerRuntime.slashCommands,
            runAction: onSlashCommandAction,
          }}
          attachments={{
            supportsAttachments: composerRuntime.supportsAttachments,
            appendFileParts: appshotRuntime.externalFileParts,
            appendFilePartsKey: appshotRuntime.externalFilePartsKey,
            pendingAppshots: appshotRuntime.pendingAppshots,
            onActionTargetElementChange: appshotRuntime.setActionTargetElement,
          }}
          slots={{
            toolbar,
            contextBar,
          }}
          externalSignals={{
            appendText: droppedPath ? `${droppedPath.text}` : undefined,
            appendTextKey: droppedPath?.ts,
          }}
          view={{
            placeholder,
            availableFiles,
            searchFiles,
            searchSkills,
            onFocusChange: onComposerFocusChange,
            sessionTokens: composerRuntime.tokenUsage.tokens,
            sessionContextWindow: composerRuntime.tokenUsage.contextWindow,
          }}
        />
      </div>
    </div>
  )
}

export function ChatView({
  sessionId,
  availableFiles = EMPTY_FILES,
  searchFiles,
  searchSkills,
  composerToolbar,
  composerContextBar,
  sendOverridesRef,
  composerModel,
  placeholder,
  runtimeKind: _runtimeKind,
  workspaceId,
  onSideChatCreated,
}: ChatViewProps) {
  const queryClient = useQueryClient()
  const {
    messageIds,
    messageCount,
    status,
    isStreaming,
    error,
    sendMessage,
    respondToToolApproval,
    stop,
    isReady,
    queueItems,
    cancelQueueItem,
    reorderQueueItems,
  } = useChatSession(sessionId)
  const { data: awaitSummary } = useSessionAwaitSummary(sessionId)
  const [droppedPath, setDroppedPath] = useState<{ text: string, ts: number } | null>(null)
  const [editingGoal, setEditingGoal] = useState<ChatRuntimeGoalUiSlotState | null>(null)
  const [goalObjectiveDraft, setGoalObjectiveDraft] = useState('')
  const [goalActionBusy, setGoalActionBusy] = useState(false)
  const [reviewModeOpen, setReviewModeOpen] = useState(false)
  const [usageSlotSessionId, setUsageSlotSessionId] = useState<string | null>(null)
  const composerRuntime = useChatComposerRuntime({
    sessionId,
    status,
    isStreaming,
    messageCount,
    isReady,
    workspaceId,
    composerModel,
    sendOverridesRef,
    sendMessage,
    stop,
  })
  const scrollRuntime = useChatScrollRuntime({ sessionId, messageIds, status })
  const appshotRuntime = useComposerAppshotCapture({
    supportsAttachments: composerRuntime.supportsAttachments,
  })
  const originalComposerSend = composerRuntime.send
  const composerSend = useCallback(async (
    ...args: Parameters<ChatComposerRuntime['send']>
  ) => {
    const result = await originalComposerSend(...args)
    if (result?.kind === 'side-chat') {
      onSideChatCreated?.(result.sessionId)
    }
    return result
  }, [onSideChatCreated, originalComposerSend])
  const navigableComposerRuntime = useMemo<ChatComposerRuntime>(() => ({
    ...composerRuntime,
    send: composerSend,
  }), [composerRuntime, composerSend])

  useEffect(() => {
    if (!sessionId) {
      return
    }
    return registerChatPromptIngressHandler(sessionId, ({ text, files, contextParts = [] }) => {
      composerSend(text, files, contextParts)
    })
  }, [composerSend, sessionId])

  useEffect(() => {
    if (!sessionId) {
      return
    }
    return registerChatComposerFileIngressHandler(sessionId, appshotRuntime.appendFileParts)
  }, [appshotRuntime.appendFileParts, sessionId])

  const refreshGoalRuntimeState = useCallback(() => {
    if (!sessionId) {
      return
    }
    void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(sessionId) })
    void queryClient.invalidateQueries({ queryKey: ['chat', 'runtime-session-status', sessionId] })
  }, [queryClient, sessionId])

  const invokeCodexGoalAction = useCallback(async (
    method: 'thread/goal/set' | 'thread/goal/clear',
    params: Record<string, unknown>,
    failureTitle: string,
  ) => {
    if (!sessionId) {
      return
    }

    setGoalActionBusy(true)
    try {
      await postChatSessionsBySessionIdCodexAppServerInvoke({
        path: { sessionId },
        body: { method, params },
        throwOnError: true,
      })
      refreshGoalRuntimeState()
      return true
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: failureTitle,
        description: error instanceof Error ? error.message : 'Unknown goal action error.',
      })
      return false
    }
    finally {
      setGoalActionBusy(false)
    }
  }, [refreshGoalRuntimeState, sessionId])

  const goalActions = useMemo(() => ({
    busy: goalActionBusy,
    onEdit: (state: ChatRuntimeGoalUiSlotState) => {
      setEditingGoal(state)
      setGoalObjectiveDraft(state.objective)
    },
    onPause: (state: ChatRuntimeGoalUiSlotState) => {
      void invokeCodexGoalAction('thread/goal/set', {
        threadId: state.threadId,
        status: 'paused',
      }, 'Goal pause failed')
    },
    onResume: (state: ChatRuntimeGoalUiSlotState) => {
      void invokeCodexGoalAction('thread/goal/set', {
        threadId: state.threadId,
        status: 'active',
      }, 'Goal resume failed')
    },
    onClear: (state: ChatRuntimeGoalUiSlotState) => {
      void invokeCodexGoalAction('thread/goal/clear', {
        threadId: state.threadId,
      }, 'Goal clear failed')
    },
  }), [goalActionBusy, invokeCodexGoalAction])

  const closeGoalEditor = useCallback(() => {
    if (goalActionBusy) {
      return
    }
    setEditingGoal(null)
    setGoalObjectiveDraft('')
  }, [goalActionBusy])

  const submitGoalEditor = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingGoal) {
      return
    }

    const objective = goalObjectiveDraft.trim()
    if (!objective) {
      toastManager.add({
        type: 'error',
        title: 'Goal update failed',
        description: 'Goal objective cannot be empty.',
      })
      return
    }

    if (objective === editingGoal.objective) {
      closeGoalEditor()
      return
    }

    void invokeCodexGoalAction('thread/goal/set', {
      threadId: editingGoal.threadId,
      objective,
    }, 'Goal update failed').then((updated) => {
      if (updated) {
        closeGoalEditor()
      }
    })
  }, [closeGoalEditor, editingGoal, goalObjectiveDraft, invokeCodexGoalAction])

  const handleSlashCommandAction = useCallback(async (
    command: ChatComposerSlashCommand,
    context: ComposerSlashCommandActionContext,
    tools?: ComposerSlashCommandActionTools,
  ): Promise<void | ComposerSlashCommandActionResult> => {
    if (command.action.kind !== 'uiAction') {
      return
    }
    if (command.action.actionId === CODEX_REVIEW_SLASH_ACTION_ID) {
      setReviewModeOpen(true)
      return { insertText: '' }
    }
    if (command.action.actionId === CODEX_USAGE_SLASH_ACTION_ID) {
      setUsageSlotSessionId(sessionId)
      return { insertText: '' }
    }
    if (command.action.actionId !== CRADLE_APPSHOT_SLASH_ACTION_ID) {
      return
    }
    if (!appshotRuntime.hasNativeCapture) {
      toastManager.add({
        type: 'error',
        title: 'Appshot is unavailable',
        description: 'Appshot capture requires the Electron desktop app.',
      })
      return
    }
    if (!composerRuntime.supportsAttachments) {
      toastManager.add({
        type: 'error',
        title: 'Appshot attachment is unavailable',
        description: 'The selected model does not accept image attachments.',
      })
      return
    }

    try {
      await appshotRuntime.capture({ tools })
      return { insertText: '' }
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Appshot capture failed',
        description: error instanceof Error ? error.message : 'Unknown Appshot capture error.',
      })
    }
  }, [appshotRuntime, composerRuntime.supportsAttachments, sessionId])

  const submitCodexReviewPrompt = useCallback((prompt: string) => {
    void composerSend(prompt, [], [])
  }, [composerSend])

  const resolveCodexReviewMergeBase = useCallback(async (baseBranch: string) => {
    if (!workspaceId) {
      return null
    }
    const url = new URL(`/workspaces/${encodeURIComponent(workspaceId)}/git/merge-base`, getServerUrl())
    url.searchParams.set('baseBranch', baseBranch)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to resolve merge base (${response.status}).`)
    }
    const payload = await response.json() as { mergeBaseSha?: unknown }
    return typeof payload.mergeBaseSha === 'string' ? payload.mergeBaseSha : null
  }, [workspaceId])

  const reviewSlot = useMemo<ComposerReviewSlotActions>(() => ({
    open: reviewModeOpen,
    workspaceId,
    onDismiss: () => setReviewModeOpen(false),
    onSubmitPrompt: submitCodexReviewPrompt,
    resolveMergeBase: resolveCodexReviewMergeBase,
  }), [resolveCodexReviewMergeBase, reviewModeOpen, submitCodexReviewPrompt, workspaceId])

  const usageSlot = useMemo<ComposerUsageSlotActions>(() => ({
    open: Boolean(sessionId) && usageSlotSessionId === sessionId,
    onDismiss: () => setUsageSlotSessionId(null),
  }), [sessionId, usageSlotSessionId])

  const runtimeToolbar = useMemo(() => (
    <>
      {composerToolbar}
      <RuntimeToolbarOptions slots={composerRuntime.uiSlots} states={composerRuntime.slotStates} />
    </>
  ), [composerRuntime.slotStates, composerRuntime.uiSlots, composerToolbar])

  const headerActions = useMemo(() => (
    <div className="flex items-center gap-0.5">
      {import.meta.env.DEV && (
        <RuntimeDiagnosticsPopover slots={composerRuntime.uiSlots} states={composerRuntime.slotStates} />
      )}
    </div>
  ), [composerRuntime.slotStates, composerRuntime.uiSlots])

  const layoutSlots = useMemo(() => ({ headerActions }), [headerActions])

  useRegisterLayoutSlots(sessionId ?? '', layoutSlots)

  return (
    <div
      className="relative flex h-full flex-col"
      data-testid="chat-view"
      data-chat-ready={isReady ? 'true' : 'false'}
      data-chat-session-id={sessionId ?? ''}
      data-chat-status={status}
      suppressHydrationWarning
      onDrop={(e) => {
        e.preventDefault()
        const path = readWorkspaceFileDragText(e.dataTransfer)
        if (path) {
          setDroppedPath({ text: path, ts: Date.now() })
        }
      }}
      onDragOver={e => e.preventDefault()}
    >
      <ChatMessageListPane
        sessionId={sessionId}
        messageIds={messageIds}
        messageCount={messageCount}
        status={status}
        error={error}
        isReady={isReady}
        scrollRuntime={scrollRuntime}
        onToolApprovalResponse={respondToToolApproval}
      />

      <ChatComposerSection
        awaitSummary={awaitSummary}
        queueItems={queueItems}
        onCancelQueueItem={queueItemId => void cancelQueueItem(queueItemId)}
        onReorderQueueItems={queueItemIds => void reorderQueueItems(queueItemIds)}
        onSlashCommandAction={handleSlashCommandAction}
        composerRuntime={navigableComposerRuntime}
        appshotRuntime={appshotRuntime}
        placeholder={placeholder}
        availableFiles={availableFiles}
        searchFiles={searchFiles}
        searchSkills={searchSkills}
        toolbar={runtimeToolbar}
        contextBar={composerContextBar}
        droppedPath={droppedPath}
        goalActions={goalActions}
        reviewSlot={reviewSlot}
        usageSlot={usageSlot}
        onComposerFocusChange={scrollRuntime.handleComposerFocusChange}
      />

      <Dialog open={editingGoal !== null} onOpenChange={open => !open && closeGoalEditor()}>
        <DialogContent className="sm:max-w-md">
          <form className="grid gap-4" onSubmit={submitGoalEditor}>
            <DialogHeader>
              <DialogTitle>Edit goal</DialogTitle>
              <DialogDescription>
                Update the active goal without sending a chat message.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={goalObjectiveDraft}
              onChange={event => setGoalObjectiveDraft(event.target.value)}
              disabled={goalActionBusy}
              autoFocus
              rows={4}
              className="max-h-48 resize-none"
              aria-label="Goal objective"
            />
            <DialogFooter variant="bare">
              <Button type="button" variant="outline" disabled={goalActionBusy} onClick={closeGoalEditor}>
                Cancel
              </Button>
              <Button type="submit" disabled={goalActionBusy || goalObjectiveDraft.trim().length === 0}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  )
}
