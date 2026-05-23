import { createHash } from 'node:crypto'

import type { StatusResult } from 'simple-git'
import simpleGit from 'simple-git'

import { AppError } from '../../errors/app-error'
import * as Workspace from '../workspace/service'

export interface GitStatusView {
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
  files: GitFileStatusView[]
}

export type GitFileStatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface GitFileStatusView {
  path: string
  status: GitFileStatusKind
}

export interface GitLocalBranchView {
  name: string
  isCurrent: boolean
  tracking?: string
}

export interface GitRemoteBranchView {
  name: string
}

export interface GitRemoteView {
  name: string
  fetchUrl: string | null
  pushUrl: string | null
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
const STATUS_RANK: Record<GitFileStatusKind, number> = {
  deleted: 5,
  renamed: 4,
  added: 3,
  modified: 2,
  untracked: 1,
}

function getGit(workspaceId: string) {
  const workspace = Workspace.get(workspaceId)
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

function mapGitError(workspaceId: string, error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error)
  return new AppError({
    code: 'git_repository_unavailable',
    status: 409,
    message: 'Git repository unavailable',
    details: { workspaceId, reason: message },
  })
}

export async function getStatus(workspaceId: string): Promise<GitStatusView> {
  const git = getGit(workspaceId)
  try {
    const status = await git.status()
    return {
      branch: status.current ?? '(detached)',
      tracking: status.tracking ?? null,
      ahead: status.ahead,
      behind: status.behind,
      isDetached: status.detached,
      files: collectFileStatuses(status),
    }
  }
  catch (error) {
    throw mapGitError(workspaceId, error)
  }
}

function collectFileStatuses(status: StatusResult): GitFileStatusView[] {
  const byPath = new Map<string, GitFileStatusKind>()

  function add(path: string, kind: GitFileStatusKind) {
    const existing = byPath.get(path)
    if (!existing || STATUS_RANK[kind] > STATUS_RANK[existing]) {
      byPath.set(path, kind)
    }
  }

  for (const path of status.not_added) {
    add(path, 'untracked')
  }
  for (const path of status.created) {
    add(path, 'added')
  }
  for (const path of status.modified) {
    add(path, 'modified')
  }
  for (const path of status.deleted) {
    add(path, 'deleted')
  }
  for (const file of status.renamed) {
    add(file.to, 'renamed')
  }

  return Array.from(byPath.entries(), ([path, fileStatus]) => ({ path, status: fileStatus }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export async function getBranches(workspaceId: string): Promise<GitBranchesView> {
  const git = getGit(workspaceId)
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
    throw mapGitError(workspaceId, error)
  }
}

export async function getRemotes(workspaceId: string): Promise<GitRemoteView[]> {
  const git = getGit(workspaceId)
  try {
    const remotes = await git.getRemotes(true)
    return remotes.map(remote => ({
      name: remote.name,
      fetchUrl: remote.refs.fetch ?? null,
      pushUrl: remote.refs.push ?? null,
    }))
  }
  catch (error) {
    throw mapGitError(workspaceId, error)
  }
}

export async function getGraph(workspaceId: string, limit: number): Promise<GitGraphCommitView[]> {
  const git = getGit(workspaceId)
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
    throw mapGitError(workspaceId, error)
  }
}

export async function checkout(workspaceId: string, branch: string): Promise<void> {
  const git = getGit(workspaceId)
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
    throw mapGitError(workspaceId, error)
  }
}

export async function createBranch(workspaceId: string, name: string, from?: string): Promise<void> {
  const git = getGit(workspaceId)
  try {
    await git.checkoutBranch(name, from ?? 'HEAD')
  }
  catch (error) {
    throw mapGitError(workspaceId, error)
  }
}

export async function fetch(workspaceId: string): Promise<void> {
  const git = getGit(workspaceId)
  try {
    await git.fetch(['--all', '--prune'])
  }
  catch (error) {
    throw mapGitError(workspaceId, error)
  }
}
