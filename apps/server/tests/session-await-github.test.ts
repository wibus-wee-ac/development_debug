import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionAwait } from '../src/modules/session-await/types'
import { fetchLiveCIStatus, githubCISource, resetTokenCache } from '../src/modules/session-await/sources/github-ci'
import { githubReviewSource } from '../src/modules/session-await/sources/github-review'

const originalFetch = globalThis.fetch

function awaitRow(filter: unknown, overrides: Partial<SessionAwait> = {}): SessionAwait {
  return {
    id: 'await-1',
    chatSessionId: 'session-1',
    workspaceId: 'workspace-1',
    source: 'github-ci',
    filterJson: JSON.stringify(filter),
    status: 'pending',
    reason: null,
    resumePayloadJson: null,
    createdAt: Math.floor(Date.now() / 1000) - 60,
    triggeredAt: null,
    expiresAt: null,
    fireAt: null,
    lastCheckedAt: null,
    lastErrorText: null,
    ...overrides,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function installGitHubFetch(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new Request(input).url
    const parsed = new URL(url)
    const key = `${parsed.pathname}?${parsed.searchParams.toString()}`
    const pathKey = parsed.pathname
    const body = routes[key] ?? routes[pathKey]
    if (body === undefined) {
      return new Response('not found', { status: 404 })
    }
    return jsonResponse(body)
  })
  globalThis.fetch = mock as typeof fetch
  return mock
}

describe('GitHub session-await sources', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'token'
    resetTokenCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.GITHUB_TOKEN
    resetTokenCache()
    vi.restoreAllMocks()
  })

  it('waits until both check runs and commit statuses complete successfully', async () => {
    installGitHubFetch({
      '/repos/acme/app/pulls/42': {
        number: 42,
        title: 'Ship feature',
        state: 'open',
        merged: false,
        mergeable: true,
        head: { sha: 'head-sha', ref: 'feature' },
        base: { ref: 'main' },
      },
      '/repos/acme/app/commits/head-sha/check-runs?per_page=100&page=1': {
        total_count: 1,
        check_runs: [{ name: 'build', status: 'completed', conclusion: 'success' }],
      },
      '/repos/acme/app/commits/head-sha/status': {
        state: 'success',
        total_count: 1,
        statuses: [{ context: 'legacy-ci', state: 'success', description: 'ok', target_url: null }],
      },
    })

    const [result] = await githubCISource.checkPending([
      awaitRow({ repo: 'acme/app', pr: 42 }),
    ])

    expect(result.matched).toBe(true)
    expect(result.resumeText).toContain('All 2 checks/statuses succeeded')
    expect(JSON.parse(result.resumePayloadJson ?? '{}')).toMatchObject({
      kind: 'github-ci',
      repo: 'acme/app',
      pr: 42,
      ref: 'head-sha',
      allSuccess: true,
      totalCount: 2,
    })
  })

  it('resumes with a failure payload when any check or status fails', async () => {
    installGitHubFetch({
      '/repos/acme/app/commits/bad-sha/check-runs?per_page=100&page=1': {
        total_count: 1,
        check_runs: [{ name: 'test', status: 'completed', conclusion: 'failure' }],
      },
      '/repos/acme/app/commits/bad-sha/status': {
        state: 'failure',
        total_count: 1,
        statuses: [{ context: 'deploy-preview', state: 'failure', description: 'failed', target_url: null }],
      },
    })

    const [result] = await githubCISource.checkPending([
      awaitRow({ repo: 'acme/app', sha: 'bad-sha' }),
    ])

    expect(result.matched).toBe(true)
    expect(result.resumeText).toContain('completed with failures')
    expect(JSON.parse(result.resumePayloadJson ?? '{}')).toMatchObject({
      kind: 'github-ci',
      allSuccess: false,
      failureCount: 2,
    })
  })

  it('keeps a CI await pending while no checks or statuses are still inside the grace window', async () => {
    installGitHubFetch({
      '/repos/acme/app/commits/new-sha/check-runs?per_page=100&page=1': {
        total_count: 0,
        check_runs: [],
      },
      '/repos/acme/app/commits/new-sha/status': {
        state: 'pending',
        total_count: 0,
        statuses: [],
      },
    })

    const [result] = await githubCISource.checkPending([
      awaitRow({ repo: 'acme/app', sha: 'new-sha', allowNoChecksAfterSeconds: 300 }),
    ])

    expect(result).toEqual({ awaitId: 'await-1', matched: false })
  })

  it('projects GitHub Actions workflow jobs and steps for live CI status', async () => {
    installGitHubFetch({
      '/repos/acme/app/pulls/42': {
        number: 42,
        title: 'Ship feature',
        state: 'open',
        merged: false,
        mergeable: true,
        head: { sha: 'head-sha', ref: 'feature' },
        base: { ref: 'main' },
      },
      '/repos/acme/app/commits/head-sha/check-runs?per_page=100&page=1': {
        total_count: 1,
        check_runs: [{
          id: 101,
          name: 'Bun - typecheck, frontend check',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/acme/app/runs/101',
          details_url: 'https://github.com/acme/app/actions/runs/201/job/301',
        }],
      },
      '/repos/acme/app/commits/head-sha/status': {
        state: 'success',
        total_count: 0,
        statuses: [],
      },
      '/repos/acme/app/actions/runs?head_sha=head-sha&per_page=100&page=1': {
        total_count: 1,
        workflow_runs: [{
          id: 201,
          name: 'CI',
          display_title: 'Ship feature',
          run_number: 8842,
          run_attempt: 1,
          status: 'completed',
          conclusion: 'success',
          head_sha: 'head-sha',
          html_url: 'https://github.com/acme/app/actions/runs/201',
          created_at: '2026-05-20T09:58:00Z',
          updated_at: '2026-05-20T09:59:15Z',
        }],
      },
      '/repos/acme/app/actions/runs/201/jobs?per_page=100&page=1': {
        total_count: 1,
        jobs: [{
          id: 301,
          run_id: 201,
          run_attempt: 1,
          name: 'Bun - typecheck, frontend check',
          status: 'completed',
          conclusion: 'success',
          workflow_name: 'CI',
          head_sha: 'head-sha',
          html_url: 'https://github.com/acme/app/actions/runs/201/job/301',
          check_run_url: 'https://api.github.com/repos/acme/app/check-runs/101',
          started_at: '2026-05-20T09:58:01Z',
          completed_at: '2026-05-20T09:59:15Z',
          runner_name: 'GitHub Actions 1000004214',
          labels: ['ubuntu-latest'],
          steps: [
            {
              name: 'Set up job',
              status: 'completed',
              conclusion: 'success',
              number: 1,
              started_at: '2026-05-20T09:58:01Z',
              completed_at: '2026-05-20T09:58:03Z',
            },
            {
              name: 'Run frontend checks',
              status: 'completed',
              conclusion: 'success',
              number: 2,
              started_at: '2026-05-20T09:58:03Z',
              completed_at: '2026-05-20T09:59:15Z',
            },
          ],
        }],
      },
    })

    const status = await fetchLiveCIStatus(JSON.stringify({ repo: 'acme/app', pr: 42 }))

    expect(status).toMatchObject({
      kind: 'github-ci',
      prNumber: 42,
      ref: 'head-sha',
      workflowRuns: [{
        id: 201,
        name: 'CI',
        jobs: [{
          id: 301,
          checkRunId: 101,
          steps: [
            { name: 'Set up job', conclusion: 'success' },
            { name: 'Run frontend checks', conclusion: 'success' },
          ],
        }],
      }],
      checkRuns: [{
        id: 101,
        workflowRunId: 201,
        workflowJobId: 301,
        steps: [
          { name: 'Set up job', conclusion: 'success' },
          { name: 'Run frontend checks', conclusion: 'success' },
        ],
      }],
    })
  })

  it('matches review approval only for the current PR head without newer changes requested', async () => {
    installGitHubFetch({
      '/repos/acme/app/pulls/42': {
        number: 42,
        title: 'Ship feature',
        state: 'open',
        merged: false,
        mergeable: true,
        head: { sha: 'head-sha', ref: 'feature' },
        base: { ref: 'main' },
      },
      '/repos/acme/app/pulls/42/reviews?per_page=100&page=1': [
        { id: 1, user: { login: 'old' }, state: 'APPROVED', commit_id: 'old-sha', submitted_at: '2026-01-01T00:00:00Z', body: null },
        { id: 2, user: { login: 'wibus' }, state: 'APPROVED', commit_id: 'head-sha', submitted_at: '2026-01-02T00:00:00Z', body: null },
      ],
    })

    const [result] = await githubReviewSource.checkPending([
      awaitRow({ repo: 'acme/app', pr: 42, mode: 'approved' }, { source: 'github-review' }),
    ])

    expect(result.matched).toBe(true)
    expect(result.resumeText).toContain('approved by 1 reviewer')
    expect(JSON.parse(result.resumePayloadJson ?? '{}')).toMatchObject({
      kind: 'github-review',
      approvedCount: 1,
      changesRequestedCount: 0,
    })
  })

  it('does not treat approval as satisfied when the latest head review requests changes', async () => {
    installGitHubFetch({
      '/repos/acme/app/pulls/42': {
        number: 42,
        title: 'Ship feature',
        state: 'open',
        merged: false,
        mergeable: true,
        head: { sha: 'head-sha', ref: 'feature' },
        base: { ref: 'main' },
      },
      '/repos/acme/app/pulls/42/reviews?per_page=100&page=1': [
        { id: 1, user: { login: 'wibus' }, state: 'APPROVED', commit_id: 'head-sha', submitted_at: '2026-01-01T00:00:00Z', body: null },
        { id: 2, user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', commit_id: 'head-sha', submitted_at: '2026-01-02T00:00:00Z', body: null },
      ],
    })

    const [approvalResult] = await githubReviewSource.checkPending([
      awaitRow({ repo: 'acme/app', pr: 42, mode: 'approved' }, { source: 'github-review' }),
    ])
    const [changesResult] = await githubReviewSource.checkPending([
      awaitRow({ repo: 'acme/app', pr: 42, mode: 'changes-requested' }, { source: 'github-review' }),
    ])

    expect(approvalResult).toEqual({ awaitId: 'await-1', matched: false })
    expect(changesResult.matched).toBe(true)
    expect(changesResult.resumeText).toContain('requested changes')
  })

  it('uses the latest current-head review per reviewer', async () => {
    installGitHubFetch({
      '/repos/acme/app/pulls/42': {
        number: 42,
        title: 'Ship feature',
        state: 'open',
        merged: false,
        mergeable: true,
        head: { sha: 'head-sha', ref: 'feature' },
        base: { ref: 'main' },
      },
      '/repos/acme/app/pulls/42/reviews?per_page=100&page=1': [
        { id: 1, user: { login: 'reviewer' }, state: 'APPROVED', commit_id: 'head-sha', submitted_at: '2026-01-01T00:00:00Z', body: null },
        { id: 2, user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', commit_id: 'head-sha', submitted_at: '2026-01-02T00:00:00Z', body: null },
      ],
    })

    const [result] = await githubReviewSource.checkPending([
      awaitRow({ repo: 'acme/app', pr: 42, mode: 'approved' }, { source: 'github-review' }),
    ])

    expect(result).toEqual({ awaitId: 'await-1', matched: false })
  })
})
