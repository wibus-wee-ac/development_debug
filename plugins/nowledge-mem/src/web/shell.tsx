/* Top-level shell for the Nowledge Mem panel — header + tab bar + sliding
   panel content. Mirrors apps/web/src/components/layout/right-aside.tsx
   structure and motion constants so the tab transitions feel identical to
   the host right-aside. */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import {
  BrainLine as BrainIcon,
  Chat3Line as ChatIcon,
  Settings2Line as SettingsIcon,
  Sun2Line as SunIcon,
} from '@mingcute/react'
import { AnimatePresence, LayoutGroup, m } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { Separator } from '~/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import {
  PANEL_INSTANT_TRANSITION,
  PANEL_INSTANT_VARIANTS,
  PANEL_SLIDE_TRANSITION,
  PANEL_SLIDE_VARIANTS,
  TAB_INSTANT_LABEL_TRANSITION,
  TAB_LABEL_TRANSITION,
  TAB_SPRING,
} from './motion'
import { PanelHeader } from './panel-header'
import { setNowledgeUiState, useNowledgeUiAction, type NowledgeTab } from './store'
import { ConfigTab } from './tabs/config-tab'
import { MemoriesTab } from './tabs/memories-tab'
import { ThreadsTab } from './tabs/threads-tab'
import { TodayTab } from './tabs/today-tab'

interface TabDef {
  id: NowledgeTab
  label: string
  icon: typeof BrainIcon
}

const TABS: TabDef[] = [
  { id: 'today', label: 'Today', icon: SunIcon },
  { id: 'memories', label: 'Memories', icon: BrainIcon },
  { id: 'threads', label: 'Threads', icon: ChatIcon },
  { id: 'config', label: 'Config', icon: SettingsIcon },
]

interface NowledgeShellProps {
  isActive: boolean
  ctx: WebPluginContext
}

export function NowledgeShell({ isActive, ctx }: NowledgeShellProps) {
  const activeTab = useNowledgeUiAction(s => s.activeTab)
  const [panelDirection, setPanelDirection] = useState(1)
  const userInitiatedTabRef = useRef<string | null>(null)

  const activateTab = (tabId: NowledgeTab) => {
    if (tabId === activeTab) { return }
    const activeIndex = TABS.findIndex(tab => tab.id === activeTab)
    const nextIndex = TABS.findIndex(tab => tab.id === tabId)
    if (nextIndex === -1) { return }
    setPanelDirection(nextIndex >= activeIndex ? 1 : -1)
    userInitiatedTabRef.current = tabId
    setNowledgeUiState({ activeTab: tabId })
  }

  useEffect(() => {
    userInitiatedTabRef.current = null
  }, [activeTab])

  const animatePanel = userInitiatedTabRef.current === activeTab
  const tabTransition = animatePanel ? TAB_SPRING : PANEL_INSTANT_TRANSITION
  const tabLabelTransition = animatePanel ? TAB_LABEL_TRANSITION : TAB_INSTANT_LABEL_TRANSITION

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col" data-testid="nowledge-panel" data-active={isActive}>
        <PanelHeader ctx={ctx} isActive={isActive} />

        {/* ── Tab bar ─────────────────────────────────────────── */}
        <div className="flex shrink-0 justify-center px-3 py-1.5">
          <LayoutGroup id="nowledge-tabs">
            <div className="relative flex items-center justify-center gap-0.5">
              {TABS.map(({ id, label, icon: Icon }) => {
                const isActiveTab = activeTab === id
                return (
                  <Tooltip key={id}>
                    <TooltipTrigger
                      render={(
                        <button
                        type="button"
                        onClick={() => activateTab(id)}
                        aria-label={label}
                        data-testid={`nowledge-tab-${id}`}
                        data-active={isActiveTab ? 'true' : 'false'}
                        className={cn(
                          'relative z-10 grid h-7 place-items-center overflow-hidden rounded-md px-2 text-xs select-none',
                          'transition-[color] duration-150 ease-out',
                          {
                            'text-foreground': isActiveTab,
                            'text-muted-foreground hover:text-foreground': !isActiveTab,
                          },
                        )}
                      >
                        {isActiveTab && (
                          <m.span
                            layoutId="nowledge-tab-pill"
                            className="absolute inset-0 rounded-md bg-accent"
                            transition={tabTransition}
                          />
                        )}
                        <span className="relative flex min-w-0 items-center justify-center">
                          <Icon className="relative size-3.5 shrink-0" aria-hidden="true" />
                          <m.span
                            aria-hidden={!isActiveTab}
                            initial={false}
                            animate={{ width: isActiveTab ? 'auto' : 0 }}
                            transition={{ width: tabLabelTransition.width }}
                            className="block overflow-hidden"
                          >
                            <m.span
                              initial={false}
                              animate={{
                                opacity: isActiveTab ? 1 : 0,
                                x: isActiveTab ? 0 : 6,
                                filter: isActiveTab ? 'blur(0px)' : 'blur(3px)',
                              }}
                              transition={{
                                opacity: tabLabelTransition.opacity,
                                x: tabLabelTransition.x,
                                filter: tabLabelTransition.filter,
                              }}
                              className="ml-1.5 block whitespace-nowrap text-left will-change-transform"
                            >
                              {label}
                            </m.span>
                          </m.span>
                        </span>
                        </button>
                      )}
                    />
                    {!isActiveTab && (
                      <TooltipContent side="bottom" sideOffset={6}>{label}</TooltipContent>
                    )}
                  </Tooltip>
                )
              })}
            </div>
          </LayoutGroup>
        </div>

        <Separator className="bg-foreground/6" />

        {/* ── Panel content ───────────────────────────────────── */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <AnimatePresence initial={false} custom={panelDirection}>
            <m.div
              key={activeTab}
              custom={panelDirection}
              variants={animatePanel ? PANEL_SLIDE_VARIANTS : PANEL_INSTANT_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              transition={animatePanel ? PANEL_SLIDE_TRANSITION : PANEL_INSTANT_TRANSITION}
              className="absolute inset-0 flex flex-col overflow-hidden will-change-transform"
            >
              {activeTab === 'today' && <TodayTab ctx={ctx} />}
              {activeTab === 'memories' && <MemoriesTab ctx={ctx} />}
              {activeTab === 'threads' && <ThreadsTab ctx={ctx} />}
              {activeTab === 'config' && <ConfigTab ctx={ctx} />}
            </m.div>
          </AnimatePresence>
        </div>
      </div>
    </TooltipProvider>
  )
}
