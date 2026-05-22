import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

interface GitStatus {
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
}

interface GitBranches {
  local: Array<{ name: string, isCurrent: boolean, tracking?: string }>
  remote: Array<{ name: string }>
}

interface GitGraphCommit {
  subject: string
  shortSha: string
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function runGit(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function initGitRepository(dir: string): void {
  try {
    runGit(dir, ['init', '--initial-branch=main'])
  }
  catch {
    runGit(dir, ['init'])
    runGit(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  }

  runGit(dir, ['config', 'user.name', 'Cradle Server Tests'])
  runGit(dir, ['config', 'user.email', 'server-tests@example.com'])
}

function commitFile(dir: string, fileName: string, content: string, message: string): void {
  writeFileSync(join(dir, fileName), `${content}\n`, 'utf8')
  runGit(dir, ['add', fileName])
  runGit(dir, ['commit', '-m', message])
}

function createGitWorkspaceFixture(dir: string): void {
  initGitRepository(dir)
  commitFile(dir, 'README.md', '# Git Fixture', 'repo: initial commit')
  commitFile(dir, 'main.txt', 'main branch content', 'main: second commit')
  runGit(dir, ['checkout', '-b', 'seed-branch'])
  commitFile(dir, 'seed.txt', 'seed branch content', 'seed: branch commit')
  runGit(dir, ['checkout', 'main'])
  commitFile(dir, 'notes.txt', 'third commit on main', 'main: third commit')
}

describe('git capability', () => {
  it('returns workspace-owned status, branches, and commit graph for a real git repository', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-git-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      createGitWorkspaceFixture(workspaceRoot)
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-git',
        name: 'Workspace Git',
        path: workspaceRoot,
      }).run()

      const statusRes = await app.handle(new Request('http://localhost/workspaces/workspace-git/git/status'))
      expect(statusRes.status).toBe(200)
      expect(await statusRes.json()).toEqual(expect.objectContaining<Partial<GitStatus>>({
        branch: 'main',
        isDetached: false,
      }))

      const branchesRes = await app.handle(new Request('http://localhost/workspaces/workspace-git/git/branches'))
      expect(branchesRes.status).toBe(200)
      const branches = await branchesRes.json() as GitBranches
      expect(branches.local).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'main', isCurrent: true }),
        expect.objectContaining({ name: 'seed-branch', isCurrent: false }),
      ]))

      const graphRes = await app.handle(new Request('http://localhost/workspaces/workspace-git/git/graph?limit=100'))
      expect(graphRes.status).toBe(200)
      const graph = await graphRes.json() as GitGraphCommit[]
      expect(graph.map(commit => commit.subject)).toEqual(expect.arrayContaining([
        'main: third commit',
        'seed: branch commit',
      ]))
      expect(graph[0]?.shortSha.length).toBe(7)
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('creates-and-switches a new branch and supports checkout of an existing branch', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-git-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      createGitWorkspaceFixture(workspaceRoot)
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-git',
        name: 'Workspace Git',
        path: workspaceRoot,
      }).run()

      const createBranchRes = await app.handle(new Request('http://localhost/workspaces/workspace-git/git/branches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'feature/http-git' }),
      }))
      expect(createBranchRes.status).toBe(200)
      expect(await createBranchRes.json()).toEqual({ ok: true })

      const statusAfterCreateRes = await app.handle(new Request('http://localhost/workspaces/workspace-git/git/status'))
      const statusAfterCreate = await statusAfterCreateRes.json() as GitStatus
      expect(statusAfterCreate.branch).toBe('feature/http-git')
      expect(runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feature/http-git')

      const checkoutRes = await app.handle(new Request('http://localhost/workspaces/workspace-git/git/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch: 'seed-branch' }),
      }))
      expect(checkoutRes.status).toBe(200)
      expect(await checkoutRes.json()).toEqual({ ok: true })

      const statusAfterCheckoutRes = await app.handle(new Request('http://localhost/workspaces/workspace-git/git/status'))
      const statusAfterCheckout = await statusAfterCheckoutRes.json() as GitStatus
      expect(statusAfterCheckout.branch).toBe('seed-branch')
      expect(runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('seed-branch')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
  it('returns structured errors for missing workspaces and non-git directories', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const plainWorkspaceRoot = makeTempDir('cradle-plain-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-plain',
        name: 'Workspace Plain',
        path: plainWorkspaceRoot,
      }).run()

      const missingWorkspace = await app.handle(new Request('http://localhost/workspaces/missing/git/status'))
      expect(missingWorkspace.status).toBe(404)
      expect((await missingWorkspace.json()).code).toBe('workspace_not_found')

      const nonGitWorkspace = await app.handle(new Request('http://localhost/workspaces/workspace-plain/git/status'))
      expect(nonGitWorkspace.status).toBe(409)
      expect((await nonGitWorkspace.json()).code).toBe('git_repository_unavailable')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(plainWorkspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
