import type { CheckResult, SessionAwait, SessionAwaitSource } from '../types'
import {
  fetchPullRequest,
  fetchPullRequestReviews,
  hasGitHubToken,
  isGitHubRateLimited,
  type GitHubPullRequestReview,
} from './github-api'

type GitHubReviewMode = 'approved' | 'changes-requested' | 'reviewed'

interface GitHubReviewFilter {
  repo: string
  pr: number
  mode?: GitHubReviewMode
  headSha?: string
}

export interface LiveReview {
  id: number
  reviewer: string | null
  state: GitHubPullRequestReview['state']
  commitId: string
  submittedAt: string | null
}

export interface LiveReviewStatus {
  kind: 'github-review'
  owner: string
  repo: string
  prNumber: number
  prTitle: string | null
  mode: GitHubReviewMode
  headSha: string | null
  matched: boolean
  approvedCount: number
  changesRequestedCount: number
  reviews: LiveReview[]
  hasToken: boolean
}

interface ResolvedReviewTarget {
  owner: string
  repo: string
  prNumber: number
  prTitle: string | null
  mode: GitHubReviewMode
  headSha: string
}

interface ReviewAggregate {
  reviews: LiveReview[]
  approvedCount: number
  changesRequestedCount: number
  matched: boolean
}

function parseFilter(filterJson: string): GitHubReviewFilter | null {
  try {
    const f = JSON.parse(filterJson) as GitHubReviewFilter
    if (!f.repo || !Number.isInteger(f.pr) || f.pr <= 0) {
      return null
    }
    if (f.mode && f.mode !== 'approved' && f.mode !== 'changes-requested' && f.mode !== 'reviewed') {
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

async function resolveTarget(filter: GitHubReviewFilter): Promise<ResolvedReviewTarget | null> {
  const repoParts = splitRepo(filter.repo)
  if (!repoParts) {
    return null
  }

  const prData = await fetchPullRequest(repoParts.owner, repoParts.repo, filter.pr)
  if (!prData) {
    return null
  }

  return {
    owner: repoParts.owner,
    repo: repoParts.repo,
    prNumber: filter.pr,
    prTitle: prData.title,
    mode: filter.mode ?? 'approved',
    headSha: filter.headSha ?? prData.head.sha,
  }
}

function latestSubmittedReviewsForHead(reviews: GitHubPullRequestReview[], headSha: string): LiveReview[] {
  const latestByReviewer = new Map<string, LiveReview>()

  for (const review of reviews) {
    if (!review.submitted_at || review.commit_id !== headSha || review.state === 'PENDING') {
      continue
    }
    const reviewer = review.user?.login ?? `review-${review.id}`
    const current = latestByReviewer.get(reviewer)
    if (current?.submittedAt && current.submittedAt >= review.submitted_at) {
      continue
    }
    latestByReviewer.set(reviewer, {
      id: review.id,
      reviewer: review.user?.login ?? null,
      state: review.state,
      commitId: review.commit_id,
      submittedAt: review.submitted_at,
    })
  }

  return [...latestByReviewer.values()].sort((a, b) =>
    (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))
}

function aggregateReviews(reviews: GitHubPullRequestReview[], target: ResolvedReviewTarget): ReviewAggregate {
  const latest = latestSubmittedReviewsForHead(reviews, target.headSha)
  const activeReviews = latest.filter(r => r.state !== 'DISMISSED' && r.state !== 'COMMENTED')
  const approvedCount = activeReviews.filter(r => r.state === 'APPROVED').length
  const changesRequestedCount = activeReviews.filter(r => r.state === 'CHANGES_REQUESTED').length

  const matched = (() => {
    if (target.mode === 'changes-requested') {
      return changesRequestedCount > 0
    }
    if (target.mode === 'reviewed') {
      return activeReviews.length > 0 || latest.some(r => r.state === 'COMMENTED')
    }
    return approvedCount > 0 && changesRequestedCount === 0
  })()

  return {
    reviews: latest,
    approvedCount,
    changesRequestedCount,
    matched,
  }
}

function buildReviewPayload(target: ResolvedReviewTarget, aggregate: ReviewAggregate): string {
  return JSON.stringify({
    kind: 'github-review',
    repo: `${target.owner}/${target.repo}`,
    pr: target.prNumber,
    mode: target.mode,
    headSha: target.headSha,
    approvedCount: aggregate.approvedCount,
    changesRequestedCount: aggregate.changesRequestedCount,
    reviews: aggregate.reviews,
  })
}

function buildResumeText(target: ResolvedReviewTarget, aggregate: ReviewAggregate): string {
  if (target.mode === 'changes-requested') {
    return `GitHub PR #${target.prNumber} has requested changes.`
  }
  if (target.mode === 'reviewed') {
    return `GitHub PR #${target.prNumber} has new review activity.`
  }
  return `GitHub PR #${target.prNumber} is approved by ${aggregate.approvedCount} reviewer${aggregate.approvedCount === 1 ? '' : 's'}.`
}

export const githubReviewSource: SessionAwaitSource = {
  source: 'github-review',
  pollIntervalMs: 30_000,

  async checkPending(awaits: SessionAwait[]): Promise<CheckResult[]> {
    if (isGitHubRateLimited()) {
      return awaits.map(a => ({ awaitId: a.id, matched: false, transientError: 'GitHub API rate limited' }))
    }

    const results: CheckResult[] = []

    for (const row of awaits) {
      const filter = parseFilter(row.filterJson)
      if (!filter) {
        results.push({ awaitId: row.id, matched: false, transientError: 'Invalid GitHub review filter JSON' })
        continue
      }

      const target = await resolveTarget(filter)
      if (!target) {
        results.push({ awaitId: row.id, matched: false, transientError: 'Unable to resolve GitHub review target' })
        continue
      }

      const reviews = await fetchPullRequestReviews(target.owner, target.repo, target.prNumber)
      if (!reviews) {
        results.push({ awaitId: row.id, matched: false, transientError: 'GitHub review API unavailable' })
        continue
      }

      const aggregate = aggregateReviews(reviews, target)
      if (!aggregate.matched) {
        results.push({ awaitId: row.id, matched: false })
        continue
      }

      results.push({
        awaitId: row.id,
        matched: true,
        resumeText: buildResumeText(target, aggregate),
        resumePayloadJson: buildReviewPayload(target, aggregate),
      })
    }

    return results
  },
}

export async function fetchLiveReviewStatus(filterJson: string): Promise<LiveReviewStatus | null> {
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
      kind: 'github-review',
      owner: repoParts.owner,
      repo: repoParts.repo,
      prNumber: filter.pr,
      prTitle: null,
      mode: filter.mode ?? 'approved',
      headSha: filter.headSha ?? null,
      matched: false,
      approvedCount: 0,
      changesRequestedCount: 0,
      reviews: [],
      hasToken: false,
    }
  }

  const target = await resolveTarget(filter)
  if (!target) {
    return null
  }

  const reviews = await fetchPullRequestReviews(target.owner, target.repo, target.prNumber)
  if (!reviews) {
    return {
      kind: 'github-review',
      owner: target.owner,
      repo: target.repo,
      prNumber: target.prNumber,
      prTitle: target.prTitle,
      mode: target.mode,
      headSha: target.headSha,
      matched: false,
      approvedCount: 0,
      changesRequestedCount: 0,
      reviews: [],
      hasToken: true,
    }
  }

  const aggregate = aggregateReviews(reviews, target)
  return {
    kind: 'github-review',
    owner: target.owner,
    repo: target.repo,
    prNumber: target.prNumber,
    prTitle: target.prTitle,
    mode: target.mode,
    headSha: target.headSha,
    matched: aggregate.matched,
    approvedCount: aggregate.approvedCount,
    changesRequestedCount: aggregate.changesRequestedCount,
    reviews: aggregate.reviews,
    hasToken: true,
  }
}
