import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { deleteAgentsById, getAgents, patchAgentsById, postAgents } from '~/api-gen/sdk.gen'
import type { Agent, CreateAgentInput, UpdateAgentInput } from '~/lib/types'

const AGENTS_QUERY_KEY = ['agents'] as const
const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  avatarStyle: z.string(),
  avatarSeed: z.string(),
  agentProfileId: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingEffort: z.enum(['low', 'medium', 'high', 'auto']),
  runtimeKind: z.enum(['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui']),
  configJson: z.string(),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
const AgentListSchema = z.array(AgentSchema).default([])

export function useAgents() {
  const queryClient = useQueryClient()

  const { data: agents = [], isLoading, isSuccess } = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: async (): Promise<Agent[]> => {
      const { data } = await getAgents()
      return AgentListSchema.parse(data) satisfies Agent[]
    },
  })

  const createAgent = useMutation({
    mutationFn: async (input: CreateAgentInput) => {
      const { data } = await postAgents({ body: input })
      return AgentSchema.parse(data) satisfies Agent
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  const updateAgent = useMutation({
    mutationFn: async ({ id, patch }: { id: string, patch: UpdateAgentInput }) => {
      const { data } = await patchAgentsById({ path: { id }, body: patch })
      return AgentSchema.parse(data) satisfies Agent
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  const removeAgent = useMutation({
    mutationFn: async (id: string) => {
      await deleteAgentsById({ path: { id } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  return {
    agents,
    isLoading,
    isSuccess,
    createAgent,
    updateAgent,
    removeAgent,
  }
}
