import { execSync } from 'node:child_process'


let cachedToken: string | null | undefined

export function resolveGitHubToken(): string | null {
  if (cachedToken !== undefined) {
    return cachedToken
  }

  const envToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (envToken) {
    cachedToken = envToken
    return envToken
  }

  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 5000 }).trim()
    if (token && !token.includes(' ')) {
      cachedToken = token
      return token
    }
  }
  catch {
    // gh is optional; unauthenticated public GitHub reads can still work.
  }

  cachedToken = null
  return null
}

export function resetTokenCache() {
  cachedToken = undefined
  etagCache.clear()
  rateLimitRemaining = 5000
  rateLimitReset = 0
}

const etagCache = new Map<string, { etag: string, data: unknown }>()

let rateLimitRemaining = 5000
let rateLimitReset = 0

export function isGitHubRateLimited(): boolean {
  if (rateLimitRemaining > 100) {
    return false
  }
  const now = Math.floor(Date.now() / 1000)
  return now < rateLimitReset
}

function recordRateLimit(headers: Headers): void {
  const remaining = headers.get('X-RateLimit-Remaining')
  const reset = headers.get('X-RateLimit-Reset')
  if (remaining) {
    rateLimitRemaining = Number.parseInt(remaining, 10)
  }
  if (reset) {
    rateLimitReset = Number.parseInt(reset, 10)
  }
}

async function githubGet<T>(path: string): Promise<T | null> {
  const token = resolveGitHubToken()
  const url = `https://api.github.com${path}`
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const cached = etagCache.get(url)
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag
  }

  const res = await fetch(url, { headers })
  recordRateLimit(res.headers)

  if (res.status === 304) {
    return cached?.data as T
  }
  if (!res.ok) {
    return null
  }

  const data = await res.json() as T
  const etag = res.headers.get('ETag')
  if (etag) {
    etagCache.set(url, { etag, data })
  }
  return data
}

async function githubGetPaged<T>(path: string, maxPages = 10): Promise<T[] | null> {
  const items: T[] = []
  for (let page = 1; page <= maxPages; page++) {
    const separator = path.includes('?') ? '&' : '?'
    const batch = await githubGet<T[]>(`${path}${separator}per_page=100&page=${page}`)
    if (!batch) {
      return null
    }
    items.push(...batch)
    if (batch.length < 100) {
      break
    }
  }
  return items
}

export interface GitHubPullRequest {
  number: number
  title: string
  state: 'open' | 'closed'
  merged: boolean
  mergeable: boolean | null
  mergeable_state?: string
  head: { sha: string, ref: string }
  base: { ref: string }
}

export interface GitHubCheckRun {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
}

interface GitHubCheckRunsResponse {
  total_count: number
  check_runs: GitHubCheckRun[]
}

export interface GitHubCommitStatus {
  context: string
  state: 'error' | 'failure' | 'pending' | 'success'
  description: string | null
  target_url: string | null
}

export interface GitHubCombinedStatus {
  state: 'error' | 'failure' | 'pending' | 'success'
  total_count: number
  statuses: GitHubCommitStatus[]
}

export interface GitHubReviewUser {
  login: string
}

export interface GitHubPullRequestReview {
  id: number
  user: GitHubReviewUser | null
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  commit_id: string
  submitted_at: string | null
  body: string | null
}

export function hasGitHubToken(): boolean {
  return resolveGitHubToken() !== null
}

export function fetchPullRequest(owner: string, repo: string, pr: number): Promise<GitHubPullRequest | null> {
  return githubGet<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${pr}`)
}

export async function fetchCheckRuns(owner: string, repo: string, ref: string): Promise<GitHubCheckRunsResponse | null> {
  const runs: GitHubCheckRun[] = []
  let totalCount = 0
  for (let page = 1; page <= 10; page++) {
    const data = await githubGet<GitHubCheckRunsResponse>(`/repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=100&page=${page}`)
    if (!data) {
      return null
    }
    totalCount = data.total_count
    runs.push(...data.check_runs)
    if (data.check_runs.length < 100 || runs.length >= data.total_count) {
      break
    }
  }
  return { total_count: totalCount, check_runs: runs }
}

export function fetchCombinedStatus(owner: string, repo: string, ref: string): Promise<GitHubCombinedStatus | null> {
  return githubGet<GitHubCombinedStatus>(`/repos/${owner}/${repo}/commits/${ref}/status`)
}

export function fetchPullRequestReviews(owner: string, repo: string, pr: number): Promise<GitHubPullRequestReview[] | null> {
  return githubGetPaged<GitHubPullRequestReview>(`/repos/${owner}/${repo}/pulls/${pr}/reviews`)
}
