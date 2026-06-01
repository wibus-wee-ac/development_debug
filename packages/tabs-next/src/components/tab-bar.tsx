import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { closestCenter, DndContext, DragOverlay, MouseSensor, useSensor, useSensors } from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '../cn'
import { useTabsContext } from '../context'
import type { TabInstance } from '../types'
import type { ScreenCoordinates } from './screen-coordinates'
import { getEventScreenCoordinates, isPointerOutsideWindow } from './screen-coordinates'

export interface TabPresentation {
  icon?: React.ReactNode
  label?: React.ReactNode
}

export interface TabBarCustomization {
  closeIcon?: React.ReactNode | (() => React.ReactNode)
  newTabIcon?: React.ReactNode | (() => React.ReactNode)
  tabIcon?: (tab: TabInstance) => React.ReactNode
  tabBadge?: (tab: TabInstance) => React.ReactNode
  tooltip?: (tab: TabInstance, children: React.ReactElement) => React.ReactNode
}

export interface TabBarProps {
  className?: string
  tabClassName?: string
  activeTabClassName?: string
  tabPresentation?: Record<string, TabPresentation>
  customization?: TabBarCustomization
  onNewTab?: () => void
  onTabActivated?: (tab: TabInstance) => void
  onTabClosed?: (tabId: string) => void
  onTabTearOff?: (tab: TabInstance, screenX: number, screenY: number) => void
  onDragStart?: (tab: TabInstance) => void
  onDragEnd?: () => void
}

interface TabPillProps {
  tab: TabInstance
  isActive: boolean
  shortcutHint?: number
  showShortcutHint: boolean
  presentation?: TabPresentation
  customization?: TabBarCustomization
  tabClassName?: string
  activeTabClassName?: string
  onActivate: (id: string) => void
  onClose: (event: React.MouseEvent, id: string) => void
}

function renderIconSlot(slot: React.ReactNode | (() => React.ReactNode) | undefined) {
  return typeof slot === 'function' ? slot() : slot
}

function readNumberShortcutIndex(event: KeyboardEvent): number | null {
  if (/^[1-9]$/.test(event.key)) {
    return Number(event.key) - 1
  }

  const digitMatch = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)
  if (!digitMatch) {
    return null
  }

  return Number(digitMatch[1]) - 1
}

const metaTabHintDelayMs = 200

const SortableTabPill = memo(({
  tab,
  isActive,
  shortcutHint,
  showShortcutHint,
  presentation,
  customization,
  tabClassName,
  activeTabClassName,
  onActivate,
  onClose,
}: TabPillProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
  }
  const tabIcon = presentation?.icon ?? customization?.tabIcon?.(tab) ?? null
  const tabBadge = customization?.tabBadge?.(tab) ?? null
  const shortcutSlot = shortcutHint === undefined
    ? null
    : (
        <span
          aria-hidden="true"
          className="inline-flex size-4 items-center justify-center rounded-sm bg-foreground/6 font-mono text-[10px] font-medium leading-none tabular-nums text-foreground/65"
        >
          {shortcutHint}
        </span>
      )
  const hasLeadingSlot = tabIcon || tabBadge || shortcutSlot
  const showBadgeSlot = Boolean(tabBadge) && !showShortcutHint

  const pill = (
    <div
      ref={setNodeRef}
      style={{ ...style, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      {...attributes}
      {...listeners}
      onClick={() => onActivate(tab.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onActivate(tab.id)
        }
      }}
      role="tab"
      tabIndex={0}
      aria-selected={isActive}
      title={customization?.tooltip ? undefined : tab.label}
      data-testid={`tab-pill-${tab.id}`}
      data-tab-active={isActive ? 'true' : 'false'}
      data-tab-pinned={tab.pinned ? 'true' : 'false'}
      className={cn(
        'group relative flex items-center justify-start gap-1.5 h-7.5 text-[11px] font-medium mx-0.5',
        tab.pinned ? 'px-3' : 'pl-3 pr-7',
        'flex-1 rounded-md transition-[opacity,background-color,color,box-shadow] duration-100 min-w-8 max-w-44 cursor-default overflow-hidden bg-background ',
        isActive
          ? cn('text-foreground shadow-xs', activeTabClassName)
          : cn('opacity-70 hover:opacity-100! text-muted-foreground hover:text-foreground/70', tabClassName),
      )}
    >
      {hasLeadingSlot && (
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          {tabIcon && (
            <span
              className={cn(
                'absolute inset-0 flex items-center justify-center transition-[opacity,transform,filter] duration-150 ease-out',
                showShortcutHint || showBadgeSlot ? 'scale-[0.92] opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-0',
              )}
            >
              {tabIcon}
            </span>
          )}
          {tabBadge && (
            <span
              className={cn(
                'absolute inset-0 flex items-center justify-center transition-[opacity,transform,filter] duration-150 ease-out',
                showBadgeSlot ? 'scale-100 opacity-100 blur-0' : 'scale-[0.92] opacity-0 blur-[2px]',
              )}
            >
              {tabBadge}
            </span>
          )}
          {shortcutSlot && (
            <span
              className={cn(
                'absolute inset-0 flex items-center justify-center transition-[opacity,transform,filter] duration-150 ease-out',
                showShortcutHint ? 'scale-100 opacity-100 blur-0' : 'scale-[0.92] opacity-0 blur-[2px]',
              )}
            >
              {shortcutSlot}
            </span>
          )}
        </span>
      )}
      <span className="truncate select-none">{presentation?.label ?? tab.label}</span>
      {!tab.pinned && (
        <button
          type="button"
          aria-label={`Close ${tab.label}`}
          onClick={event => onClose(event, tab.id)}
          data-testid={`tab-close-${tab.id}`}
          className={cn(
            'absolute right-0 top-1/2 z-10 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-transparent p-0',
            'opacity-0 text-muted-foreground transition-[opacity,color,background-color] hover:bg-foreground/6 hover:text-foreground',
            'group-hover:opacity-80 group-data-[tab-active=true]:opacity-100',
          )}
        >
          {renderIconSlot(customization?.closeIcon) ?? '×'}
        </button>
      )}
    </div>
  )

  return customization?.tooltip ? customization.tooltip(tab, pill) as React.ReactElement : pill
})

export const TabBar = memo(({
  className,
  tabClassName,
  activeTabClassName,
  tabPresentation,
  customization,
  onNewTab,
  onTabActivated,
  onTabClosed,
  onTabTearOff,
  onDragStart,
  onDragEnd,
}: TabBarProps) => {
  'use no memo'
  const { store } = useTabsContext()
  const tabs = store(s => s.tabs)
  const activeTabId = store(s => s.activeTabId)
  const pointerRef = useRef<ScreenCoordinates | null>(null)
  const dragWasTornOffRef = useRef(false)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const metaHintTimerRef = useRef<number | null>(null)
  const [activeDragTab, setActiveDragTab] = useState<TabInstance | null>(null)
  const [showMetaTabHints, setShowMetaTabHints] = useState(false)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
  )
  const sortableTabIds = useMemo(() => tabs.map(tab => tab.id), [tabs])

  const releaseCurrentDrag = useCallback(() => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
    pointerRef.current = null
    dragWasTornOffRef.current = false
  }, [])

  const handleActivate = useCallback((id: string) => {
    store.getState().setActiveTab(id)
    const tab = store.getState().tabs.find(item => item.id === id)
    if (tab) {
      onTabActivated?.(tab)
    }
  }, [onTabActivated, store])

  const handleClose = useCallback((event: React.MouseEvent, id: string) => {
    event.stopPropagation()
    store.getState().closeTab(id)
    onTabClosed?.(id)
  }, [onTabClosed, store])

  const clearMetaHintTimer = useCallback(() => {
    if (metaHintTimerRef.current === null) {
      return
    }
    window.clearTimeout(metaHintTimerRef.current)
    metaHintTimerRef.current = null
  }, [])

  const hideMetaTabHints = useCallback(() => {
    clearMetaHintTimer()
    setShowMetaTabHints(false)
  }, [clearMetaHintTimer])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta' && !event.repeat && metaHintTimerRef.current === null) {
        metaHintTimerRef.current = window.setTimeout(() => {
          metaHintTimerRef.current = null
          setShowMetaTabHints(true)
        }, metaTabHintDelayMs)
      }

      if (!event.metaKey || event.altKey || event.shiftKey) {
        return
      }

      const shortcutIndex = readNumberShortcutIndex(event)
      if (shortcutIndex === null) {
        return
      }

      const targetTab = tabs[shortcutIndex]
      if (!targetTab) {
        return
      }

      event.preventDefault()
      handleActivate(targetTab.id)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        hideMetaTabHints()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', hideMetaTabHints)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', hideMetaTabHints)
      hideMetaTabHints()
    }
  }, [handleActivate, hideMetaTabHints, tabs])

  const checkTearOff = useCallback((activeId: string | number) => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null

    if (!onTabTearOff) {
      return false
    }

    const pointer = pointerRef.current
    pointerRef.current = null

    if (!isPointerOutsideWindow(pointer, window)) {
      return false
    }

    const tab = store.getState().tabs.find(item => item.id === activeId)
    if (tab && !tab.pinned && pointer) {
      dragWasTornOffRef.current = true
      onTabTearOff(tab, pointer.screenX, pointer.screenY)
      return true
    }

    return false
  }, [onTabTearOff, store])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    pointerRef.current = getEventScreenCoordinates(event.activatorEvent, window)
    dragWasTornOffRef.current = false
    dragCleanupRef.current?.()

    const tab = store.getState().tabs.find(item => item.id === event.active.id)
    setActiveDragTab(tab ?? null)
    if (tab) {
      onDragStart?.(tab)
    }

    const onMove = (moveEvent: MouseEvent | PointerEvent | TouchEvent) => {
      pointerRef.current = getEventScreenCoordinates(moveEvent, window)
    }

    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('touchmove', onMove, true)
    dragCleanupRef.current = () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('touchmove', onMove, true)
    }
  }, [onDragStart, store])

  useEffect(() => {
    return releaseCurrentDrag
  }, [releaseCurrentDrag])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragTab(null)
    onDragEnd?.()
    if (dragWasTornOffRef.current) {
      releaseCurrentDrag()
      return
    }
    if (checkTearOff(active.id)) {
      return
    }
    if (!over || active.id === over.id) {
      releaseCurrentDrag()
      return
    }
    const currentTabs = store.getState().tabs
    const oldIndex = currentTabs.findIndex(tab => tab.id === active.id)
    const newIndex = currentTabs.findIndex(tab => tab.id === over.id)
    if (oldIndex === -1 || newIndex === -1) {
      releaseCurrentDrag()
      return
    }
    const reordered = [...currentTabs]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    store.getState().reorderTabs(reordered.map(tab => tab.id))
    releaseCurrentDrag()
  }, [checkTearOff, onDragEnd, releaseCurrentDrag, store])

  const handleDragCancel = useCallback(() => {
    setActiveDragTab(null)
    onDragEnd?.()
    releaseCurrentDrag()
  }, [onDragEnd, releaseCurrentDrag])

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div
        className={cn('flex items-center overflow-hidden px-0.5', className)}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        data-testid="tab-bar"
      >
        <SortableContext items={sortableTabIds} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab, index) => (
            <SortableTabPill
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              shortcutHint={index < 9 ? index + 1 : undefined}
              showShortcutHint={showMetaTabHints}
              presentation={tabPresentation?.[tab.id]}
              customization={customization}
              tabClassName={tabClassName}
              activeTabClassName={activeTabClassName}
              onActivate={handleActivate}
              onClose={handleClose}
            />
          ))}
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeDragTab && (
            <div
              className={cn(
                'flex items-center justify-start gap-1.5 h-7.5 text-[11px] font-medium mx-0.5',
                activeDragTab.pinned ? 'px-3' : 'pl-3 pr-7',
                'rounded-md bg-background shadow-lg border border-border/50 opacity-90 cursor-grabbing overflow-hidden max-w-44',
              )}
            >
              {(tabPresentation?.[activeDragTab.id]?.icon ?? customization?.tabIcon?.(activeDragTab)) && (
                <span className="shrink-0 flex items-center">
                  {tabPresentation?.[activeDragTab.id]?.icon ?? customization?.tabIcon?.(activeDragTab)}
                </span>
              )}
              <span className="truncate select-none">{tabPresentation?.[activeDragTab.id]?.label ?? activeDragTab.label}</span>
            </div>
          )}
        </DragOverlay>

        {onNewTab && (
          <button
            type="button"
            aria-label="New tab"
            onClick={onNewTab}
            data-testid="tab-new-btn"
            className={cn(
              'flex shrink-0 items-center justify-center rounded-md size-7',
              'text-muted-foreground/30 hover:text-foreground/60 hover:bg-foreground/4 transition-colors',
            )}
          >
            {renderIconSlot(customization?.newTabIcon) ?? '+'}
          </button>
        )}
      </div>
    </DndContext>
  )
})
