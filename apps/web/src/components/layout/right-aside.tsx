import { useQuery } from '@tanstack/react-query'
import { ActivityIcon, CircleDotIcon, FileDiffIcon, FolderTreeIcon, GitBranchIcon, RssIcon, SlidersHorizontalIcon } from 'lucide-react'
import { AnimatePresence, LayoutGroup, m } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getWorkspacesById } from '~/api-gen/sdk.gen'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { BrowserAnnotationAdjustmentPanel } from '~/features/browser/browser-annotation-adjustment-panel'
import { RuntimeSessionPanel } from '~/features/chat/runtime-session-panel'
import { useSessionAwaitSummary } from '~/features/chat/use-session-await'
import { ChangesPanel, GitPanel } from '~/features/git'
import { IssueAsidePanel } from '~/features/kanban/issue-aside-panel'
import { AwaitPanel } from '~/features/session-await/await-panel'
import { FileTree } from '~/features/workspace/file-tree'
import { cn } from '~/lib/cn'
import type { RuntimeKind, Workspace } from '~/lib/types'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

interface Tab {
  id: string
  labelKey:
    | 'rightAside.tab.files'
    | 'rightAside.tab.changes'
    | 'rightAside.tab.git'
    | 'rightAside.tab.issue'
    | 'rightAside.tab.await'
    | 'rightAside.tab.runtime'
    | 'rightAside.tab.adjustment'
  icon: typeof FolderTreeIcon
}

const TABS: Tab[] = [
  { id: 'files', labelKey: 'rightAside.tab.files', icon: FolderTreeIcon },
  { id: 'changes', labelKey: 'rightAside.tab.changes', icon: FileDiffIcon },
  { id: 'git', labelKey: 'rightAside.tab.git', icon: GitBranchIcon },
  { id: 'issue', labelKey: 'rightAside.tab.issue', icon: CircleDotIcon },
  { id: 'runtime', labelKey: 'rightAside.tab.runtime', icon: ActivityIcon },
  { id: 'await', labelKey: 'rightAside.tab.await', icon: RssIcon },
  { id: 'adjustment', labelKey: 'rightAside.tab.adjustment', icon: SlidersHorizontalIcon },
]

const TAB_GAP = 2

const TAB_SPRING = {
  type: 'spring',
  stiffness: 520,
  damping: 36,
  mass: 0.7,
} as const

const TAB_LABEL_TRANSITION = {
  width: {
    type: 'spring',
    stiffness: 520,
    damping: 36,
    mass: 0.7,
  },
  opacity: {
    duration: 0.16,
    ease: 'easeOut',
  },
  x: {
    duration: 0.2,
    ease: [0.22, 1, 0.36, 1],
  },
  filter: {
    duration: 0.16,
    ease: 'easeOut',
  },
} as const

const PANEL_SLIDE_TRANSITION = {
  type: 'spring',
  stiffness: 580,
  damping: 48,
  mass: 0.78,
} as const

const PANEL_SLIDE_VARIANTS = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0.96,
  }),
  center: {
    x: '0%',
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? '-100%' : '100%',
    opacity: 0.96,
  }),
} as const

interface RightAsideProps {
  sessionId?: string | null
  workspaceId?: string | null
  workspaceName?: string | null
  workspacePath?: string | null
}

interface RightAsidePanelContentProps {
  tabId: string
  sessionId: string | null
  workspaceId: string | null
  workspacePath: string | null
  issueEmptyLabel: string
  runtimeKind: RuntimeKind | null
  providerTargetId: string | null
}

function RightAsidePanelContent({
  tabId,
  sessionId,
  workspaceId,
  workspacePath,
  issueEmptyLabel,
  runtimeKind,
  providerTargetId,
}: RightAsidePanelContentProps) {
  if (tabId === 'files') {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-files"
      >
        <FileTree
          workspaceId={workspaceId}
          workspacePath={workspacePath}
        />
      </div>
    )
  }

  if (tabId === 'git') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" data-testid="right-aside-panel-git">
        <GitPanel workspaceId={workspaceId} />
      </div>
    )
  }

  if (tabId === 'changes') {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-changes"
      >
        <ChangesPanel
          workspaceId={workspaceId}
          workspacePath={workspacePath}
        />
      </div>
    )
  }

  if (tabId === 'issue' && sessionId) {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-issue"
      >
        <IssueAsidePanel sessionId={sessionId} workspaceId={workspaceId} />
      </div>
    )
  }

  if (tabId === 'issue') {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        data-testid="right-aside-panel-issue-empty"
      >
        <p className="text-[11px] text-muted-foreground">{issueEmptyLabel}</p>
      </div>
    )
  }

  if (tabId === 'await') {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-await"
      >
        <AwaitPanel sessionId={sessionId ?? null} workspaceId={workspaceId} />
      </div>
    )
  }

  if (tabId === 'runtime') {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-runtime"
      >
        <RuntimeSessionPanel
          sessionId={sessionId ?? null}
          runtimeKind={runtimeKind}
          providerTargetId={providerTargetId}
        />
      </div>
    )
  }

  if (tabId === 'adjustment') {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-adjustment"
      >
        <BrowserAnnotationAdjustmentPanel />
      </div>
    )
  }

  return null
}

export function RightAside({
  sessionId = null,
  workspaceId: explicitWorkspaceId = null,
  workspaceName: explicitWorkspaceName = null,
  workspacePath: explicitWorkspacePath = null,
}: RightAsideProps) {
  const { t } = useTranslation('chrome')
  const activeTab = useLayoutStore(s => s.asideActiveTab)
  const setActiveTab = useLayoutStore(s => s.setAsideActiveTab)
  const [panelDirection, setPanelDirection] = useState(1)

  // Derive workspaceId from session
  const { data: sessionMeta } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId ?? '' } }),
    select: s => ({
      workspaceId: s?.workspaceId as string | null,
      runtimeKind: s?.runtimeKind as RuntimeKind | null,
      providerTargetId: s?.providerTargetId as string | null,
    }),
    enabled: !!sessionId,
    staleTime: 60_000,
  })
  const workspaceId = explicitWorkspaceId ?? sessionMeta?.workspaceId ?? null

  // Derive workspace details from workspaceId
  const { data: workspace } = useQuery({
    queryKey: ['workspace-detail', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesById({ path: { id: workspaceId! } })
      return data as Workspace | undefined
    },
    enabled: !!workspaceId && (!explicitWorkspaceName || !explicitWorkspacePath),
    staleTime: 60_000,
  })
  const workspacePath = explicitWorkspacePath ?? workspace?.path ?? null

  // Badge: pending awaits for Feed tab
  const { data: awaitSummary } = useSessionAwaitSummary(sessionId)
  const hasPendingAwaits = awaitSummary?.awaiting ?? false

  // Badge: active adjustment session
  const adjustmentSession = useBrowserPanelStore(state => state.annotationAdjustmentSession)
  const hasActiveAdjustment = adjustmentSession !== null
  const activeBrowserPanelOwnerId = useLayoutStore(state => state.activeBrowserPanelOwnerId)
  const browserPanelOpen = useLayoutStore(state => state.browserPanelOpen)
  const hasActiveBrowserTab = useBrowserPanelStore((state) => {
    const ownerState = state.owners[activeBrowserPanelOwnerId]
    const activePanelTab = ownerState?.tabs.find(tab => tab.id === ownerState.activeTabId)
      ?? ownerState?.tabs[0]
    return activePanelTab?.kind === 'browser'
  })
  const visibleTabs = TABS.filter(
    tab => tab.id !== 'adjustment' || (browserPanelOpen && hasActiveBrowserTab),
  )
  const resolvedActiveTab = visibleTabs.some(tab => tab.id === activeTab)
    ? activeTab
    : 'files'

  const activateTab = (tabId: string) => {
    if (tabId === resolvedActiveTab) {
      return
    }

    const activeIndex = visibleTabs.findIndex(tab => tab.id === resolvedActiveTab)
    const nextIndex = visibleTabs.findIndex(tab => tab.id === tabId)
    if (nextIndex === -1) {
      return
    }

    setPanelDirection(nextIndex >= activeIndex ? 1 : -1)
    setActiveTab(tabId)
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="right-aside"
      data-active-tab={resolvedActiveTab}
    >
      {/* ── Tab bar ─────────────────────────────────────── */}
      <div className="flex shrink-0 justify-center border-b border-border px-2 py-1.5">
        <LayoutGroup id="right-aside-tabs">
          <div className="relative flex items-center justify-center" style={{ gap: TAB_GAP }}>
            {visibleTabs.map(({ id, labelKey, icon: Icon }) => {
              const isActive = resolvedActiveTab === id
              const showBadge = (id === 'await' && hasPendingAwaits && !isActive)
                || (id === 'adjustment' && hasActiveAdjustment && !isActive)
              const label = t(labelKey)

              const button = (
                <m.button
                  type="button"
                  layout
                  onClick={() => activateTab(id)}
                  aria-label={label}
                  data-testid={`right-aside-tab-${id}`}
                  data-active={isActive ? 'true' : 'false'}
                  initial={false}
                  transition={TAB_SPRING}
                  className={cn(
                    'relative z-10 grid h-7 place-items-center overflow-hidden rounded-md px-2 text-xs select-none',
                    'transition-[color] duration-150 ease-out',
                    {
                      'text-foreground': isActive,
                      'text-muted-foreground hover:text-foreground': !isActive,
                    },
                  )}
                >
                  {isActive && (
                    <m.span
                      layoutId="right-aside-tab-pill"
                      className="absolute inset-0 rounded-md bg-accent"
                      transition={TAB_SPRING}
                    />
                  )}
                  <span className="relative flex min-w-0 items-center justify-center">
                    <Icon className="relative size-3.5 shrink-0" aria-hidden="true" />
                    <m.span
                      aria-hidden={!isActive}
                      initial={false}
                      animate={{
                        width: isActive ? 'auto' : 0,
                      }}
                      transition={{
                        width: TAB_LABEL_TRANSITION.width,
                      }}
                      className="block overflow-hidden"
                    >
                      <m.span
                        initial={false}
                        animate={{
                          opacity: isActive ? 1 : 0,
                          x: isActive ? 0 : 6,
                          filter: isActive ? 'blur(0px)' : 'blur(3px)',
                        }}
                        transition={{
                          opacity: TAB_LABEL_TRANSITION.opacity,
                          x: TAB_LABEL_TRANSITION.x,
                          filter: TAB_LABEL_TRANSITION.filter,
                        }}
                        className="ml-1.5 block whitespace-nowrap text-left will-change-transform"
                      >
                        {label}
                      </m.span>
                    </m.span>
                  </span>
                  {showBadge && (
                    <span className="absolute right-2 flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                    </span>
                  )}
                </m.button>
              )

              return (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  {!isActive && (
                    <TooltipContent side="bottom" sideOffset={8}>
                      {label}
                    </TooltipContent>
                  )}
                </Tooltip>
              )
            })}
          </div>
        </LayoutGroup>
      </div>

      {/* ── Tab content ─────────────────────────────────── */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <AnimatePresence initial={false} custom={panelDirection}>
          <m.div
            key={resolvedActiveTab}
            custom={panelDirection}
            variants={PANEL_SLIDE_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={PANEL_SLIDE_TRANSITION}
            className="absolute inset-0 flex flex-col overflow-hidden will-change-transform"
          >
            <RightAsidePanelContent
              tabId={resolvedActiveTab}
              sessionId={sessionId}
              workspaceId={workspaceId}
              workspacePath={workspacePath}
              issueEmptyLabel={t('rightAside.issue.empty')}
              runtimeKind={sessionMeta?.runtimeKind ?? null}
              providerTargetId={sessionMeta?.providerTargetId ?? null}
            />
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
