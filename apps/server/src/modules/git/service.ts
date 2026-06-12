import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, posix as pathPosix, relative, resolve, sep } from 'node:path'

import type { StatusResult } from 'simple-git'
import simpleGit from 'simple-git'

import { AppError } from '../../errors/app-error'
import * as Workspace from '../workspace/service'

export interface GitStatusView {
  repositoryPath: string
  repositoryName: string
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
  files: GitFileStatusView[]
}

export interface GitRepositoryView {
  path: string
  name: string
  absolutePath: string
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
  workspacePath: string
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

interface GitRepositoryLocator {
  path: string
  name: string
  absolutePath: string
}

interface ResolvedGitRepository {
  repository: GitRepositoryLocator
}

const FIELD_SEP = '\x1F'
const ROOT_REPOSITORY_PATH = '.'
const RE_REMOTE_PREFIX = /^remotes\//
const RE_REMOTE_BRANCH = /^[^/]+\/(.+)$/
const MAX_REPOSITORY_SCAN_ENTRIES = 20_000
const REPOSITORY_SCAN_IGNORED_NAMES = new Set([
  '.git',
  '.DS_Store',
  '.cache',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'vendor',
])
const STATUS_RANK: Record<GitFileStatusKind, number> = {
  deleted: 5,
  renamed: 4,
  added: 3,
  modified: 2,
  untracked: 1,
}

function getWorkspacePath(workspaceId: string): string {
  const workspace = Workspace.get(workspaceId)
  if (!workspace) {
    throw new AppError({
      code: 'workspace_not_found',
      status: 404,
      message: 'Workspace not found',
      details: { workspaceId },
    })
  }
  return workspace.path
}

function mapGitError(workspaceId: string, error: unknown, repositoryPath?: string): AppError {
  if (error instanceof AppError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  return new AppError({
    code: 'git_repository_unavailable',
    status: 409,
    message: 'Git repository unavailable',
    details: { workspaceId, repositoryPath, reason: message },
  })
}

export async function getRepositories(workspaceId: string): Promise<GitRepositoryView[]> {
  const workspacePath = getWorkspacePath(workspaceId)
  const repositories = await discoverGitRepositories(workspaceId, workspacePath)
  try {
    return await Promise.all(repositories.map(async (repository) => {
      const status = await readStatus(repository)
    return {
        path: repository.path,
        name: repository.name,
        absolutePath: repository.absolutePath,
        branch: status.branch,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        isDetached: status.isDetached,
        files: status.files,
      }
    }))
  }
  catch (error) {
    throw mapGitError(workspaceId, error)
  }
}

export async function getStatus(workspaceId: string, repositoryPath?: string): Promise<GitStatusView> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  try {
    return await readStatus(repository)
  }
  catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

async function readStatus(
  repository: GitRepositoryLocator,
): Promise<GitStatusView> {
  const status = await simpleGit(repository.absolutePath).status()
  return {
    repositoryPath: repository.path,
    repositoryName: repository.name,
    branch: status.current ?? '(detached)',
    tracking: status.tracking ?? null,
    ahead: status.ahead,
    behind: status.behind,
    isDetached: status.detached,
    files: collectFileStatuses(status, repository.path),
  }
}

function collectFileStatuses(
  status: StatusResult,
  repositoryPath: string,
): GitFileStatusView[] {
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

  return Array.from(byPath.entries(), ([path, fileStatus]) => ({
    path,
    workspacePath: toWorkspacePath(repositoryPath, path),
    status: fileStatus,
  })).sort(
    (left, right) => left.path.localeCompare(right.path),
  )
}

export async function getBranches(
  workspaceId: string,
  repositoryPath?: string,
): Promise<GitBranchesView> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
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
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function getRemotes(
  workspaceId: string,
  repositoryPath?: string,
): Promise<GitRemoteView[]> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
  try {
    const remotes = await git.getRemotes(true)
    return remotes.map(remote => ({
      name: remote.name,
      fetchUrl: remote.refs.fetch ?? null,
      pushUrl: remote.refs.push ?? null,
    }))
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function getGraph(
  workspaceId: string,
  limit: number,
  repositoryPath?: string,
): Promise<GitGraphCommitView[]> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
  try {
    const format = `%H${FIELD_SEP}%P${FIELD_SEP}%D${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%at`
    const raw = await git.raw(['log', '--all', `--pretty=format:${format}`, '-n', String(limit)])

    return raw
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map((line) => {
        const [sha, parentsRaw, refsRaw, subject, authorName, authorEmail, timestampStr]
          = line.split(FIELD_SEP)
        const parents = parentsRaw?.trim() ? parentsRaw.trim().split(' ') : []
        const refs = refsRaw?.trim()
          ? refsRaw
              .trim()
              .split(',')
              .map(ref => ref.trim())
              .filter(Boolean)
          : []
        const timestamp = timestampStr ? Number.parseInt(timestampStr, 10) * 1000 : 0

        return {
          sha,
          shortSha: sha.slice(0, 7),
          parents,
          refs,
          subject: subject ?? '',
          authorName: authorName ?? '',
          authorEmail: authorEmail ?? '',
          gravatarHash: createHash('md5')
            .update((authorEmail ?? '').toLowerCase().trim())
            .digest('hex'),
          date: new Date(timestamp).toISOString(),
          timestamp,
        }
      })
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function checkout(
  workspaceId: string,
  branch: string,
  repositoryPath?: string,
): Promise<void> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
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
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function createBranch(
  workspaceId: string,
  name: string,
  from?: string,
  repositoryPath?: string,
): Promise<void> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
  try {
    await git.checkoutBranch(name, from ?? 'HEAD')
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function fetch(workspaceId: string, repositoryPath?: string): Promise<void> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
  try {
    await git.fetch(['--all', '--prune'])
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function getDiff(
  workspaceId: string,
  paths?: string[],
  repositoryPath?: string,
): Promise<string> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  try {
    const selectedPaths = normalizeDiffPaths(paths)
    const status = await simpleGit(repository.absolutePath).status()
    const untrackedPaths = collectUntrackedDiffPaths(status, selectedPaths)
    const trackedPaths = selectedPaths?.filter(path => !untrackedPaths.has(path))
    const trackedDiff
      = trackedPaths?.length === 0
        ? ''
        : await runGitCommand(repository.absolutePath, [
            'diff',
            'HEAD',
            ...(trackedPaths ? ['--', ...trackedPaths] : []),
          ])
    const untrackedDiffs: string[] = []
    for (const path of untrackedPaths) {
      untrackedDiffs.push(
        await runGitCommand(repository.absolutePath, ['diff', '--no-index', '--', '/dev/null', path], [1]),
      )
    }
    return joinDiffs([trackedDiff, ...untrackedDiffs])
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function getMergeBase(
  workspaceId: string,
  baseBranch: string,
  repositoryPath?: string,
): Promise<{ mergeBaseSha: string | null }> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  try {
    const mergeBaseSha = await runGitCommand(repository.absolutePath, ['merge-base', 'HEAD', baseBranch])
    return { mergeBaseSha: mergeBaseSha.trim() || null }
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

async function resolveRepository(
  workspaceId: string,
  repositoryPath?: string | null,
): Promise<ResolvedGitRepository> {
  const workspacePath = getWorkspacePath(workspaceId)
  const repositories = await discoverGitRepositories(workspaceId, workspacePath)
  const requestedPath = normalizeRepositoryPath(workspaceId, repositoryPath)

  if (requestedPath) {
    const repository = repositories.find(candidate => candidate.path === requestedPath)
    if (!repository) {
      throw new AppError({
        code: 'git_repository_not_found',
        status: 404,
        message: 'Git repository not found',
        details: {
          workspaceId,
          repositoryPath: requestedPath,
          availableRepositories: repositories.map(repository => repository.path),
        },
      })
    }

    return { repository }
  }

  if (repositories.length === 1) {
    return { repository: repositories[0]! }
  }

  if (repositories.length === 0) {
    throw new AppError({
      code: 'git_repository_unavailable',
      status: 409,
      message: 'Git repository unavailable',
      details: { workspaceId, reason: 'No Git repository found in workspace' },
    })
  }

  throw new AppError({
    code: 'git_repository_required',
    status: 409,
    message: 'Git repository is required for workspaces with multiple repositories',
    details: {
      workspaceId,
      repositories: repositories.map(repository => ({
        path: repository.path,
        name: repository.name,
      })),
    },
  })
}

async function discoverGitRepositories(
  workspaceId: string,
  workspacePath: string,
): Promise<GitRepositoryLocator[]> {
  const rootPath = resolve(workspacePath)
  const repositories: GitRepositoryLocator[] = []
  let scannedEntries = 0

  async function visit(directoryPath: string): Promise<void> {
    scannedEntries += 1
    if (scannedEntries > MAX_REPOSITORY_SCAN_ENTRIES) {
      throw new AppError({
        code: 'git_repository_scan_limit_exceeded',
        status: 409,
        message: 'Git repository scan limit exceeded',
        details: { workspaceId, limit: MAX_REPOSITORY_SCAN_ENTRIES },
      })
    }

    if (hasGitMarker(directoryPath)) {
      repositories.push(createRepositoryLocator(rootPath, directoryPath))
      return
    }

    let entries
    try {
      entries = await readdir(directoryPath, { withFileTypes: true })
    }
    catch {
      return
    }

    const directories = entries
      .filter(entry => entry.isDirectory() && !REPOSITORY_SCAN_IGNORED_NAMES.has(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of directories) {
      await visit(join(directoryPath, entry.name))
    }
  }

  await visit(rootPath)
  return repositories.sort(compareRepositories)
}

function hasGitMarker(directoryPath: string): boolean {
  return existsSync(join(directoryPath, '.git'))
}

function createRepositoryLocator(
  workspacePath: string,
  absolutePath: string,
): GitRepositoryLocator {
  const relativePath = relative(workspacePath, absolutePath)
  const repositoryPath = relativePath ? toPosixPath(relativePath) : ROOT_REPOSITORY_PATH
  return {
    path: repositoryPath,
    name: repositoryPath === ROOT_REPOSITORY_PATH ? basename(workspacePath) : pathPosix.basename(repositoryPath),
    absolutePath,
  }
}

function compareRepositories(left: GitRepositoryLocator, right: GitRepositoryLocator): number {
  if (left.path === ROOT_REPOSITORY_PATH) {
    return right.path === ROOT_REPOSITORY_PATH ? 0 : -1
  }
  if (right.path === ROOT_REPOSITORY_PATH) {
    return 1
  }
  return left.path.localeCompare(right.path)
}

function normalizeRepositoryPath(workspaceId: string, repositoryPath?: string | null): string | null {
  if (!repositoryPath) {
    return null
  }

  const trimmedPath = repositoryPath.trim()
  if (!trimmedPath) {
    return null
  }

  const slashPath = trimmedPath.replaceAll('\\', '/')
  if (slashPath === ROOT_REPOSITORY_PATH) {
    return ROOT_REPOSITORY_PATH
  }

  const normalizedPath = pathPosix.normalize(slashPath)
  if (
    isAbsolute(trimmedPath)
    || pathPosix.isAbsolute(normalizedPath)
    || normalizedPath === '..'
    || normalizedPath.startsWith('../')
  ) {
    throw new AppError({
      code: 'git_repository_invalid',
      status: 400,
      message: 'Git repository path must be relative to the workspace',
      details: { workspaceId, repositoryPath },
    })
  }

  return normalizedPath === ROOT_REPOSITORY_PATH ? ROOT_REPOSITORY_PATH : normalizedPath
}

function toWorkspacePath(repositoryPath: string, path: string): string {
  if (repositoryPath === ROOT_REPOSITORY_PATH) {
    return path
  }
  return `${repositoryPath}/${path}`
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/')
}

function normalizeDiffPaths(paths?: string[]): string[] | undefined {
  if (!paths || paths.length === 0) {
    return undefined
  }

  const normalizedPaths = paths.map(path => path.trim()).filter(Boolean)
  return normalizedPaths.length > 0 ? Array.from(new Set(normalizedPaths)) : undefined
}

function collectUntrackedDiffPaths(status: StatusResult, selectedPaths?: string[]): Set<string> {
  const untrackedPaths = new Set(status.not_added)
  if (!selectedPaths) {
    return untrackedPaths
  }

  return new Set(selectedPaths.filter(path => untrackedPaths.has(path)))
}

async function runGitCommand(
  cwd: string,
  args: string[],
  allowedExitCodes: number[] = [],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8')
      const exitCode = code ?? 0
      if (exitCode === 0 || allowedExitCodes.includes(exitCode)) {
        resolve(output)
        return
      }

      const errorOutput = Buffer.concat(stderr).toString('utf8').trim()
      const message = errorOutput || `git ${args[0] ?? 'command'} exited with code ${exitCode}`
      reject(Object.assign(new Error(message), { code: exitCode, stdout: output }))
    })
  })
}

function joinDiffs(diffs: string[]): string {
  return diffs
    .map(diff => diff.trimEnd())
    .filter(Boolean)
    .join('\n')
}
