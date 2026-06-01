import { AlertCircleIcon, ExternalLinkIcon, ListTodoIcon, LoaderCircleIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtualizer } from 'virtua'

import { Progress } from '~/components/ui/progress'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Skeleton } from '~/components/ui/skeleton'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'
import type { ModelDescriptor, RuntimeKind } from '~/lib/types'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'
import { useLayoutStore } from '~/store/layout'

import { ChatMinimap } from './chat-minimap'
import { ChatQueueList } from './chat-queue-list'
import { ChatShareExport } from './chat-share-export'
import type { ChatComposerSlashCommand } from './chat-slash-commands'
import { CRADLE_APPSHOT_SLASH_ACTION_ID } from './chat-slash-commands'
import type { SessionTodoSnapshot } from './chat-todo-projection'
import { readTodoCompletion } from './chat-todo-projection'
import { Composer } from './composer'
import type { ComposerSlashCommandActionContext, ComposerSlashCommandActionResult, ComposerSlashCommandActionTools } from './composer-action-context'
import type { MentionItem } from './mention-panel'
import { MessageBubbleById } from './message-bubble'
import type { ChatComposerRuntime } from './use-chat-composer-runtime'
import { useChatComposerRuntime } from './use-chat-composer-runtime'
import type { ChatScrollRuntime } from './use-chat-scroll-runtime'
import { useChatScrollRuntime } from './use-chat-scroll-runtime'
import type { ChatQueueItem } from './use-chat-session'
import { useChatSession } from './use-chat-session'
import type { ComposerAppshotRuntime } from './use-composer-appshot-capture'
import { useComposerAppshotCapture } from './use-composer-appshot-capture'
import { useSessionAwaitSummary } from './use-session-await'
import { useSessionTodos } from './use-session-todos'

interface ChatViewProps {
  sessionId: string | null
  /** Available files for @ mention */
  availableFiles?: MentionItem[]
  /** Lazy workspace file search for @ mention */
  searchFiles?: (query: string, signal?: AbortSignal) => Promise<MentionItem[]>
  /** Custom toolbar rendered in the composer left slot */
  composerToolbar?: React.ReactNode
  /** Ref to read per-message overrides (modelId, thinkingEffort) before sending */
  sendOverridesRef?: React.MutableRefObject<{
    providerTargetId?: string
    modelId?: string
    thinkingEffort?: 'low' | 'medium' | 'high' | 'auto' | null
  }>
  /** Currently selected composer model, including provider-switched chat sessions before the first run persists. */
  composerModel?: ModelDescriptor | null
  /** Custom context bar rendered before the send button */
  composerContextBar?: React.ReactNode
  /** Placeholder text for composer */
  placeholder?: string
  runtimeKind?: RuntimeKind
}

const EMPTY_FILES: MentionItem[] = []

function ChatMessageListPane({
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
}) {
  const { t } = useTranslation('chat')

  return (
    <div ref={scrollRuntime.scrollContainerRef} className="relative min-h-0 flex-1 overflow-hidden">
      <ScrollArea
        viewportRef={scrollRuntime.viewportRef}
        className="h-full **:data-[slot=scroll-area-scrollbar]:flex **:data-[slot=scroll-area-scrollbar]:opacity-100 **:data-[slot=scroll-area-thumb]:bg-foreground/25"
      >
        <div className="mx-auto max-w-208 px-4 pr-12 pt-4">
          {messageCount === 0 && !isReady && (
            <div className="space-y-6 py-4">
              {['loading-left-1', 'loading-right', 'loading-left-2'].map((skeletonId, i) => (
                <div key={skeletonId} className={cn('flex gap-3', i % 2 !== 0 && 'justify-end')}>
                  {i % 2 === 0 && <Skeleton className="size-7 rounded-full shrink-0 mt-0.5" />}
                  <div className="space-y-1.5 max-w-[60%]">
                    <Skeleton className="h-4 w-full rounded-xl" />
                    <Skeleton className={cn('h-4 rounded-xl', i === 0 ? 'w-3/4' : 'w-2/3')} />
                  </div>
                </div>
              ))}
            </div>
          )}
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
}

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
  todoSnapshot,
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
  toolbar,
  contextBar,
  droppedPath,
  onComposerFocusChange,
}: {
  todoSnapshot: SessionTodoSnapshot | null
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
  toolbar?: React.ReactNode
  contextBar?: React.ReactNode
  droppedPath: { text: string, ts: number } | null
  onComposerFocusChange?: (focused: boolean) => void
}) {
  return (
    <div className="shrink-0 bg-background/80 px-4 py-3 backdrop-blur-sm">
      <div className="mx-auto max-w-208">
        <TodoProgress snapshot={todoSnapshot} />
        <ChatAwaitBanner awaitSummary={awaitSummary} />
        <ChatQueueList
          items={queueItems}
          onCancel={onCancelQueueItem}
          onReorder={onReorderQueueItems}
          className="mb-2"
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
            onFocusChange: onComposerFocusChange,
            sessionTokens: composerRuntime.tokenUsage.tokens,
            sessionContextWindow: composerRuntime.tokenUsage.contextWindow,
          }}
        />
      </div>
    </div>
  )
}

function TodoProgress({ snapshot }: { snapshot: SessionTodoSnapshot | null }) {
  if (!snapshot || snapshot.todos.length === 0) {
    return null
  }

  const completion = readTodoCompletion(snapshot.todos)
  const fallbackTodo = snapshot.todos.at(-1)
  if (!fallbackTodo) {
    return null
  }
  const activeTodo = snapshot.todos.find(todo => todo.status === 'processing')
    ?? snapshot.todos.find(todo => todo.status === 'todo')
    ?? fallbackTodo

  const label = completion.completed === completion.total
    ? 'Todos complete'
    : activeTodo.content
  const completionLabel = `${completion.completed}/${completion.total}`

  return (
    <div className="mb-2 px-1">
      <div className="flex h-6 min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <ListTodoIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="shrink-0 font-medium text-foreground/75">Todo</span>
        <span className="min-w-0 flex-1 truncate text-foreground/80">
          {label}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
          {completionLabel}
        </span>
      </div>
      <Progress value={safePercent(completion.completed, completion.total)} className="h-0.5 bg-muted/60" />
    </div>
  )
}

export function ChatView({
  sessionId,
  availableFiles = EMPTY_FILES,
  searchFiles,
  composerToolbar,
  composerContextBar,
  sendOverridesRef,
  composerModel,
  placeholder,
  runtimeKind: _runtimeKind,
}: ChatViewProps) {
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
  const todoSnapshot = useSessionTodos(sessionId)
  const [droppedPath, setDroppedPath] = useState<{ text: string, ts: number } | null>(null)
  const composerRuntime = useChatComposerRuntime({
    sessionId,
    status,
    isStreaming,
    messageCount,
    isReady,
    composerModel,
    sendOverridesRef,
    sendMessage,
    stop,
  })
  const scrollRuntime = useChatScrollRuntime({ sessionId, messageIds, status })
  const appshotRuntime = useComposerAppshotCapture({
    supportsAttachments: composerRuntime.supportsAttachments,
  })

  const handleSlashCommandAction = useCallback(async (
    command: ChatComposerSlashCommand,
    context: ComposerSlashCommandActionContext,
    tools?: ComposerSlashCommandActionTools,
  ): Promise<void | ComposerSlashCommandActionResult> => {
    if (command.action.kind !== 'uiAction' || command.action.actionId !== CRADLE_APPSHOT_SLASH_ACTION_ID) {
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
  }, [appshotRuntime, composerRuntime.supportsAttachments])

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
      <div className="pointer-events-none absolute right-4 top-3 z-20 flex items-center gap-1">
        <div className="pointer-events-auto rounded-lg bg-background/75 p-0.5 shadow-sm ring-1 ring-foreground/10 backdrop-blur-sm">
          <ChatShareExport sessionId={sessionId} disabled={!isReady} />
        </div>
      </div>

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
        todoSnapshot={todoSnapshot}
        awaitSummary={awaitSummary}
        queueItems={queueItems}
        onCancelQueueItem={queueItemId => void cancelQueueItem(queueItemId)}
        onReorderQueueItems={queueItemIds => void reorderQueueItems(queueItemIds)}
        onSlashCommandAction={handleSlashCommandAction}
        composerRuntime={composerRuntime}
        appshotRuntime={appshotRuntime}
        placeholder={placeholder}
        availableFiles={availableFiles}
        searchFiles={searchFiles}
        toolbar={composerToolbar}
        contextBar={composerContextBar}
        droppedPath={droppedPath}
        onComposerFocusChange={scrollRuntime.handleComposerFocusChange}
      />
    </div>
  )
}

function safePercent(value: number, total: number): number {
  if (total <= 0) {
    return 0
  }
  return Math.round((value / total) * 100)
}
