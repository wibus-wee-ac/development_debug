import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'

import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { CommitPlanPage } from '~/features/diff-review/commit-plan-page'
import { GuideView } from '~/features/diff-review/review-detail/guide-view'
import { ReviewDetailPage } from '~/features/diff-review/review-detail/review-detail-page'
import { ReviewsListPage } from '~/features/diff-review/reviews-list-page'
import { WORKER_HIGHLIGHTER_OPTIONS, WORKER_POOL_OPTIONS } from '~/features/diff-review/shared/diff-items'
import { navigateToReview } from '~/features/diff-review/shared/navigation'

interface WorkspaceDiffsSearch {
  repo?: string
  path?: string
  review?: string
  view?: 'commit' | 'guide'
}

export const Route = createFileRoute('/workspaces/$workspaceId/diffs')({
  validateSearch: (search: Record<string, unknown>): WorkspaceDiffsSearch => ({
    repo: typeof search.repo === 'string' && search.repo.length > 0 ? search.repo : undefined,
    path: typeof search.path === 'string' && search.path.length > 0 ? search.path : undefined,
    review: typeof search.review === 'string' && search.review.length > 0 ? search.review : undefined,
    view: search.view === 'commit' || search.view === 'guide' ? search.view : undefined,
  }),
  component: WorkspaceDiffsRoute,
})

function WorkspaceDiffsRoute() {
  const { workspaceId } = Route.useParams()
  const { repo, path, review, view } = Route.useSearch()

  useRegisterLayoutSlots(`workspace-diffs:${workspaceId}`, useMemo(() => ({
    asideWorkspaceId: workspaceId,
    hasAside: true,
    hasBrowserPanel: false,
    hasPanel: false,
  }), [workspaceId]))

  // One shared highlighter worker pool for every CodeView under /diffs (review detail, guide,
  // commit plan). Without this, each CodeView tokenizes on the main thread and the singleton pool
  // is never initialized — see shared/diff-items.ts for the option constants.
  return (
    <WorkerPoolContextProvider poolOptions={WORKER_POOL_OPTIONS} highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}>
      <WorkspaceDiffsContent
        workspaceId={workspaceId}
        repo={repo}
        path={path}
        review={review}
        view={view}
      />
    </WorkerPoolContextProvider>
  )
}

function WorkspaceDiffsContent({
  workspaceId,
  repo,
  path,
  review,
  view,
}: {
  workspaceId: string
  repo?: string
  path?: string
  review?: string
  view?: 'commit' | 'guide'
}) {
  if (review && view === 'commit') {
    return <CommitPlanPage workspaceId={workspaceId} repositoryPath={repo} reviewId={review} />
  }

  if (review && view === 'guide') {
    return (
      <GuideView
        workspaceId={workspaceId}
        repositoryPath={repo}
        reviewId={review}
        onBack={() => navigateToReview(workspaceId, review, { repositoryPath: repo })}
      />
    )
  }

  if (review) {
    return <ReviewDetailPage workspaceId={workspaceId} repositoryPath={repo} reviewId={review} initialPath={path} />
  }

  return <ReviewsListPage workspaceId={workspaceId} repositoryPath={repo} />
}
