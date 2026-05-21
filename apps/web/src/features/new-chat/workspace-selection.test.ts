import { describe, expect, it } from 'vitest'

import { resolveSelectedWorkspaceId } from './workspace-selection'

describe('resolveSelectedWorkspaceId', () => {
  const workspaces = [
    { id: 'workspace-1' },
    { id: 'workspace-2' },
  ]

  it('prefers the workspace id requested by the homepage navigation', () => {
    expect(resolveSelectedWorkspaceId('workspace-2', null, workspaces)).toBe('workspace-2')
  })

  it('falls back to the previous selection when the requested workspace does not exist', () => {
    expect(resolveSelectedWorkspaceId('missing', 'workspace-1', workspaces)).toBe('workspace-1')
  })
})
