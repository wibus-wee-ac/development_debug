// Input: ResizeHandle, layout store, sidebar-nav store, motion/react, page slot props, DevBottomBar
// Output: AppLayout component — the main three-column layout shell
// Position: Core layout component, receives aside/panel content as children props

import { DevBottomBar } from '@renderer/components/layout/dev-bottom-bar'
import { ResizeHandle } from '@renderer/components/layout/resize-handle'
import { SettingsContent, SettingsSidebar } from '@renderer/features/settings'
import { WorkspaceSidebar } from '@renderer/features/workspace'
import { useShortcut } from '@renderer/hooks/use-shortcut'
import { useLayoutStore } from '@renderer/store/layout'
import { useSessionActivityStore } from '@renderer/store/session-activity'
import { useSidebarNavStore } from '@renderer/store/sidebar-nav'
import { useMatchRoute } from '@tanstack/react-router'
import { SettingsIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'

const SIDEBAR = { min: 160, max: 480 }
const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }

const SPRING = { type: 'spring', stiffness: 600, damping: 40 } as const
const INSTANT = { duration: 0 } as const

const DRILL_TRANSITION = {
  type: 'spring',
  stiffness: 500,
  damping: 35,
  mass: 0.8,
} as const

interface AppLayoutProps {
  children?: ReactNode
  header?: ReactNode
  aside?: ReactNode
  panel?: ReactNode
}

export function AppLayout({ children, header, aside, panel }: AppLayoutProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const sidebarView = useSidebarNavStore(s => s.view)
  const navigateTo = useSidebarNavStore(s => s.navigateTo)
  const back = useSidebarNavStore(s => s.back)
  const markUnread = useSessionActivityStore(s => s.markUnread)
  const matchRoute = useMatchRoute()

  // Global listener: mark sessions with finished responses as unread
  // when they are not the currently active session
  useEffect(() => {
    const off = window.electron.ipcRenderer.on(
      'chat:response-event',
      (_: unknown, data: { chatSessionId: string, event: { type: string } }) => {
        if (
          data.event.type !== 'response.completed'
          && data.event.type !== 'response.failed'
        ) {
          return
        }
        const isActive = !!matchRoute({
          to: '/chat/$sessionId',
          params: { sessionId: data.chatSessionId },
        })
        if (!isActive) {
          markUnread(data.chatSessionId)
        }
      },
    )
    return () => { off() }
  }, [markUnread, matchRoute])

  const toggleSettings = useCallback(() => {
    if (sidebarView === 'settings') {
      back()
    }
    else {
      navigateTo('settings')
    }
  }, [sidebarView, navigateTo, back])

  useShortcut('toggle-settings', { meta: true, key: ',' }, toggleSettings)
  useShortcut('exit-settings', { key: 'Escape' }, back, sidebarView !== 'main')

  const {
    sidebarWidth,
    setSidebarWidth,
    asideWidth,
    setAsideWidth,
    asideOpen,
    bottomPanelHeight,
    setBottomPanelHeight,
    bottomPanelOpen,
  } = useLayoutStore()

  const isMain = sidebarView === 'main'

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden text-foreground">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Sidebar ─────────────────────────────────── */}
        <aside
          className="flex flex-col shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <div className="h-11 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

          <div
            className="relative flex flex-col flex-1 overflow-hidden"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {isMain
                ? (
                  <motion.div
                    key="main-nav"
                    className="flex flex-1 flex-col overflow-hidden"
                    initial={{ x: -20, opacity: 0, filter: 'blur(4px)' }}
                    animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
                    exit={{ x: -20, opacity: 0, filter: 'blur(4px)' }}
                    transition={DRILL_TRANSITION}
                  >
                    <WorkspaceSidebar />

                    <div className="shrink-0 border-t border-sidebar-border px-3 py-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => navigateTo('settings')}
                        data-testid="settings-btn"
                        className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-sidebar-foreground/70 hover:bg-accent/50 hover:text-sidebar-foreground transition-colors"
                      >
                        <SettingsIcon className="size-4" aria-hidden="true" />
                        <span>设置</span>
                      </button>
                    </div>
                  </motion.div>
                )
                : (
                  <motion.div
                    key="settings-nav"
                    className="flex flex-1 flex-col overflow-hidden"
                    initial={{ x: 20, opacity: 0, filter: 'blur(4px)' }}
                    animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
                    exit={{ x: 20, opacity: 0, filter: 'blur(4px)' }}
                    transition={DRILL_TRANSITION}
                  >
                    <SettingsSidebar />
                  </motion.div>
                )}
            </AnimatePresence>
          </div>
        </aside>

        <ResizeHandle
          direction="horizontal"
          value={sidebarWidth}
          onChange={setSidebarWidth}
          onDragStart={() => setDragging('sidebar')}
          onDragEnd={() => setDragging(null)}
          min={SIDEBAR.min}
          max={SIDEBAR.max}
          className="bg-background"
        />

        {/* ── Center column ────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <div style={{ display: isMain ? undefined : 'none' }}>
            {header}
          </div>
          <main className="flex-1 bg-background overflow-hidden">
            {isMain ? children : <SettingsContent />}
          </main>

          {/* Bottom panel — only renders if content is provided AND panel is open */}
          <div style={{ display: isMain ? undefined : 'none' }}>
            {bottomPanelOpen && panel !== undefined && (
              <ResizeHandle
                direction="vertical"
                value={bottomPanelHeight}
                onChange={setBottomPanelHeight}
                onDragStart={() => setDragging('panel')}
                onDragEnd={() => setDragging(null)}
                min={PANEL.min}
                max={PANEL.max}
                inverted
                className="bg-background"
              />
            )}
            <AnimatePresence initial={false}>
              {bottomPanelOpen && panel !== undefined && (
                <motion.div
                  key="bottom-panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: bottomPanelHeight, opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={dragging === 'panel' ? INSTANT : SPRING}
                  className="bg-background border-t border-border overflow-hidden shrink-0"
                >
                  <div style={{ height: bottomPanelHeight }}>{panel}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Right Aside — only renders if content is provided AND aside is open ── */}
        <div className="flex" style={{ display: isMain ? 'flex' : 'none' }}>
          <AnimatePresence initial={false}>
            {asideOpen && aside !== undefined && (
              <>
                <ResizeHandle
                  direction="horizontal"
                  value={asideWidth}
                  onChange={setAsideWidth}
                  onDragStart={() => setDragging('aside')}
                  onDragEnd={() => setDragging(null)}
                  min={ASIDE.min}
                  max={ASIDE.max}
                  inverted
                  className="bg-background"
                />
                <motion.aside
                  key="aside"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: asideWidth, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={dragging === 'aside' ? INSTANT : SPRING}
                  className="flex shrink-0 overflow-hidden border-l border-border bg-background"
                >
                  <div className="flex flex-col flex-1 overflow-hidden" style={{ width: asideWidth }}>
                    {aside}
                  </div>
                </motion.aside>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
      {import.meta.env.DEV && <DevBottomBar />}
    </div>
  )
}
