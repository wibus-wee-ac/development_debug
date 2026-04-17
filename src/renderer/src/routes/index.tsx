import { ResizeHandle } from '@renderer/components/layout/resize-handle'
import { WorkspaceSidebar } from '@renderer/features/workspace'
import { useLayoutStore } from '@renderer/store/layout'
import { createFileRoute } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

export const Route = createFileRoute('/')({ component: App })

const SIDEBAR = { min: 160, max: 480 }
const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }

const SPRING = { type: 'spring', stiffness: 600, damping: 40 } as const
const INSTANT = { duration: 0 } as const

function App() {
  const [dragging, setDragging] = useState<string | null>(null)
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

  return (
    <div className="flex h-screen w-screen overflow-hidden text-foreground">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0 border-r border-sidebar-border text-sidebar-foreground"
        style={{ width: sidebarWidth, background: 'transparent' }}
      >
        {/* macOS traffic-light drag region */}
        <div
          className="h-10 shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />

        <div
          className="flex flex-col flex-1 overflow-hidden"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Scrollable nav area */}
          <WorkspaceSidebar />

          {/* Bottom controls */}
          <div className="shrink-0 border-t border-sidebar-border px-2 py-2 flex items-center gap-1.5">
            <button
              onClick={toggleBottomPanel}
              className="flex-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Panel
            </button>
            <button
              onClick={toggleAside}
              className="flex-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Aside
            </button>
          </div>
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
        {/* Main content */}
        <main className="flex-1 bg-background overflow-hidden" />

        {/* Bottom panel */}
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
              <p className="px-3 py-2 text-xs text-muted-foreground select-none">Bottom Panel</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Right Aside ──────────────────────────────── */}
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
              className="flex flex-col bg-background border-l border-border overflow-hidden shrink-0"
            >
              <p className="px-3 py-2 text-xs text-muted-foreground select-none">Aside</p>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
