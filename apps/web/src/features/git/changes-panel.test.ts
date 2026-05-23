import { describe, expect, it } from 'vitest'

import type { GitFileStatus } from '~/lib/types'

import { groupGitFileStatuses } from './changes-grouping'

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
