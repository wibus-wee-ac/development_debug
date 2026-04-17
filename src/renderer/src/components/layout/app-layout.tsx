// Input: ResizeHandle, layout store, sidebar-nav store, motion/react, page slot props
// Output: AppLayout component — the main three-column layout shell
// Position: Core layout component, receives aside/panel content as children props

import { ResizeHandle } from '@renderer/components/layout/resize-handle'
import { SettingsContent, SettingsSidebar } from '@renderer/features/settings'
import { WorkspaceSidebar } from '@renderer/features/workspace'
import { useShortcut } from '@renderer/hooks/use-shortcut'
import { useLayoutStore } from '@renderer/store/layout'
import { useSidebarNavStore } from '@renderer/store/sidebar-nav'
import { SettingsIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'

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
  aside?: ReactNode
  panel?: ReactNode
}

export function AppLayout({ children, aside, panel }: AppLayoutProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const sidebarView = useSidebarNavStore(s => s.view)
  const navigateTo = useSidebarNavStore(s => s.navigateTo)
  const back = useSidebarNavStore(s => s.back)

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
    toggleAside,
    toggleBottomPanel,
  } = useLayoutStore()

  const isMain = sidebarView === 'main'

  return (
    <div className="flex h-screen w-screen overflow-hidden text-foreground">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground overflow-hidden"
        style={{ width: sidebarWidth }}
      >
        <div
          className="h-10 shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />

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

                  <div className="shrink-0 border-t border-sidebar-border px-2 py-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => navigateTo('settings')}
                      data-testid="settings-btn"
                      className="flex items-center justify-center rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <SettingsIcon className="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={toggleBottomPanel}
                      className="flex-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      Panel
                    </button>
                    <button
                      type="button"
                      onClick={toggleAside}
                      className="flex-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      Aside
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
        <main className="flex-1 bg-background overflow-hidden">
          {isMain ? children : <SettingsContent />}
        </main>

        {/* Bottom panel — frozen (not unmounted) when in sub-pages */}
        <div style={{ display: isMain ? undefined : 'none' }}>
          {bottomPanelOpen && (
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
            {bottomPanelOpen && (
              <motion.div
                key="bottom-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: bottomPanelHeight, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={dragging === 'panel' ? INSTANT : SPRING}
                className="bg-background border-t border-border overflow-hidden shrink-0"
              >
                <div style={{ height: bottomPanelHeight }}>
                  {panel ?? (
                    <p className="px-3 py-2 text-xs text-muted-foreground select-none">Bottom Panel</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Right Aside — frozen when in sub-pages ── */}
      <div className="flex" style={{ display: isMain ? 'flex' : 'none' }}>
        <AnimatePresence initial={false}>
          {asideOpen && (
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
                  {aside ?? (
                    <p className="px-3 py-2 text-xs text-muted-foreground select-none">Aside</p>
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
