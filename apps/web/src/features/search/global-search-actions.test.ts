// Input: Vitest mocks, global search action helpers
// Output: Regression coverage for file search result selection behavior
// Position: Search feature unit tests for command palette actions

import { describe, expect, it, vi } from 'vitest'

import { selectFileSearchResult } from './global-search-actions'

describe('selectFileSearchResult', () => {
  it('opens the workspace detail tab and copies the relative file path', async () => {
    const openTab = vi.fn()
    const close = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const notify = vi.fn()

    await selectFileSearchResult({
      workspaceId: 'workspace-1',
      filePath: 'src/app.tsx',
      openTab,
      close,
      writeText,
      notify,
    })

    expect(close).toHaveBeenCalledBefore(openTab)
    expect(openTab).toHaveBeenCalledWith('workspace-detail', { workspaceId: 'workspace-1' })
    expect(writeText).toHaveBeenCalledWith('src/app.tsx')
    expect(notify).toHaveBeenCalledWith({
      type: 'success',
      title: 'File path copied',
      description: 'src/app.tsx',
    })
  })

  it('still opens the workspace detail tab when clipboard copy fails', async () => {
    const openTab = vi.fn()
    const close = vi.fn()
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    const notify = vi.fn()

    await selectFileSearchResult({
      workspaceId: 'workspace-1',
      filePath: 'src/app.tsx',
      openTab,
      close,
      writeText,
      notify,
    })

    expect(close).toHaveBeenCalled()
    expect(openTab).toHaveBeenCalledWith('workspace-detail', { workspaceId: 'workspace-1' })
    expect(notify).toHaveBeenCalledWith({
      type: 'error',
      title: 'Copy failed',
      description: 'src/app.tsx',
    })
  })
})
