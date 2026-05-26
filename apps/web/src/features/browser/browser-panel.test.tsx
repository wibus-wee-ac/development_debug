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

describe('BrowserPanel rendering', () => {
  beforeEach(() => {
    cleanup()
    diffViewerRender.mockClear()
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
})
