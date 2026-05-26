import {
  ArrowUpIcon,
  MaximizeIcon,
  MinimizeIcon,
  MousePointer2Icon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react'
import { m } from 'motion/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { postSessions } from '~/api-gen/sdk.gen'
import { useLayoutGeometry } from '~/components/layout/layout-geometry-context'
import { Button } from '~/components/ui/button'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Switch } from '~/components/ui/switch'
import { MessageBubble } from '~/features/chat/message-bubble'
import { useChatSession } from '~/features/chat/use-chat-session'
import { cn } from '~/lib/cn'

import { projectJarvisMessageForDisplay } from './display-context'
import {
  addCurrentTextSelectionAttachment,
  clearExplicitContextAttachments,
  installExplicitContextProvider,
  removeExplicitContextAttachment,
  useExplicitContextAttachments,
} from './explicit-context'
import { formatContextEnvelopeForAgent } from './format-context'
import { useJarvisUiStore } from './jarvis-ui-store'
import { collectContextEnvelope } from './use-context-snapshot'
import { useJarvisPreferences } from './use-jarvis-preferences'

const FALLBACK_EXPANDED_BOUNDS = { top: 44, left: 268, width: 800, height: 600 }
const PANEL_MIN_WIDTH = 320
const PANEL_MAX_WIDTH = 900
const PANEL_MIN_HEIGHT = 300
const PANEL_MAX_HEIGHT = 800

export function JarvisPopover({
  open,
  onOpenChange,
  anchorRef,
  anchorKey: _anchorKey,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: React.RefObject<HTMLElement | null>
  anchorKey: string
}) {
  const { t } = useTranslation('system-agent')
  const [input, setInput] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [pendingInitialText, setPendingInitialText] = React.useState<string | null>(null)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const includeContextSwitchId = React.useId()
  const explicitAttachments = useExplicitContextAttachments()

  const jarvisExpanded = useJarvisUiStore(s => s.expanded)
  const setJarvisExpanded = useJarvisUiStore(s => s.setExpanded)
  const panelWidth = useJarvisUiStore(s => s.panelWidth)
  const panelHeight = useJarvisUiStore(s => s.panelHeight)
  const setPanelSize = useJarvisUiStore(s => s.setPanelSize)
  const activeSessionId = useJarvisUiStore(s => s.activeSessionId)
  const setActiveSessionId = useJarvisUiStore(s => s.setActiveSessionId)
  const addSession = useJarvisUiStore(s => s.addSession)
  const includeContext = useJarvisUiStore(s => s.includeContext)
  const setIncludeContext = useJarvisUiStore(s => s.setIncludeContext)

  const { centerColumnRect, footerRect } = useLayoutGeometry()
  const { prefs, isSuccess: preferencesReady } = useJarvisPreferences()

  React.useEffect(() => {
    installExplicitContextProvider()
  }, [])

  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    isReady: chatReady,
  } = useChatSession(activeSessionId)
  const isStreaming = status === 'streaming'
  const jarvisReady = preferencesReady && (!activeSessionId || chatReady)
  const displayMessages = React.useMemo(
    () => messages.map(projectJarvisMessageForDisplay),
    [messages],
  )

  // Collapse when popover closes
  React.useEffect(() => {
    if (!open && jarvisExpanded) {
      setJarvisExpanded(false)
    }
  }, [open, jarvisExpanded, setJarvisExpanded])

  // Send the initial message once the session ID becomes available
  React.useEffect(() => {
    if (activeSessionId && pendingInitialText) {
      void sendMessage(pendingInitialText)
      setPendingInitialText(null)
    }
  }, [activeSessionId, pendingInitialText, sendMessage])

  // Escape to close/collapse
  React.useEffect(() => {
    if (!open) {
      return
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (jarvisExpanded) {
          setJarvisExpanded(false)
        }
        else {
          onOpenChange(false)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange, jarvisExpanded, setJarvisExpanded])

  // Auto-scroll on new messages
  const messageCount = messages.length
  const lastPartCount = messages.at(-1)?.parts?.length ?? 0
  React.useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [messageCount, lastPartCount])

  // Auto-focus textarea when popover opens
  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [open])

  const [sendError, setSendError] = React.useState<string | null>(null)

  const handleSend = React.useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming || !prefs?.profileId || creating) {
      return
    }

    setSendError(null)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const envelope = collectContextEnvelope()
    const contextItems = includeContext
      ? envelope.items
      : envelope.items.filter(item => item.id.startsWith('explicit:'))
    const contextBlock = contextItems.length > 0
      ? formatContextEnvelopeForAgent({ ...envelope, items: contextItems })
      : ''
    const fullText = contextBlock ? `${contextBlock}\n\n${text}` : text

    // Lazy-create session on first message (or when no active session)
    let sessionId = activeSessionId
    if (!sessionId) {
      setCreating(true)
      try {
        const res = await postSessions({
          body: {
            title: 'Jarvis',
            providerTargetId: prefs!.profileId!,
            runtimeKind: 'jar-core',
          },
        })
        const session = res.data as { id: string } | null
        if (!session?.id) {
          setSendError(
            res.error
              ? String((res.error as { message?: string }).message ?? res.error)
              : t('error.sessionCreationFailed'),
          )
          return
        }
        sessionId = session.id
        addSession({ id: sessionId, title: text.slice(0, 40), createdAt: Date.now() })
        setActiveSessionId(sessionId)
        setPendingInitialText(fullText)
        clearExplicitContextAttachments()
        return
      }
      catch (e) {
        setSendError(e instanceof Error ? e.message : t('error.createSessionFailed'))
        return
      }
      finally {
        setCreating(false)
      }
    }

    await sendMessage(fullText)
    clearExplicitContextAttachments()
  }, [
    input,
    isStreaming,
    prefs,
    creating,
    activeSessionId,
    sendMessage,
    addSession,
    setActiveSessionId,
    includeContext,
    t,
  ])

  const handleAttachSelection = React.useCallback(() => {
    const attachment = addCurrentTextSelectionAttachment()
    if (!attachment) {
      setSendError(t('error.noTextSelection'))
    }
    else {
      setSendError(null)
    }
  }, [t])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  // Resize logic
  const resizingRef = React.useRef(false)
  const resizeStartRef = React.useRef({ x: 0, y: 0, w: 0, h: 0 })
  const [isResizing, setIsResizing] = React.useState(false)

  const handleResizeStart = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      resizingRef.current = true
      setIsResizing(true)
      resizeStartRef.current = { x: e.clientX, y: e.clientY, w: panelWidth, h: panelHeight }

      const handleMove = (ev: PointerEvent) => {
        if (!resizingRef.current) {
          return
        }
        const dx = resizeStartRef.current.x - ev.clientX
        const dy = resizeStartRef.current.y - ev.clientY
        const newW = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, resizeStartRef.current.w + dx))
        const newH = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, resizeStartRef.current.h + dy))
        setPanelSize(newW, newH)
      }

      const handleUp = () => {
        resizingRef.current = false
        setIsResizing(false)
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [panelWidth, panelHeight, setPanelSize],
  )

  // Calculate expanded bounds
  const expandedBounds = React.useMemo(() => {
    if (!centerColumnRect) {
      return FALLBACK_EXPANDED_BOUNDS
    }
    return {
      top: centerColumnRect.top + 12,
      left: centerColumnRect.left - 8,
      width: centerColumnRect.width + 16,
      height: centerColumnRect.height + 4,
    }
  }, [centerColumnRect])

  // Calculate popover bounds
  const popoverBounds = React.useMemo(() => {
    if (!footerRect) {
      return { top: 0, left: 0, width: panelWidth, height: panelHeight }
    }
    const anchorRect = anchorRef.current?.getBoundingClientRect()
    const centerX = anchorRect
      ? anchorRect.left + anchorRect.width / 2
      : footerRect.right - 12 - panelWidth / 2
    const left = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, centerX - panelWidth / 2))
    return {
      top: footerRect.top - 8 - panelHeight,
      left,
      width: panelWidth,
      height: panelHeight,
    }
  }, [footerRect, panelWidth, panelHeight, anchorRef])

  const targetBounds = jarvisExpanded ? expandedBounds : popoverBounds

  // Determine which messages are streaming (only the last assistant one)
  const lastAssistantId = React.useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === 'assistant') {
        return displayMessages[i].id
      }
    }
    return null
  }, [displayMessages])

  const emptyState = (
    <div className="flex flex-col items-center justify-center h-full min-h-72 px-8">
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted mb-4">
        <MousePointer2Icon className="size-4.5 text-foreground" />
      </div>
      {!prefs?.profileId
        ? (
            <>
              <p className="text-[13px] font-medium text-foreground mb-1.5">{t('empty.noProfile.title')}</p>
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                {t('empty.noProfile.description')}
              </p>
            </>
          )
        : (
            <>
              <p className="text-[13px] font-medium text-foreground mb-1.5">{t('empty.ready.title')}</p>
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                {t('empty.ready.description')}
              </p>
              {sendError && <p className="text-xs text-destructive/80 text-center mt-3">{sendError}</p>}
            </>
          )}
    </div>
  )

  const messageList = (
    <div className="flex flex-col gap-5 px-4 py-3">
      {displayMessages.map(msg => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isStreaming={isStreaming && msg.id === lastAssistantId}
          executionDetailsDefaultOpen
        />
      ))}
      {error && <div className="text-xs text-destructive/80 p-1">{error}</div>}
      {sendError && <div className="text-xs text-destructive/80 p-1">{sendError}</div>}
    </div>
  )

  const sendButton = isStreaming
    ? (
        <Button variant="outline" size="icon-xs" onClick={stop} aria-label={t('action.stop')}>
          <SquareIcon />
        </Button>
      )
    : (
        <Button
          variant="default"
          size="icon-xs"
          disabled={!input.trim() || creating || !prefs?.profileId}
          onClick={() => void handleSend()}
          aria-label={t('action.send')}
        >
          <ArrowUpIcon />
        </Button>
      )

  return (
    <m.div
      ref={panelRef}
      data-testid="jarvis-popover"
      data-jarvis-ready={jarvisReady ? 'true' : 'false'}
      initial={false}
      animate={{
        opacity: open ? 1 : 0,
        y: open ? 0 : 8,
        ...targetBounds,
      }}
      exit={{ opacity: 0, y: 8 }}
      transition={
        isResizing
          ? { duration: 0 }
          : {
              opacity: { duration: 0.15 },
              y: { duration: 0.2 },
              top: { type: 'spring', duration: 0.4, bounce: 0 },
              left: { type: 'spring', duration: 0.4, bounce: 0 },
              width: { type: 'spring', duration: 0.35, bounce: 0 },
              height: { type: 'spring', duration: 0.35, bounce: 0 },
            }
      }
      style={{ pointerEvents: open ? 'auto' : 'none' }}
      className={cn(
        'fixed z-50 flex flex-col',
        'rounded-xl bg-popover text-popover-foreground',
        'border border-border',
        'overflow-hidden',
        jarvisExpanded && 'shadow-[var(--shadow-xs)]',
      )}
    >
      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <MousePointer2Icon className="size-3.5 text-muted-foreground" />
            <span className="text-[13px] font-medium text-foreground">Jarvis</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setJarvisExpanded(!jarvisExpanded)}
              aria-label={jarvisExpanded ? t('action.collapse') : t('action.expand')}
            >
              {jarvisExpanded ? <MinimizeIcon /> : <MaximizeIcon />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setJarvisExpanded(false)
                onOpenChange(false)
              }}
              aria-label={t('action.close')}
            >
              <XIcon />
            </Button>
          </div>
        </div>

        {/* Messages — uses the same MessageBubble as the Chat page */}
        <ScrollArea className="flex-1 min-h-0" viewportRef={viewportRef}>
          {displayMessages.length === 0 ? emptyState : messageList}
        </ScrollArea>

        {/* Input */}
        <div className="shrink-0 px-3 pb-3">
          <div className="rounded-xl border border-border bg-background">
            <textarea
              ref={textareaRef}
              value={input}
              aria-label={t('input.aria')}
              onChange={(e) => {
                setInput(e.target.value)
                const el = e.target
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                !prefs?.profileId ? t('input.placeholder.configureProfile') : t('input.placeholder.ask')
              }
              rows={1}
              disabled={!prefs?.profileId}
              className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none min-h-9 max-h-30 rounded-t-xl disabled:opacity-50"
            />
            {explicitAttachments.length > 0 && (
              <div className="flex min-w-0 flex-wrap gap-1.5 border-t border-border/60 px-2.5 py-2">
                {explicitAttachments.map(attachment => (
                  <div
                    key={attachment.id}
                    className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 text-[11px] text-muted-foreground"
                  >
                    <PaperclipIcon className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{attachment.title}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="-mr-1 size-4 rounded-sm text-muted-foreground/70 hover:text-foreground"
                      onClick={() => removeExplicitContextAttachment(attachment.id)}
                      aria-label={t('action.removeContext')}
                    >
                      <XIcon className="size-2.5" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-3 px-2.5 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <Switch
                  id={includeContextSwitchId}
                  size="sm"
                  checked={includeContext}
                  onCheckedChange={setIncludeContext}
                  disabled={!prefs?.profileId}
                />
                <label
                  htmlFor={includeContextSwitchId}
                  className="truncate text-[11px] text-muted-foreground"
                >
                  {t('input.includeContext')}
                </label>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={!prefs?.profileId}
                  onClick={handleAttachSelection}
                  aria-label={t('action.attachSelection')}
                >
                  <PaperclipIcon />
                </Button>
                {sendButton}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Resize handle (top-left corner) — only in popover mode */}
      {!jarvisExpanded && (
        <div
          onPointerDown={handleResizeStart}
          className="absolute top-0 left-0 size-3 cursor-nw-resize z-10"
        />
      )}
    </m.div>
  )
}
