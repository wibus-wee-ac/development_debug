import { describe, expect, it } from 'vitest'

import {
  buildCodexReviewPrompt,
  createCodexReviewBranchLines,
} from './codex-review-mode'

describe('Codex review mode', () => {
  it('builds the native uncommitted review prompt instead of raw slash text', () => {
    const prompt = buildCodexReviewPrompt({
      mode: 'uncommitted',
      sourceBranch: 'feature/review',
    })

    expect(prompt).toContain('## Code review guidelines:')
    expect(prompt).toContain('# Review Guidelines')
    expect(prompt).toContain('Review the current code changes (staged, unstaged, and untracked files)')
    expect(prompt).toContain('## My request for Codex:')
    expect(prompt).toContain('Please review my uncommitted changes')
    expect(prompt).not.toContain('/review')
  })

  it('builds the native base branch review prompt with merge-base diff instructions', () => {
    const prompt = buildCodexReviewPrompt({
      mode: 'base-branch',
      sourceBranch: 'feature/review',
      baseBranch: 'origin/main',
      mergeBaseSha: 'abc1234\n',
    })

    expect(prompt).toContain('Review the code changes against the base branch \'origin/main\'')
    expect(prompt).toContain('The merge base commit for this comparison is abc1234.')
    expect(prompt).toContain('Run `git diff abc1234`')
    expect(prompt).toContain('Please review changes on feature/review against origin/main')
  })

  it('orders likely base branches before other branches and excludes the current branch', () => {
    const lines = createCodexReviewBranchLines({
      currentBranch: 'feature/review',
      branches: {
        local: [
          { name: 'feature/review', isCurrent: true },
          { name: 'develop', isCurrent: false },
          { name: 'release', isCurrent: false },
        ],
        remote: [
          { name: 'origin/main' },
          { name: 'origin/release' },
        ],
      },
    })

    expect(lines.map(line => line.label)).toEqual([
      'main',
      'develop',
      'origin/main',
      'release',
      'origin/release',
    ])
  })
})
