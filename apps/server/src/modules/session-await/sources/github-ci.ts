import { execSync } from 'node:child_process'

import type { CheckResult, SessionAwait, SessionAwaitSource } from '../types'

// ── GitHub Token Resolution ──

let cachedToken: string | null | undefined

function resolveGitHubToken(): string | null {
  if (cachedToken !== undefined) return cachedToken

  // P0: environment variables
  const envToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (envToken) {
    cachedToken = envToken
    return envToken
  }

  // P1: gh CLI
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 5000 }).trim()
    if (token && !token.includes(' ')) {
      cachedToken = token
      return token
    }
  }
  catch {
    // gh not installed or not logged in
  }

  cachedToken = null
  return null
}

/** Reset cached token (for testing or when token expires) */
export function resetTokenCache() {
  cachedToken = undefined
}

// ── ETag Cache ──

const etagCache = new Map<string, { etag: string, data: unknown }>()

// ── Rate Limit Tracking ──

let rateLimitRemaining = 5000
let rateLimitReset = 0

function isRateLimited(): boolean {
  if (rateLimitRemaining > 100) return false
  const now = Math.floor(Date.now() / 1000)
  return now < rateLimitReset
}

// ── GitHub API ──

interface CheckRun {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
}

interface CheckRunsResponse {
  total_count: number
  check_runs: CheckRun[]
}

async function fetchCheckRuns(owner: string, repo: string, ref: string): Promise<CheckRunsResponse | null> {
  const token = resolveGitHubToken()
  if (!token) return null

  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}/check-runs`
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  // Conditional request with ETag
  const cached = etagCache.get(url)
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag
  }

  const res = await fetch(url, { headers })

  // Track rate limit
  const remaining = res.headers.get('X-RateLimit-Remaining')
  const reset = res.headers.get('X-RateLimit-Reset')
  if (remaining) rateLimitRemaining = Number.parseInt(remaining, 10)
  if (reset) rateLimitReset = Number.parseInt(reset, 10)

  if (res.status === 304) {
    return cached?.data as CheckRunsResponse
  }

  if (!res.ok) return null

  const data = await res.json() as CheckRunsResponse
  const etag = res.headers.get('ETag')
  if (etag) {
    etagCache.set(url, { etag, data })
  }
  return data
}

// ── Filter schema: { repo: "owner/repo", pr: number } or { repo: "owner/repo", sha: "abc123" } ──

interface GitHubCIFilter {
  repo: string
  pr?: number
  sha?: string
}

function parseFilter(filterJson: string): GitHubCIFilter | null {
  try {
    const f = JSON.parse(filterJson) as GitHubCIFilter
    if (!f.repo || (!f.pr && !f.sha)) return null
    return f
  }
  catch { return null }
}

// ── Source Adapter ──

export const githubCISource: SessionAwaitSource = {
  source: 'github-ci',
  pollIntervalMs: 30_000,

  async checkPending(awaits: SessionAwait[]): Promise<CheckResult[]> {
    if (isRateLimited()) {
      return awaits.map(a => ({ awaitId: a.id, matched: false, transientError: 'GitHub API rate limited' }))
    }

    const results: CheckResult[] = []

    for (const row of awaits) {
      const filter = parseFilter(row.filterJson)
      if (!filter) {
        results.push({ awaitId: row.id, matched: false, transientError: 'Invalid filter JSON' })
        continue
      }

      const [owner, repo] = filter.repo.split('/')
      if (!owner || !repo) {
        results.push({ awaitId: row.id, matched: false, transientError: 'Invalid repo format' })
        continue
      }

      // For PR-based, we need the head SHA. Use the PR number to get it.
      let ref = filter.sha ?? ''
      if (filter.pr && !ref) {
        // Fetch PR to get head SHA
        const token = resolveGitHubToken()
        if (!token) {
          results.push({ awaitId: row.id, matched: false, transientError: 'No GitHub token available' })
          continue
        }
        try {
          const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${filter.pr}`, {
            headers: {
              'Accept': 'application/vnd.github+json',
              'Authorization': `Bearer ${token}`,
              'X-GitHub-Api-Version': '2022-11-28',
            },
          })
          if (!prRes.ok) {
            results.push({ awaitId: row.id, matched: false, transientError: `PR fetch failed: ${prRes.status}` })
            continue
          }
          const prData = await prRes.json() as { head: { sha: string } }
          ref = prData.head.sha
        }
        catch (e) {
          results.push({ awaitId: row.id, matched: false, transientError: `PR fetch error: ${(e as Error).message}` })
          continue
        }
      }

      if (!ref) {
        results.push({ awaitId: row.id, matched: false, transientError: 'No ref resolved' })
        continue
      }

      const checkRuns = await fetchCheckRuns(owner, repo, ref)
      if (!checkRuns) {
        results.push({ awaitId: row.id, matched: false, transientError: 'No GitHub token or API error' })
        continue
      }

      if (checkRuns.total_count === 0) {
        // Grace period: if no checks appear within 2 minutes of creation,
        // the repo likely has no CI configured — auto-resolve
        const ageSeconds = Math.floor(Date.now() / 1000) - (row.createdAt ?? 0)
        if (ageSeconds > 120) {
          results.push({
            awaitId: row.id,
            matched: true,
            resumeText: 'No CI checks configured for this repository. Proceeding without CI.',
            resumePayloadJson: JSON.stringify({ allSuccess: true, totalCount: 0, runs: [], noCIConfigured: true }),
          })
        }
        else {
          results.push({ awaitId: row.id, matched: false })
        }
        continue
      }

      // Check if all runs are completed
      const allCompleted = checkRuns.check_runs.every(r => r.status === 'completed')
      if (!allCompleted) {
        results.push({ awaitId: row.id, matched: false })
        continue
      }

      // All completed — check conclusions
      const allSuccess = checkRuns.check_runs.every(r =>
        r.conclusion === 'success' || r.conclusion === 'neutral' || r.conclusion === 'skipped',
      )
      const summary = checkRuns.check_runs.map(r => `${r.name}: ${r.conclusion}`).join(', ')

      results.push({
        awaitId: row.id,
        matched: true,
        resumeText: allSuccess
          ? `CI passed. All ${checkRuns.total_count} checks succeeded.`
          : `CI completed with failures. ${summary}`,
        resumePayloadJson: JSON.stringify({
          allSuccess,
          totalCount: checkRuns.total_count,
          runs: checkRuns.check_runs.map(r => ({ name: r.name, conclusion: r.conclusion })),
        }),
      })
    }

    return results
  },
}

// ── Public: Fetch live CI status for UI display ──

export interface LiveCheckRun {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
  required: boolean
}

export interface LiveCIStatus {
  owner: string
  repo: string
  prNumber: number | null
  prTitle: string | null
  ref: string
  runs: LiveCheckRun[]
  allCompleted: boolean
  allPassed: boolean
  hasToken: boolean
}

export async function fetchLiveCIStatus(filterJson: string): Promise<LiveCIStatus | null> {
  const filter = parseFilter(filterJson)
  if (!filter) return null

  const [owner, repo] = filter.repo.split('/')
  if (!owner || !repo) return null

  const token = resolveGitHubToken()
  if (!token) return { owner, repo, prNumber: filter.pr ?? null, prTitle: null, ref: '', runs: [], allCompleted: false, allPassed: false, hasToken: false }

  let ref = filter.sha ?? ''
  let prTitle: string | null = null

  if (filter.pr) {
    try {
      const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${filter.pr}`, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
      if (prRes.ok) {
        const prData = await prRes.json() as { head: { sha: string }, title: string }
        ref = prData.head.sha
        prTitle = prData.title
      }
    }
    catch { /* ignore */ }
  }

  if (!ref) return { owner, repo, prNumber: filter.pr ?? null, prTitle, ref: '', runs: [], allCompleted: false, allPassed: false, hasToken: true }

  const checkRuns = await fetchCheckRuns(owner, repo, ref)
  if (!checkRuns) return { owner, repo, prNumber: filter.pr ?? null, prTitle, ref, runs: [], allCompleted: false, allPassed: false, hasToken: true }

  // Fetch branch protection required checks (best effort)
  let requiredChecks = new Set<string>()
  try {
    // Try to get required status checks — this is a rough heuristic
    // GitHub doesn't have a simple API for "which checks are required for this PR"
    // so we just mark all as non-required for now
  }
  catch { /* ignore */ }

  const runs: LiveCheckRun[] = checkRuns.check_runs.map(r => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    required: requiredChecks.has(r.name),
  }))

  const allCompleted = runs.every(r => r.status === 'completed')
  const allPassed = allCompleted && runs.every(r =>
    r.conclusion === 'success' || r.conclusion === 'neutral' || r.conclusion === 'skipped',
  )

  return { owner, repo, prNumber: filter.pr ?? null, prTitle, ref, runs, allCompleted, allPassed, hasToken: true }
}
