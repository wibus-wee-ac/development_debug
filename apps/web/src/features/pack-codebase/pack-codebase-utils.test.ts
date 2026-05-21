import { describe, expect, it } from 'vitest'

import { formatTokens, mergeScopePaths, pathsToInclude, pathsToIncludeFromDraft, splitScopePathInput } from './pack-codebase-utils'

describe('pack-codebase utilities', () => {
  it('splits scope path input on commas and newlines', () => {
    expect(splitScopePathInput('src, packages/ipc\napps/web  ,  docs')).toEqual([
      'src',
      'packages/ipc',
      'apps/web',
      'docs',
    ])
  })

  it('merges scope paths without duplicating existing entries', () => {
    expect(mergeScopePaths(['src'], 'src, apps/web\npackages/ipc')).toEqual([
      'src',
      'apps/web',
      'packages/ipc',
    ])
  })

  it('converts paths to repomix include globs', () => {
    expect(pathsToInclude(['src', 'README.md', 'packages/ipc'])).toBe('src/**,README.md,packages/ipc/**')
  })

  it('builds include globs from committed chips and pending multiline input', () => {
    expect(pathsToIncludeFromDraft(['src'], 'apps/web\nREADME.md')).toBe('src/**,apps/web/**,README.md')
    expect(pathsToIncludeFromDraft([], ' \n ')).toBeUndefined()
  })

  it('formats token totals compactly', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_200)).toBe('1.2K')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})
