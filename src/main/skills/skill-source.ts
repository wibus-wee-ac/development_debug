// Input: node:fs, node:os, node:path, simple-git
// Output: parseSkillSource, fetchSkillsFromSource, cleanupFetchSession, DiscoveredSkill, FetchSessionResult
// Position: Skills capability library for parsing sources, cloning repos, and discovering skill packages

import fs from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path, { isAbsolute, join, resolve } from 'node:path'

import simpleGit from 'simple-git'

// ── Types ──────────────────────────────────────────────────────────────────────

export type SkillSourceType = 'github' | 'gitlab' | 'git' | 'local'

export interface ParsedSkillSource {
  type: SkillSourceType
  /** For git types: clone URL. For local: resolved absolute path. */
  url: string
  /** Git ref (branch / tag / commit) */
  ref?: string
  /** Subpath within the repo to search for skills */
  subpath?: string
  /** Display-friendly label (e.g. "owner/repo" or "/abs/path") */
  label: string
}

export interface DiscoveredSkill {
  /** Skill name from SKILL.md frontmatter */
  name: string
  /** Skill description from SKILL.md frontmatter */
  description: string
  /** Absolute path to the skill directory */
  skillDir: string
  /** Path relative to the search root (for display) */
  relativePath: string
}

export interface FetchSessionResult {
  sessionId: string
  source: ParsedSkillSource
  skills: DiscoveredSkill[]
  /** Temp dir that must be cleaned up (null for local sources) */
  tempDir: string | null
}

// ── Module-scope regexes ───────────────────────────────────────────────────────

const RE_WIN_PATH = /^[a-z]:[/\\]/i
const RE_BACKSLASH = /\\/g
const RE_GIT_SUFFIX = /\.git$/
const RE_QUOTE_WRAP = /^["']|["']$/g
const RE_SSH_LABEL = /^git@[^:]+:/
const RE_GITHUB_TREE_PATH = /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/
const RE_GITHUB_TREE = /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/
const RE_GITHUB_REPO = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
const RE_GITLAB_TREE_PATH = /^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)\/(.+)/
const RE_GITLAB_TREE = /^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)$/
const RE_GITLAB_REPO = /gitlab\.com\/(.+?)(?:\.git)?\/?$/
const RE_SHORTHAND = /^([^/]+)\/([^/]+)(?:\/(.+))?$/
const RE_FM_SPLIT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const RE_FM_NAME = /^name:\s*(\S[^\n]*)$/m
const RE_FM_DESC = /^description:\s*(\S[^\n]*)$/m

// ── Session registry ───────────────────────────────────────────────────────────

const SESSION_TTL_MS = 15 * 60 * 1000 // 15 minutes

interface SessionEntry {
  tempDir: string | null
  expiresAt: number
}

const activeSessions = new Map<string, SessionEntry>()

function purgeExpiredSessions(): void {
  const now = Date.now()
  for (const [id, session] of activeSessions) {
    if (now > session.expiresAt) {
      if (session.tempDir) {
        rm(session.tempDir, { recursive: true, force: true }).catch(() => {})
      }
      activeSessions.delete(id)
    }
  }
}

function generateSessionId(): string {
  return `skill-fetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function cleanupFetchSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId)
  if (!session) {
    return
  }
  if (session.tempDir) {
    await rm(session.tempDir, { recursive: true, force: true }).catch(() => {})
  }
  activeSessions.delete(sessionId)
}

// ── Source parser ──────────────────────────────────────────────────────────────

function isLocalPath(input: string): boolean {
  return (
    isAbsolute(input)
    || input.startsWith('./')
    || input.startsWith('../')
    || input === '.'
    || input === '..'
    || RE_WIN_PATH.test(input)
  )
}

function sanitizeSubpath(subpath: string): string {
  const segments = subpath.replace(RE_BACKSLASH, '/').split('/')
  for (const seg of segments) {
    if (seg === '..') {
      throw new Error(`Unsafe subpath: "${subpath}" contains path traversal`)
    }
  }
  return subpath
}

/**
 * Parse a source string into a structured format.
 * Supports: local paths, GitHub shorthand (owner/repo), full GitHub/GitLab URLs,
 * tree paths pointing to a skill subdirectory, SSH URLs, and generic HTTPS git URLs.
 */
export function parseSkillSource(input: string): ParsedSkillSource {
  input = input.trim()

  if (!input) {
    throw new Error('Source cannot be empty')
  }

  // ── Local path ──────────────────────────────────────────────────────────────
  if (isLocalPath(input)) {
    const resolvedPath = resolve(input)
    return { type: 'local', url: resolvedPath, label: resolvedPath }
  }

  // ── GitHub tree with subpath: github.com/owner/repo/tree/branch/path/to/skill
  const githubTreePath = RE_GITHUB_TREE_PATH.exec(input)
  if (githubTreePath) {
    const [, owner, repo, ref, subpath] = githubTreePath
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref: ref!,
      subpath: sanitizeSubpath(subpath!),
      label: `${owner}/${repo}`,
    }
  }

  // ── GitHub tree without subpath: github.com/owner/repo/tree/branch
  const githubTree = RE_GITHUB_TREE.exec(input)
  if (githubTree) {
    const [, owner, repo, ref] = githubTree
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref: ref!,
      label: `${owner}/${repo}`,
    }
  }

  // ── GitHub repo URL: github.com/owner/repo
  const githubRepo = RE_GITHUB_REPO.exec(input)
  if (githubRepo) {
    const [, owner, repo] = githubRepo
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      label: `${owner}/${repo}`,
    }
  }

  // ── GitLab tree with subpath: gitlab.com/owner/repo/-/tree/branch/subpath
  const gitlabTreePath = RE_GITLAB_TREE_PATH.exec(input)
  if (gitlabTreePath && gitlabTreePath[2] !== 'github.com') {
    const [, protocol, hostname, repoPath, ref, subpath] = gitlabTreePath
    return {
      type: 'gitlab',
      url: `${protocol}://${hostname}/${repoPath!.replace(RE_GIT_SUFFIX, '')}.git`,
      ref: ref!,
      subpath: sanitizeSubpath(subpath!),
      label: repoPath!,
    }
  }

  // ── GitLab tree without subpath: gitlab.com/owner/repo/-/tree/branch
  const gitlabTree = RE_GITLAB_TREE.exec(input)
  if (gitlabTree && gitlabTree[2] !== 'github.com') {
    const [, protocol, hostname, repoPath, ref] = gitlabTree
    return {
      type: 'gitlab',
      url: `${protocol}://${hostname}/${repoPath!.replace(RE_GIT_SUFFIX, '')}.git`,
      ref: ref!,
      label: repoPath!,
    }
  }

  // ── GitLab repo URL: gitlab.com/owner/repo
  const gitlabRepo = RE_GITLAB_REPO.exec(input)
  if (gitlabRepo && gitlabRepo[1]?.includes('/')) {
    return {
      type: 'gitlab',
      url: `https://gitlab.com/${gitlabRepo[1]}.git`,
      label: gitlabRepo[1]!,
    }
  }

  // ── SSH git URL: git@host:owner/repo.git
  if (input.startsWith('git@')) {
    const label = input.replace(RE_SSH_LABEL, '').replace(RE_GIT_SUFFIX, '')
    return { type: 'git', url: input, label }
  }

  // ── GitHub shorthand: owner/repo  or  owner/repo/path/to/skill
  const shorthand = RE_SHORTHAND.exec(input)
  if (shorthand && !input.includes(':') && !input.startsWith('.') && !input.startsWith('/')) {
    const [, owner, repo, subpath] = shorthand
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo!.replace(RE_GIT_SUFFIX, '')}.git`,
      subpath: subpath ? sanitizeSubpath(subpath) : undefined,
      label: `${owner}/${repo}`,
    }
  }

  // ── Generic HTTPS git URL
  if (input.startsWith('https://') || input.startsWith('http://')) {
    return { type: 'git', url: input, label: input }
  }

  throw new Error(`Cannot parse skill source: "${input}"`)
}

// ── Git clone ──────────────────────────────────────────────────────────────────

async function cloneRepo(cloneUrl: string, ref?: string): Promise<string> {
  const tempDir = await mkdtemp(join(os.tmpdir(), 'cradle-skills-'))
  const git = simpleGit({
    timeout: { block: 120_000 },
    // filter.lfs.required=false prevents git from aborting when git-lfs is not installed.
    // We do NOT set filter.lfs.smudge= via config because newer git versions block
    // empty-string filter overrides unless allowUnsafeFilter is enabled.
    config: [
      'filter.lfs.required=false',
    ],
  })

  // Set env vars on the git instance to skip LFS downloads and prompts
  git.env('GIT_LFS_SKIP_SMUDGE', '1')
  git.env('GIT_TERMINAL_PROMPT', '0')

  const cloneOptions: string[] = ['--depth', '1']
  if (ref) {
    cloneOptions.push('--branch', ref)
  }

  try {
    await git.clone(cloneUrl, tempDir, cloneOptions)
    return tempDir
  }
  catch (err) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    const isAuth = msg.includes('Authentication failed')
      || msg.includes('Permission denied')
      || msg.includes('Repository not found')
      || msg.includes('could not read Username')
    if (isAuth) {
      throw new Error(`Authentication failed for ${cloneUrl}. Ensure the repository is public or that you have configured git credentials.`)
    }
    throw new Error(`Failed to clone repository: ${msg}`)
  }
}

// ── Skill discovery ────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'out'])

async function parseSkillFrontmatter(skillMdPath: string): Promise<{ name: string, description: string } | null> {
  try {
    const content = await readFile(skillMdPath, 'utf8')
    const match = RE_FM_SPLIT.exec(content)
    if (!match) {
      return null
    }
    const block = match[1]
    const nameMatch = RE_FM_NAME.exec(block)
    const descMatch = RE_FM_DESC.exec(block)
    if (!nameMatch || !descMatch) {
      return null
    }
    const name = nameMatch[1].trim().replace(RE_QUOTE_WRAP, '')
    const description = descMatch[1].trim().replace(RE_QUOTE_WRAP, '')
    if (!name || !description) {
      return null
    }
    return { name, description }
  }
  catch {
    return null
  }
}

async function findSkillDirs(dir: string, rootDir: string, depth = 0): Promise<DiscoveredSkill[]> {
  if (depth > 5) {
    return []
  }

  let entries: { name: string, isDirectory: () => boolean }[] = []
  let hasSkill = false

  try {
    const [skillStat, dirEntries] = await Promise.all([
      stat(join(dir, 'SKILL.md')).catch(() => null),
      readdir(dir, { withFileTypes: true }).catch(() => []),
    ])
    hasSkill = skillStat?.isFile() ?? false
    entries = dirEntries
  }
  catch {
    return []
  }

  const results: DiscoveredSkill[] = []

  if (hasSkill) {
    const info = await parseSkillFrontmatter(join(dir, 'SKILL.md'))
    if (info) {
      const relativePath = path.relative(rootDir, dir).replace(RE_BACKSLASH, '/') || '.'
      results.push({
        name: info.name,
        description: info.description,
        skillDir: dir,
        relativePath,
      })
    }
  }

  // Always recurse into subdirectories (allows nested skill collections)
  const subResults = await Promise.all(
    entries
      .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name))
      .map(e => findSkillDirs(join(dir, e.name), rootDir, depth + 1)),
  )
  results.push(...subResults.flat())

  return results
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse a source string, fetch the content (clone if remote, read if local),
 * discover all skills within it, and return a session for subsequent import.
 *
 * Always clean up via `cleanupFetchSession(sessionId)` when done.
 */
export async function fetchSkillsFromSource(sourceInput: string): Promise<FetchSessionResult> {
  purgeExpiredSessions()

  const source = parseSkillSource(sourceInput)
  const sessionId = generateSessionId()
  let tempDir: string | null = null
  let searchRoot: string

  if (source.type === 'local') {
    searchRoot = source.url
    if (!fs.existsSync(searchRoot)) {
      throw new Error(`Local path not found: ${searchRoot}`)
    }
  }
  else {
    tempDir = await cloneRepo(source.url, source.ref)
    searchRoot = source.subpath
      ? path.join(tempDir, source.subpath)
      : tempDir
    if (!fs.existsSync(searchRoot)) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      throw new Error(`Path not found in repository: ${source.subpath ?? '(root)'}`)
    }
  }

  const skills = await findSkillDirs(searchRoot, searchRoot)

  activeSessions.set(sessionId, {
    tempDir,
    expiresAt: Date.now() + SESSION_TTL_MS,
  })

  return { sessionId, source, skills, tempDir }
}
