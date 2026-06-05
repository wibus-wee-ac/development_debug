import { useQuery } from '@tanstack/react-query'
import { ActivityIcon, CircleDotIcon, FileDiffIcon, FolderTreeIcon, GitBranchIcon, RssIcon } from 'lucide-react'
import { animate, AnimatePresence, LayoutGroup, m, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getWorkspacesById } from '~/api-gen/sdk.gen'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { RuntimeSessionPanel } from '~/features/chat/runtime-session-panel'
import { useSessionAwaitSummary } from '~/features/chat/use-session-await'
import { ChangesPanel, GitPanel } from '~/features/git'
import { IssueAsidePanel } from '~/features/kanban/issue-aside-panel'
import { PackCodebaseDialog } from '~/features/pack-codebase/pack-codebase-dialog'
import { AwaitPanel } from '~/features/session-await/await-panel'
import { FileTree } from '~/features/workspace/file-tree'
import { cn } from '~/lib/cn'
import type { RuntimeKind, Workspace } from '~/lib/types'
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
  icon: typeof FolderTreeIcon
}

const TABS: Tab[] = [
  { id: 'files', labelKey: 'rightAside.tab.files', icon: FolderTreeIcon },
  { id: 'changes', labelKey: 'rightAside.tab.changes', icon: FileDiffIcon },
  { id: 'git', labelKey: 'rightAside.tab.git', icon: GitBranchIcon },
  { id: 'issue', labelKey: 'rightAside.tab.issue', icon: CircleDotIcon },
  { id: 'runtime', labelKey: 'rightAside.tab.runtime', icon: ActivityIcon },
  { id: 'await', labelKey: 'rightAside.tab.await', icon: RssIcon },
]

const TAB_GAP = 2
const HORIZONTAL_SWIPE_AXIS_RATIO = 1.25
const HORIZONTAL_SWIPE_SETTLE_IDLE_MS = 96
const HORIZONTAL_SWIPE_LOCK_IDLE_MS = 220
const HORIZONTAL_SWIPE_COMMIT_RATIO = 0.24
const HORIZONTAL_SWIPE_DELTA_SCALE = 0.88
const HORIZONTAL_SWIPE_MAX_DELTA = 64
const HORIZONTAL_SWIPE_FLICK_VELOCITY = 0.62
const HORIZONTAL_SWIPE_MIN_FLICK_DISTANCE = 18
const HORIZONTAL_SWIPE_MIN_COMMIT_DISTANCE = 52
const HORIZONTAL_SWIPE_MAX_COMMIT_DISTANCE = 112
const HORIZONTAL_SWIPE_REVERSAL_EPSILON = 2
const HORIZONTAL_SCROLL_EPSILON = 1
const EDITABLE_WHEEL_TARGET_SELECTOR = 'input, textarea, select, [contenteditable], [role="textbox"]'

const TAB_SPRING = {
  type: 'spring',
  stiffness: 480,
  damping: 31,
  mass: 0.8,
} as const

// const TAB_LABEL_TRANSITION = {
//   width: { type: 'spring', stiffness: 520, damping: 36, mass: 0.7 },
//   marginLeft: { type: 'spring', stiffness: 520, damping: 36, mass: 0.7 },
//   opacity: { duration: 0.16, ease: 'easeOut' },
//   x: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
//   filter: { duration: 0.16, ease: 'easeOut' },
//   scaleX: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
// } as const

const TAB_LABEL_TRANSITION = {
  width: {
    type: 'spring',
    stiffness: 390,
    damping: 32,
    mass: 0.8,
  },
  opacity: {
    duration: 0.12,
    ease: 'easeOut',
    delay: 0.03,
  },
  x: {
    duration: 0.24,
    ease: [0.16, 1, 0.3, 1],
    delay: 0.02,
  },
  filter: {
    duration: 0.2,
    ease: [0.16, 1, 0.3, 1],
  },
} as const

const PANEL_SLIDE_TRANSITION = {
  type: 'spring',
  stiffness: 660,
  damping: 56,
  mass: 0.82,
} as const

const TAB_PILL_TRANSITION = {
  type: 'spring',
  stiffness: 760,
  damping: 54,
  mass: 0.72,
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

type HorizontalSwipePreview = {
  direction: -1 | 1
  targetTabId: string
}

type HorizontalSwipeGesture = {
  lastWheelTime: number
  peakVelocity: number
  velocity: number
}

type TabPillRect = {
  x: number
  width: number
}

function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return delta * 16
  }
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return delta * pageSize
  }
  return delta
}

function canScrollHorizontally(element: HTMLElement, deltaX: number): boolean {
  const overflowX = window.getComputedStyle(element).overflowX
  if (overflowX !== 'auto' && overflowX !== 'scroll' && overflowX !== 'overlay') {
    return false
  }
  if (element.scrollWidth <= element.clientWidth + HORIZONTAL_SCROLL_EPSILON) {
    return false
  }

  const maxScrollLeft = element.scrollWidth - element.clientWidth
  return deltaX > 0
    ? element.scrollLeft < maxScrollLeft - HORIZONTAL_SCROLL_EPSILON
    : element.scrollLeft > HORIZONTAL_SCROLL_EPSILON
}

function shouldKeepHorizontalWheelForContent(
  target: EventTarget | null,
  root: HTMLElement,
  deltaX: number,
): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  if (target.closest(EDITABLE_WHEEL_TARGET_SELECTOR)) {
    return true
  }

  let element: HTMLElement | null = target instanceof HTMLElement
    ? target
    : target.parentElement

  while (element && element !== root) {
    if (canScrollHorizontally(element, deltaX)) {
      return true
    }
    element = element.parentElement
  }

  return false
}

function getAdjacentTabId(activeTab: string, direction: -1 | 1): string | null {
  const activeIndex = TABS.findIndex(tab => tab.id === activeTab)
  if (activeIndex === -1) {
    return TABS[0]?.id ?? null
  }

  return TABS[activeIndex + direction]?.id ?? null
}

function clampHorizontalSwipeOffset(offset: number, direction: -1 | 1, width: number): number {
  return direction > 0
    ? Math.max(-width, Math.min(0, offset))
    : Math.max(0, Math.min(width, offset))
}

function getHorizontalSwipeCommitDistance(width: number): number {
  return Math.min(
    HORIZONTAL_SWIPE_MAX_COMMIT_DISTANCE,
    Math.max(HORIZONTAL_SWIPE_MIN_COMMIT_DISTANCE, width * HORIZONTAL_SWIPE_COMMIT_RATIO),
  )
}

function getHorizontalSwipeTargetOffset(direction: -1 | 1, width: number): number {
  return -direction * width
}

function shouldCommitHorizontalSwipe(distance: number, width: number, velocity: number): boolean {
  return distance >= getHorizontalSwipeCommitDistance(width)
    || (distance >= HORIZONTAL_SWIPE_MIN_FLICK_DISTANCE && velocity >= HORIZONTAL_SWIPE_FLICK_VELOCITY)
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function normalizeHorizontalSwipeDelta(deltaX: number): number {
  return Math.sign(deltaX) * Math.min(Math.abs(deltaX) * HORIZONTAL_SWIPE_DELTA_SCALE, HORIZONTAL_SWIPE_MAX_DELTA)
}

function readSwipeVelocity(gesture: HorizontalSwipeGesture, delta: number, now: number): number {
  const elapsed = gesture.lastWheelTime > 0
    ? Math.max(8, Math.min(48, now - gesture.lastWheelTime))
    : 16
  gesture.lastWheelTime = now

  const velocity = Math.abs(delta) / elapsed
  gesture.velocity = (gesture.velocity * 0.68) + (velocity * 0.32)
  gesture.peakVelocity = Math.max(gesture.peakVelocity, gesture.velocity)
  return gesture.peakVelocity
}

function getTabById(tabId: string): Tab | null {
  return TABS.find(tab => tab.id === tabId) ?? null
}

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
  onPackRequested: (paths: string[]) => void
}

function RightAsidePanelContent({
  tabId,
  sessionId,
  workspaceId,
  workspacePath,
  issueEmptyLabel,
  runtimeKind,
  providerTargetId,
  onPackRequested,
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
          onPackRequested={workspaceId ? onPackRequested : undefined}
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
          onPackRequested={workspaceId ? onPackRequested : undefined}
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
  const rootRef = useRef<HTMLDivElement | null>(null)
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const currentPanelX = useMotionValue(0)
  const adjacentPanelX = useMotionValue(0)
  const tabPillX = useMotionValue(0)
  const tabPillWidth = useMotionValue(0)
  const tabPillOpacity = useMotionValue(0)
  const swipePreviewRef = useRef<HorizontalSwipePreview | null>(null)
  const swipeGestureRef = useRef<HorizontalSwipeGesture>({
    lastWheelTime: 0,
    peakVelocity: 0,
    velocity: 0,
  })
  const swipeIdleTimerRef = useRef<number | null>(null)
  const swipeLockedUntilIdleRef = useRef(false)
  const swipeSettlingRef = useRef(false)
  const swipeAnimationsRef = useRef<Array<{ stop: () => void }>>([])
  const tabPillAnimationsRef = useRef<Array<{ stop: () => void }>>([])
  const tabPillMeasureFrameRef = useRef(0)
  const [swipePreview, setSwipePreview] = useState<HorizontalSwipePreview | null>(null)
  const [tabPillReady, setTabPillReady] = useState(false)
  const [panelDirection, setPanelDirection] = useState(1)
  const [packOpen, setPackOpen] = useState(false)
  const [packInitialPaths, setPackInitialPaths] = useState<string[]>([])

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
  const workspaceName = explicitWorkspaceName ?? workspace?.name ?? null
  const workspacePath = explicitWorkspacePath ?? workspace?.path ?? null

  // Badge: pending awaits for Feed tab
  const { data: awaitSummary } = useSessionAwaitSummary(sessionId)
  const hasPendingAwaits = awaitSummary?.awaiting ?? false
  const swipePreviewTab = swipePreview ? getTabById(swipePreview.targetTabId) : null
  const SwipePreviewIcon = swipePreviewTab?.icon ?? null

  const handlePackRequested = useCallback((paths: string[]) => {
    setPackInitialPaths(paths)
    setPackOpen(true)
  }, [])

  const clearSwipeIdleTimer = useCallback(() => {
    if (swipeIdleTimerRef.current === null) {
      return
    }
    window.clearTimeout(swipeIdleTimerRef.current)
    swipeIdleTimerRef.current = null
  }, [])

  const stopSwipeAnimations = useCallback(() => {
    for (const animation of swipeAnimationsRef.current) {
      animation.stop()
    }
    swipeAnimationsRef.current = []
  }, [])

  const resetSwipeGesture = useCallback(() => {
    swipeGestureRef.current.lastWheelTime = 0
    swipeGestureRef.current.peakVelocity = 0
    swipeGestureRef.current.velocity = 0
  }, [])

  const stopTabPillAnimations = useCallback(() => {
    for (const animation of tabPillAnimationsRef.current) {
      animation.stop()
    }
    tabPillAnimationsRef.current = []
  }, [])

  const measureTabPillRect = useCallback((tabId: string): TabPillRect | null => {
    const tabList = tabListRef.current
    const button = tabList?.querySelector<HTMLButtonElement>(`[data-right-aside-tab-id="${tabId}"]`) ?? null
    if (!tabList || !button) {
      return null
    }

    const listRect = tabList.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    return {
      x: buttonRect.left - listRect.left,
      width: buttonRect.width,
    }
  }, [])

  const applyTabPillRect = useCallback((rect: TabPillRect) => {
    stopTabPillAnimations()
    tabPillX.set(rect.x)
    tabPillWidth.set(rect.width)
    tabPillOpacity.set(1)
    setTabPillReady(true)
  }, [stopTabPillAnimations, tabPillOpacity, tabPillWidth, tabPillX])

  const animateTabPillToRect = useCallback((rect: TabPillRect) => {
    stopTabPillAnimations()
    tabPillOpacity.set(1)
    setTabPillReady(true)
    const xAnimation = animate(tabPillX, rect.x, TAB_PILL_TRANSITION)
    const widthAnimation = animate(tabPillWidth, rect.width, TAB_PILL_TRANSITION)
    tabPillAnimationsRef.current = [xAnimation, widthAnimation]
  }, [stopTabPillAnimations, tabPillOpacity, tabPillWidth, tabPillX])

  const updateTabPillForSwipe = useCallback((
    preview: HorizontalSwipePreview,
    currentX: number,
    width: number,
  ) => {
    const activeRect = measureTabPillRect(activeTab)
    const targetRect = measureTabPillRect(preview.targetTabId)
    if (!activeRect || !targetRect) {
      return
    }

    const progress = clampProgress(Math.abs(currentX) / width)
    stopTabPillAnimations()
    tabPillX.set(lerp(activeRect.x, targetRect.x, progress))
    tabPillWidth.set(lerp(activeRect.width, targetRect.width, progress))
    tabPillOpacity.set(1)
    setTabPillReady(true)
  }, [
    activeTab,
    measureTabPillRect,
    stopTabPillAnimations,
    tabPillOpacity,
    tabPillWidth,
    tabPillX,
  ])

  const scheduleActiveTabPillMeasurement = useCallback(() => {
    if (tabPillMeasureFrameRef.current !== 0) {
      cancelAnimationFrame(tabPillMeasureFrameRef.current)
    }

    tabPillMeasureFrameRef.current = requestAnimationFrame(() => {
      tabPillMeasureFrameRef.current = 0
      const rect = measureTabPillRect(activeTab)
      if (!rect) {
        return
      }

      if (tabPillReady) {
        animateTabPillToRect(rect)
        return
      }
      applyTabPillRect(rect)
    })
  }, [activeTab, animateTabPillToRect, applyTabPillRect, measureTabPillRect, tabPillReady])

  const syncSwipePreview = useCallback((preview: HorizontalSwipePreview | null) => {
    swipePreviewRef.current = preview
    setSwipePreview(preview)
  }, [])

  const unlockSwipeAfterIdle = useCallback(() => {
    clearSwipeIdleTimer()
    swipeIdleTimerRef.current = window.setTimeout(() => {
      swipeLockedUntilIdleRef.current = false
      swipeIdleTimerRef.current = null
    }, HORIZONTAL_SWIPE_LOCK_IDLE_MS)
  }, [clearSwipeIdleTimer])

  const resetHorizontalSwipe = useCallback((measureActiveTab = true) => {
    clearSwipeIdleTimer()
    stopSwipeAnimations()
    resetSwipeGesture()
    swipeLockedUntilIdleRef.current = false
    swipeSettlingRef.current = false
    syncSwipePreview(null)
    currentPanelX.set(0)
    adjacentPanelX.set(0)
    if (measureActiveTab) {
      scheduleActiveTabPillMeasurement()
    }
  }, [
    adjacentPanelX,
    clearSwipeIdleTimer,
    currentPanelX,
    scheduleActiveTabPillMeasurement,
    resetSwipeGesture,
    stopSwipeAnimations,
    syncSwipePreview,
  ])

  const settleHorizontalSwipe = useCallback((commit: boolean) => {
    const root = rootRef.current
    const preview = swipePreviewRef.current
    if (!root || !preview || swipeSettlingRef.current) {
      return
    }

    clearSwipeIdleTimer()
    stopSwipeAnimations()
    swipeSettlingRef.current = true

    const width = Math.max(root.clientWidth, 1)
    const currentTargetX = commit ? getHorizontalSwipeTargetOffset(preview.direction, width) : 0
    const adjacentTargetX = commit ? 0 : preview.direction * width
    const pillTargetRect = measureTabPillRect(commit ? preview.targetTabId : activeTab)
    let completed = false

    if (pillTargetRect) {
      animateTabPillToRect(pillTargetRect)
    }

    const complete = () => {
      if (completed) {
        return
      }
      completed = true
      swipeSettlingRef.current = false

      if (commit) {
        setPanelDirection(preview.direction)
        setActiveTab(preview.targetTabId)
      }
      swipeLockedUntilIdleRef.current = true
      unlockSwipeAfterIdle()

      syncSwipePreview(null)
      currentPanelX.set(0)
      adjacentPanelX.set(0)
      resetSwipeGesture()
      swipeAnimationsRef.current = []
      if (!commit) {
        scheduleActiveTabPillMeasurement()
      }
    }

    const currentAnimation = animate(currentPanelX, currentTargetX, PANEL_SLIDE_TRANSITION)
    const adjacentAnimation = animate(adjacentPanelX, adjacentTargetX, {
      ...PANEL_SLIDE_TRANSITION,
      onComplete: complete,
    })
    swipeAnimationsRef.current = [currentAnimation, adjacentAnimation]
  }, [
    adjacentPanelX,
    clearSwipeIdleTimer,
    currentPanelX,
    activeTab,
    animateTabPillToRect,
    measureTabPillRect,
    scheduleActiveTabPillMeasurement,
    setActiveTab,
    resetSwipeGesture,
    stopSwipeAnimations,
    syncSwipePreview,
    unlockSwipeAfterIdle,
  ])

  const scheduleHorizontalSwipeSettle = useCallback(() => {
    clearSwipeIdleTimer()
    swipeIdleTimerRef.current = window.setTimeout(() => {
      swipeIdleTimerRef.current = null
      const root = rootRef.current
      const preview = swipePreviewRef.current
      if (!root || !preview) {
        return
      }

      const width = Math.max(root.clientWidth, 1)
      const distance = Math.abs(currentPanelX.get())
      settleHorizontalSwipe(
        shouldCommitHorizontalSwipe(distance, width, swipeGestureRef.current.peakVelocity),
      )
    }, HORIZONTAL_SWIPE_SETTLE_IDLE_MS)
  }, [clearSwipeIdleTimer, currentPanelX, settleHorizontalSwipe])

  const activateTab = useCallback((tabId: string) => {
    if (tabId === activeTab) {
      resetHorizontalSwipe()
      return false
    }

    resetHorizontalSwipe(false)
    const activeIndex = TABS.findIndex(tab => tab.id === activeTab)
    const nextIndex = TABS.findIndex(tab => tab.id === tabId)
    setPanelDirection(nextIndex >= activeIndex ? 1 : -1)
    setActiveTab(tabId)
    return true
  }, [activeTab, resetHorizontalSwipe, setActiveTab])

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const handleWheel = (event: WheelEvent) => {
      if (
        event.defaultPrevented
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
      ) {
        return
      }

      const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode, root.clientWidth)
      const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode, root.clientHeight)
      const absDeltaX = Math.abs(deltaX)
      const absDeltaY = Math.abs(deltaY)

      if (absDeltaX < 1 || absDeltaX < absDeltaY * HORIZONTAL_SWIPE_AXIS_RATIO) {
        return
      }

      if (swipeSettlingRef.current || swipeLockedUntilIdleRef.current) {
        event.preventDefault()
        unlockSwipeAfterIdle()
        return
      }

      const incomingDirection = deltaX > 0 ? 1 : -1
      let preview = swipePreviewRef.current
      if (
        preview
        && incomingDirection !== preview.direction
        && Math.abs(currentPanelX.get()) <= HORIZONTAL_SWIPE_REVERSAL_EPSILON
      ) {
        syncSwipePreview(null)
        adjacentPanelX.set(0)
        resetSwipeGesture()
        preview = null
      }

      if (!preview) {
        if (shouldKeepHorizontalWheelForContent(event.target, root, deltaX)) {
          return
        }

        const targetTabId = getAdjacentTabId(activeTab, incomingDirection)
        if (!targetTabId) {
          return
        }

        const width = Math.max(root.clientWidth, 1)
        preview = { direction: incomingDirection, targetTabId }
        stopSwipeAnimations()
        resetSwipeGesture()
        setPanelDirection(incomingDirection)
        syncSwipePreview(preview)
        currentPanelX.set(0)
        adjacentPanelX.set(incomingDirection * width)
      }

      const width = Math.max(root.clientWidth, 1)
      const now = performance.now()
      const horizontalDelta = normalizeHorizontalSwipeDelta(deltaX)
      readSwipeVelocity(swipeGestureRef.current, horizontalDelta, now)
      const nextCurrentX = clampHorizontalSwipeOffset(
        currentPanelX.get() - horizontalDelta,
        preview.direction,
        width,
      )
      currentPanelX.set(nextCurrentX)
      adjacentPanelX.set(preview.direction * width + nextCurrentX)
      updateTabPillForSwipe(preview, nextCurrentX, width)
      scheduleHorizontalSwipeSettle()
      event.preventDefault()
    }

    root.addEventListener('wheel', handleWheel, { capture: true, passive: false })

    return () => {
      root.removeEventListener('wheel', handleWheel, { capture: true })
    }
  }, [
    activeTab,
    adjacentPanelX,
    currentPanelX,
    resetSwipeGesture,
    scheduleHorizontalSwipeSettle,
    stopSwipeAnimations,
    syncSwipePreview,
    updateTabPillForSwipe,
    unlockSwipeAfterIdle,
  ])

  useEffect(() => {
    return () => {
      clearSwipeIdleTimer()
      stopSwipeAnimations()
      stopTabPillAnimations()
      if (tabPillMeasureFrameRef.current !== 0) {
        cancelAnimationFrame(tabPillMeasureFrameRef.current)
        tabPillMeasureFrameRef.current = 0
      }
    }
  }, [clearSwipeIdleTimer, stopSwipeAnimations, stopTabPillAnimations])

  useLayoutEffect(() => {
    if (swipePreview) {
      return
    }
    scheduleActiveTabPillMeasurement()
  }, [activeTab, scheduleActiveTabPillMeasurement, swipePreview])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !swipePreview) {
      return
    }

    updateTabPillForSwipe(
      swipePreview,
      currentPanelX.get(),
      Math.max(root.clientWidth, 1),
    )
  }, [currentPanelX, swipePreview, updateTabPillForSwipe])

  useEffect(() => {
    const tabList = tabListRef.current
    if (!tabList) {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!swipePreviewRef.current) {
        scheduleActiveTabPillMeasurement()
      }
    })
    resizeObserver.observe(tabList)

    return () => {
      resizeObserver.disconnect()
    }
  }, [scheduleActiveTabPillMeasurement])

  return (
    <div
      ref={rootRef}
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="right-aside"
      data-active-tab={activeTab}
    >
      {/* ── Tab bar ─────────────────────────────────────── */}
      <div className="flex shrink-0 justify-center border-b border-border px-2 py-1.5">
        <LayoutGroup id="right-aside-tabs">
          <div
            ref={tabListRef}
            className="relative flex items-center justify-center"
            style={{ gap: TAB_GAP }}
          >
            <m.span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 z-0 rounded-md bg-accent will-change-transform"
              style={{
                opacity: swipePreview ? 0 : tabPillOpacity,
                width: tabPillWidth,
                x: tabPillX,
              }}
            />
            {swipePreviewTab && SwipePreviewIcon && (
              <m.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 z-20 inline-flex h-7 items-center justify-center rounded-md bg-accent px-2 text-xs text-foreground will-change-transform"
                style={{ x: tabPillX }}
              >
                <SwipePreviewIcon className="relative size-3.5 shrink-0" />
                <span className="ml-1.5 whitespace-nowrap">{t(swipePreviewTab.labelKey)}</span>
              </m.div>
            )}
            {TABS.map(({ id, labelKey, icon: Icon }) => {
              const isActive = activeTab === id
              const isPreviewTarget = swipePreview?.targetTabId === id
              const showBaseLabel = isActive && !swipePreview
              const showBadge = id === 'await' && hasPendingAwaits && !isActive
              const label = t(labelKey)

              const button = (
                <m.button
                  type="button"
                  layout
                  onClick={() => activateTab(id)}
                  aria-label={label}
                  data-right-aside-tab-id={id}
                  data-testid={`right-aside-tab-${id}`}
                  data-active={isActive ? 'true' : 'false'}
                  initial={false}
                  transition={TAB_SPRING}
                  className={cn(
                    'relative z-10 grid h-7 place-items-center overflow-hidden rounded-md px-2 text-xs select-none',
                    'transition-[color] duration-150 ease-out',
                    {
                      'text-foreground': isActive,
                      'text-foreground/80': !isActive && isPreviewTarget,
                      'text-muted-foreground hover:text-foreground': !isActive && !isPreviewTarget,
                    },
                  )}
                >
                  <span className="relative flex min-w-0 items-center justify-center">
                    <Icon className="relative size-3.5 shrink-0" aria-hidden="true" />
                    <m.span
                      aria-hidden={!showBaseLabel}
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
                          opacity: showBaseLabel ? 1 : 0,
                          x: isActive ? 0 : 6,
                          filter: showBaseLabel ? 'blur(0px)' : 'blur(3px)',
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
        {swipePreview
? (
          <>
            <m.div
              className="absolute inset-0 flex flex-col overflow-hidden will-change-transform"
              style={{ x: currentPanelX }}
            >
              <RightAsidePanelContent
                tabId={activeTab}
                sessionId={sessionId}
                workspaceId={workspaceId}
                workspacePath={workspacePath}
                issueEmptyLabel={t('rightAside.issue.empty')}
                runtimeKind={sessionMeta?.runtimeKind ?? null}
                providerTargetId={sessionMeta?.providerTargetId ?? null}
                onPackRequested={handlePackRequested}
              />
            </m.div>
            <m.div
              className="absolute inset-0 flex flex-col overflow-hidden will-change-transform"
              style={{ x: adjacentPanelX }}
            >
              <RightAsidePanelContent
                tabId={swipePreview.targetTabId}
                sessionId={sessionId}
                workspaceId={workspaceId}
                workspacePath={workspacePath}
                issueEmptyLabel={t('rightAside.issue.empty')}
                runtimeKind={sessionMeta?.runtimeKind ?? null}
                providerTargetId={sessionMeta?.providerTargetId ?? null}
                onPackRequested={handlePackRequested}
              />
            </m.div>
          </>
        )
: (
          <AnimatePresence initial={false} custom={panelDirection}>
            <m.div
              key={activeTab}
              custom={panelDirection}
              variants={PANEL_SLIDE_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              transition={PANEL_SLIDE_TRANSITION}
              className="absolute inset-0 flex flex-col overflow-hidden"
            >
              <RightAsidePanelContent
                tabId={activeTab}
                sessionId={sessionId}
                workspaceId={workspaceId}
                workspacePath={workspacePath}
                issueEmptyLabel={t('rightAside.issue.empty')}
                runtimeKind={sessionMeta?.runtimeKind ?? null}
                providerTargetId={sessionMeta?.providerTargetId ?? null}
                onPackRequested={handlePackRequested}
              />
            </m.div>
          </AnimatePresence>
        )}
      </div>

      {workspaceId && workspaceName && (
        <PackCodebaseDialog
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          initialPaths={packInitialPaths}
          open={packOpen}
          onOpenChange={setPackOpen}
        />
      )}
    </div>
  )
}
