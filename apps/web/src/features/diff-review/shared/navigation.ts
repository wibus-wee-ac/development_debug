import { router } from '~/router'

import { WORKING_TREE_REVIEW_ID } from './types'

export interface DiffsViewSearch {
  repo?: string
  path?: string
  review?: string
  view?: 'commit' | 'guide'
}

export function navigateToReviewsList(workspaceId: string, repositoryPath?: string | null): void {
  void router.navigate({
    to: '/workspaces/$workspaceId/diffs',
    params: { workspaceId },
    search: {
      repo: repositoryPath && repositoryPath !== '.' ? repositoryPath : undefined,
    },
  })
}

export function navigateToReview(
  workspaceId: string,
  reviewId: string,
  options: { repositoryPath?: string | null, path?: string | null, replace?: boolean } = {},
): void {
  void router.navigate({
    to: '/workspaces/$workspaceId/diffs',
    params: { workspaceId },
    search: {
      repo: options.repositoryPath && options.repositoryPath !== '.' ? options.repositoryPath : undefined,
      path: options.path ?? undefined,
      review: reviewId,
    },
    replace: options.replace,
  })
}

export function navigateToCommitView(workspaceId: string, reviewId: string, repositoryPath?: string | null): void {
  void router.navigate({
    to: '/workspaces/$workspaceId/diffs',
    params: { workspaceId },
    search: {
      repo: repositoryPath && repositoryPath !== '.' ? repositoryPath : undefined,
      review: reviewId,
      view: 'commit',
    },
  })
}

export function navigateToGuideView(workspaceId: string, reviewId: string, repositoryPath?: string | null): void {
  void router.navigate({
    to: '/workspaces/$workspaceId/diffs',
    params: { workspaceId },
    search: {
      repo: repositoryPath && repositoryPath !== '.' ? repositoryPath : undefined,
      review: reviewId,
      view: 'guide',
    },
  })
}

export { WORKING_TREE_REVIEW_ID }
