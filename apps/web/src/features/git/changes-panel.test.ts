import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitFileStatus } from '~/lib/types'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import { groupGitFileStatuses } from './changes-grouping'
import { ChangesPanel } from './changes-panel'
import { resolveTreeItemFromEvent } from './tree-event-target'

const treeMocks = vi.hoisted(() => {
  const select = vi.fn()
  return {
    select,
    focusPath: vi.fn(),
    getItem: vi.fn(() => ({ select })),
    resetPaths: vi.fn(),
    setGitStatus: vi.fn(),
  }
})

const gitQueryMocks = vi.hoisted(() => ({
  useGitFileStatuses: vi.fn(),
}))

vi.mock('@pierre/trees/react', async () => {
  const React = await import('react')
  return {
    FileTree: () =>
      React.createElement(
        'div',
        { 'data-testid': 'mock-pierre-tree' },
        React.createElement('button', {
          type: 'button',
          'data-item-path': 'src/app.tsx',
          'data-item-type': 'file',
        }, 'src/app.tsx'),
        React.createElement('button', {
          type: 'button',
          'data-item-path': 'src',
          'data-item-type': 'folder',
        }, 'src'),
      ),
    useFileTree: () => ({ model: treeMocks }),
  }
})

vi.mock('./use-git', () => ({
  useGitFileStatuses: gitQueryMocks.useGitFileStatuses,
}))

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  useBrowserPanelStore.setState({
    tabs: [],
    activeTabId: null,
    requestedTab: null,
    scrollToFilePath: null,
  })
  useLayoutStore.setState({ browserPanelOpen: false })
  gitQueryMocks.useGitFileStatuses.mockReturnValue({
    data: [{ path: 'src/app.tsx', status: 'modified' }],
    isLoading: false,
    isError: false,
    isSuccess: true,
  })
})

describe('groupGitFileStatuses', () => {
  it('places tests, markdown docs, and all other files into stable sections', () => {
    const files: GitFileStatus[] = [
      { path: 'src/app.tsx', status: 'modified' },
      { path: 'README.md', status: 'modified' },
      { path: 'src/app.test.ts', status: 'added' },
      { path: 'docs/spec.mdx', status: 'untracked' },
      { path: 'src/app.spec.ts', status: 'modified' },
    ]

    expect(groupGitFileStatuses(files)).toEqual([
      {
        id: 'sources',
        label: 'Sources',
        files: [
          { path: 'src/app.spec.ts', status: 'modified' },
          { path: 'src/app.tsx', status: 'modified' },
        ],
      },
      {
        id: 'docs',
        label: 'Docs / Specs',
        files: [
          { path: 'docs/spec.mdx', status: 'untracked' },
          { path: 'README.md', status: 'modified' },
        ],
      },
      {
        id: 'tests',
        label: 'Tests',
        files: [{ path: 'src/app.test.ts', status: 'added' }],
      },
    ])
  })
})

describe('ChangesPanel tree interactions', () => {
  it('opens the diff tab and scrolls to the double-clicked tree file', () => {
    render(createElement(ChangesPanel, { workspaceId: 'workspace-1' }))

    fireEvent.click(screen.getByRole('radio', { name: 'Show changes as tree' }))
    fireEvent.doubleClick(screen.getByText('src/app.tsx'))

    expect(treeMocks.focusPath).toHaveBeenCalledWith('src/app.tsx')
    expect(treeMocks.select).toHaveBeenCalled()
    expect(useLayoutStore.getState().browserPanelOpen).toBe(true)
    expect(useBrowserPanelStore.getState().tabs).toEqual([
      expect.objectContaining({
        kind: 'workspace-diff',
        workspaceId: 'workspace-1',
        title: 'All Changes',
      }),
    ])
    expect(useBrowserPanelStore.getState().scrollToFilePath).toMatchObject({
      path: 'src/app.tsx',
      tabId: useBrowserPanelStore.getState().activeTabId,
    })
  })

  it('ignores double-clicks on tree folders', () => {
    render(createElement(ChangesPanel, { workspaceId: 'workspace-1' }))

    fireEvent.click(screen.getByRole('radio', { name: 'Show changes as tree' }))
    fireEvent.doubleClick(screen.getByText('src'))

    expect(useBrowserPanelStore.getState().tabs).toEqual([])
    expect(useBrowserPanelStore.getState().scrollToFilePath).toBeNull()
  })
})

describe('resolveTreeItemFromEvent', () => {
  it('reads file rows from the closest tree item element', () => {
    const row = document.createElement('button')
    row.dataset.itemPath = 'src/app.tsx'
    row.dataset.itemType = 'file'

    const label = document.createElement('span')
    row.append(label)
    document.body.append(row)

    const event = new MouseEvent('dblclick', { bubbles: true })
    Object.defineProperty(event, 'target', { configurable: true, value: label })

    expect(resolveTreeItemFromEvent(event)).toEqual({
      path: 'src/app.tsx',
      kind: 'file',
    })
  })

  it('falls back to composedPath entries when the event target is outside the tree root', () => {
    const row = document.createElement('button')
    row.dataset.itemPath = 'src'
    row.dataset.itemType = 'folder'

    const event = new MouseEvent('dblclick', { bubbles: true })
    Object.defineProperty(event, 'target', {
      configurable: true,
      value: document.createElement('div'),
    })
    Object.defineProperty(event, 'composedPath', {
      configurable: true,
      value: () => [document.createElement('span'), row, document.body, document],
    })

    expect(resolveTreeItemFromEvent(event)).toEqual({
      path: 'src',
      kind: 'directory',
    })
  })
})
