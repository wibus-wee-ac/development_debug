import { describe, expect, it } from 'vitest'

import type { GitStatus } from '~/lib/types'

import {
  derivePullRequestNumberFromStatus,
  parseGitHubAwaitTargetInput,
  parseGitHubRepositoryFromUrl,
  parseGitHubRepositoryInput,
  selectGitHubRepository,
} from './await-github'

interface GitRemote {
  name: string
  fetchUrl: string | null
  pushUrl: string | null
}

describe('GitHub await helpers', () => {
  it('parses GitHub HTTPS and SSH remotes', () => {
    expect(parseGitHubRepositoryFromUrl('https://github.com/openai/codex.git')).toMatchObject({
      owner: 'openai',
      repo: 'codex',
      fullName: 'openai/codex',
    })
    expect(parseGitHubRepositoryFromUrl('git@github.com:openai/codex.git')).toMatchObject({
      owner: 'openai',
      repo: 'codex',
      fullName: 'openai/codex',
    })
  })

  it('accepts owner/repo manual input', () => {
    expect(parseGitHubRepositoryInput('openai/codex')).toMatchObject({
      owner: 'openai',
      repo: 'codex',
      fullName: 'openai/codex',
    })
  })

  it('parses PR numbers and commit refs from the same target input', () => {
    expect(parseGitHubAwaitTargetInput('42')).toEqual({
      kind: 'pull-request',
      filter: { pr: 42 },
      label: '#42',
    })
    expect(parseGitHubAwaitTargetInput('abcdef1')).toEqual({
      kind: 'commit-ref',
      filter: { sha: 'abcdef1' },
      label: '@abcdef1',
    })
    expect(parseGitHubAwaitTargetInput('feature/checks')).toEqual({
      kind: 'commit-ref',
      filter: { sha: 'feature/checks' },
      label: '@feature/checks',
    })
    expect(parseGitHubAwaitTargetInput('0')).toBeNull()
    expect(parseGitHubAwaitTargetInput('123abc')).toEqual({
      kind: 'commit-ref',
      filter: { sha: '123abc' },
      label: '@123abc',
    })
  })

  it('ignores non-GitHub remotes and prefers origin', () => {
    const remotes: GitRemote[] = [
      { name: 'upstream', fetchUrl: 'https://github.com/example/upstream.git', pushUrl: null },
      { name: 'origin', fetchUrl: 'git@gitlab.com:example/project.git', pushUrl: null },
      { name: 'fork', fetchUrl: 'git@github.com:example/fork.git', pushUrl: null },
    ]

    expect(selectGitHubRepository(remotes)).toMatchObject({
      fullName: 'example/fork',
      remoteName: 'fork',
    })
  })

  it('does not invent a PR number from a normal branch', () => {
    const status: GitStatus = {
      branch: 'feature/manual-awaits',
      tracking: 'origin/feature/manual-awaits',
      ahead: 0,
      behind: 0,
      isDetached: false,
    }

    expect(derivePullRequestNumberFromStatus(status)).toBeNull()
  })

  it('derives PR number from pull refs when available', () => {
    expect(derivePullRequestNumberFromStatus({
      branch: 'pull/42/head',
      tracking: 'origin/pull/42/head',
      ahead: 0,
      behind: 0,
      isDetached: false,
    })).toBe(42)
  })
})
