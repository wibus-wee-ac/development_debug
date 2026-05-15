import * as React from 'react'
import { AnimatePresence, m } from 'motion/react'
import { ArrowUpIcon, MaximizeIcon, MinimizeIcon, MousePointer2Icon, SquareIcon, XIcon } from 'lucide-react'
import { StaticRender } from '@cradle/streamdown'

import { postSessions } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { ScrollArea } from '~/components/ui/scroll-area'
import { useChatSession } from '~/features/chat/use-chat-session'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import { useLayoutStore } from '~/store/layout'
import { useNewChatStore } from '~/store/new-chat'

import { formatContextForAgent } from './format-context'
import { collectContextSnapshot } from './use-context-snapshot'

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
  const pendingTextRef = React.useRef<string | null>(null)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const jarvisExpanded = useLayoutStore(s => s.jarvisExpanded)
  const setJarvisExpanded = useLayoutStore(s => s.setJarvisExpanded)

  const { workspaces } = useWorkspaces()
  const { profiles } = useAgentProfiles()
  const lastAgentProfileId = useNewChatStore(s => s.lastAgentProfileId)

  const workspaceId = workspaces[0]?.id ?? null
  const profileId = lastAgentProfileId && profiles.some(p => p.id === lastAgentProfileId)
    ? lastAgentProfileId
    : profiles[0]?.id ?? null

  const { messages, status, sendMessage, stop } = useChatSession(jarvisSessionId)
  const isStreaming = status === 'streaming'

  // When session is created and there's a pending message, send it
  React.useEffect(() => {
    if (jarvisSessionId && pendingTextRef.current) {
      const text = pendingTextRef.current
      pendingTextRef.current = null
      sendMessage(text)
    }
  }, [jarvisSessionId, sendMessage])

  // Click outside to close (only in popover mode)
  React.useEffect(() => {
    if (!open || jarvisExpanded) return
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
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (jarvisExpanded) {
          setJarvisExpanded(false)
        } else {
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

  const handleSend = React.useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming || creating) return
    if (!workspaceId || !profileId) return

    const snapshot = collectContextSnapshot()
    const contextBlock = formatContextForAgent(snapshot)
    const enrichedText = `${contextBlock}\n\n${text}`

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    if (jarvisSessionId) {
      sendMessage(enrichedText)
    } else {
      setCreating(true)
      pendingTextRef.current = enrichedText
      try {
        const { data } = await postSessions({
          body: { workspaceId, title: 'Jarvis', agentProfileId: profileId },
        })
        const session = data as { id: string } | null
        if (session?.id) {
          setJarvisSessionId(session.id)
        }
      } finally {
        setCreating(false)
      }
    }
  }, [input, isStreaming, creating, workspaceId, profileId, jarvisSessionId, sendMessage])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  // Measure the center column bounds for expanded positioning
  const [expandedBounds, setExpandedBounds] = React.useState({ top: 44, left: 268, width: 800, height: 600 })
  const [popoverBounds, setPopoverBounds] = React.useState({ top: 0, left: 0, width: 384, height: 480 })

  React.useEffect(() => {
    if (!open) return
    function measure() {
      const centerEl = document.querySelector('[data-slot="app-center-column"]') as HTMLElement | null
      if (centerEl) {
        const r = centerEl.getBoundingClientRect()
        // Jarvis slightly wider than center column + tighter top for depth gap
        setExpandedBounds({ top: r.top + 12, left: r.left - 8, width: r.width + 16, height: r.height + 4 })
      }
      // Popover position: above the footer, right-aligned
      const footerEl = document.querySelector('footer') as HTMLElement | null
      if (footerEl) {
        const fr = footerEl.getBoundingClientRect()
        setPopoverBounds({
          top: fr.top - 8 - 480,
          left: fr.right - 12 - 384,
          width: 384,
          height: 480,
        })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

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
          {/* Title bar — inline, no border */}
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
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-72 px-8">
                <div className="flex size-10 items-center justify-center rounded-xl bg-muted mb-4">
                  <MousePointer2Icon className="size-4.5 text-foreground" />
                </div>
                <p className="text-[13px] font-medium text-foreground mb-1.5">What can I help with?</p>
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  I have full awareness of your workspace — active tabs, chat sessions, and current layout.
                </p>
              </div>
            ) : (
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
              </div>
            )}
          </ScrollArea>

          {/* Input card — no shadow, border only */}
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
                placeholder="Ask Jarvis..."
                rows={1}
                className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none min-h-9 max-h-30 rounded-t-xl"
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
                      disabled={!input.trim() || creating}
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

/** Extract visible user text, stripping the <cradle_context> block */
function extractUserText(msg: { parts?: Array<{ type: string, text?: string }> }): string {
  const text = msg.parts?.find(p => p.type === 'text')?.text ?? ''
  return text.replace(/<cradle_context>[\s\S]*?<\/cradle_context>\s*/, '')
}

function extractAssistantText(msg: { parts?: Array<{ type: string, text?: string }> }): string {
  return msg.parts?.find(p => p.type === 'text')?.text ?? ''
}
