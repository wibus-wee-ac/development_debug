/**
 * Output: Regression coverage for BrowserPanel render subscription boundaries.
 * Input: Workspace diff tab activation and diff scroll command store updates.
 * Position: Browser feature tests for the right-side panel shell.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBrowserPanelStore } from '~/store/browser-panel'

import { BrowserPanel } from './browser-panel'

const diffViewerRender = vi.hoisted(() => vi.fn())

type TestWebviewPrototype = HTMLElement & {
  loadURL?: (url: string) => Promise<void>
  goBack?: () => void
  goForward?: () => void
  reload?: () => void
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  getURL?: () => string
  getTitle?: () => string
  isLoading?: () => boolean
  getWebContentsId?: () => number
  executeJavaScript?: (code: string) => Promise<unknown>
}

function installTestWebviewPrototype() {
  const prototype = HTMLElement.prototype as TestWebviewPrototype
  const loadURL = vi.fn(() => Promise.resolve())
  prototype.loadURL = loadURL
  prototype.getWebContentsId = vi.fn(() => 1)
  prototype.goBack = vi.fn()
  prototype.goForward = vi.fn()
  prototype.reload = vi.fn()
  prototype.canGoBack = vi.fn(() => false)
  prototype.canGoForward = vi.fn(() => false)
  prototype.getURL = vi.fn(() => 'about:blank')
  prototype.getTitle = vi.fn(() => '')
  prototype.isLoading = vi.fn(() => false)
  prototype.executeJavaScript = vi.fn(() => Promise.resolve(undefined))
  return { loadURL }
}

vi.mock('./workspace-diff-viewer', () => ({
  WorkspaceDiffViewer: (props: { tabId: string, workspaceId: string, paths?: string[] }) => {
    diffViewerRender(props)
    return null
  },
}))

vi.mock('~/features/workspace/workspace-file-editor', () => ({
  WorkspaceFileEditor: () => <div data-testid="workspace-file-editor" />,
}))

vi.mock('~/features/workspace/workspace-file-preview', () => ({
  WorkspaceFilePreview: () => <div data-testid="workspace-file-preview" />,
}))

describe('browserPanel rendering', () => {
  beforeEach(() => {
    cleanup()
    diffViewerRender.mockClear()
    installTestWebviewPrototype()
    useBrowserPanelStore.setState({
      tabs: [],
      activeTabId: null,
      requestedTab: null,
      scrollToFilePath: null,
    })
  })

  it('does not repaint the panel shell for diff scroll commands', () => {
    const tabId = useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })

    render(<BrowserPanel />)
    expect(diffViewerRender).toHaveBeenCalledTimes(1)

    act(() => {
      useBrowserPanelStore.getState().requestScrollToFilePath({
        path: 'src/index.ts',
        tabId,
      })
    })

    expect(diffViewerRender).toHaveBeenCalledTimes(1)
  })

  it('shows the source session marker for browser tabs from another session', () => {
    useBrowserPanelStore.getState().createTab('https://example.com', {
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })

    render(<BrowserPanel activeSessionId="session-b" activeSessionTitle="Session B" />)

    expect(screen.getByLabelText('From Session A')).not.toBeNull()
  })

  it('does not show a source marker for browser tabs from the active session', () => {
    useBrowserPanelStore.getState().createTab('https://example.com', {
      sessionId: 'session-a',
      sessionTitle: 'Session A',
    })

    render(<BrowserPanel activeSessionId="session-a" activeSessionTitle="Session A" />)

    expect(screen.queryByLabelText('From Session A')).toBeNull()
  })

  it('does not show a source marker for workspace tabs', () => {
    useBrowserPanelStore.getState().openWorkspaceFileTab({
      workspaceId: 'workspace-1',
      path: 'src/index.ts',
      view: 'preview',
    })
    useBrowserPanelStore.getState().openWorkspaceDiffTab({
      workspaceId: 'workspace-1',
      title: 'All Changes',
    })

    render(<BrowserPanel activeSessionId="session-b" activeSessionTitle="Session B" />)

    expect(screen.queryByLabelText(/From /)).toBeNull()
  })

  it('does not reload a browser webview after unrelated tab state updates', () => {
    const webview = installTestWebviewPrototype()
    const tabId = useBrowserPanelStore.getState().createTab('https://example.com')

    render(<BrowserPanel />)

    expect(webview.loadURL).toHaveBeenCalledTimes(1)
    expect(webview.loadURL).toHaveBeenCalledWith('https://example.com')

    act(() => {
      useBrowserPanelStore.getState().updateTab(tabId, { loading: true })
    })

    expect(webview.loadURL).toHaveBeenCalledTimes(1)
  })

  it('does not imperatively reload the initial about blank webview', () => {
    const webview = installTestWebviewPrototype()
    useBrowserPanelStore.getState().createTab('about:blank')

    render(<BrowserPanel />)

    expect(webview.loadURL).not.toHaveBeenCalled()
  })

  it('does not imperatively reload an equivalent current webview URL', () => {
    const webview = installTestWebviewPrototype()
    const prototype = HTMLElement.prototype as TestWebviewPrototype
    prototype.getURL = vi.fn(() => 'https://www.baidu.com/')
    useBrowserPanelStore.getState().createTab('https://www.baidu.com')

    render(<BrowserPanel />)

    expect(webview.loadURL).not.toHaveBeenCalled()
  })
})
