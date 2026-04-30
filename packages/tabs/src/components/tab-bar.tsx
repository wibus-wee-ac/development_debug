// Input: useTabsContext, TabInstance, React, dnd-kit, internal cn
// Output: TabBar — capsule-shaped tab pills with drag-to-reorder
// Position: Header component rendering tab pills with close/new-tab buttons

import type { DragEndEvent } from '@dnd-kit/core'
import { closestCenter, DndContext, MouseSensor, useSensor, useSensors } from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useCallback, useRef } from 'react'

import { cn } from '../cn'
import { useTabsContext } from '../context'
import type { TabInstance } from '../store'

export interface TabBarProps {
  /** CSS class for the outer container */
  className?: string
  /** CSS class applied to each tab pill */
  tabClassName?: string
  /** CSS class applied to the active tab pill */
  activeTabClassName?: string
  /** Render prop for the close button icon (default: ×) */
  renderCloseIcon?: () => React.ReactNode
  /** Render prop for the new tab button icon (default: +) */
  renderNewTabIcon?: () => React.ReactNode
  /**
   * Render prop for per-tab icon shown to the left of the label.
   * Receives the full TabInstance so the consumer can look up the registry.
   * Return null to show no icon for a specific tab.
   */
  renderTabIcon?: (tab: TabInstance) => React.ReactNode
  /** Render prop to wrap each tab with a tooltip. Receives the tab and children (the tab pill button). */
  renderTooltip?: (tab: TabInstance, children: React.ReactElement) => React.ReactNode
  /** Called when a new tab is requested. Consumer decides what tab to open. */
  onNewTab?: () => void
  /** Called after a tab is activated */
  onTabActivated?: (tab: TabInstance) => void
  /** Called after a tab is closed */
  onTabClosed?: (tabId: string) => void
  /** Called when a tab is dragged outside the window bounds. Receives the tab and screen coordinates. */
  onTabTearOff?: (tab: TabInstance, screenX: number, screenY: number) => void
}

interface TabPillProps {
  tab: TabInstance
  isActive: boolean
  tabClassName?: string
  activeTabClassName?: string
  renderCloseIcon?: () => React.ReactNode
  renderTabIcon?: (tab: TabInstance) => React.ReactNode
  renderTooltip?: (tab: TabInstance, children: React.ReactElement) => React.ReactNode
  onActivate: (id: string) => void
  onClose: (e: React.MouseEvent, id: string) => void
}

const SortableTabPill = memo(({ tab, isActive, tabClassName, activeTabClassName, renderCloseIcon, renderTabIcon, renderTooltip, onActivate, onClose }: TabPillProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
  }

  const pill = (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onActivate(tab.id)}
      title={renderTooltip ? undefined : tab.label}
      data-testid={`tab-pill-${tab.id}`}
      data-tab-active={isActive ? 'true' : 'false'}
      data-tab-pinned={tab.pinned ? 'true' : 'false'}
      className={cn(
        'group relative flex items-center justify-start gap-1.5 px-3.5 h-7 text-[11px] font-medium',
        'flex-1 rounded-md transition-all duration-100 min-w-8 max-w-44 cursor-default overflow-hidden',
        isActive
          ? cn(
            'bg-background text-foreground',
            'inset-shadow-sm inset-shadow-white/10',
            activeTabClassName,
          )
          : cn('text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-foreground/3', tabClassName),
      )}
    >
      {renderTabIcon && (
        <span className="shrink-0 flex items-center">
          {renderTabIcon(tab)}
        </span>
      )}
      <span className="truncate select-none">{tab.label}</span>
      {!tab.pinned && (
        <span
          role="button"
          tabIndex={-1}
          onClick={e => onClose(e, tab.id)}
          data-testid={`tab-close-${tab.id}`}
          className={cn(
            'inline-flex items-center justify-center rounded-full size-3.5 shrink-0',
            isActive
              ? 'opacity-0 group-hover:opacity-60 hover:opacity-100!'
              : 'opacity-0 group-hover:opacity-60 hover:opacity-100!',
            'transition-opacity hover:bg-foreground/10',
          )}
        >
          {renderCloseIcon ? renderCloseIcon() : '×'}
        </span>
      )}
    </button>
  )

  return renderTooltip ? renderTooltip(tab, pill) as React.ReactElement : pill
})

export const TabBar = memo(({ className, tabClassName, activeTabClassName, renderCloseIcon, renderNewTabIcon, renderTabIcon, renderTooltip, onNewTab, onTabActivated, onTabClosed, onTabTearOff }: TabBarProps) => {
  'use no memo'
  const { store } = useTabsContext()
  const tabs = store(s => s.tabs)
  const activeTabId = store(s => s.activeTabId)
  const pointerRef = useRef<{ screenX: number, screenY: number }>({ screenX: 0, screenY: 0 })
  const draggingRef = useRef(false)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleActivate = useCallback((id: string) => {
    store.getState().setActiveTab(id)
    const tab = store.getState().tabs.find(t => t.id === id)
    if (tab) {
      onTabActivated?.(tab)
    }
  }, [store, onTabActivated])

  const handleClose = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    store.getState().closeTab(id)
    onTabClosed?.(id)
  }, [store, onTabClosed])

  const handleDragStart = useCallback(() => {
    draggingRef.current = true
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { screenX: e.screenX, screenY: e.screenY }
    }
    window.addEventListener('pointermove', onMove, true)
      ; (draggingRef as unknown as { _cleanup: () => void })._cleanup = () => {
        window.removeEventListener('pointermove', onMove, true)
      }
  }, [])

  const checkTearOff = useCallback((activeId: string | number) => {
    ; (draggingRef as unknown as { _cleanup?: () => void })._cleanup?.()
    draggingRef.current = false

    if (!onTabTearOff) {
      return false
    }
    const { screenX, screenY } = pointerRef.current
    const outside = (
      screenX < window.screenX
      || screenX > window.screenX + window.outerWidth
      || screenY < window.screenY
      || screenY > window.screenY + window.outerHeight
    )
    if (outside) {
      const tab = store.getState().tabs.find(t => t.id === activeId)
      if (tab && !tab.pinned) {
        onTabTearOff(tab, screenX, screenY)
        return true
      }
    }
    return false
  }, [store, onTabTearOff])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (checkTearOff(active.id)) {
      return
    }

    if (!over || active.id === over.id) {
      return
    }
    const currentTabs = store.getState().tabs
    const oldIndex = currentTabs.findIndex(t => t.id === active.id)
    const newIndex = currentTabs.findIndex(t => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) {
      return
    }
    const reordered = [...currentTabs]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    store.getState().reorderTabs(reordered.map(t => t.id))
  }, [store, checkTearOff])

  const handleDragCancel = useCallback((event: { active: { id: string | number } }) => {
    checkTearOff(event.active.id)
  }, [checkTearOff])

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div
        className={cn(
          'flex items-center gap-0.5 overflow-hidden px-0.5',
          className,
        )}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        data-testid="tab-bar"
      >
        <SortableContext items={tabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
          {tabs.map(tab => (
            <SortableTabPill
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              tabClassName={tabClassName}
              activeTabClassName={activeTabClassName}
              renderCloseIcon={renderCloseIcon}
              renderTabIcon={renderTabIcon}
              renderTooltip={renderTooltip}
              onActivate={handleActivate}
              onClose={handleClose}
            />
          ))}
        </SortableContext>

        {onNewTab && (
          <button
            onClick={onNewTab}
            data-testid="tab-new-btn"
            className={cn(
              'flex shrink-0 items-center justify-center rounded-md size-5',
              'text-muted-foreground/30 hover:text-foreground/60 hover:bg-foreground/4 transition-colors',
            )}
          >
            {renderNewTabIcon ? renderNewTabIcon() : '+'}
          </button>
        )}
      </div>
    </DndContext>
  )
})
