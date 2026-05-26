import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { getProviderTargetsQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { deleteAgentsById, getAgents, patchAgentsById, postAgents } from '~/api-gen/sdk.gen'
import { getServerUrl } from '~/lib/electron'
import type { Agent, CreateAgentInput, UpdateAgentInput } from '~/lib/types'

const AGENTS_QUERY_KEY = ['agents'] as const
const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  avatarStyle: z.string(),
  avatarSeed: z.string(),
  providerTargetId: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingEffort: z.enum(['low', 'medium', 'high', 'auto']),
  runtimeKind: z.enum(['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui']),
  configJson: z.string(),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
const AgentListSchema = z.array(AgentSchema).default([])
const LocalConfigImportCandidateSchema = z.object({
  id: z.string(),
  app: z.enum(['claude', 'codex']),
  runtimeKind: z.enum(['claude-agent', 'codex']),
  sourceKind: z.enum(['cc-switch', 'local-config']),
  sourceLabel: z.string(),
  externalRecordId: z.string(),
  providerTargetId: z.string().nullable(),
  agentName: z.string(),
  resolvedProviderName: z.string(),
  name: z.string(),
  modelId: z.string().nullable(),
  endpoint: z.string().nullable(),
  importable: z.boolean(),
  alreadyConfigured: z.boolean(),
  reason: z.string().nullable(),
  notes: z.array(z.string()),
  agent: AgentSchema.nullable(),
})
const LocalConfigImportSourceRefreshSchema = z.object({
  sourceKey: z.string(),
  sourceLabel: z.string(),
  status: z.enum(['ok', 'warning', 'error']),
  recordsSeen: z.number(),
  recordsProjected: z.number(),
  recordsMissing: z.number(),
  message: z.string().nullable(),
})
const PreviewLocalConfigImportResultSchema = z.object({
  candidates: z.array(LocalConfigImportCandidateSchema),
  sourceRefreshes: z.array(LocalConfigImportSourceRefreshSchema),
})
const ImportedAgentResultSchema = z.object({
  app: z.enum(['claude', 'codex']),
  candidateId: z.string(),
  sourceKind: z.enum(['cc-switch', 'local-config']),
  externalRecordId: z.string(),
  providerTargetId: z.string().nullable(),
  runtimeKind: z.enum(['claude-agent', 'codex']),
  status: z.enum(['created', 'existing', 'skipped']),
  reason: z.string().nullable(),
  agent: AgentSchema.nullable(),
})
const ImportLocalConfigResultSchema = z.object({
  preview: PreviewLocalConfigImportResultSchema,
  created: z.number(),
  existing: z.number(),
  skipped: z.number(),
  agents: z.array(ImportedAgentResultSchema),
})

export type LocalConfigImportCandidate = z.infer<typeof LocalConfigImportCandidateSchema>
export type PreviewLocalConfigImportResult = z.infer<typeof PreviewLocalConfigImportResultSchema>
export type ImportLocalConfigResult = z.infer<typeof ImportLocalConfigResultSchema>

async function postLocalConfigImport<T>(path: string, body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${getServerUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) {
    const message = typeof data?.message === 'string'
      ? data.message
      : 'Failed to import local agent config'
    throw new Error(message)
  }
  return schema.parse(data)
}

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

  const importLocalConfig = useMutation({
    mutationFn: async (input: { candidateIds?: string[] } = {}): Promise<ImportLocalConfigResult> =>
      postLocalConfigImport('/agents/import/local-config', input, ImportLocalConfigResultSchema),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
    },
  })

  const previewLocalConfigImport = useMutation({
    mutationFn: async (): Promise<PreviewLocalConfigImportResult> =>
      postLocalConfigImport('/agents/import/local-config/preview', {}, PreviewLocalConfigImportResultSchema),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
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
    importLocalConfig,
    previewLocalConfigImport,
    updateAgent,
    removeAgent,
  }
}
