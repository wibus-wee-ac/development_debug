/**
 * Output: Regression coverage for BrowserPanel render subscription boundaries.
 * Input: Workspace diff tab activation and diff scroll command store updates.
 * Position: Browser feature tests for the right-side panel shell.
 */

import { act, cleanup, render } from '@testing-library/react'
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
})
