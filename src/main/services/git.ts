// Input: simple-git, IpcService decorator framework
// Output: GitService — IPC surface for git status, branch list, graph log, checkout, createBranch, fetch
// Position: Main-process IPC layer for git feature; used by renderer GitPanel and GitBranchControl

import { createHash } from 'node:crypto'

import { IpcMethod, IpcService } from '@cradle/ipc'
import simpleGit from 'simple-git'

export interface GitStatus {
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
}

export interface GitLocalBranch {
  name: string
  isCurrent: boolean
  tracking?: string
}

export interface GitRemoteBranch {
  name: string
}

export interface GitBranches {
  local: GitLocalBranch[]
  remote: GitRemoteBranch[]
}

export interface GitGraphCommit {
  sha: string
  shortSha: string
  parents: string[]
  refs: string[]
  subject: string
  authorName: string
  authorEmail: string
  /** MD5 hex of trimmed+lowercased authorEmail, for Gravatar */
  gravatarHash: string
  /** ISO 8601 date string */
  date: string
  /** Unix timestamp (ms) */
  timestamp: number
}

// Unit separator — safe delimiter unlikely to appear in git output
const FIELD_SEP = '\x1F'

const RE_REMOTE_PREFIX = /^remotes\//
const RE_REMOTE_BRANCH = /^[^/]+\/(.+)$/

export class GitService extends IpcService {
  static readonly groupName = 'git'

  @IpcMethod()
  async getStatus(workspacePath: string): Promise<GitStatus> {
    const git = simpleGit(workspacePath)
    const status = await git.status()
    return {
      branch: status.current ?? '(detached)',
      tracking: status.tracking ?? null,
      ahead: status.ahead,
      behind: status.behind,
      isDetached: status.detached,
    }
  }

  @IpcMethod()
  async getBranches(workspacePath: string): Promise<GitBranches> {
    const git = simpleGit(workspacePath)

    const raw = await git.raw([
      'branch',
      '-a',
      `--format=%(refname:short)${FIELD_SEP}%(upstream:short)${FIELD_SEP}%(HEAD)`,
    ])

    const local: GitLocalBranch[] = []
    const remote: GitRemoteBranch[] = []

    for (const line of raw.trim().split('\n')) {
      if (!line.trim()) {
        continue
      }
      const [name, upstream, head] = line.split(FIELD_SEP)
      if (!name) {
        continue
      }

      if (RE_REMOTE_PREFIX.test(name)) {
        const remoteName = name.replace(RE_REMOTE_PREFIX, '')
        if (!remoteName.endsWith('/HEAD')) {
          remote.push({ name: remoteName })
        }
      }
      else {
        local.push({
          name,
          isCurrent: head === '*',
          tracking: upstream?.trim() || undefined,
        })
      }
    }

    return { local, remote }
  }

  @IpcMethod()
  async getGraph(workspacePath: string, limit: number = 100): Promise<GitGraphCommit[]> {
    const git = simpleGit(workspacePath)

    // Format: sha|parents|refs|subject|authorName|authorEmail|unixTimestamp
    const format = `%H${FIELD_SEP}%P${FIELD_SEP}%D${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%at`
    const raw = await git.raw([
      'log',
      '--all',
      `--pretty=format:${format}`,
      '-n',
      String(limit),
    ])

    const commits: GitGraphCommit[] = []

    for (const line of raw.split('\n')) {
      if (!line.trim()) {
        continue
      }
      const [sha, parentsRaw, refsRaw, subject, authorName, authorEmail, timestampStr] = line.split(FIELD_SEP)
      if (!sha) {
        continue
      }

      const parents = parentsRaw?.trim() ? parentsRaw.trim().split(' ') : []
      const refs = refsRaw?.trim()
        ? refsRaw.trim().split(',').map(r => r.trim()).filter(Boolean)
        : []

      const timestamp = timestampStr ? Number.parseInt(timestampStr, 10) * 1000 : 0

      commits.push({
        sha,
        shortSha: sha.slice(0, 7),
        parents,
        refs,
        subject: subject ?? '',
        authorName: authorName ?? '',
        authorEmail: authorEmail ?? '',
        gravatarHash: createHash('md5').update((authorEmail ?? '').toLowerCase().trim()).digest('hex'),
        date: new Date(timestamp).toISOString(),
        timestamp,
      })
    }

    return commits
  }

  @IpcMethod()
  async checkout(workspacePath: string, branch: string): Promise<void> {
    const git = simpleGit(workspacePath)
    const remoteMatch = RE_REMOTE_BRANCH.exec(branch)
    if (remoteMatch) {
      // Remote branch like "origin/feature" — create local tracking branch
      const localName = remoteMatch[1]
      const summary = await git.branchLocal()
      if (summary.all.includes(localName)) {
        await git.checkout(localName)
      }
      else {
        await git.checkoutBranch(localName, branch)
      }
    }
    else {
      await git.checkout(branch)
    }
  }

  @IpcMethod()
  async createBranch(workspacePath: string, name: string, from?: string): Promise<void> {
    const git = simpleGit(workspacePath)
    await git.checkoutBranch(name, from ?? 'HEAD')
  }

  @IpcMethod()
  async fetch(workspacePath: string): Promise<void> {
    const git = simpleGit(workspacePath)
    await git.fetch(['--all', '--prune'])
  }
}
