// FILE: browser-panel.tsx
// Purpose: Renders Cradle's BrowserPanel chrome and anchors the native Electron WebContentsView.
// Layer: Browser feature UI
// Depends on: BrowserPanel Zustand metadata cache, Electron browser preload bridge

import type { FileUIPart } from 'ai'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  CameraIcon,
  FileDiffIcon,
  FileTextIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { submitChatComposerFileIngress } from '~/features/chat/prompt-ingress'
import { WorkspaceFileEditor } from '~/features/workspace/workspace-file-editor'
import { WorkspaceFilePreview } from '~/features/workspace/workspace-file-preview'
import { cn } from '~/lib/cn'
import { isElectron } from '~/lib/electron'
import type { BrowserPanelTab, BrowserTabState, BrowserWebTab } from '~/store/browser-panel'
import {
  DEFAULT_BROWSER_PANEL_OWNER_ID,
  selectOwnerBrowserHistory,
  selectOwnerBrowserState,
  useBrowserPanelStore,
} from '~/store/browser-panel'

import type { BrowserAddressSuggestion } from './browser-panel.logic'
import {
  browserAddressDisplayValue,
  buildBrowserAddressSuggestions,
  normalizeBrowserAddressInput,
  resolveBrowserAddressSync,
  resolveBrowserChromeStatus,
} from './browser-panel.logic'
import { SubagentOutputPanel } from './subagent-output-panel'
import { WorkspaceDiffViewer } from './workspace-diff-viewer'

interface BrowserPanelProps {
  ownerId?: string | null
  activeSessionId?: string | null
  activeSessionTitle?: string | null
  onCloseLastTab?: (ownerId: string) => void
}

const BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET = 2
const BROWSER_SCREENSHOT_CHUNK_SIZE = 0x8000
const EMPTY_BROWSER_PANEL_TABS: BrowserPanelTab[] = []

function readBrowserBridge() {
  return window.cradle?.browser ?? null
}

function formatBrowserActionError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return 'Browser action failed.'
  }
  if (/ERR_ABORTED|\(-3\)/i.test(error.message)) {
    return null
  }
  return error.message || 'Browser action failed.'
}

function getTabTitle(tab: BrowserTabState): string {
  if (tab.title && tab.title !== 'about:blank') {
    return tab.title
  }
  if (tab.url === 'about:blank') {
    return 'New tab'
  }
  return tab.url
}

function getPanelTabTitle(tab: BrowserPanelTab): string {
  if (tab.kind === 'browser') {
    return getTabTitle(tab)
  }
  return tab.title
}

function isBrowserPanelTab(tab: BrowserPanelTab): tab is BrowserWebTab {
  return tab.kind === 'browser'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BROWSER_SCREENSHOT_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BROWSER_SCREENSHOT_CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return window.btoa(binary)
}

function createBrowserScreenshotFilePart(input: {
  name: string
  mimeType: 'image/png'
  bytes: Uint8Array
}): FileUIPart {
  return {
    type: 'file',
    filename: input.name,
    mediaType: input.mimeType,
    url: `data:${input.mimeType};base64,${bytesToBase64(input.bytes)}`,
  }
}

export function BrowserPanel({
  ownerId = null,
  activeSessionId = null,
  onCloseLastTab,
}: BrowserPanelProps) {
  const resolvedOwnerId = ownerId ?? DEFAULT_BROWSER_PANEL_OWNER_ID
  const browserState = useBrowserPanelStore(selectOwnerBrowserState(resolvedOwnerId))
  const recentHistory = useBrowserPanelStore(selectOwnerBrowserHistory(resolvedOwnerId))
  const requestedTab = useBrowserPanelStore(
    state => state.owners[resolvedOwnerId]?.requestedTab ?? null,
  )
  const setActiveOwner = useBrowserPanelStore(state => state.setActiveOwner)
  const upsertOwnerState = useBrowserPanelStore(state => state.upsertOwnerState)
  const fulfillRequestedTab = useBrowserPanelStore(state => state.fulfillRequestedTab)
  const removeOwnerState = useBrowserPanelStore(state => state.removeOwnerState)
  const setActiveTab = useBrowserPanelStore(state => state.setActiveTab)
  const closePanelTab = useBrowserPanelStore(state => state.closeTab)
  const openWorkspaceFileTab = useBrowserPanelStore(state => state.openWorkspaceFileTab)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const previousActiveTabIdRef = useRef<string | null>(null)
  const addressDraftByTabIdRef = useRef<Map<string, string>>(new Map())
  const lastSyncedAddressValueRef = useRef<string | undefined>(undefined)
  const stableBoundsFrameCountRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)

  const [addressValue, setAddressValue] = useState('')
  const [isEditingAddress, setIsEditingAddress] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)

  const tabs = useBrowserPanelStore(
    state => state.owners[resolvedOwnerId]?.tabs ?? EMPTY_BROWSER_PANEL_TABS,
  )
  const activePanelTabId = useBrowserPanelStore(
    state => state.owners[resolvedOwnerId]?.activeTabId ?? null,
  )
  const browserTabs = useMemo(() => tabs.filter(isBrowserPanelTab), [tabs])
  const activePanelTab = tabs.find(tab => tab.id === activePanelTabId) ?? tabs[0] ?? null
  const activeBrowserTab = activePanelTab?.kind === 'browser' ? activePanelTab : null
  const activeBrowserTabId = activeBrowserTab?.id ?? null
  const suggestions = useMemo(
    () =>
      buildBrowserAddressSuggestions({
        query: addressValue,
        activeTabId: activeBrowserTabId,
        tabs: browserTabs,
        recentHistory,
      }),
    [activeBrowserTabId, addressValue, browserTabs, recentHistory],
  )
  const chromeStatus = activePanelTab?.kind === 'browser' || localError || browserState?.lastError
    ? resolveBrowserChromeStatus({
        localError,
        threadLastError: browserState?.lastError,
        activeTabStatus: activeBrowserTab?.status ?? 'suspended',
        hasActiveTab: Boolean(activeBrowserTab),
        workspaceReady: Boolean(browserState),
      })
    : null

  useEffect(() => {
    setActiveOwner(resolvedOwnerId)
  }, [resolvedOwnerId, setActiveOwner])

  useEffect(() => {
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }

    const unsubscribe = bridge.onState((state) => {
      upsertOwnerState(state)
    })

    void bridge
      .getState({ threadId: resolvedOwnerId })
      .then(upsertOwnerState)
      .catch((error) => {
        setLocalError(formatBrowserActionError(error))
      })

    return () => {
      unsubscribe()
      void bridge.hide({ threadId: resolvedOwnerId }).catch(() => {})
    }
  }, [resolvedOwnerId, upsertOwnerState])

  useEffect(() => {
    if (!requestedTab) {
      return
    }

    const bridge = readBrowserBridge()
    if (!bridge) {
      fulfillRequestedTab(requestedTab.id, resolvedOwnerId)
      return
    }

    const url = requestedTab.url ?? 'about:blank'
    const action = browserState?.open
      ? bridge.newTab({ threadId: resolvedOwnerId, url, activate: true })
      : bridge.open({ threadId: resolvedOwnerId, initialUrl: url })

    void action
      .then((nextState) => {
        upsertOwnerState(nextState)
        if (nextState.activeTabId) {
          setActiveTab(nextState.activeTabId, resolvedOwnerId)
        }
      })
      .catch((error) => {
        setLocalError(formatBrowserActionError(error))
      })
      .finally(() => {
        fulfillRequestedTab(requestedTab.id, resolvedOwnerId)
      })
  }, [
    browserState?.open,
    fulfillRequestedTab,
    requestedTab,
    resolvedOwnerId,
    setActiveTab,
    upsertOwnerState,
  ])

  const syncBounds = useCallback(() => {
    const bridge = readBrowserBridge()
    const element = viewportRef.current
    if (!bridge || !element) {
      return
    }

    const rect = element.getBoundingClientRect()
    const visible
      = rect.width > 0 && rect.height > 0 && browserState?.open && activePanelTab?.kind === 'browser'
    if (!visible) {
      bridge.setBounds({ threadId: resolvedOwnerId, bounds: null, surface: 'native' })
      return
    }

    bridge.setBounds({
      threadId: resolvedOwnerId,
      surface: 'native',
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    })
  }, [activePanelTab?.kind, browserState?.open, resolvedOwnerId])

  const scheduleStableBoundsSync = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return
    }

    const tick = () => {
      syncBounds()
      stableBoundsFrameCountRef.current += 1
      if (stableBoundsFrameCountRef.current < BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET) {
        animationFrameRef.current = window.requestAnimationFrame(tick)
        return
      }
      animationFrameRef.current = null
      stableBoundsFrameCountRef.current = 0
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [syncBounds])

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) {
      readBrowserBridge()?.setBounds({ threadId: resolvedOwnerId, bounds: null, surface: 'native' })
      return
    }

    scheduleStableBoundsSync()
    const resizeObserver = new ResizeObserver(scheduleStableBoundsSync)
    resizeObserver.observe(element)
    window.addEventListener('resize', scheduleStableBoundsSync)
    window.addEventListener('scroll', scheduleStableBoundsSync, true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleStableBoundsSync)
      window.removeEventListener('scroll', scheduleStableBoundsSync, true)
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      readBrowserBridge()?.setBounds({ threadId: resolvedOwnerId, bounds: null, surface: 'native' })
    }
  }, [activePanelTab?.kind, resolvedOwnerId, scheduleStableBoundsSync])

  useEffect(() => {
    scheduleStableBoundsSync()
  }, [activePanelTab?.id, scheduleStableBoundsSync])

  useEffect(() => {
    const nextDisplayValue = browserAddressDisplayValue(activeBrowserTab)
    const decision = resolveBrowserAddressSync({
      activeTabId: activeBrowserTabId,
      previousActiveTabId: previousActiveTabIdRef.current,
      savedDraft: activeBrowserTabId
        ? addressDraftByTabIdRef.current.get(activeBrowserTabId)
        : undefined,
      nextDisplayValue,
      lastSyncedValue: lastSyncedAddressValueRef.current,
      isEditing: isEditingAddress,
    })
    previousActiveTabIdRef.current = activeBrowserTabId

    if (decision.type === 'replace') {
      setAddressValue(decision.value)
      lastSyncedAddressValueRef.current = decision.syncedValue
    }
  }, [activeBrowserTab, activeBrowserTabId, isEditingAddress])

  const runBrowserAction = useCallback(async (action: () => Promise<unknown>) => {
    setLocalError(null)
    try {
      await action()
    }
    catch (error) {
      const message = formatBrowserActionError(error)
      if (message) {
        setLocalError(message)
      }
    }
  }, [])

  const handleNewTab = useCallback(() => {
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }
    void runBrowserAction(async () => {
      const nextState = browserState?.open
        ? await bridge.newTab({
            threadId: resolvedOwnerId,
            url: 'about:blank',
            activate: true,
          })
        : await bridge.open({ threadId: resolvedOwnerId, initialUrl: 'about:blank' })
      upsertOwnerState(nextState)
      if (nextState.activeTabId) {
        setActiveTab(nextState.activeTabId, resolvedOwnerId)
      }
    })
  }, [browserState?.open, resolvedOwnerId, runBrowserAction, setActiveTab, upsertOwnerState])

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find(item => item.id === tabId)
      if (!tab) {
        return
      }

      if (tab.kind !== 'browser') {
        const result = closePanelTab(tabId, resolvedOwnerId)
        if (result.closedLastTab) {
          removeOwnerState(resolvedOwnerId)
          onCloseLastTab?.(resolvedOwnerId)
          return
        }
        const nextOwnerState = useBrowserPanelStore.getState().owners[resolvedOwnerId]
        const nextActiveBrowserTab = nextOwnerState?.tabs.find(
          item => item.id === nextOwnerState.activeTabId && item.kind === 'browser',
        )
        const bridge = readBrowserBridge()
        if (nextActiveBrowserTab && bridge) {
          void runBrowserAction(async () => {
            upsertOwnerState(
              await bridge.selectTab({
                threadId: resolvedOwnerId,
                tabId: nextActiveBrowserTab.id,
              }),
            )
          })
        }
        return
      }

      const bridge = readBrowserBridge()
      if (!bridge) {
        const result = closePanelTab(tabId, resolvedOwnerId)
        if (result.closedLastTab) {
          removeOwnerState(resolvedOwnerId)
          onCloseLastTab?.(resolvedOwnerId)
        }
        return
      }

      void runBrowserAction(async () => {
        const nextState = await bridge.closeTab({ threadId: resolvedOwnerId, tabId })
        upsertOwnerState(nextState)
        const remainingTabs
          = useBrowserPanelStore.getState().owners[resolvedOwnerId]?.tabs ?? EMPTY_BROWSER_PANEL_TABS
        if (remainingTabs.length === 0) {
          removeOwnerState(resolvedOwnerId)
          onCloseLastTab?.(resolvedOwnerId)
        }
      })
    },
    [
      closePanelTab,
      onCloseLastTab,
      removeOwnerState,
      resolvedOwnerId,
      runBrowserAction,
      tabs,
      upsertOwnerState,
    ],
  )

  const handleSelectTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find(item => item.id === tabId)
      if (!tab) {
        return
      }
      if (tab.kind !== 'browser') {
        setActiveTab(tabId, resolvedOwnerId)
        return
      }

      const bridge = readBrowserBridge()
      if (!bridge) {
        setActiveTab(tabId, resolvedOwnerId)
        return
      }
      void runBrowserAction(async () => {
        upsertOwnerState(await bridge.selectTab({ threadId: resolvedOwnerId, tabId }))
        setActiveTab(tabId, resolvedOwnerId)
      })
    },
    [resolvedOwnerId, runBrowserAction, setActiveTab, tabs, upsertOwnerState],
  )

  const navigateActiveTab = useCallback(
    (url: string) => {
      if (!activeBrowserTabId) {
        return
      }
      const bridge = readBrowserBridge()
      if (!bridge) {
        return
      }
      void runBrowserAction(async () => {
        const normalizedUrl = normalizeBrowserAddressInput(url)
        upsertOwnerState(
          await bridge.navigate({
            threadId: resolvedOwnerId,
            tabId: activeBrowserTabId,
            url: normalizedUrl,
          }),
        )
        lastSyncedAddressValueRef.current = browserAddressDisplayValue({ url: normalizedUrl })
        addressDraftByTabIdRef.current.delete(activeBrowserTabId)
        setSuggestionsOpen(false)
      })
    },
    [activeBrowserTabId, resolvedOwnerId, runBrowserAction, upsertOwnerState],
  )

  const handleSuggestion = useCallback(
    (suggestion: BrowserAddressSuggestion) => {
      if (suggestion.kind === 'tab' && suggestion.tabId) {
        handleSelectTab(suggestion.tabId)
        setSuggestionsOpen(false)
        return
      }
      navigateActiveTab(suggestion.url)
    },
    [handleSelectTab, navigateActiveTab],
  )

  const handleAddressSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      navigateActiveTab(addressValue)
    },
    [addressValue, navigateActiveTab],
  )

  const handleCaptureScreenshot = useCallback(() => {
    if (!activeBrowserTabId) {
      return
    }
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }
    void runBrowserAction(async () => {
      if (!activeSessionId) {
        throw new Error('Open a chat session to attach browser screenshots.')
      }
      const screenshot = await bridge.captureScreenshot({
        threadId: resolvedOwnerId,
        tabId: activeBrowserTabId,
      })
      const attached = submitChatComposerFileIngress(activeSessionId, [
        createBrowserScreenshotFilePart({
          name: screenshot.name,
          mimeType: screenshot.mimeType,
          bytes: screenshot.bytes,
        }),
      ])
      if (!attached) {
        throw new Error('The active composer is not ready for browser screenshots.')
      }
    })
  }, [activeBrowserTabId, activeSessionId, resolvedOwnerId, runBrowserAction])

  const handlePanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const isCommandOnly
        = event.nativeEvent.metaKey
          && !event.nativeEvent.altKey
          && !event.nativeEvent.ctrlKey
          && !event.nativeEvent.shiftKey
      if (!isCommandOnly) {
        return
      }

      const key = event.nativeEvent.key.toLowerCase()
      if (key === 'w' && activePanelTab) {
        event.preventDefault()
        event.stopPropagation()
        event.nativeEvent.stopImmediatePropagation()
        handleCloseTab(activePanelTab.id)
        return
      }

      if (!/^\d$/.test(key)) {
        return
      }

      const targetIndex = key === '0' ? 9 : Number.parseInt(key, 10) - 1
      const targetTab = tabs[targetIndex]
      if (!targetTab) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      handleSelectTab(targetTab.id)
    },
    [activePanelTab, handleCloseTab, handleSelectTab, tabs],
  )

  if (!isElectron) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-xs text-muted-foreground"
        data-testid="browser-panel"
      >
        Browser Panel is available in the desktop app.
      </div>
    )
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-testid="browser-panel"
      data-browser-panel-ready="true"
      onKeyDownCapture={handlePanelKeyDown}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 bg-card px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={cn(
                'group flex h-7 max-w-44 shrink-0 items-center rounded-md text-[11px] transition-colors',
                tab.id === activePanelTabId
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground',
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-l-md py-1 pl-2 pr-1 text-left"
                onClick={() => handleSelectTab(tab.id)}
                aria-current={tab.id === activePanelTabId ? 'page' : undefined}
              >
                {tab.kind === 'browser' && tab.isLoading && (
                  <LoaderCircleIcon
                    className="size-3 shrink-0 animate-spin text-primary"
                    aria-hidden="true"
                  />
                )}
                {tab.kind === 'browser' && !tab.isLoading && tab.faviconUrl && (
                  <img src={tab.faviconUrl} alt="" className="size-3 shrink-0 rounded-sm" />
                )}
                {tab.kind === 'browser' && !tab.isLoading && !tab.faviconUrl && (
                  <GlobeIcon
                    className="size-3 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                )}
                {tab.kind === 'workspace-file' && (
                  <FileTextIcon className="size-3 shrink-0 text-muted-foreground/60" />
                )}
                {tab.kind === 'workspace-diff' && (
                  <FileDiffIcon className="size-3 shrink-0 text-muted-foreground/60" />
                )}
                {tab.kind === 'subagent' && (
                  <BotIcon className="size-3 shrink-0 text-muted-foreground/60" />
                )}
                <span className="truncate">{getPanelTabTitle(tab)}</span>
                {tab.kind === 'browser'
                  && tab.sessionId
                  && tab.sessionId !== activeSessionId
                  && tab.sessionTitle && (
                    <span
                      className="ml-0.5 shrink-0 rounded-sm bg-foreground/7 px-1 text-[9px] text-muted-foreground"
                      aria-label={`From ${tab.sessionTitle}`}
                    >
                      {tab.sessionTitle}
                    </span>
                  )}
              </button>
              <button
                type="button"
                className="mr-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => handleCloseTab(tab.id)}
                aria-label={`Close ${getPanelTabTitle(tab)}`}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
            onClick={handleNewTab}
            aria-label="New browser tab"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-border/50 bg-card px-2">
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
            disabled={!activeBrowserTab?.canGoBack}
            onClick={() => {
              const bridge = readBrowserBridge()
              if (bridge && activeBrowserTabId) {
                void runBrowserAction(async () => {
                  upsertOwnerState(
                    await bridge.goBack({ threadId: resolvedOwnerId, tabId: activeBrowserTabId }),
                  )
                })
              }
            }}
            aria-label="Go back"
          >
            <ArrowLeftIcon className="size-3.5" />
          </button>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
            disabled={!activeBrowserTab?.canGoForward}
            onClick={() => {
              const bridge = readBrowserBridge()
              if (bridge && activeBrowserTabId) {
                void runBrowserAction(async () => {
                  upsertOwnerState(
                    await bridge.goForward({
                      threadId: resolvedOwnerId,
                      tabId: activeBrowserTabId,
                    }),
                  )
                })
              }
            }}
            aria-label="Go forward"
          >
            <ArrowRightIcon className="size-3.5" />
          </button>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
            disabled={!activeBrowserTabId}
            onClick={() => {
              const bridge = readBrowserBridge()
              if (bridge && activeBrowserTabId) {
                void runBrowserAction(async () => {
                  upsertOwnerState(
                    await bridge.reload({
                      threadId: resolvedOwnerId,
                      tabId: activeBrowserTabId,
                    }),
                  )
                })
              }
            }}
            aria-label="Reload"
          >
            <RefreshCwIcon
              className={cn('size-3.5', activeBrowserTab?.isLoading && 'animate-spin')}
            />
          </button>
        </div>

        <form className="relative min-w-0 flex-1" onSubmit={handleAddressSubmit}>
          <input
            type="text"
            value={addressValue}
            placeholder="Search or enter address"
            aria-label="Search or enter address"
            disabled={!activeBrowserTab}
            className="h-7 w-full rounded-md bg-foreground/5 px-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:bg-foreground/8"
            onFocus={() => {
              setIsEditingAddress(true)
              setSuggestionsOpen(true)
            }}
            onBlur={() => {
              window.setTimeout(() => {
                setIsEditingAddress(false)
                setSuggestionsOpen(false)
              }, 120)
            }}
            onChange={(event) => {
              const nextValue = event.target.value
              setAddressValue(nextValue)
              if (activeBrowserTabId) {
                addressDraftByTabIdRef.current.set(activeBrowserTabId, nextValue)
              }
              setSuggestionsOpen(true)
            }}
          />
          {suggestionsOpen && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-8 z-20 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg">
              {suggestions.map(suggestion => (
                <button
                  key={suggestion.id}
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-foreground/5"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => handleSuggestion(suggestion)}
                >
                  {suggestion.faviconUrl && (
                    <img
                      src={suggestion.faviconUrl}
                      alt=""
                      className="size-3.5 shrink-0 rounded-sm"
                    />
                  )}
                  {!suggestion.faviconUrl && (
                    <GlobeIcon
                      className="size-3.5 shrink-0 text-muted-foreground/60"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{suggestion.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {suggestion.detail}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>

        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
          disabled={!activeBrowserTabId}
          onClick={handleCaptureScreenshot}
          aria-label="Attach screenshot to composer"
        >
          <CameraIcon className="size-3.5" />
        </button>
      </div>

      {chromeStatus && (
        <div
          className={cn(
            'flex h-7 shrink-0 items-center border-b px-3 text-[11px]',
            chromeStatus.tone === 'error'
              ? 'border-destructive/20 bg-destructive/8 text-destructive'
              : 'border-border/40 bg-muted/40 text-muted-foreground',
          )}
        >
          {chromeStatus.label}
        </div>
      )}

      <div className="relative min-h-0 flex-1 bg-background">
        {activePanelTab?.kind === 'browser' && (
          <div ref={viewportRef} className="absolute inset-0 bg-background" />
        )}

        {activePanelTab?.kind === 'workspace-file' && activePanelTab.view === 'preview' && (
          <WorkspaceFilePreview
            workspaceId={activePanelTab.workspaceId}
            path={activePanelTab.path}
            onOpenEditor={(path) => {
              openWorkspaceFileTab({
                workspaceId: activePanelTab.workspaceId,
                path,
                view: 'editor',
                ownerId: resolvedOwnerId,
              })
            }}
          />
        )}

        {activePanelTab?.kind === 'workspace-file' && activePanelTab.view === 'editor' && (
          <WorkspaceFileEditor workspaceId={activePanelTab.workspaceId} path={activePanelTab.path} />
        )}

        {activePanelTab?.kind === 'workspace-diff' && (
          <WorkspaceDiffViewer
            ownerId={resolvedOwnerId}
            tabId={activePanelTab.id}
            workspaceId={activePanelTab.workspaceId}
            paths={activePanelTab.paths}
          />
        )}

        {activePanelTab?.kind === 'subagent' && (
          <SubagentOutputPanel
            sessionId={activePanelTab.sessionId}
            threadId={activePanelTab.threadId}
            agentName={activePanelTab.agentName}
            agentRole={activePanelTab.agentRole}
          />
        )}

        {!activePanelTab && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground/70">
            <GlobeIcon className="size-9 opacity-40" />
            <button
              type="button"
              onClick={handleNewTab}
              className="rounded-md bg-foreground/5 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
            >
              New Tab
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
