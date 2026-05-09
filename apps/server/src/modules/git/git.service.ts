// Input: workspace store and simple-git
// Output: workspace-owned git status, branches, graph, checkout, create-branch, and fetch operations
// Position: apps/server/src/modules/git/git.service.ts

import { createHash } from 'node:crypto'

import simpleGit from 'simple-git'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { WorkspaceStore } from '../workspace/workspace.store'

export interface GitStatusView {
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
}

export interface GitLocalBranchView {
  name: string
  isCurrent: boolean
  tracking?: string
}

export interface GitRemoteBranchView {
  name: string
}

export interface GitBranchesView {
  local: GitLocalBranchView[]
  remote: GitRemoteBranchView[]
}

export interface GitGraphCommitView {
  sha: string
  shortSha: string
  parents: string[]
  refs: string[]
  subject: string
  authorName: string
  authorEmail: string
  gravatarHash: string
  date: string
  timestamp: number
}

const FIELD_SEP = '\x1F'
const RE_REMOTE_PREFIX = /^remotes\//
const RE_REMOTE_BRANCH = /^[^/]+\/(.+)$/

@injectable()
export class GitService {
  constructor(@inject(WorkspaceStore) private readonly workspaces: WorkspaceStore) {}

  async getStatus(workspaceId: string): Promise<GitStatusView> {
    const git = this.getGit(workspaceId)
    try {
      const status = await git.status()
      return {
        branch: status.current ?? '(detached)',
        tracking: status.tracking ?? null,
        ahead: status.ahead,
        behind: status.behind,
        isDetached: status.detached,
      }
    }
    catch (error) {
      throw this.mapGitError(workspaceId, error)
    }
  }

  async getBranches(workspaceId: string): Promise<GitBranchesView> {
    const git = this.getGit(workspaceId)
    try {
      const raw = await git.raw([
        'branch',
        '-a',
        `--format=%(refname:short)${FIELD_SEP}%(upstream:short)${FIELD_SEP}%(HEAD)`,
      ])

      const local: GitLocalBranchView[] = []
      const remote: GitRemoteBranchView[] = []

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
    catch (error) {
      throw this.mapGitError(workspaceId, error)
    }
  }

  async getGraph(workspaceId: string, limit: number): Promise<GitGraphCommitView[]> {
    const git = this.getGit(workspaceId)
    try {
      const format = `%H${FIELD_SEP}%P${FIELD_SEP}%D${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%at`
      const raw = await git.raw([
        'log',
        '--all',
        `--pretty=format:${format}`,
        '-n',
        String(limit),
      ])

      return raw.split('\n').filter(line => line.trim().length > 0).map((line) => {
        const [sha, parentsRaw, refsRaw, subject, authorName, authorEmail, timestampStr] = line.split(FIELD_SEP)
        const parents = parentsRaw?.trim() ? parentsRaw.trim().split(' ') : []
        const refs = refsRaw?.trim() ? refsRaw.trim().split(',').map(ref => ref.trim()).filter(Boolean) : []
        const timestamp = timestampStr ? Number.parseInt(timestampStr, 10) * 1000 : 0

        return {
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
        }
      })
    }
    catch (error) {
      throw this.mapGitError(workspaceId, error)
    }
  }

  async checkout(workspaceId: string, branch: string): Promise<void> {
    const git = this.getGit(workspaceId)
    try {
      const remoteMatch = RE_REMOTE_BRANCH.exec(branch)
      if (remoteMatch) {
        const localName = remoteMatch[1]
        const summary = await git.branchLocal()
        if (summary.all.includes(localName)) {
          await git.checkout(localName)
        }
        else {
          await git.checkoutBranch(localName, branch)
        }
        return
      }

      await git.checkout(branch)
    }
    catch (error) {
      throw this.mapGitError(workspaceId, error)
    }
  }

  async createBranch(workspaceId: string, name: string, from?: string): Promise<void> {
    const git = this.getGit(workspaceId)
    try {
      await git.checkoutBranch(name, from ?? 'HEAD')
    }
    catch (error) {
      throw this.mapGitError(workspaceId, error)
    }
  }

  async fetch(workspaceId: string): Promise<void> {
    const git = this.getGit(workspaceId)
    try {
      await git.fetch(['--all', '--prune'])
    }
    catch (error) {
      throw this.mapGitError(workspaceId, error)
    }
  }

  private getGit(workspaceId: string) {
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) {
      throw new AppError({
        code: 'workspace_not_found',
        status: 404,
        message: 'Workspace not found',
        details: { workspaceId },
      })
    }
    return simpleGit(workspace.path)
  }

  private mapGitError(workspaceId: string, error: unknown): AppError {
    const message = error instanceof Error ? error.message : String(error)
    return new AppError({
      code: 'git_repository_unavailable',
      status: 409,
      message: 'Git repository unavailable',
      details: { workspaceId, reason: message },
    })
  }
}
