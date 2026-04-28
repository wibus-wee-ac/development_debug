// Input: useTabsContext, TabInstance, React, dnd-kit
// Output: TabBar — capsule-shaped tab pills with drag-to-reorder
// Position: Header component rendering tab pills with close/new-tab buttons

import type { DragEndEvent } from '@dnd-kit/core'
import { closestCenter, DndContext, MouseSensor, useSensor, useSensors } from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useCallback } from 'react'

import { useTabsContext } from '../context'
import type { TabInstance } from '../store'

export interface TabBarProps {
  /** Utility for merging class names (e.g. `cn` from the consuming app) */
  cn?: (...inputs: (string | boolean | undefined | null | Record<string, boolean>)[]) => string
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
  /** Called when a new tab is requested. Consumer decides what tab to open. */
  onNewTab?: () => void
  /** Called after a tab is activated */
  onTabActivated?: (tab: TabInstance) => void
  /** Called after a tab is closed */
  onTabClosed?: (tabId: string) => void
}

function defaultCn(...inputs: (string | boolean | undefined | null | Record<string, boolean>)[]): string {
  return inputs
    .flatMap((input) => {
      if (!input) {
        return []
      }
      if (typeof input === 'string') {
        return [input]
      }
      if (typeof input === 'object') {
        return Object.entries(input)
          .filter(([, v]) => v)
          .map(([k]) => k)
      }
      return []
    })
    .join(' ')
}

interface TabPillProps {
  tab: TabInstance
  isActive: boolean
  cn?: TabBarProps['cn']
  tabClassName?: string
  activeTabClassName?: string
  renderCloseIcon?: () => React.ReactNode
  onActivate: (id: string) => void
  onClose: (e: React.MouseEvent, id: string) => void
}

const SortableTabPill = memo(({ tab, isActive, cn: mergeCn = defaultCn, tabClassName, activeTabClassName, renderCloseIcon, onActivate, onClose }: TabPillProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onActivate(tab.id)}
      data-testid={`tab-pill-${tab.id}`}
      data-tab-active={isActive ? 'true' : 'false'}
      data-tab-pinned={tab.pinned ? 'true' : 'false'}
      className={mergeCn(
        'group relative flex items-center gap-1.5 px-3 h-6 text-[11px]',
        'rounded-lg transition-all duration-150 shrink-0 max-w-44',
        isActive
          ? mergeCn(
            'bg-background text-foreground shadow-[0_0.5px_2px_0_rgba(0,0,0,0.1)] dark:shadow-[0_0.5px_2px_0_rgba(0,0,0,0.4)]',
            activeTabClassName,
          )
          : 'text-muted-foreground/60 hover:text-foreground/80 hover:bg-foreground/5',
        tabClassName,
      )}
    >
      <span className="truncate select-none">{tab.label}</span>
      {!tab.pinned && (
        <span
          role="button"
          tabIndex={-1}
          onClick={e => onClose(e, tab.id)}
          data-testid={`tab-close-${tab.id}`}
          className={mergeCn(
            'inline-flex items-center justify-center rounded-full size-3.5',
            isActive
              ? 'opacity-60 hover:opacity-100'
              : 'opacity-0 group-hover:opacity-60 hover:opacity-100!',
            'transition-opacity hover:bg-foreground/10',
          )}
        >
          {renderCloseIcon ? renderCloseIcon() : '×'}
        </span>
      )}
    </button>
  )
})

export const TabBar = memo(({ cn: mergeCn = defaultCn, className, tabClassName, activeTabClassName, renderCloseIcon, renderNewTabIcon, onNewTab, onTabActivated, onTabClosed }: TabBarProps) => {
  'use no memo'
  const { store } = useTabsContext()
  const tabs = store(s => s.tabs)
  const activeTabId = store(s => s.activeTabId)

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

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
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
  }, [store])

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div
        className={mergeCn(
          'flex items-center gap-0.5 overflow-x-auto scrollbar-none px-0.5',
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
              cn={mergeCn}
              tabClassName={tabClassName}
              activeTabClassName={activeTabClassName}
              renderCloseIcon={renderCloseIcon}
              onActivate={handleActivate}
              onClose={handleClose}
            />
          ))}
        </SortableContext>

        {onNewTab && (
          <button
            onClick={onNewTab}
            data-testid="tab-new-btn"
            className={mergeCn(
              'flex shrink-0 items-center justify-center rounded-lg size-5',
              'text-muted-foreground/40 hover:text-foreground/70 hover:bg-foreground/5 transition-colors',
            )}
          >
            {renderNewTabIcon ? renderNewTabIcon() : '+'}
          </button>
        )}
      </div>
    </DndContext>
  )
})
