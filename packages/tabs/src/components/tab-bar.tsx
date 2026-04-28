// Input: useTabsContext, TabInstance, React
// Output: TabBar — capsule-shaped tab pills
// Position: Header component rendering tab pills with close/new-tab buttons

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

const TabPill = memo(({ tab, isActive, cn: mergeCn = defaultCn, tabClassName, activeTabClassName, renderCloseIcon, onActivate, onClose }: TabPillProps) => (
  <button
    onClick={() => onActivate(tab.id)}
    data-testid={`tab-pill-${tab.id}`}
    data-tab-active={isActive ? 'true' : 'false'}
    data-tab-pinned={tab.pinned ? 'true' : 'false'}
    className={mergeCn(
      'group relative flex items-center gap-1 rounded-full px-3 py-1 text-xs',
      'transition-colors shrink-0 max-w-40',
      isActive
        ? mergeCn('bg-fill text-foreground inset-shadow-sm inset-shadow-white/5', activeTabClassName)
        : 'text-muted-foreground hover:text-foreground hover:bg-fill/50',
      tabClassName,
    )}
  >
    <span className="truncate">{tab.label}</span>
    {!tab.pinned && (
      <span
        role="button"
        tabIndex={-1}
        onClick={e => onClose(e, tab.id)}
        data-testid={`tab-close-${tab.id}`}
        className={mergeCn(
          'inline-flex items-center justify-center rounded-full size-3.5',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          'hover:bg-foreground/10',
        )}
      >
        {renderCloseIcon ? renderCloseIcon() : '×'}
      </span>
    )}
  </button>
))

export const TabBar = memo(({ cn: mergeCn = defaultCn, className, tabClassName, activeTabClassName, renderCloseIcon, renderNewTabIcon, onNewTab, onTabActivated, onTabClosed }: TabBarProps) => {
  'use no memo'
  const { store } = useTabsContext()
  const tabs = store(s => s.tabs)
  const activeTabId = store(s => s.activeTabId)

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

  return (
    <div
      className={mergeCn(
        'flex items-center gap-0.5 overflow-x-auto scrollbar-none px-0.5',
        className,
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      data-testid="tab-bar"
    >
      {tabs.map(tab => (
        <TabPill
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

      {onNewTab && (
        <button
          onClick={onNewTab}
          data-testid="tab-new-btn"
          className={mergeCn(
            'flex shrink-0 items-center justify-center rounded-full size-5',
            'text-muted-foreground hover:text-foreground hover:bg-fill/50 transition-colors',
          )}
        >
          {renderNewTabIcon ? renderNewTabIcon() : '+'}
        </button>
      )}
    </div>
  )
})
