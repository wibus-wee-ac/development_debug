// Input: sessionId prop, ChatView, RightAside, ShellView, ipc, theme
// Output: TearOffApp — independent shell for tear-off chat windows
// Position: Root component for tear-off BrowserWindows; no sidebar, no tabs, independent layout

import './styles.css'

import { ResizeHandle } from '@renderer/components/layout/resize-handle'
import { RightAside } from '@renderer/components/layout/right-aside'
import { Button } from '@renderer/components/ui/button'
import { AnchoredToastProvider, ToastProvider } from '@renderer/components/ui/toast'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { ChatView } from '@renderer/features/chat/chat-view'
import { ShellView } from '@renderer/features/tui/shell-view'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import { ShortcutProvider } from '@renderer/lib/shortcut-provider'
import { useThemeStore } from '@renderer/store/theme'
import { useQuery } from '@tanstack/react-query'
import { PanelBottomIcon, PanelRightIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { Suspense, useEffect, useMemo, useState } from 'react'

const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }
const SPRING = { type: 'spring', stiffness: 600, damping: 40 } as const

function TearOffLayout({ sessionId }: { sessionId: string }) {
  const [asideWidth, setAsideWidth] = useState(280)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200)
  const [asideOpen, setAsideOpen] = useState(false)
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false)
  const [shellGen, setShellGen] = useState(0)

  // Register panel keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+` → toggle bottom panel
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === '`') {
        e.preventDefault()
        setBottomPanelOpen(o => !o)
        return
      }
      // Cmd+Option+B → toggle right aside
      if (e.metaKey && e.altKey && !e.ctrlKey && (e.key === 'b' || e.key === 'B' || e.key === '∫')) {
        e.preventDefault()
        setAsideOpen(o => !o)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const { data: session } = useQuery({
    queryKey: ['chat-session', sessionId],
    queryFn: () => ipc?.session.get(sessionId),
    enabled: !!sessionId,
  })

  const workspaceId = session?.workspaceId ?? null

  // Fetch workspace details — derive path from query data (not side-effects)
  const { data: workspace } = useQuery({
    queryKey: ['workspace-detail', workspaceId],
    queryFn: () => ipc?.workspace.get(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 60_000,
  })

  const workspacePath = workspace?.path ?? null

  const hasWorkspace = !!(workspaceId && workspacePath)

  const aside = useMemo(
    () => (
      <RightAside
        workspaceId={workspaceId}
        workspacePath={workspacePath}
        sessionId={sessionId}
      />
    ),
    [workspaceId, workspacePath, sessionId],
  )

  const panel = useMemo(
    () => hasWorkspace
      ? (
        <ShellView
          key={`${sessionId}:${shellGen}`}
          ptyId={`shell:${sessionId}:${shellGen}`}
          cwd={workspacePath!}
          onExited={() => setShellGen(g => g + 1)}
        />
      )
      : null,
    [hasWorkspace, workspacePath, sessionId, shellGen],
  )

  return (
    <div className="flex flex-1 flex-col overflow-hidden text-foreground">
      {/* Title header */}
      <div
        className="relative flex h-10 shrink-0 items-center bg-sidebar pe-1 pl-4 mt-1 mb-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-xs font-medium text-foreground truncate pl-14">
          {session?.title ?? 'Chat'}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {hasWorkspace && (
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn('text-muted-foreground', bottomPanelOpen && 'text-foreground')}
              onClick={() => setBottomPanelOpen(o => !o)}
              title="切换底部面板"
            >
              <PanelBottomIcon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', asideOpen && 'text-foreground')}
            onClick={() => setAsideOpen(o => !o)}
            title="切换右侧面板"
          >
            <PanelRightIcon />
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <motion.div
          className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background rounded-xl shadow-sm z-10 m-1 mr-2"
          transition={SPRING}
        >
          <main className="flex-1 bg-background overflow-hidden rounded-xl">
            <Suspense fallback={null}>
              <ChatView sessionId={sessionId} />
            </Suspense>
          </main>

          {bottomPanelOpen && panel && (
            <>
              <ResizeHandle
                direction="vertical"
                value={bottomPanelHeight}
                onChange={setBottomPanelHeight}
                min={PANEL.min}
                max={PANEL.max}
              />
              <div style={{ height: bottomPanelHeight }} className="shrink-0 overflow-hidden">
                {panel}
              </div>
            </>
          )}
        </motion.div>

        {/* Right aside */}
        <motion.aside
          animate={{ width: asideOpen ? asideWidth : 0 }}
          transition={SPRING}
          className="shrink-0 overflow-hidden"
        >
          {asideOpen && (
            <>
              <ResizeHandle
                direction="horizontal"
                value={asideWidth}
                onChange={setAsideWidth}
                min={ASIDE.min}
                max={ASIDE.max}
              />
              <div
                className="flex flex-col flex-1 overflow-hidden h-full"
                style={{ width: asideWidth }}
              >
                {aside}
              </div>
            </>
          )}
        </motion.aside>
      </div>
    </div>
  )
}

export function TearOffApp({ sessionId }: { sessionId: string }) {
  const mode = useThemeStore(s => s.mode)

  useEffect(() => {
    const applyDark = (dark: boolean): void => {
      document.documentElement.classList.toggle('dark', dark)
    }
    if (mode !== 'system') {
      applyDark(mode === 'dark')
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    applyDark(mq.matches)
    const listener = (e: MediaQueryListEvent): void => applyDark(e.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [mode])

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <TooltipProvider>
          <ShortcutProvider>
            <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
              <TearOffLayout sessionId={sessionId} />
            </div>
          </ShortcutProvider>
        </TooltipProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  )
}
