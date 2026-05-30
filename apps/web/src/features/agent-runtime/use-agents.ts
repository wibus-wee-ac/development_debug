import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteAgentsByIdMutation,
  getAgentsOptions,
  getAgentsQueryKey,
  getProviderTargetsQueryKey,
  patchAgentsByIdMutation,
  postAgentsImportLocalConfigMutation,
  postAgentsImportLocalConfigPreviewMutation,
  postAgentsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetAgentsResponse,
  PatchAgentsByIdData,
  PostAgentsData,
  PostAgentsImportLocalConfigPreviewResponse,
  PostAgentsImportLocalConfigResponse,
} from '~/api-gen/types.gen'

export const AGENTS_QUERY_KEY = getAgentsQueryKey()

export type Agent = GetAgentsResponse[number]
export type CreateAgentInput = PostAgentsData['body']
export type UpdateAgentInput = PatchAgentsByIdData['body']
export type PreviewLocalConfigImportResult = PostAgentsImportLocalConfigPreviewResponse
export type ImportLocalConfigResult = PostAgentsImportLocalConfigResponse

export function useAgents() {
  const queryClient = useQueryClient()

  const { data: agents = [], isLoading, isSuccess } = useQuery({
    ...getAgentsOptions(),
  })

  const createAgent = useMutation({
    ...postAgentsMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  const importLocalConfig = useMutation({
    ...postAgentsImportLocalConfigMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
    },
  })

  const previewLocalConfigImport = useMutation({
    ...postAgentsImportLocalConfigPreviewMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
    },
  })

  const updateAgent = useMutation({
    ...patchAgentsByIdMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  const removeAgent = useMutation({
    ...deleteAgentsByIdMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  return {
    agents,
    isLoading,
    isSuccess,
    createAgent,
    importLocalConfig,
    previewLocalConfigImport,
    updateAgent,
    removeAgent,
  }
}
