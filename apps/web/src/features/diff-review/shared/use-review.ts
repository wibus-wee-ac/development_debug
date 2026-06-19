import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getWorkspacesByIdDiffReviewsByReviewId,
  postWorkspacesByIdDiffReviewsByReviewIdCommitPlan,
  postWorkspacesByIdDiffReviewsByReviewIdCommitPlansByCommitPlanIdApply,
  postWorkspacesByIdDiffReviewsByReviewIdFilesByFileIdViewed,
  postWorkspacesByIdDiffReviewsByReviewIdGuideGenerate,
  postWorkspacesByIdDiffReviewsByReviewIdRefresh,
  postWorkspacesByIdDiffReviewsByReviewIdSubmit,
  postWorkspacesByIdDiffReviewsByReviewIdThreads,
  postWorkspacesByIdDiffReviewsByReviewIdThreadsByThreadIdComments,
  postWorkspacesByIdDiffReviewsByReviewIdThreadsByThreadIdResolve,
  postWorkspacesByIdDiffReviewsLocalWorkingTree,
  putWorkspacesByIdDiffReviewsByReviewIdCommitPlansByCommitPlanId,
  putWorkspacesByIdDiffReviewsPreferences,
} from '~/api-gen/sdk.gen'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

import { reviewListQueryKey, reviewQueryKey } from './diff-items'
import type {
  CradleDiffReview,
  DiffStyle,
  EditableCommitPlanStatus,
  GenerateGuideInput,
  ReviewCommitPlanGroup,
  ReviewDecision,
  ReviewThreadAnchorInput,
} from './types'
import { isWorkingTreeReviewId } from './types'

export interface UseReviewArgs {
  workspaceId: string
  repositoryPath?: string | null
  reviewId: string
}

/**
 * Owns the active review document and every mutation that updates it. All mutations write the
 * fresh review back into the cache so the diff stage, threads, and rail stay in sync without a
 * refetch round-trip.
 */
export function useReview({ workspaceId, repositoryPath, reviewId }: UseReviewArgs) {
  const queryClient = useQueryClient()
  const queryKey = reviewQueryKey(workspaceId, repositoryPath, reviewId)

  const applyReview = (review: CradleDiffReview) => {
    queryClient.setQueryData(reviewQueryKey(workspaceId, review.repositoryPath, review.id), review)
    queryClient.setQueryData(queryKey, review)
  }

  const invalidateList = () => {
    void queryClient.invalidateQueries({ queryKey: reviewListQueryKey(workspaceId) })
  }

  const reviewQuery = useQuery({
    queryKey,
    queryFn: async () => {
      if (isWorkingTreeReviewId(reviewId)) {
        const { data } = await postWorkspacesByIdDiffReviewsLocalWorkingTree({
          path: { id: workspaceId },
          body: repositoryPath ? { repo: repositoryPath } : {},
          throwOnError: true,
        })
        return data
      }
      const { data } = await getWorkspacesByIdDiffReviewsByReviewId({
        path: { id: workspaceId, reviewId },
        throwOnError: true,
      })
      return data
    },
    ...queryRefreshPolicies.active,
    refetchInterval: (query) => {
      const review = query.state.data as CradleDiffReview | undefined
      return review?.guide.status === 'pending' || review?.guide.status === 'running'
        ? 1_500
        : queryRefreshPolicies.active.refetchInterval
    },
    retry: false,
  })

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const review = reviewQuery.data
      if (review?.id && !isWorkingTreeReviewId(reviewId)) {
        const { data } = await postWorkspacesByIdDiffReviewsByReviewIdRefresh({
          path: { id: workspaceId, reviewId: review.id },
          throwOnError: true,
        })
        return data
      }
      const { data } = await postWorkspacesByIdDiffReviewsLocalWorkingTree({
        path: { id: workspaceId },
        body: repositoryPath ? { repo: repositoryPath } : {},
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const viewedMutation = useMutation({
    mutationFn: async (input: { fileId: string, viewed: boolean }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByIdDiffReviewsByReviewIdFilesByFileIdViewed({
        path: { id: workspaceId, reviewId: review.id, fileId: input.fileId },
        body: { viewed: input.viewed },
        throwOnError: true,
      })
      return data
    },
    onSuccess: applyReview,
  })

  const createThreadMutation = useMutation({
    mutationFn: async (input: {
      fileId: string | null
      anchor?: ReviewThreadAnchorInput | null
      bodyMarkdown: string
    }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByIdDiffReviewsByReviewIdThreads({
        path: { id: workspaceId, reviewId: review.id },
        body: { fileId: input.fileId, anchor: input.anchor ?? null, bodyMarkdown: input.bodyMarkdown },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const replyMutation = useMutation({
    mutationFn: async (input: { threadId: string, bodyMarkdown: string }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByIdDiffReviewsByReviewIdThreadsByThreadIdComments({
        path: { id: workspaceId, reviewId: review.id, threadId: input.threadId },
        body: { bodyMarkdown: input.bodyMarkdown },
        throwOnError: true,
      })
      return data
    },
    onSuccess: applyReview,
  })

  const resolveThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByIdDiffReviewsByReviewIdThreadsByThreadIdResolve({
        path: { id: workspaceId, reviewId: review.id, threadId },
        throwOnError: true,
      })
      return data
    },
    onSuccess: applyReview,
  })

  const submitMutation = useMutation({
    mutationFn: async (input: { decision: ReviewDecision, bodyMarkdown: string }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByIdDiffReviewsByReviewIdSubmit({
        path: { id: workspaceId, reviewId: review.id },
        body: { decision: input.decision, bodyMarkdown: input.bodyMarkdown || null },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const preferenceMutation = useMutation({
    mutationFn: async (input: {
      diffStyle?: DiffStyle
      fontSize?: number
      hideWhitespaceOnly?: boolean
      collapseGeneratedFiles?: boolean
      lineHeight?: number
    }) => {
      const { data } = await putWorkspacesByIdDiffReviewsPreferences({
        path: { id: workspaceId },
        body: input,
        throwOnError: true,
      })
      return data
    },
    onSuccess: (preferences) => {
      const review = reviewQuery.data
      if (review) {
        applyReview({ ...review, preferences })
      }
    },
  })

  const commitPlanMutation = useMutation({
    mutationFn: async (strategy: 'single' | 'rule-based-groups') => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByIdDiffReviewsByReviewIdCommitPlan({
        path: { id: workspaceId, reviewId: review.id },
        body: { strategy },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const commitPlanUpdateMutation = useMutation({
    mutationFn: async (input: {
      planId: string
      groups: ReviewCommitPlanGroup[]
      rationale: string
      status: EditableCommitPlanStatus
    }) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await putWorkspacesByIdDiffReviewsByReviewIdCommitPlansByCommitPlanId({
        path: { id: workspaceId, reviewId: review.id, commitPlanId: input.planId },
        body: {
          groups: input.groups.map(group => ({
            id: group.id,
            title: group.title,
            message: group.message,
            rationale: group.rationale,
            fileIds: group.fileIds,
            paths: group.paths,
            dependsOn: group.dependsOn,
          })),
          rationale: input.rationale,
          status: input.status,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  const commitPlanApplyMutation = useMutation({
    mutationFn: async (planId: string) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByIdDiffReviewsByReviewIdCommitPlansByCommitPlanIdApply({
        path: { id: workspaceId, reviewId: review.id, commitPlanId: planId },
        body: {},
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  /**
   * On-demand change walkthrough generation. This spends tokens, so it is strictly user-initiated —
   * never auto-triggered. `force` re-generates over an existing guide.
   */
  const generateGuideMutation = useMutation({
    mutationFn: async (input: GenerateGuideInput) => {
      const review = reviewQuery.data
      if (!review) {
        throw new Error('Review not loaded')
      }
      const { data } = await postWorkspacesByIdDiffReviewsByReviewIdGuideGenerate({
        path: { id: workspaceId, reviewId: review.id },
        body: {
          providerTargetId: input.providerTargetId,
          runtimeKind: input.runtimeKind,
          modelId: input.modelId ?? null,
          force: input.force,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      applyReview(data)
      invalidateList()
    },
  })

  return {
    review: reviewQuery.data ?? null,
    isLoading: reviewQuery.isLoading,
    isFetching: reviewQuery.isFetching,
    isError: reviewQuery.isError,
    refreshMutation,
    viewedMutation,
    createThreadMutation,
    replyMutation,
    resolveThreadMutation,
    submitMutation,
    preferenceMutation,
    commitPlanMutation,
    commitPlanUpdateMutation,
    commitPlanApplyMutation,
    generateGuideMutation,
  }
}
