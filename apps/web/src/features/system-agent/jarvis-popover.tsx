import { StaticRender } from '@cradle/streamdown'
import { ArrowUpIcon, MaximizeIcon, MinimizeIcon, MousePointer2Icon, SquareIcon, XIcon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import * as React from 'react'

import { postSessions } from '~/api-gen/sdk.gen'
import { useLayoutGeometry } from '~/components/layout/layout-geometry-context'
import { Button } from '~/components/ui/button'
import { ScrollArea } from '~/components/ui/scroll-area'
import { useChatSession } from '~/features/chat/use-chat-session'
import { cn } from '~/lib/cn'

import { formatContextForAgent } from './format-context'
import { useJarvisUiStore } from './jarvis-ui-store'
import { collectContextSnapshot } from './use-context-snapshot'
import { useJarvisPreferences } from './use-jarvis-preferences'

export function JarvisPopover({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [input, setInput] = React.useState('')
  const [jarvisSessionId, setJarvisSessionId] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [pendingInitialText, setPendingInitialText] = React.useState<string | null>(null)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const jarvisExpanded = useJarvisUiStore(s => s.expanded)
  const setJarvisExpanded = useJarvisUiStore(s => s.setExpanded)
  const { centerColumnRect, footerRect } = useLayoutGeometry()
  const { prefs } = useJarvisPreferences()

  const { messages, status, error, sendMessage, stop } = useChatSession(jarvisSessionId)
  const isStreaming = status === 'streaming'

  // Send the initial message once the session ID becomes available
  React.useEffect(() => {
    if (jarvisSessionId && pendingInitialText) {
      void sendMessage(pendingInitialText)
      setPendingInitialText(null)
    }
  }, [jarvisSessionId, pendingInitialText, sendMessage])

  // Click outside to close (only in popover mode)
  React.useEffect(() => {
    if (!open || jarvisExpanded) {
      return
    }
    function handlePointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open, onOpenChange, jarvisExpanded])

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

  // Collapse when popover closes
  React.useEffect(() => {
    if (!open && jarvisExpanded) {
      setJarvisExpanded(false)
    }
  }, [open, jarvisExpanded, setJarvisExpanded])

  // Auto-scroll on new messages
  const messageCount = messages.length
  React.useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [messageCount])

  // Auto-focus textarea when popover opens
  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [open])

  const [sendError, setSendError] = React.useState<string | null>(null)

  const handleSend = React.useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming || !(prefs?.profileId) || creating) {
      return
    }

    setSendError(null)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    // Collect context and prepend to user message (client-side injection)
    // formatContextForAgent already returns a complete <cradle_context>...</cradle_context> block
    const ctx = collectContextSnapshot()
    const contextBlock = formatContextForAgent(ctx)
    const fullText = contextBlock ? `${contextBlock}\n\n${text}` : text

    // Lazy-create session on first message
    let sessionId = jarvisSessionId
    if (!sessionId) {
      setCreating(true)
      try {
        const res = await postSessions({
          body: {
            title: 'Jarvis',
            agentProfileId: prefs!.profileId!,
            runtimeKind: 'jar-core',
          },
        })
        const session = res.data as { id: string } | null
        if (!session?.id) {
          setSendError(res.error ? String((res.error as { message?: string }).message ?? res.error) : 'Session creation failed')
          return
        }
        sessionId = session.id
        setJarvisSessionId(sessionId)
        setPendingInitialText(fullText)
        return  // useEffect will send once sessionId state propagates
      }
      catch (e) {
        setSendError(e instanceof Error ? e.message : 'Failed to create session')
        return
      }
      finally {
        setCreating(false)
      }
    }

    await sendMessage(fullText)
  }, [input, isStreaming, prefs, creating, jarvisSessionId, sendMessage])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const expandedBounds = React.useMemo(() => {
    if (!centerColumnRect) {
      return { top: 44, left: 268, width: 800, height: 600 }
    }

    return {
      top: centerColumnRect.top + 12,
      left: centerColumnRect.left - 8,
      width: centerColumnRect.width + 16,
      height: centerColumnRect.height + 4,
    }
  }, [centerColumnRect])

  const popoverBounds = React.useMemo(() => {
    if (!footerRect) {
      return { top: 0, left: 0, width: 384, height: 480 }
    }

    return {
      top: footerRect.top - 8 - 480,
      left: footerRect.right - 12 - 384,
      width: 384,
      height: 480,
    }
  }, [footerRect])

  const targetBounds = jarvisExpanded ? expandedBounds : popoverBounds

  return (
    <AnimatePresence>
      {open && (
        <m.div
          ref={panelRef}
          initial={{ opacity: 0, scale: 0.96, ...popoverBounds }}
          animate={{ opacity: 1, scale: 1, ...targetBounds }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ type: 'spring', duration: 0.5, bounce: 0.05 }}
          className={cn(
            'fixed z-50 flex flex-col',
            'rounded-xl bg-popover text-popover-foreground',
            'border border-border',
            'overflow-hidden',
            jarvisExpanded && 'shadow-[0_1px_10px_rgba(0,0,0,0.08)]',
          )}
        >
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
                aria-label={jarvisExpanded ? 'Collapse' : 'Expand'}
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
                aria-label="Close"
              >
                <XIcon />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 min-h-0" viewportRef={viewportRef}>
            {messages.length === 0
              ? (
                <div className="flex flex-col items-center justify-center h-full min-h-72 px-8">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-muted mb-4">
                    <MousePointer2Icon className="size-4.5 text-foreground" />
                  </div>
                  {!(prefs?.profileId)
                    ? (
                      <>
                        <p className="text-[13px] font-medium text-foreground mb-1.5">No profile configured</p>
                        <p className="text-xs text-muted-foreground text-center leading-relaxed">
                          Go to Settings → Jarvis and select a provider profile and model.
                        </p>
                      </>
                    )
                    : (
                      <>
                        <p className="text-[13px] font-medium text-foreground mb-1.5">What can I help with?</p>
                        <p className="text-xs text-muted-foreground text-center leading-relaxed">
                          I have full awareness of your workspace — active tabs, chat sessions, and current layout.
                        </p>
                        {sendError && (
                          <p className="text-xs text-destructive/80 text-center mt-3">{sendError}</p>
                        )}
                      </>
                    )}
                </div>
              )
              : (
                <div className="flex flex-col gap-5 px-4 py-3">
                  {messages.map(msg => (
                    <div key={msg.id}>
                      {msg.role === 'user' && (
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-lg rounded-br-sm bg-muted px-3 py-2 text-sm text-foreground whitespace-pre-wrap">
                            {extractUserText(msg)}
                          </div>
                        </div>
                      )}
                      {msg.role === 'assistant' && (
                        <div className="text-sm text-foreground prose prose-sm dark:prose-invert max-w-none">
                          <StaticRender content={extractAssistantText(msg)} />
                        </div>
                      )}
                    </div>
                  ))}
                  {isStreaming && (
                    <div className="flex items-center gap-1.5 py-1">
                      <span className="size-1.5 rounded-full bg-foreground/20 animate-pulse" />
                      <span className="size-1.5 rounded-full bg-foreground/20 animate-pulse [animation-delay:150ms]" />
                      <span className="size-1.5 rounded-full bg-foreground/20 animate-pulse [animation-delay:300ms]" />
                    </div>
                  )}
                  {error && (
                    <div className="text-xs text-destructive/80 px-1 py-1">
                      {error}
                    </div>
                  )}
                  {sendError && (
                    <div className="text-xs text-destructive/80 px-1 py-1">
                      {sendError}
                    </div>
                  )}
                </div>
              )}
          </ScrollArea>

          {/* Input */}
          <div className="shrink-0 px-3 pb-3">
            <div className="rounded-xl border border-border bg-background">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  const el = e.target
                  el.style.height = 'auto'
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
                }}
                onKeyDown={handleKeyDown}
                placeholder={!(prefs?.profileId) ? 'Configure a profile in Settings → Jarvis' : 'Ask Jarvis...'}
                rows={1}
                disabled={!(prefs?.profileId)}
                className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none min-h-9 max-h-30 rounded-t-xl disabled:opacity-50"
              />
              <div className="flex items-center justify-end px-2.5 pb-2">
                {isStreaming
                  ? (
                    <Button variant="outline" size="icon-xs" onClick={stop} aria-label="Stop">
                      <SquareIcon />
                    </Button>
                  )
                  : (
                    <Button
                      variant="default"
                      size="icon-xs"
                      disabled={!input.trim() || creating || !(prefs?.profileId)}
                      onClick={() => void handleSend()}
                      aria-label="Send"
                    >
                      <ArrowUpIcon />
                    </Button>
                  )}
              </div>
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}

const CONTEXT_RE = /<cradle_context>[\s\S]*?<\/cradle_context>\s*/

function extractUserText(msg: { parts?: Array<{ type: string, text?: string }> }): string {
  const text = msg.parts
    ?.filter(p => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text!)
    .join('\n') ?? ''
  return text.replace(CONTEXT_RE, '')
}

function extractAssistantText(msg: { parts?: Array<{ type: string, text?: string }> }): string {
  return msg.parts
    ?.filter(p => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text!)
    .join('\n') ?? ''
}
