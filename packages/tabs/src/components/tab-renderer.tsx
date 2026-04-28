// Input: useTabsContext, Activity, Suspense, React
// Output: TabRenderer — renders all open tabs wrapped in Activity
// Position: Main content area component managing tab visibility via React 19 Activity

import { Activity, Suspense } from 'react'

import { useTabsContext } from '../context'

export interface TabRendererProps {
  /** Fallback shown while a tab's component is loading (React.lazy) */
  fallback?: React.ReactNode
  /** Wrapper rendered around each tab's content (e.g. AppLayout) */
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
  /** CSS class for the outer container */
  className?: string
}

export function TabRenderer({ fallback, wrapper: Wrapper, className }: TabRendererProps) {
  'use no memo'
  const { store, registry } = useTabsContext()
  const tabs = store(s => s.tabs)
  const activeTabId = store(s => s.activeTabId)

  return (
    <div className={className ?? 'flex-1 flex overflow-hidden'} data-testid="tab-content-renderer">
      {tabs.map((tab) => {
        const def = registry[tab.type]
        if (!def) {
          return null
        }
        const Component = def.component

        const content = (
          <Suspense fallback={fallback ?? null}>
            <Component params={tab.params} />
          </Suspense>
        )

        return (
          <Activity key={tab.id} mode={tab.id === activeTabId ? 'visible' : 'hidden'}>
            <div className="w-full" data-testid={`tab-content-${tab.id}`} data-tab-visible={tab.id === activeTabId ? 'true' : 'false'}>
              {Wrapper ? <Wrapper>{content}</Wrapper> : content}
            </div>
          </Activity>
        )
      })}
    </div>
  )
}
