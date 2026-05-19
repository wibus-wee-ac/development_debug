// Input: Button, cn utility, JarvisPopover, JarvisUiStore
// Output: AppFooter — slim global status footer bar mirroring the AppHeader chrome pattern
// Position: Bottom chrome of AppLayout's center column; always rendered, no slot props

import { MousePointer2Icon, XIcon } from 'lucide-react'
import * as React from 'react'

import { useLayoutGeometry } from '~/components/layout/layout-geometry-context'
import { JarvisPopover } from '~/features/system-agent/jarvis-popover'
import { useJarvisUiStore } from '~/features/system-agent/jarvis-ui-store'
import { useShortcut } from '~/hooks/use-shortcut'
import { cn } from '~/lib/cn'

export function AppFooter({ className }: { className?: string }) {
  const [jarvisOpen, setJarvisOpen] = React.useState(false)
  const { registerFooter } = useLayoutGeometry()
  const activeTabRef = React.useRef<HTMLButtonElement>(null)
  const [popoverAnchorX, setPopoverAnchorX] = React.useState<number | null>(null)

  const sessions = useJarvisUiStore(s => s.sessions)
  const activeSessionId = useJarvisUiStore(s => s.activeSessionId)
  const setActiveSessionId = useJarvisUiStore(s => s.setActiveSessionId)
  const removeSession = useJarvisUiStore(s => s.removeSession)

  useShortcut('toggle-jarvis', { meta: true, key: 'j' }, () => setJarvisOpen(prev => !prev))

  // Update popover anchor position when active tab changes
  React.useEffect(() => {
    if (activeTabRef.current) {
      const rect = activeTabRef.current.getBoundingClientRect()
      setPopoverAnchorX(rect.left + rect.width / 2)
    }
  }, [activeSessionId, sessions.length])

  // "Ask Jarvis" is the active tab when no session is selected
  const isNewSessionActive = !activeSessionId

  return (
    <footer
      ref={registerFooter}
      className={cn(
        'relative flex h-9 shrink-0 items-center bg-sidebar px-1',
        className,
      )}
    >
      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Tabs (right-aligned, badge style) */}
      <div className="flex items-center gap-1 px-1 h-full shrink-0">
        {sessions.map(sess => (
          <div
            key={sess.id}
            className={cn(
              'group relative flex max-w-28 items-center rounded-full text-[11px] transition-colors shrink-0',
              sess.id === activeSessionId && jarvisOpen
                ? 'bg-foreground/10 text-foreground'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
            )}
          >
            <button
              ref={sess.id === activeSessionId ? activeTabRef : undefined}
              type="button"
              onClick={() => {
                setActiveSessionId(sess.id)
                setJarvisOpen(true)
              }}
              className="min-w-0 flex-1 rounded-l-full py-0.5 pl-2.5 pr-1 text-left"
            >
              <span className="block truncate">{sess.title || 'Untitled'}</span>
            </button>
            <button
              type="button"
              onClick={() => removeSession(sess.id)}
              aria-label={`Close Jarvis session ${sess.title || 'Untitled'}`}
              className="flex size-5 shrink-0 items-center justify-center rounded-r-full opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
            >
              <XIcon className="size-2.5" aria-hidden="true" />
            </button>
          </div>
        ))}

        {/* Ask Jarvis — pinned tab for new session */}
        <button
          ref={isNewSessionActive ? activeTabRef : undefined}
          type="button"
          onClick={() => {
            setActiveSessionId(null)
            setJarvisOpen(true)
          }}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] transition-colors shrink-0',
            isNewSessionActive && jarvisOpen
              ? 'bg-foreground/10 text-foreground'
              : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
          )}
        >
          <MousePointer2Icon className="size-3" aria-hidden="true" />
          <span>Ask Jarvis</span>
        </button>
      </div>

      <JarvisPopover open={jarvisOpen} onOpenChange={setJarvisOpen} anchorX={popoverAnchorX} />
    </footer>
  )
}
