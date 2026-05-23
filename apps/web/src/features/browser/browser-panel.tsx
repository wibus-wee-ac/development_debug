import { ArrowLeftIcon, ArrowRightIcon, Code2Icon, EyeIcon, FileCodeIcon, GlobeIcon, PlusIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'

import { WorkspaceFileEditor } from '~/features/workspace/workspace-file-editor'
import { WorkspaceFilePreview } from '~/features/workspace/workspace-file-preview'
import { cn } from '~/lib/cn'
import { isElectron } from '~/lib/electron'
import { useBrowserPanelStore } from '~/store/browser-panel'

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
    script: `(function(){if(!window.__REACT_SCAN_INJECTED__){window.__REACT_SCAN_INJECTED__=true;const s=document.createElement('script');s.src='https://unpkg.com/react-scan/dist/auto.global.js';document.head.appendChild(s)}})()`,
  },
] as const

const MAX_TABS = 5
const WEBVIEW_PARTITION = 'persist:browser'
const WEBVIEW_PREFERENCES = 'contextIsolation=yes'

interface ElectronWebviewProps {
  url: string
  active: boolean
  webviewRef: (el: WebviewElement | null) => void
}

function ElectronWebview({ url, active, webviewRef }: ElectronWebviewProps) {
  return createElement('webview', {
    ref: webviewRef,
    src: url,
    partition: WEBVIEW_PARTITION,
    webpreferences: WEBVIEW_PREFERENCES,
    className: 'absolute inset-0 w-full h-full',
    style: { display: active ? 'flex' : 'none' },
  } as React.HTMLAttributes<HTMLElement> & {
    ref: (el: WebviewElement | null) => void
    src: string
    partition: string
    webpreferences: string
  })
}

export function BrowserPanel() {
  const { tabs, activeTabId, requestedTab, createTab, fulfillRequestedTab, closeTab, setActiveTab, updateTab, navigateTo, openWorkspaceFileTab } = useBrowserPanelStore()
  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeBrowserTab = activeTab?.kind === 'browser' ? activeTab : null
  const activeWorkspaceFileTab = activeTab?.kind === 'workspace-file' ? activeTab : null
  const browserTabCount = tabs.filter(tab => tab.kind === 'browser').length
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

  const attachWebviewListeners = useCallback((tabId: string, el: WebviewElement) => {
    // eslint-disable-next-line ts/no-explicit-any
    const handleTitleUpdated = (e: any) => {
      updateTab(tabId, { title: e.title })
    }
    // eslint-disable-next-line ts/no-explicit-any
    const handleDidNavigate = (e: any) => {
      updateTab(tabId, {
        url: e.url,
        canGoBack: el.canGoBack(),
        canGoForward: el.canGoForward(),
      })
    }
    const handleDidStartLoading = () => {
      updateTab(tabId, { loading: true })
    }
    const handleDidStopLoading = () => {
      updateTab(tabId, {
        loading: false,
        canGoBack: el.canGoBack(),
        canGoForward: el.canGoForward(),
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
  }, [updateTab])

  // Ref callback factory for each webview
  const webviewRef = useCallback((tabId: string) => (el: WebviewElement | null) => {
    if (el && !webviewMapRef.current.has(tabId)) {
      webviewMapRef.current.set(tabId, el)
      el.__cleanup = attachWebviewListeners(tabId, el)
    }
    else if (!el) {
      const prev = webviewMapRef.current.get(tabId)
      if (prev) {
        prev.__cleanup?.()
        webviewMapRef.current.delete(tabId)
      }
    }
  }, [attachWebviewListeners])

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

  const handleInjectScript = useCallback((script: string) => {
    if (!activeBrowserTab) {
      return
    }
    webviewMapRef.current.get(activeBrowserTab.id)?.executeJavaScript(script)
  }, [activeBrowserTab])

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
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
  }, [activeBrowserTab, urlInput, navigateTo])

  const handleNewTab = useCallback(() => {
    if (browserTabCount >= MAX_TABS) {
      return
    }
    createTab('about:blank')
  }, [browserTabCount, createTab])

  if (!isElectron) {
    return null
  }

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
        <button
          type="button"
          onClick={handleNewTab}
          className="px-4 py-2 text-xs font-medium rounded-full bg-foreground/5 hover:bg-foreground/10 text-foreground transition-colors active:scale-95"
        >
          New Tab
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden"
      data-testid="browser-panel"
      data-browser-panel-ready="true"
    >
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-1 shrink-0 border-b border-border/30 bg-card">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={cn(
              'group flex max-w-40 items-center rounded-md text-[11px] transition-colors',
              tab.id === activeTabId
                ? 'bg-foreground/5 text-foreground'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-foreground/4',
            )}
          >
            <button
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-l-md py-1 pl-2.5 pr-1 text-left transition-transform active:scale-[0.96]"
              aria-current={tab.id === activeTabId ? 'page' : undefined}
            >
              {tab.loading && <span className="size-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
              {tab.kind === 'workspace-file' && <FileCodeIcon className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />}
              {tab.kind === 'browser' && !tab.loading && tab.favicon && (
                <img src={tab.favicon} alt="" className="size-3 shrink-0 rounded-sm" />
              )}
              {tab.kind === 'browser' && !tab.loading && !tab.favicon && <GlobeIcon className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
              <span className="truncate">{tab.title || (tab.kind === 'browser' ? tab.url : 'Workspace file')}</span>
            </button>
            <button
              type="button"
              onClick={() => closeTab(tab.id)}
              aria-label={`Close ${tab.title || (tab.kind === 'browser' ? tab.url : 'workspace file')}`}
              className="mr-0.5 flex size-6 items-center justify-center rounded-sm text-muted-foreground/70 opacity-0 transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
            >
              <XIcon className="size-2.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={handleNewTab}
          disabled={browserTabCount >= MAX_TABS}
          aria-label="New browser tab"
          className="ml-0.5 flex size-6 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:bg-foreground/4 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95 disabled:opacity-20"
        >
          <PlusIcon className="size-3" />
        </button>
      </div>

      {activeBrowserTab && (
        <div className="flex items-center gap-2 px-2 py-1.5 shrink-0 border-b border-border/50 bg-card">
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" onClick={handleGoBack} disabled={!activeBrowserTab.canGoBack} aria-label="Go back" className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95 disabled:opacity-20 disabled:hover:bg-transparent">
              <ArrowLeftIcon className="size-3.5" />
            </button>
            <button type="button" onClick={handleGoForward} disabled={!activeBrowserTab.canGoForward} aria-label="Go forward" className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95 disabled:opacity-20 disabled:hover:bg-transparent">
              <ArrowRightIcon className="size-3.5" />
            </button>
            <button type="button" onClick={handleReload} aria-label="Reload page" className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95">
              <RefreshCwIcon className="size-3.5" />
            </button>
          </div>

          <form onSubmit={handleUrlSubmit} className="flex-1 min-w-0">
            <input
              type="text"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="URL"
              aria-label="URL"
              className="w-full px-3 py-1 text-xs rounded-full bg-foreground/4 placeholder:text-muted-foreground/40 focus:bg-foreground/7 focus:outline-none transition-[background-color]"
            />
          </form>

          {INJECT_PRESETS.map(preset => (
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
            <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            <span className="truncate font-mono text-[11px] text-muted-foreground">{activeWorkspaceFileTab.path}</span>
          </div>
          <div className="flex shrink-0 rounded-md bg-foreground/4 p-0.5">
            <button
              type="button"
              onClick={() => openWorkspaceFileTab({
                workspaceId: activeWorkspaceFileTab.workspaceId,
                path: activeWorkspaceFileTab.path,
                view: 'preview',
              })}
              className={cn(
                'flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors',
                activeWorkspaceFileTab.view === 'preview'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/70 hover:text-foreground',
              )}
              aria-pressed={activeWorkspaceFileTab.view === 'preview'}
            >
              <EyeIcon className="size-3" aria-hidden="true" />
              Preview
            </button>
            <button
              type="button"
              onClick={() => openWorkspaceFileTab({
                workspaceId: activeWorkspaceFileTab.workspaceId,
                path: activeWorkspaceFileTab.path,
                view: 'editor',
              })}
              className={cn(
                'flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors',
                activeWorkspaceFileTab.view === 'editor'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/70 hover:text-foreground',
              )}
              aria-pressed={activeWorkspaceFileTab.view === 'editor'}
            >
              <Code2Icon className="size-3" aria-hidden="true" />
              Editor
            </button>
          </div>
        </div>
      )}

      <div className="relative flex-1">
        {tabs.map(tab => (
          tab.kind === 'browser'
            ? (
              <ElectronWebview
                key={tab.id}
                url={tab.url}
                active={tab.id === activeTabId}
                webviewRef={webviewRef(tab.id)}
              />
              )
            : (
              <div
                key={tab.id}
                className={cn(
                  'absolute inset-0 min-h-0',
                  tab.id === activeTabId ? 'block' : 'hidden',
                )}
              >
                {tab.view === 'editor'
                  ? <WorkspaceFileEditor workspaceId={tab.workspaceId} path={tab.path} />
                  : (
                    <WorkspaceFilePreview
                      workspaceId={tab.workspaceId}
                      path={tab.path}
                      onOpenEditor={() => openWorkspaceFileTab({
                        workspaceId: tab.workspaceId,
                        path: tab.path,
                        view: 'editor',
                      })}
                    />
                    )}
              </div>
              )
        ))}
      </div>
    </div>
  )
}
