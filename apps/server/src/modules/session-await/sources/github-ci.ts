// Input: session-await rows with GitHub CI filters
// Output: GitHub check/status aggregation source and live status projection
// Position: GitHub CI source adapter owned by session-await

import type { CheckResult, SessionAwait, SessionAwaitSource } from '../types'
import {
  fetchCheckRuns,
  fetchCombinedStatus,
  fetchPullRequest,
  hasGitHubToken,
  isGitHubRateLimited,
  resetTokenCache,
  type GitHubCheckRun,
  type GitHubCommitStatus,
} from './github-api'

export { resetTokenCache }

type GitHubCIMode = 'all'

interface GitHubCIFilter {
  repo: string
  pr?: number
  sha?: string
  mode?: GitHubCIMode
  allowNoChecksAfterSeconds?: number
}

export interface LiveCheckRun {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
  required: boolean
}

export interface LiveCommitStatus {
  context: string
  state: 'error' | 'failure' | 'pending' | 'success'
  description: string | null
  targetUrl: string | null
}

export interface LiveCIStatus {
  kind: 'github-ci'
  owner: string
  repo: string
  prNumber: number | null
  prTitle: string | null
  ref: string
  checkRuns: LiveCheckRun[]
  statuses: LiveCommitStatus[]
  totalCount: number
  pendingCount: number
  failureCount: number
  allCompleted: boolean
  allPassed: boolean
  noCIConfigured: boolean
  hasToken: boolean
}

interface ResolvedCITarget {
  owner: string
  repo: string
  prNumber: number | null
  prTitle: string | null
  ref: string
}

interface AggregatedCI {
  checkRuns: GitHubCheckRun[]
  statuses: GitHubCommitStatus[]
  totalCount: number
  pendingCount: number
  failureCount: number
  allCompleted: boolean
  allPassed: boolean
}

const DEFAULT_NO_CHECKS_GRACE_SECONDS = 300
const PASSING_CHECK_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])
const FAILING_CHECK_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'])

function parseFilter(filterJson: string): GitHubCIFilter | null {
  try {
    const f = JSON.parse(filterJson) as GitHubCIFilter
    if (!f.repo || (!f.pr && !f.sha)) {
      return null
    }
    if (f.pr !== undefined && (!Number.isInteger(f.pr) || f.pr <= 0)) {
      return null
    }
    if (f.sha !== undefined && typeof f.sha !== 'string') {
      return null
    }
    return f
  }
  catch {
    return null
  }
}

function splitRepo(repoFullName: string): { owner: string, repo: string } | null {
  const [owner, repo] = repoFullName.split('/')
  return owner && repo ? { owner, repo } : null
}

async function resolveTarget(filter: GitHubCIFilter): Promise<ResolvedCITarget | null> {
  const repoParts = splitRepo(filter.repo)
  if (!repoParts) {
    return null
  }

  let ref = filter.sha ?? ''
  let prTitle: string | null = null
  if (filter.pr) {
    const prData = await fetchPullRequest(repoParts.owner, repoParts.repo, filter.pr)
    if (!prData) {
      return null
    }
    ref = prData.head.sha
    prTitle = prData.title
  }

  if (!ref) {
    return null
  }

  return {
    owner: repoParts.owner,
    repo: repoParts.repo,
    prNumber: filter.pr ?? null,
    prTitle,
    ref,
  }
}

function aggregateCI(checkRuns: GitHubCheckRun[], statuses: GitHubCommitStatus[]): AggregatedCI {
  let pendingCount = 0
  let failureCount = 0

  for (const run of checkRuns) {
    if (run.status !== 'completed') {
      pendingCount++
      continue
    }
    if (!run.conclusion || !PASSING_CHECK_CONCLUSIONS.has(run.conclusion)) {
      failureCount++
    }
  }

  for (const status of statuses) {
    if (status.state === 'pending') {
      pendingCount++
    }
    else if (status.state !== 'success') {
      failureCount++
    }
  }

  const totalCount = checkRuns.length + statuses.length
  const allCompleted = totalCount > 0 && pendingCount === 0
  const allPassed = allCompleted && failureCount === 0

  return {
    checkRuns,
    statuses,
    totalCount,
    pendingCount,
    failureCount,
    allCompleted,
    allPassed,
  }
}

async function fetchAggregatedCI(target: ResolvedCITarget): Promise<AggregatedCI | null> {
  const [checkRuns, combinedStatus] = await Promise.all([
    fetchCheckRuns(target.owner, target.repo, target.ref),
    fetchCombinedStatus(target.owner, target.repo, target.ref),
  ])
  if (!checkRuns || !combinedStatus) {
    return null
  }
  return aggregateCI(checkRuns.check_runs, combinedStatus.statuses)
}

function buildCIResumePayload(target: ResolvedCITarget, aggregate: AggregatedCI, noCIConfigured = false): string {
  return JSON.stringify({
    kind: 'github-ci',
    repo: `${target.owner}/${target.repo}`,
    pr: target.prNumber,
    ref: target.ref,
    allSuccess: aggregate.allPassed,
    totalCount: aggregate.totalCount,
    pendingCount: aggregate.pendingCount,
    failureCount: aggregate.failureCount,
    noCIConfigured,
    checkRuns: aggregate.checkRuns.map(r => ({ name: r.name, status: r.status, conclusion: r.conclusion })),
    statuses: aggregate.statuses.map(s => ({ context: s.context, state: s.state, description: s.description, targetUrl: s.target_url })),
  })
}

function buildSummary(aggregate: AggregatedCI): string {
  const failedChecks = aggregate.checkRuns
    .filter(r => r.status === 'completed' && (!r.conclusion || FAILING_CHECK_CONCLUSIONS.has(r.conclusion) || !PASSING_CHECK_CONCLUSIONS.has(r.conclusion)))
    .map(r => `${r.name}: ${r.conclusion ?? 'unknown'}`)
  const failedStatuses = aggregate.statuses
    .filter(s => s.state === 'error' || s.state === 'failure')
    .map(s => `${s.context}: ${s.state}`)
  return [...failedChecks, ...failedStatuses].join(', ')
}

export const githubCISource: SessionAwaitSource = {
  source: 'github-ci',
  pollIntervalMs: 30_000,

  async checkPending(awaits: SessionAwait[]): Promise<CheckResult[]> {
    if (isGitHubRateLimited()) {
      return awaits.map(a => ({ awaitId: a.id, matched: false, transientError: 'GitHub API rate limited' }))
    }

    const results: CheckResult[] = []

    for (const row of awaits) {
      const filter = parseFilter(row.filterJson)
      if (!filter) {
        results.push({ awaitId: row.id, matched: false, transientError: 'Invalid GitHub CI filter JSON' })
        continue
      }

      const target = await resolveTarget(filter)
      if (!target) {
        results.push({ awaitId: row.id, matched: false, transientError: 'Unable to resolve GitHub CI target' })
        continue
      }

      const aggregate = await fetchAggregatedCI(target)
      if (!aggregate) {
        results.push({ awaitId: row.id, matched: false, transientError: 'GitHub CI API unavailable' })
        continue
      }

      if (aggregate.totalCount === 0) {
        const graceSeconds = filter.allowNoChecksAfterSeconds ?? DEFAULT_NO_CHECKS_GRACE_SECONDS
        const ageSeconds = Math.floor(Date.now() / 1000) - (row.createdAt ?? 0)
        if (ageSeconds > graceSeconds) {
          results.push({
            awaitId: row.id,
            matched: true,
            resumeText: 'No GitHub checks or commit statuses were found. Proceeding without CI signals.',
            resumePayloadJson: buildCIResumePayload(target, aggregate, true),
          })
        }
        else {
          results.push({ awaitId: row.id, matched: false })
        }
        continue
      }

      if (!aggregate.allCompleted) {
        results.push({ awaitId: row.id, matched: false })
        continue
      }

      results.push({
        awaitId: row.id,
        matched: true,
        resumeText: aggregate.allPassed
          ? `GitHub checks passed. All ${aggregate.totalCount} checks/statuses succeeded.`
          : `GitHub checks completed with failures. ${buildSummary(aggregate)}`,
        resumePayloadJson: buildCIResumePayload(target, aggregate),
      })
    }

    return results
  },
}

export async function fetchLiveCIStatus(filterJson: string): Promise<LiveCIStatus | null> {
  const filter = parseFilter(filterJson)
  if (!filter) {
    return null
  }

  const repoParts = splitRepo(filter.repo)
  if (!repoParts) {
    return null
  }

  if (!hasGitHubToken()) {
    return {
      kind: 'github-ci',
      owner: repoParts.owner,
      repo: repoParts.repo,
      prNumber: filter.pr ?? null,
      prTitle: null,
      ref: filter.sha ?? '',
      checkRuns: [],
      statuses: [],
      totalCount: 0,
      pendingCount: 0,
      failureCount: 0,
      allCompleted: false,
      allPassed: false,
      noCIConfigured: false,
      hasToken: false,
    }
  }

  const target = await resolveTarget(filter)
  if (!target) {
    return null
  }

  const aggregate = await fetchAggregatedCI(target)
  if (!aggregate) {
    return {
      kind: 'github-ci',
      owner: target.owner,
      repo: target.repo,
      prNumber: target.prNumber,
      prTitle: target.prTitle,
      ref: target.ref,
      checkRuns: [],
      statuses: [],
      totalCount: 0,
      pendingCount: 0,
      failureCount: 0,
      allCompleted: false,
      allPassed: false,
      noCIConfigured: false,
      hasToken: true,
    }
  }

  return {
    kind: 'github-ci',
    owner: target.owner,
    repo: target.repo,
    prNumber: target.prNumber,
    prTitle: target.prTitle,
    ref: target.ref,
    checkRuns: aggregate.checkRuns.map(r => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      required: false,
    })),
    statuses: aggregate.statuses.map(s => ({
      context: s.context,
      state: s.state,
      description: s.description,
      targetUrl: s.target_url,
    })),
    totalCount: aggregate.totalCount,
    pendingCount: aggregate.pendingCount,
    failureCount: aggregate.failureCount,
    allCompleted: aggregate.allCompleted,
    allPassed: aggregate.allPassed,
    noCIConfigured: aggregate.totalCount === 0,
    hasToken: true,
  }
}
