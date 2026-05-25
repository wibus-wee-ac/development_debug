import { useQuery } from '@tanstack/react-query'
// Per-message wrapper that subscribes to generating state from the store.
// This ensures only truly-generating messages get streaming=true — not passive/stale state.
import type { FileUIPart, UIMessage } from 'ai'
import { AlertCircleIcon, ExternalLinkIcon, LoaderCircleIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VirtualizerHandle } from 'virtua'
import { Virtualizer } from 'virtua'
import { z } from 'zod'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getUsageSessionsBySessionId } from '~/api-gen/sdk.gen'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Skeleton } from '~/components/ui/skeleton'
import { toastManager } from '~/components/ui/toast'
import { useProviderTargetModels } from '~/features/agent-runtime/use-agent-models'
import { useChatPreferencesQuery } from '~/features/settings/use-chat-preferences'
import { cn } from '~/lib/cn'
import { isElectron, nativeIpc, platform, type MacAppshotCaptureResponse } from '~/lib/electron'
import type { ModelDescriptor } from '~/lib/types'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'

import { SessionApprovalList } from '../approval/approval-card'
import { getChatRuntimeCapabilities } from './chat-capabilities'
import type { ChatMinimapHandle } from './chat-minimap'
import { ChatMinimap } from './chat-minimap'
import { ChatQueueList } from './chat-queue-list'
import { Composer, type ComposerSlashCommandActionContext, type ComposerSlashCommandActionResult } from './composer'
import { modelSupportsAttachments } from './composer-attachment-state'
import type { ChatComposerSlashCommand } from './chat-slash-commands'
import { CRADLE_APPSHOT_SLASH_ACTION_ID, CRADLE_APPSHOT_SLASH_COMMAND, getFallbackRuntimeSlashCommands, mergeChatSlashCommands, withSlashCommandAvailability } from './chat-slash-commands'
import type { MentionItem } from './mention-panel'
import { MessageBubble } from './message-bubble'
import type { ChatContinuationMode, ChatQueueItem } from './use-chat-session'
import { useChatSession } from './use-chat-session'
import { useSessionAwaitSummary } from './use-session-await'

interface ChatViewProps {
  sessionId: string | null
  /** Available files for @ mention */
  availableFiles?: MentionItem[]
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
}

interface ChatScrollMetrics {
  offset: number
  scrollHeight: number
  viewportHeight: number
}

const EMPTY_FILES: MentionItem[] = []
const EMPTY_SCROLL_METRICS: ChatScrollMetrics = { offset: 0, scrollHeight: 0, viewportHeight: 0 }
const SessionBindingSchema = z
  .object({
    providerTargetId: z.string().nullable(),
    modelId: z.string().nullable(),
    runtimeKind: z.string().nullable().optional(),
  })
  .passthrough()

function invertContinuationMode(mode: ChatContinuationMode): ChatContinuationMode {
  return mode === 'queue' ? 'steer' : 'queue'
}

function readAppshotCaptureAsset(response: MacAppshotCaptureResponse) {
  if (response.strategy === 'cradle-native') {
    return response.asset
  }
  for (let index = response.updates.length - 1; index >= 0; index -= 1) {
    const update = response.updates[index]
    if (!update) {
      continue
    }
    const asset = update.screenshotAsset ?? update.transitionSnapshotAsset
    if (asset) {
      return asset
    }
  }
  return null
}

function readFileNameFromPath(path: string, fallback: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? fallback
}

function ChatMessageListPane({
  messages,
  status,
  error,
  isReady,
  showThinking,
  scrollContainerRef,
  viewportRef,
  virtualizerRef,
  keepMountedIndices,
  onVirtualScroll,
  scrollMetrics,
  minimapRef,
  onScrollToIndex,
  onScrollTo
}: {
  messages: ReturnType<typeof useChatSession>['messages']
  status: ReturnType<typeof useChatSession>['status']
  error: ReturnType<typeof useChatSession>['error']
  isReady: boolean
  showThinking: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  viewportRef: React.RefObject<HTMLDivElement | null>
  virtualizerRef: React.RefObject<VirtualizerHandle | null>
  keepMountedIndices?: number[]
  onVirtualScroll: (offset: number) => void
  scrollMetrics: ChatScrollMetrics
  minimapRef: React.RefObject<ChatMinimapHandle | null>
  onScrollToIndex: (index: number) => void
  onScrollTo: (offset: number) => void
}) {
  const { t } = useTranslation('chat')

  return (
    <div ref={scrollContainerRef} className="relative min-h-0 flex-1 overflow-hidden">
      <ScrollArea
        viewportRef={viewportRef}
        className="h-full **:data-[slot=scroll-area-scrollbar]:hidden"
      >
        <div className="mx-auto max-w-208 px-4 pt-4">
          {messages.length === 0 && !isReady && (
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
          {messages.length === 0 && isReady && (
            <div className="flex h-full items-center justify-center py-32">
              <p className="select-none text-sm text-muted-foreground">
                {t('empty.startConversation')}
              </p>
            </div>
          )}

          <Virtualizer
            ref={virtualizerRef}
            scrollRef={viewportRef}
            startMargin={24}
            keepMounted={keepMountedIndices}
            onScroll={onVirtualScroll}
          >
            {messages.map((message) => (
              <MessageBubbleWithStreamState key={message.id} message={message} />
            ))}
          </Virtualizer>

          {status === 'error' && (
            <m.div
              data-testid="chat-error-banner"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
              className="flex items-center gap-2 pl-1 pt-4"
            >
              <AlertCircleIcon className="size-3.5 text-destructive/70" aria-hidden="true" />
              <span className="text-xs text-destructive/70">
                {error ?? t('error.loadMessages')}
              </span>
            </m.div>
          )}

          {showThinking && (
            <m.div
              data-testid="chat-thinking-indicator"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
              className="flex items-center gap-2 pl-1 pt-4"
            >
              <LoaderCircleIcon
                className="size-3.5 animate-spin text-muted-foreground/50"
                aria-hidden="true"
              />
              <span className="text-xs text-muted-foreground">{t('status.thinking')}</span>
            </m.div>
          )}

          <div className="h-6" aria-hidden="true" />
        </div>
      </ScrollArea>

      <ChatMinimap
        ref={minimapRef}
        messages={messages}
        scrollHeight={scrollMetrics.scrollHeight}
        viewportHeight={scrollMetrics.viewportHeight}
        onScrollToIndex={onScrollToIndex}
        onScrollTo={onScrollTo}
      />
    </div>
  )
}

function ChatAwaitBanner({
  awaitSummary
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
  onSend,
  onSlashCommandAction,
  onStop,
  isStreaming,
  disabled,
  placeholder,
  availableFiles,
  slashCommands,
  toolbar,
  contextBar,
  droppedPath,
  sessionTokens,
  sessionContextWindow,
  supportsAttachments
}: {
  awaitSummary: Awaited<ReturnType<typeof useSessionAwaitSummary>['data']>
  queueItems: ChatQueueItem[]
  onCancelQueueItem: (queueItemId: string) => void
  onReorderQueueItems: (queueItemIds: string[]) => void
  onSend: (
    text: string,
    files: FileUIPart[],
    options?: { invertContinuationMode?: boolean }
  ) => void
  onSlashCommandAction?: (command: ChatComposerSlashCommand, context: ComposerSlashCommandActionContext) => Promise<void | ComposerSlashCommandActionResult> | void | ComposerSlashCommandActionResult
  onStop: () => void
  isStreaming: boolean
  disabled: boolean
  placeholder?: string
  availableFiles: MentionItem[]
  slashCommands: ChatComposerSlashCommand[]
  toolbar?: React.ReactNode
  contextBar?: React.ReactNode
  droppedPath: { text: string; ts: number } | null
  sessionTokens: number
  sessionContextWindow: number | null
  supportsAttachments: boolean
}) {
  return (
    <div className="shrink-0 bg-background/80 px-4 py-3 backdrop-blur-sm">
      <div className="mx-auto max-w-208">
        <ChatAwaitBanner awaitSummary={awaitSummary} />
        <ChatQueueList
          items={queueItems}
          onCancel={onCancelQueueItem}
          onReorder={onReorderQueueItems}
          className="mb-2"
        />
        <Composer
          onSend={onSend}
          onSlashCommandAction={onSlashCommandAction}
          onStop={onStop}
          isStreaming={isStreaming}
          disabled={disabled}
          supportsAttachments={supportsAttachments}
          placeholder={placeholder}
          availableFiles={availableFiles}
          slashCommands={slashCommands}
          toolbar={toolbar}
          contextBar={contextBar}
          appendText={droppedPath ? `${droppedPath.text}` : undefined}
          appendTextKey={droppedPath?.ts}
          sessionTokens={sessionTokens}
          sessionContextWindow={sessionContextWindow}
        />
      </div>
    </div>
  )
}

export function ChatView({
  sessionId,
  availableFiles = EMPTY_FILES,
  composerToolbar,
  composerContextBar,
  sendOverridesRef,
  composerModel,
  placeholder
}: ChatViewProps) {
  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    isReady,
    queueItems,
    cancelQueueItem,
    reorderQueueItems
  } = useChatSession(sessionId)
  const { data: awaitSummary } = useSessionAwaitSummary(sessionId)
  const { data: chatPreferences } = useChatPreferencesQuery()
  const { data: runtimeCapabilities } = useQuery({
    queryKey: ['chat', 'runtime-capabilities', sessionId ?? 'no-session'] as const,
    queryFn: ({ signal }) => getChatRuntimeCapabilities(sessionId!, signal),
    enabled: !!sessionId,
    staleTime: 60_000,
    retry: false
  })
  const isAwaiting = awaitSummary?.awaiting ?? false
  const [droppedPath, setDroppedPath] = useState<{ text: string; ts: number } | null>(null)
  const [sessionTokens, setSessionTokens] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { data: sessionBinding } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId ?? '' } }),
    enabled: !!sessionId,
    staleTime: 60_000,
    select: (data) => (data ? SessionBindingSchema.parse(data) : null)
  })
  const boundProviderTarget = useMemo(() => {
    return sessionBinding?.providerTargetId ? { id: sessionBinding.providerTargetId } : null
  }, [sessionBinding?.providerTargetId])
  const { models: sessionModels } = useProviderTargetModels(boundProviderTarget)
  const currentSessionModel = useMemo(() => {
    if (composerModel) {
      return composerModel
    }
    if (!sessionBinding?.modelId) {
      return null
    }
    return sessionModels.find((candidate) => candidate.id === sessionBinding.modelId) ?? null
  }, [composerModel, sessionBinding?.modelId, sessionModels])
  const sessionContextWindow = useMemo(() => {
    const contextWindow = currentSessionModel?.capabilities.contextWindow
    return contextWindow != null && contextWindow > 0 ? contextWindow : null
  }, [currentSessionModel])
  const supportsAttachments = useMemo(() => {
    return modelSupportsAttachments(currentSessionModel)
  }, [currentSessionModel])
  const cradleSlashCommands = useMemo(() => {
    if (!isElectron || platform !== 'darwin') {
      return [
        withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, {
          enabled: false,
          reason: 'Requires the macOS desktop app.',
        }),
      ]
    }
    if (!supportsAttachments) {
      return [
        withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, {
          enabled: false,
          reason: 'Requires an image-capable model.',
        }),
      ]
    }
    return [withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, undefined)]
  }, [supportsAttachments])
  const slashCommands = useMemo(() => mergeChatSlashCommands({
    runtimeCommands: runtimeCapabilities?.slashCommands ?? [],
    fallbackRuntimeCommands: getFallbackRuntimeSlashCommands(runtimeCapabilities?.runtimeKind ?? sessionBinding?.runtimeKind),
    cradleCommands: cradleSlashCommands,
  }), [cradleSlashCommands, runtimeCapabilities?.runtimeKind, runtimeCapabilities?.slashCommands, sessionBinding?.runtimeKind])

  /**
   * Ref to the ScrollArea's scrollable viewport — shared with Virtualizer so
   * it can track scroll position without a separate listener.
   */
  const viewportRef = useRef<HTMLDivElement>(null)
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  const minimapRef = useRef<ChatMinimapHandle>(null)

  /** True when the user is near the bottom (<= 200 px away). Auto-scroll only fires when true. */
  const isAtBottomRef = useRef(true)

  /** Scroll metrics for the minimap */
  const [scrollMetrics, setScrollMetrics] = useState<ChatScrollMetrics>(EMPTY_SCROLL_METRICS)

  const isStreaming = status === 'streaming'

  // Keep the streaming message mounted to prevent re-animation on scroll recycle
  const generatingIds = useChatStore((s) => s.generatingMessageIds)
  const keepMountedIndices = useMemo(() => {
    if (generatingIds.size === 0) {
      return undefined
    }
    const indices: number[] = []
    for (let i = 0; i < messages.length; i++) {
      if (generatingIds.has(messages[i].id)) {
        indices.push(i)
      }
    }
    return indices.length > 0 ? indices : undefined
  }, [generatingIds, messages])

  const lastMsg = messages.at(-1)
  const assistantHasVisibleText =
    lastMsg?.role === 'assistant' &&
    lastMsg.parts.some((p) => p.type === 'text' && (p as { text: string }).text.trim().length > 0)
  const showThinking = isStreaming && !assistantHasVisibleText

  const scrollToBottom = useCallback(() => {
    const vp = viewportRef.current
    if (vp) {
      vp.scrollTop = vp.scrollHeight
      isAtBottomRef.current = true
    }
  }, [])

  const readScrollMetrics = useCallback((): ChatScrollMetrics | null => {
    const vp = viewportRef.current
    if (!vp) {
      return null
    }

    return {
      offset: vp.scrollTop,
      scrollHeight: vp.scrollHeight,
      viewportHeight: vp.offsetHeight
    }
  }, [])

  const writeMinimapProgress = useCallback(() => {
    const vp = viewportRef.current
    if (!vp || messages.length === 0) {
      return
    }

    const offset = vp.scrollTop
    const scrollHeight = vp.scrollHeight
    const viewportHeight = vp.offsetHeight
    const scrollable = Math.max(scrollHeight - viewportHeight, 0)
    const scrollRatio = scrollable > 0 ? Math.max(0, Math.min(1, offset / scrollable)) : 1
    minimapRef.current?.setScrollProgress(scrollRatio)
  }, [messages.length])

  const refreshScrollMetrics = useCallback(() => {
    const metrics = readScrollMetrics()
    if (metrics) {
      setScrollMetrics(metrics)
    }
    writeMinimapProgress()
  }, [readScrollMetrics, writeMinimapProgress])

  // Disable CSS scroll anchoring on the viewport — we handle auto-scroll explicitly
  // via scrollToBottom(). Without this, the browser follows content added at the very
  // bottom (e.g. expanding an EditFileBlock diff), pushing the user down unintentionally.
  useEffect(() => {
    const vp = viewportRef.current
    if (vp) {
      vp.style.overflowAnchor = 'none'
    }
  }, [])

  // Scroll to bottom on initial data load (once per mount, since key={sessionId} remounts)
  const initialScrollDoneRef = useRef(false)
  useEffect(() => {
    if (initialScrollDoneRef.current || messages.length === 0) {
      return
    }
    initialScrollDoneRef.current = true
    virtualizerRef.current?.scrollToIndex(messages.length - 1, { align: 'end' })
    requestAnimationFrame(() => {
      const vp = viewportRef.current
      if (vp) {
        vp.scrollTop = vp.scrollHeight
      }
      refreshScrollMetrics()
    })
  }, [messages.length, refreshScrollMetrics])

  // Ongoing auto-scroll during streaming and after new messages are appended —
  // but only when the user was already near the bottom (respect manual scroll-up).
  useEffect(() => {
    if (!isAtBottomRef.current) {
      return
    }
    scrollToBottom()
    requestAnimationFrame(refreshScrollMetrics)
  }, [messages, status, refreshScrollMetrics, scrollToBottom])

  // Track whether the user is near the bottom. Fires on every scroll offset from virtua.
  const handleVirtScroll = useCallback((offset: number) => {
    const vp = viewportRef.current
    if (!vp) {
      return
    }
    isAtBottomRef.current = offset + vp.offsetHeight >= vp.scrollHeight - 200
  }, [])

  useEffect(() => {
    let frame = 0
    let lastScrollTop = -1
    let lastScrollHeight = -1
    let lastViewportHeight = -1

    const syncMinimapProgress = () => {
      const vp = viewportRef.current
      if (vp) {
        const scrollTop = vp.scrollTop
        const scrollHeight = vp.scrollHeight
        const viewportHeight = vp.offsetHeight

        if (
          scrollTop !== lastScrollTop ||
          scrollHeight !== lastScrollHeight ||
          viewportHeight !== lastViewportHeight
        ) {
          lastScrollTop = scrollTop
          lastScrollHeight = scrollHeight
          lastViewportHeight = viewportHeight
          isAtBottomRef.current = scrollTop + viewportHeight >= scrollHeight - 200
          writeMinimapProgress()
        }
      }

      frame = requestAnimationFrame(syncMinimapProgress)
    }

    frame = requestAnimationFrame(syncMinimapProgress)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [writeMinimapProgress])

  useEffect(() => {
    const frame = requestAnimationFrame(refreshScrollMetrics)
    return () => cancelAnimationFrame(frame)
  }, [messages.length, refreshScrollMetrics])

  // Fetch session token count after each turn completes
  useEffect(() => {
    if (sessionId && status !== 'streaming') {
      getUsageSessionsBySessionId({ path: { sessionId } })
        .then((res) => {
          if (res.data) {
            setSessionTokens(res.data.totalTokens)
          }
        })
        .catch(() => {})
    }
  }, [sessionId, status, messages.length])

  const handleSend = useCallback(
    (text: string, files: FileUIPart[], options?: { invertContinuationMode?: boolean }) => {
      if (!isReady || (!text.trim() && files.length === 0)) {
        return
      }
      const overrides = sendOverridesRef?.current
      const defaultContinuationMode = chatPreferences?.continuationBehavior ?? 'queue'
      const continuationMode = options?.invertContinuationMode
        ? invertContinuationMode(defaultContinuationMode)
        : defaultContinuationMode
      sendMessage(text, { ...overrides, continuationMode }, files)
    },
    [chatPreferences?.continuationBehavior, isReady, sendMessage, sendOverridesRef]
  )

  const handleSlashCommandAction = useCallback(async (
    command: ChatComposerSlashCommand,
    context: ComposerSlashCommandActionContext,
  ): Promise<void | ComposerSlashCommandActionResult> => {
    if (command.action.kind !== 'uiAction' || command.action.actionId !== CRADLE_APPSHOT_SLASH_ACTION_ID) {
      return
    }
    if (!nativeIpc) {
      toastManager.add({
        type: 'error',
        title: 'Appshot is unavailable',
        description: 'Appshot capture requires the Electron desktop app.',
      })
      return
    }
    if (!supportsAttachments) {
      toastManager.add({
        type: 'error',
        title: 'Appshot attachment is unavailable',
        description: 'The selected model does not accept image attachments.',
      })
      return
    }

    try {
      const response = await nativeIpc.macCapture.captureAppshot({
        sink: 'file',
        strategy: 'auto',
        animationTarget: context.animationTarget,
      })
      if (import.meta.env.DEV) {
        toastManager.add({
          type: 'info',
          title: 'Appshot strategy',
          description: response.strategy,
        })
      }
      const asset = readAppshotCaptureAsset(response)
      if (!asset) {
        throw new Error('Appshot capture did not return an image asset.')
      }
      return {
        insertText: '',
        fileParts: [{
          type: 'file',
          mediaType: asset.mimeType,
          filename: readFileNameFromPath(asset.path, 'appshot.png'),
          url: asset.dataURL,
        }],
      }
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Appshot capture failed',
        description: error instanceof Error ? error.message : 'Unknown Appshot capture error.',
      })
    }
  }, [supportsAttachments])

  const handleMinimapScrollToIndex = useCallback((index: number) => {
    const virt = virtualizerRef.current
    const vp = viewportRef.current
    if (!virt || !vp) {
      return
    }
    virt.scrollToIndex(index, { align: 'start', smooth: true })
  }, [])

  const handleMinimapScrollTo = useCallback((offset: number) => {
    const vp = viewportRef.current
    if (vp) {
      vp.scrollTop = offset
    }
  }, [])

  return (
    <div
      className="flex h-full flex-col"
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
      onDragOver={(e) => e.preventDefault()}
    >
      <ChatMessageListPane
        messages={messages}
        status={status}
        error={error}
        isReady={isReady}
        showThinking={showThinking}
        scrollContainerRef={scrollContainerRef}
        viewportRef={viewportRef}
        virtualizerRef={virtualizerRef}
        keepMountedIndices={keepMountedIndices}
        onVirtualScroll={handleVirtScroll}
        scrollMetrics={scrollMetrics}
        minimapRef={minimapRef}
        onScrollToIndex={handleMinimapScrollToIndex}
        onScrollTo={handleMinimapScrollTo}
      />

      {/* Approval cards — pinned above composer */}
      <SessionApprovalList chatSessionId={sessionId} />

      <ChatComposerSection
        awaitSummary={awaitSummary}
        queueItems={queueItems}
        onCancelQueueItem={(queueItemId) => void cancelQueueItem(queueItemId)}
        onReorderQueueItems={(queueItemIds) => void reorderQueueItems(queueItemIds)}
        onSend={handleSend}
        onSlashCommandAction={handleSlashCommandAction}
        onStop={stop}
        isStreaming={isStreaming}
        disabled={!isReady || isAwaiting}
        placeholder={placeholder}
        availableFiles={availableFiles}
        slashCommands={slashCommands}
        toolbar={composerToolbar}
        contextBar={composerContextBar}
        droppedPath={droppedPath}
        sessionTokens={sessionTokens}
        sessionContextWindow={sessionContextWindow}
        supportsAttachments={supportsAttachments}
      />
    </div>
  )
}

function MessageBubbleWithStreamState({ message }: { message: UIMessage }) {
  const isGenerating = useChatStore(chatSelectors.isGenerating(message.id))
  return <MessageBubble message={message} isStreaming={isGenerating} />
}
