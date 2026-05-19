// Input: Vitest, directory selection helpers
// Output: Regression coverage for custom directory browser keyboard selection logic
// Position: Filesystem feature unit tests for browser fallback directory picker behavior

import { describe, expect, it } from 'vitest'

import { selectDirectoryByOffset } from './directory-browser-dialog'

const directories = [
  { name: 'alpha', path: '/repo/alpha', type: 'directory' as const },
  { name: 'bravo', path: '/repo/bravo', type: 'directory' as const },
  { name: 'charlie', path: '/repo/charlie', type: 'directory' as const },
]

describe('selectDirectoryByOffset', () => {
  it('selects the first or last directory when no directory is selected', () => {
    expect(selectDirectoryByOffset(directories, null, 1)).toBe('/repo/alpha')
    expect(selectDirectoryByOffset(directories, null, -1)).toBe('/repo/charlie')
  })

  it('moves selection within the directory list bounds', () => {
    expect(selectDirectoryByOffset(directories, '/repo/alpha', 1)).toBe('/repo/bravo')
    expect(selectDirectoryByOffset(directories, '/repo/bravo', -1)).toBe('/repo/alpha')
    expect(selectDirectoryByOffset(directories, '/repo/charlie', 1)).toBe('/repo/charlie')
    expect(selectDirectoryByOffset(directories, '/repo/alpha', -1)).toBe('/repo/alpha')
  })

  it('returns null for an empty directory list', () => {
    expect(selectDirectoryByOffset([], null, 1)).toBeNull()
  })
})
