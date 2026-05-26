import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Code2Icon,
  EyeIcon,
  FileCodeIcon,
  FileDiffIcon,
  GlobeIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon
} from 'lucide-react'
import { Activity, createElement, useCallback, useEffect, useRef, useState } from 'react'

import { WorkspaceFileEditor } from '~/features/workspace/workspace-file-editor'
import { WorkspaceFilePreview } from '~/features/workspace/workspace-file-preview'
import { cn } from '~/lib/cn'
import { isElectron } from '~/lib/electron'
import type { BrowserPanelTab } from '~/store/browser-panel'
import { handleBrowserPanelTabShortcut, useBrowserPanelStore } from '~/store/browser-panel'

import { WorkspaceDiffViewer } from './workspace-diff-viewer'

// Electron webview element — not in React's JSX types
type WebviewElement = HTMLElement & {
  src: string
  __cleanup?: () => void
  loadURL: (url: string) => Promise<void>
  goBack: () => void
  goForward: () => void
  reload: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  getTitle: () => string
  isLoading: () => boolean
  executeJavaScript: (code: string) => Promise<unknown>
  addEventListener: (event: string, handler: (...args: unknown[]) => void) => void
  removeEventListener: (event: string, handler: (...args: unknown[]) => void) => void
}

// Script injection presets
const INJECT_PRESETS = [
  {
    id: 'react-scan',
    label: 'React Scan',
    script: `(function(){if(!window.__REACT_SCAN_INJECTED__){window.__REACT_SCAN_INJECTED__=true;const s=document.createElement('script');s.src='https://unpkg.com/react-scan/dist/auto.global.js';document.head.appendChild(s)}})()`
  }
] as const

const MAX_TABS = 5
const WEBVIEW_PARTITION = 'persist:browser'
const WEBVIEW_PREFERENCES = 'contextIsolation=yes'

interface ElectronWebviewProps {
  url: string
  webviewRef: (el: WebviewElement | null) => void
}

function ElectronWebview({ url, webviewRef }: ElectronWebviewProps) {
  return createElement('webview', {
    ref: webviewRef,
    src: url,
    partition: WEBVIEW_PARTITION,
    webpreferences: WEBVIEW_PREFERENCES,
    className: 'absolute inset-0 w-full h-full',
  } as React.HTMLAttributes<HTMLElement> & {
    ref: (el: WebviewElement | null) => void
    src: string
    partition: string
    webpreferences: string
  })
}

interface BrowserPanelProps {
  activeSessionId?: string | null
  activeSessionTitle?: string | null
}

function getTabFallbackTitle(tab: BrowserPanelTab): string {
  if (tab.kind === 'browser') {
    return tab.url
  }
  if (tab.kind === 'workspace-diff') {
    return 'diff'
  }
  return 'workspace file'
}

function getSourceSessionTitle(tab: BrowserPanelTab): string | null {
  if (tab.kind !== 'browser' || !tab.sessionId) {
    return null
  }
  return tab.sessionTitle || `Session ${tab.sessionId.slice(0, 8)}`
}

export function BrowserPanel({ activeSessionId = null, activeSessionTitle = null }: BrowserPanelProps) {
  const tabs = useBrowserPanelStore(state => state.tabs)
  const activeTabId = useBrowserPanelStore(state => state.activeTabId)
  const requestedTab = useBrowserPanelStore(state => state.requestedTab)
  const createTab = useBrowserPanelStore(state => state.createTab)
  const fulfillRequestedTab = useBrowserPanelStore(state => state.fulfillRequestedTab)
  const closeTab = useBrowserPanelStore(state => state.closeTab)
  const setActiveTab = useBrowserPanelStore(state => state.setActiveTab)
  const updateTab = useBrowserPanelStore(state => state.updateTab)
  const navigateTo = useBrowserPanelStore(state => state.navigateTo)
  const openWorkspaceFileTab = useBrowserPanelStore(state => state.openWorkspaceFileTab)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeBrowserTab = activeTab?.kind === 'browser' ? activeTab : null
  const activeWorkspaceFileTab = activeTab?.kind === 'workspace-file' ? activeTab : null
  const activeWorkspaceDiffTab = activeTab?.kind === 'workspace-diff' ? activeTab : null
  const browserTabCount = tabs.filter((tab) => tab.kind === 'browser').length
  const [urlInput, setUrlInput] = useState('')
  const webviewMapRef = useRef<Map<string, WebviewElement>>(new Map())

  useEffect(() => {
    if (!requestedTab) {
      return
    }
    fulfillRequestedTab(requestedTab.id)
  }, [fulfillRequestedTab, requestedTab])

  // Sync URL input with active tab
  const activeTabUrl = activeBrowserTab?.url
  const activeTabIdForSync = activeBrowserTab?.id
  useEffect(() => {
    if (activeTabUrl !== undefined) {
      setUrlInput(activeTabUrl === 'about:blank' ? '' : activeTabUrl)
    }
  }, [activeTabUrl, activeTabIdForSync])

  const attachWebviewListeners = useCallback(
    (tabId: string, el: WebviewElement) => {
      // eslint-disable-next-line ts/no-explicit-any
      const handleTitleUpdated = (e: any) => {
        updateTab(tabId, { title: e.title })
      }
      // eslint-disable-next-line ts/no-explicit-any
      const handleDidNavigate = (e: any) => {
        updateTab(tabId, {
          url: e.url,
          canGoBack: el.canGoBack(),
          canGoForward: el.canGoForward()
        })
      }
      const handleDidStartLoading = () => {
        updateTab(tabId, { loading: true })
      }
      const handleDidStopLoading = () => {
        updateTab(tabId, {
          loading: false,
          canGoBack: el.canGoBack(),
          canGoForward: el.canGoForward()
        })
      }
      // eslint-disable-next-line ts/no-explicit-any
      const handleFavicon = (e: any) => {
        updateTab(tabId, { favicon: e.favicons?.[0] ?? null })
      }

      el.addEventListener('page-title-updated', handleTitleUpdated)
      el.addEventListener('did-navigate', handleDidNavigate)
      el.addEventListener('did-navigate-in-page', handleDidNavigate)
      el.addEventListener('did-start-loading', handleDidStartLoading)
      el.addEventListener('did-stop-loading', handleDidStopLoading)
      el.addEventListener('page-favicon-updated', handleFavicon)

      return () => {
        el.removeEventListener('page-title-updated', handleTitleUpdated)
        el.removeEventListener('did-navigate', handleDidNavigate)
        el.removeEventListener('did-navigate-in-page', handleDidNavigate)
        el.removeEventListener('did-start-loading', handleDidStartLoading)
        el.removeEventListener('did-stop-loading', handleDidStopLoading)
        el.removeEventListener('page-favicon-updated', handleFavicon)
      }
    },
    [updateTab]
  )

  // Ref callback factory for each webview
  const webviewRef = useCallback(
    (tabId: string) => (el: WebviewElement | null) => {
      if (el && !webviewMapRef.current.has(tabId)) {
        webviewMapRef.current.set(tabId, el)
        el.__cleanup = attachWebviewListeners(tabId, el)
      } else if (!el) {
        const prev = webviewMapRef.current.get(tabId)
        if (prev) {
          prev.__cleanup?.()
          webviewMapRef.current.delete(tabId)
        }
      }
    },
    [attachWebviewListeners]
  )

  const handleGoBack = useCallback(() => {
    if (!activeBrowserTab) {
      return
    }
    webviewMapRef.current.get(activeBrowserTab.id)?.goBack()
  }, [activeBrowserTab])

  const handleGoForward = useCallback(() => {
    if (!activeBrowserTab) {
      return
    }
    webviewMapRef.current.get(activeBrowserTab.id)?.goForward()
  }, [activeBrowserTab])

  const handleReload = useCallback(() => {
    if (!activeBrowserTab) {
      return
    }
    webviewMapRef.current.get(activeBrowserTab.id)?.reload()
  }, [activeBrowserTab])

  const handleInjectScript = useCallback(
    (script: string) => {
      if (!activeBrowserTab) {
        return
      }
      webviewMapRef.current.get(activeBrowserTab.id)?.executeJavaScript(script)
    },
    [activeBrowserTab]
  )

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!activeBrowserTab || !urlInput.trim()) {
        return
      }
      let url = urlInput.trim()
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`
      }
      const wv = webviewMapRef.current.get(activeBrowserTab.id)
      if (wv) {
        wv.loadURL(url)
        navigateTo(activeBrowserTab.id, url)
      }
    },
    [activeBrowserTab, urlInput, navigateTo]
  )

  const handleNewTab = useCallback(() => {
    if (browserTabCount >= MAX_TABS) {
      return
    }
    createTab('about:blank', { sessionId: activeSessionId, sessionTitle: activeSessionTitle })
  }, [activeSessionId, activeSessionTitle, browserTabCount, createTab])

  // Empty state
  if (tabs.length === 0) {
    return (
      <div
        className="flex flex-col flex-1 items-center justify-center gap-4 text-muted-foreground/60"
        data-testid="browser-panel"
        data-browser-panel-ready="true"
      >
        <GlobeIcon className="size-10 opacity-30" />
        <p className="text-xs">No tabs open</p>
        {isElectron && (
          <button
            type="button"
            onClick={handleNewTab}
            className="px-4 py-2 text-xs font-medium rounded-full bg-foreground/5 hover:bg-foreground/10 text-foreground transition-colors active:scale-95"
          >
            New Tab
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden"
      data-testid="browser-panel"
      data-browser-panel-ready="true"
      onKeyDownCapture={(event) => {
        handleBrowserPanelTabShortcut(event.nativeEvent, { panelOpen: true })
      }}
    >
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-1 shrink-0 border-b border-border/30 bg-card">
        {tabs.map((tab) => {
          const sourceSessionTitle = getSourceSessionTitle(tab)
          const isForeignBrowserTab = tab.kind === 'browser'
            && !!tab.sessionId
            && tab.sessionId !== activeSessionId
          return (
          <div
            key={tab.id}
            className={cn(
              'group flex max-w-40 items-center rounded-md text-[11px] transition-colors',
              tab.id === activeTabId
                ? 'bg-foreground/5 text-foreground'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-foreground/4'
            )}
          >
            <button
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-l-md py-1 pl-2.5 pr-1 text-left transition-transform active:scale-[0.96]"
              aria-current={tab.id === activeTabId ? 'page' : undefined}
            >
              {tab.loading && (
                <span className="size-1.5 rounded-full bg-primary animate-pulse shrink-0" />
              )}
              {tab.kind === 'workspace-file' && (
                <FileCodeIcon
                  className="size-3 shrink-0 text-muted-foreground/70"
                  aria-hidden="true"
                />
              )}
              {tab.kind === 'workspace-diff' && (
                <FileDiffIcon
                  className="size-3 shrink-0 text-muted-foreground/70"
                  aria-hidden="true"
                />
              )}
              {tab.kind === 'browser' && !tab.loading && tab.favicon && (
                <img src={tab.favicon} alt="" className="size-3 shrink-0 rounded-sm" />
              )}
              {tab.kind === 'browser' && !tab.loading && !tab.favicon && (
                <GlobeIcon
                  className="size-3 shrink-0 text-muted-foreground/60"
                  aria-hidden="true"
                />
              )}
              <span className="truncate">
                {tab.title || (tab.kind === 'browser' ? tab.url : 'Workspace file')}
              </span>
              {isForeignBrowserTab && sourceSessionTitle && (
                <span
                  className="ml-0.5 flex size-3 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[8px] font-semibold leading-none text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-300"
                  title={`From ${sourceSessionTitle}`}
                  aria-label={`From ${sourceSessionTitle}`}
                >
                  S
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => closeTab(tab.id)}
              aria-label={`Close ${tab.title || getTabFallbackTitle(tab)}`}
              className="mr-0.5 flex size-6 items-center justify-center rounded-sm text-muted-foreground/70 opacity-0 transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
            >
              <XIcon className="size-2.5" />
            </button>
          </div>
          )
        })}
        {isElectron && (
          <button
            type="button"
            onClick={handleNewTab}
            disabled={browserTabCount >= MAX_TABS}
            aria-label="New browser tab"
            className="ml-0.5 flex size-6 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:bg-foreground/4 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95 disabled:opacity-20"
          >
            <PlusIcon className="size-3" />
          </button>
        )}
      </div>

      {activeBrowserTab && (
        <div className="flex items-center gap-2 px-2 py-1.5 shrink-0 border-b border-border/50 bg-card">
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={handleGoBack}
              disabled={!activeBrowserTab.canGoBack}
              aria-label="Go back"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95 disabled:opacity-20 disabled:hover:bg-transparent"
            >
              <ArrowLeftIcon className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={handleGoForward}
              disabled={!activeBrowserTab.canGoForward}
              aria-label="Go forward"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95 disabled:opacity-20 disabled:hover:bg-transparent"
            >
              <ArrowRightIcon className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={handleReload}
              aria-label="Reload page"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95"
            >
              <RefreshCwIcon className="size-3.5" />
            </button>
          </div>

          <form onSubmit={handleUrlSubmit} className="flex-1 min-w-0">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="URL"
              aria-label="URL"
              className="w-full px-3 py-1 text-xs rounded-full bg-foreground/4 placeholder:text-muted-foreground/40 focus:bg-foreground/7 focus:outline-none transition-[background-color]"
            />
          </form>

          {INJECT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleInjectScript(preset.script)}
              className="px-2.5 py-1 text-[10px] font-medium rounded-full bg-foreground/4 hover:bg-foreground/8 text-muted-foreground/70 hover:text-foreground transition-colors active:scale-95 whitespace-nowrap"
              title={`Inject ${preset.label}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {activeWorkspaceFileTab && (
        <div className="flex items-center gap-2 border-b border-border/50 bg-card px-2 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileCodeIcon
              className="size-3.5 shrink-0 text-muted-foreground/60"
              aria-hidden="true"
            />
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {activeWorkspaceFileTab.path}
            </span>
          </div>
          <div className="flex shrink-0 rounded-md bg-foreground/4 p-0.5">
            <button
              type="button"
              onClick={() =>
                openWorkspaceFileTab({
                  workspaceId: activeWorkspaceFileTab.workspaceId,
                  path: activeWorkspaceFileTab.path,
                  view: 'preview'
                })
              }
              className={cn(
                'flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors',
                activeWorkspaceFileTab.view === 'preview'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/70 hover:text-foreground'
              )}
              aria-pressed={activeWorkspaceFileTab.view === 'preview'}
            >
              <EyeIcon className="size-3" aria-hidden="true" />
              Preview
            </button>
            <button
              type="button"
              onClick={() =>
                openWorkspaceFileTab({
                  workspaceId: activeWorkspaceFileTab.workspaceId,
                  path: activeWorkspaceFileTab.path,
                  view: 'editor'
                })
              }
              className={cn(
                'flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors',
                activeWorkspaceFileTab.view === 'editor'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/70 hover:text-foreground'
              )}
              aria-pressed={activeWorkspaceFileTab.view === 'editor'}
            >
              <Code2Icon className="size-3" aria-hidden="true" />
              Editor
            </button>
          </div>
        </div>
      )}

      {activeWorkspaceDiffTab && (
        <div className="flex items-center gap-2 border-b border-border/50 bg-card px-2 py-1.5">
          <FileDiffIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          <span className="truncate text-[11px] font-medium text-foreground/80">
            {activeWorkspaceDiffTab.title}
          </span>
        </div>
      )}

      <div className="relative flex-1">
        {tabs.map((tab) => {
          if (tab.kind === 'browser') {
            return (
              <Activity key={tab.id} name={`browser-panel:${tab.id}`} mode={tab.id === activeTabId ? 'visible' : 'hidden'}>
                <ElectronWebview
                  url={tab.url}
                  webviewRef={webviewRef(tab.id)}
                />
              </Activity>
            )
          }
          if (tab.kind === 'workspace-diff') {
            return (
              <Activity key={tab.id} name={`browser-panel:${tab.id}`} mode={tab.id === activeTabId ? 'visible' : 'hidden'}>
                <div className="absolute inset-0 min-h-0 flex flex-col">
                  <WorkspaceDiffViewer tabId={tab.id} workspaceId={tab.workspaceId} paths={tab.paths} />
                </div>
              </Activity>
            )
          }
          return (
            <Activity key={tab.id} name={`browser-panel:${tab.id}`} mode={tab.id === activeTabId ? 'visible' : 'hidden'}>
              <div className="absolute inset-0 min-h-0">
                {tab.view === 'editor' ? (
                  <WorkspaceFileEditor workspaceId={tab.workspaceId} path={tab.path} />
                ) : (
                  <WorkspaceFilePreview
                    workspaceId={tab.workspaceId}
                    path={tab.path}
                    onOpenEditor={() =>
                      openWorkspaceFileTab({
                        workspaceId: tab.workspaceId,
                        path: tab.path,
                        view: 'editor'
                      })
                    }
                  />
                )}
              </div>
            </Activity>
          )
        })}
      </div>
    </div>
  )
}
