// Input: generated API SDK, TanStack Query
// Output: Hooks for listing skill inventory, loading skill documents, mutating filesystem-backed skills, and fetching/importing from remote sources
// Position: Data layer for the skills management feature

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteSkillsDocument,
  getSkills,
  getSkillsDocument,
  postSkills,
  postSkillsCancelFetch,
  postSkillsExport,
  postSkillsFetchSource,
  postSkillsImport,
  postSkillsImportFromFetch,
  putSkillsDocument,
} from '~/api-gen/sdk.gen'
import type {
  DiscoveredSkill,
  ParsedSkillSource,
  SkillDocument,
  SkillInventoryEntry,
  SkillScope,
} from '~/lib/types'

export interface SkillQueryContext {
  workspaceId?: string | null
  agentId?: string | null
}

export const skillsInventoryQueryKey = (context?: SkillQueryContext) =>
  ['skills', 'inventory', context?.workspaceId ?? 'global', context?.agentId ?? 'no-agent'] as const
export const skillDocumentQueryKey = (context: SkillQueryContext | undefined, scope: SkillScope, name: string | null) =>
  ['skills', 'document', context?.workspaceId ?? 'global', context?.agentId ?? 'no-agent', scope, name ?? ''] as const

function toIpcContext(context?: SkillQueryContext): { workspaceId?: string | null, agentId?: string | null } {
  return {
    workspaceId: context?.workspaceId ?? null,
    agentId: context?.agentId ?? null,
  }
}

export function useSkills(context?: SkillQueryContext) {
  const queryClient = useQueryClient()
  const inventoryQueryKey = skillsInventoryQueryKey(context)

  const { data: inventory = [], isLoading } = useQuery({
    queryKey: inventoryQueryKey,
    queryFn: async (): Promise<SkillInventoryEntry[]> => {
      const ctx = toIpcContext(context)
      const { data } = await getSkills({
        query: { workspaceId: ctx.workspaceId ?? undefined, agentId: ctx.agentId ?? undefined },
      })
      return (data ?? []) as SkillInventoryEntry[]
    },
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['skills'] })

  const createSkill = useMutation({
    mutationFn: async (params: {
      scope: SkillScope
      name: string
      description: string
      body: string
      frontmatter: Record<string, unknown>
    }) => {
      const { data } = await postSkills({
        body: {
          ...toIpcContext(context),
          scope: params.scope,
          name: params.name,
          description: params.description,
          body: params.body,
          frontmatter: params.frontmatter,
        },
      })
      return data as SkillDocument
    },
    onSuccess: invalidate,
  })

  const updateSkill = useMutation({
    mutationFn: async (params: {
      scope: SkillScope
      currentName: string
      name: string
      description: string
      body: string
      frontmatter: Record<string, unknown>
    }) => {
      const { data } = await putSkillsDocument({
        body: {
          ...toIpcContext(context),
          scope: params.scope,
          name: params.currentName,
          document: {
            name: params.name,
            description: params.description,
            body: params.body,
            frontmatter: params.frontmatter,
          },
        },
      })
      return data as SkillDocument
    },
    onSuccess: invalidate,
  })

  const deleteSkill = useMutation({
    mutationFn: async (params: { scope: SkillScope, name: string }) => {
      await deleteSkillsDocument({
        query: {
          scope: params.scope,
          name: params.name,
          workspaceId: toIpcContext(context).workspaceId ?? undefined,
          agentId: toIpcContext(context).agentId ?? undefined,
        },
      })
    },
    onSuccess: invalidate,
  })

  const importSkill = useMutation({
    mutationFn: async (params: { scope: SkillScope, sourceDir: string }) => {
      const { data } = await postSkillsImport({
        body: {
          ...toIpcContext(context),
          scope: params.scope,
          sourceDir: params.sourceDir,
          overwrite: false,
        },
      })
      return data as SkillDocument
    },
    onSuccess: invalidate,
  })

  const exportSkill = useMutation({
    mutationFn: async (params: { scope: SkillScope, name: string, destinationDir: string }) => {
      const ctx = toIpcContext(context)
      const { data, error } = await postSkillsExport({
        body: {
          scope: params.scope,
          name: params.name,
          destinationDir: params.destinationDir,
          overwrite: false,
          workspaceId: ctx.workspaceId ?? null,
          agentId: ctx.agentId ?? null,
        },
      })
      if (error) {
        throw new Error(String(error))
      }
      return (data as { destinationDir: string }).destinationDir
    },
  })

  return {
    inventory,
    isLoading,
    createSkill,
    updateSkill,
    deleteSkill,
    importSkill,
    exportSkill,
  }
}

export function useSkillDocument(
  context: SkillQueryContext | undefined,
  scope: SkillScope | null,
  name: string | null,
) {
  return useQuery({
    queryKey: skillDocumentQueryKey(context, scope ?? 'global', name),
    queryFn: async (): Promise<SkillDocument | null> => {
      if (!scope || !name) {
        return null
      }
      const { data } = await getSkillsDocument({
        query: {
          scope,
          name,
          workspaceId: toIpcContext(context).workspaceId ?? undefined,
          agentId: toIpcContext(context).agentId ?? undefined,
        },
      })
      return (data as SkillDocument | null | undefined) ?? null
    },
    enabled: !!scope && !!name,
  })
}

/**
 * Hooks to fetch skills from a remote/local source and import selected ones.
 * Operates independently of the inventory query context.
 */
export function useSkillSourceImport(context?: SkillQueryContext) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['skills'] })

  const fetchSource = useMutation({
    mutationFn: async (source: string): Promise<{
      sessionId: string
      source: ParsedSkillSource
      skills: DiscoveredSkill[]
    }> => {
      const { data } = await postSkillsFetchSource({ body: { source } })
      return data as unknown as { sessionId: string, source: ParsedSkillSource, skills: DiscoveredSkill[] }
    },
  })

  const importFromFetch = useMutation({
    mutationFn: async (params: {
      sessionId: string
      selectedDirs: string[]
      scope: SkillScope
      overwrite?: boolean
    }): Promise<{ imported: SkillDocument[], errors: Array<{ dir: string, error: string }> }> => {
      const { data } = await postSkillsImportFromFetch({
        body: {
          ...toIpcContext(context),
          sessionId: params.sessionId,
          selectedDirs: params.selectedDirs,
          scope: params.scope,
          overwrite: params.overwrite,
        },
      })
      return data as { imported: SkillDocument[], errors: Array<{ dir: string, error: string }> }
    },
    onSuccess: invalidate,
  })

  const cancelFetch = useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      await postSkillsCancelFetch({ body: { sessionId } })
    },
  })

  return { fetchSource, importFromFetch, cancelFetch }
}
