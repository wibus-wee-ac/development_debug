// FILE: browser-panel.tsx
// Purpose: Renders Cradle's BrowserPanel chrome and anchors the native Electron WebContentsView.
// Layer: Browser feature UI
// Depends on: BrowserPanel Zustand metadata cache, Electron browser preload bridge

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { cn } from '~/lib/cn'
import { isElectron } from '~/lib/electron'
import {
  DEFAULT_BROWSER_PANEL_OWNER_ID,
  handleBrowserPanelTabShortcut,
  selectOwnerBrowserHistory,
  selectOwnerBrowserState,
  useBrowserPanelStore,
  type BrowserTabState,
} from '~/store/browser-panel'

import {
  browserAddressDisplayValue,
  buildBrowserAddressSuggestions,
  normalizeBrowserAddressInput,
  resolveBrowserAddressSync,
  resolveBrowserChromeStatus,
  type BrowserAddressSuggestion,
} from './browser-panel.logic'

interface BrowserPanelProps {
  ownerId?: string | null
  activeSessionId?: string | null
  activeSessionTitle?: string | null
  onCloseLastTab?: (ownerId: string) => void
}

const BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET = 2

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

export function BrowserPanel({
  ownerId = null,
  onCloseLastTab,
}: BrowserPanelProps) {
  const resolvedOwnerId = ownerId ?? DEFAULT_BROWSER_PANEL_OWNER_ID
  const browserState = useBrowserPanelStore(selectOwnerBrowserState(resolvedOwnerId))
  const recentHistory = useBrowserPanelStore(selectOwnerBrowserHistory(resolvedOwnerId))
  const requestedTab = useBrowserPanelStore(state => state.owners[resolvedOwnerId]?.requestedTab ?? null)
  const setActiveOwner = useBrowserPanelStore(state => state.setActiveOwner)
  const upsertOwnerState = useBrowserPanelStore(state => state.upsertOwnerState)
  const fulfillRequestedTab = useBrowserPanelStore(state => state.fulfillRequestedTab)
  const removeOwnerState = useBrowserPanelStore(state => state.removeOwnerState)

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

  const tabs = browserState?.tabs ?? []
  const activeTab = tabs.find(tab => tab.id === browserState?.activeTabId) ?? tabs[0] ?? null
  const activeTabId = activeTab?.id ?? null
  const suggestions = useMemo(
    () =>
      buildBrowserAddressSuggestions({
        query: addressValue,
        activeTabId,
        tabs,
        recentHistory,
      }),
    [activeTabId, addressValue, recentHistory, tabs],
  )
  const chromeStatus = resolveBrowserChromeStatus({
    localError,
    threadLastError: browserState?.lastError,
    activeTabStatus: activeTab?.status ?? 'suspended',
    hasActiveTab: Boolean(activeTab),
    workspaceReady: Boolean(browserState),
  })

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

    void bridge.open({ threadId: resolvedOwnerId }).then(upsertOwnerState).catch((error) => {
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
      .then(upsertOwnerState)
      .catch((error) => {
        setLocalError(formatBrowserActionError(error))
      })
      .finally(() => {
        fulfillRequestedTab(requestedTab.id, resolvedOwnerId)
      })
  }, [browserState?.open, fulfillRequestedTab, requestedTab, resolvedOwnerId, upsertOwnerState])

  const syncBounds = useCallback(() => {
    const bridge = readBrowserBridge()
    const element = viewportRef.current
    if (!bridge || !element) {
      return
    }

    const rect = element.getBoundingClientRect()
    const visible = rect.width > 0 && rect.height > 0 && browserState?.open
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
  }, [browserState?.open, resolvedOwnerId])

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
  }, [resolvedOwnerId, scheduleStableBoundsSync])

  useEffect(() => {
    scheduleStableBoundsSync()
  }, [activeTabId, scheduleStableBoundsSync])

  useEffect(() => {
    const nextDisplayValue = browserAddressDisplayValue(activeTab)
    const decision = resolveBrowserAddressSync({
      activeTabId,
      previousActiveTabId: previousActiveTabIdRef.current,
      savedDraft: activeTabId ? addressDraftByTabIdRef.current.get(activeTabId) : undefined,
      nextDisplayValue,
      lastSyncedValue: lastSyncedAddressValueRef.current,
      isEditing: isEditingAddress,
    })
    previousActiveTabIdRef.current = activeTabId

    if (decision.type === 'replace') {
      setAddressValue(decision.value)
      lastSyncedAddressValueRef.current = decision.syncedValue
    }
  }, [activeTab, activeTabId, isEditingAddress])

  const runBrowserAction = useCallback(
    async (action: () => Promise<unknown>) => {
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
    },
    [],
  )

  const handleNewTab = useCallback(() => {
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }
    void runBrowserAction(async () => {
      upsertOwnerState(await bridge.newTab({ threadId: resolvedOwnerId, url: 'about:blank', activate: true }))
    })
  }, [resolvedOwnerId, runBrowserAction, upsertOwnerState])

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const bridge = readBrowserBridge()
      if (!bridge) {
        return
      }
      void runBrowserAction(async () => {
        const nextState = await bridge.closeTab({ threadId: resolvedOwnerId, tabId })
        upsertOwnerState(nextState)
        if (nextState.tabs.length === 0) {
          removeOwnerState(resolvedOwnerId)
          onCloseLastTab?.(resolvedOwnerId)
        }
      })
    },
    [onCloseLastTab, removeOwnerState, resolvedOwnerId, runBrowserAction, upsertOwnerState],
  )

  const handleSelectTab = useCallback(
    (tabId: string) => {
      const bridge = readBrowserBridge()
      if (!bridge) {
        return
      }
      void runBrowserAction(async () => {
        upsertOwnerState(await bridge.selectTab({ threadId: resolvedOwnerId, tabId }))
      })
    },
    [resolvedOwnerId, runBrowserAction, upsertOwnerState],
  )

  const navigateActiveTab = useCallback(
    (url: string) => {
      if (!activeTabId) {
        return
      }
      const bridge = readBrowserBridge()
      if (!bridge) {
        return
      }
      void runBrowserAction(async () => {
        const normalizedUrl = normalizeBrowserAddressInput(url)
        upsertOwnerState(await bridge.navigate({ threadId: resolvedOwnerId, tabId: activeTabId, url: normalizedUrl }))
        lastSyncedAddressValueRef.current = browserAddressDisplayValue({ url: normalizedUrl })
        addressDraftByTabIdRef.current.delete(activeTabId)
        setSuggestionsOpen(false)
      })
    },
    [activeTabId, resolvedOwnerId, runBrowserAction, upsertOwnerState],
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

  if (!isElectron) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground" data-testid="browser-panel">
        Browser Panel is available in the desktop app.
      </div>
    )
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-testid="browser-panel"
      data-browser-panel-ready="true"
      onKeyDownCapture={(event) => {
        handleBrowserPanelTabShortcut(event.nativeEvent, {
          panelOpen: true,
          ownerId: resolvedOwnerId,
          onCloseLastTab,
        })
      }}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 bg-card px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={cn(
                'group flex h-7 max-w-44 shrink-0 items-center rounded-md text-[11px] transition-colors',
                tab.id === activeTabId
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground',
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-l-md py-1 pl-2 pr-1 text-left"
                onClick={() => handleSelectTab(tab.id)}
                aria-current={tab.id === activeTabId ? 'page' : undefined}
              >
                {tab.isLoading ? (
                  <LoaderCircleIcon className="size-3 shrink-0 animate-spin text-primary" aria-hidden="true" />
                ) : tab.faviconUrl ? (
                  <img src={tab.faviconUrl} alt="" className="size-3 shrink-0 rounded-sm" />
                ) : (
                  <GlobeIcon className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                )}
                <span className="truncate">{getTabTitle(tab)}</span>
              </button>
              <button
                type="button"
                className="mr-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => handleCloseTab(tab.id)}
                aria-label={`Close ${getTabTitle(tab)}`}
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
            disabled={!activeTab?.canGoBack}
            onClick={() => {
              const bridge = readBrowserBridge()
              if (bridge && activeTabId) {
                void runBrowserAction(async () => {
                  upsertOwnerState(await bridge.goBack({ threadId: resolvedOwnerId, tabId: activeTabId }))
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
            disabled={!activeTab?.canGoForward}
            onClick={() => {
              const bridge = readBrowserBridge()
              if (bridge && activeTabId) {
                void runBrowserAction(async () => {
                  upsertOwnerState(await bridge.goForward({ threadId: resolvedOwnerId, tabId: activeTabId }))
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
            disabled={!activeTabId}
            onClick={() => {
              const bridge = readBrowserBridge()
              if (bridge && activeTabId) {
                void runBrowserAction(async () => {
                  upsertOwnerState(await bridge.reload({ threadId: resolvedOwnerId, tabId: activeTabId }))
                })
              }
            }}
            aria-label="Reload"
          >
            <RefreshCwIcon className={cn('size-3.5', activeTab?.isLoading && 'animate-spin')} />
          </button>
        </div>

        <form className="relative min-w-0 flex-1" onSubmit={handleAddressSubmit}>
          <input
            type="text"
            value={addressValue}
            placeholder="Search or enter address"
            aria-label="Search or enter address"
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
              if (activeTabId) {
                addressDraftByTabIdRef.current.set(activeTabId, nextValue)
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
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSuggestion(suggestion)}
                >
                  {suggestion.faviconUrl ? (
                    <img src={suggestion.faviconUrl} alt="" className="size-3.5 shrink-0 rounded-sm" />
                  ) : (
                    <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{suggestion.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{suggestion.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>

        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
          disabled={!activeTabId}
          onClick={() => {
            const bridge = readBrowserBridge()
            if (bridge && activeTabId) {
              void runBrowserAction(() => bridge.copyScreenshotToClipboard({ threadId: resolvedOwnerId, tabId: activeTabId }))
            }
          }}
          aria-label="Copy screenshot"
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

      <div ref={viewportRef} className="relative min-h-0 flex-1 bg-background">
        {!activeTab && (
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
