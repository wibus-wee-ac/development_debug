// Input: renderer IPC proxy, TanStack Query
// Output: Hooks for listing skill inventory, loading skill documents, and mutating filesystem-backed skills across shared, workspace, and agent roots
// Position: Data layer for the skills management feature

import type {
  SkillDocument,
  SkillInventoryEntry,
  SkillScope,
} from '@main/ipc-types'
import { ipc } from '@renderer/lib/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
      if (!ipc) {
        return []
      }
      return ipc.skills.list(toIpcContext(context)) as Promise<SkillInventoryEntry[]>
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
      if (!ipc) {
        throw new Error('IPC not available')
      }
      return ipc.skills.create({
        ...toIpcContext(context),
        scope: params.scope,
        name: params.name,
        description: params.description,
        body: params.body,
        frontmatter: params.frontmatter,
      }) as Promise<SkillDocument>
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
      if (!ipc) {
        throw new Error('IPC not available')
      }
      return ipc.skills.update({
        ...toIpcContext(context),
        scope: params.scope,
        name: params.currentName,
        document: {
          name: params.name,
          description: params.description,
          body: params.body,
          frontmatter: params.frontmatter,
        },
      }) as Promise<SkillDocument>
    },
    onSuccess: invalidate,
  })

  const deleteSkill = useMutation({
    mutationFn: async (params: { scope: SkillScope, name: string }) => {
      if (!ipc) {
        throw new Error('IPC not available')
      }
      await ipc.skills.delete({
        ...toIpcContext(context),
        scope: params.scope,
        name: params.name,
      })
    },
    onSuccess: invalidate,
  })

  const importSkill = useMutation({
    mutationFn: async (params: { scope: SkillScope, sourceDir: string }) => {
      if (!ipc) {
        throw new Error('IPC not available')
      }
      return ipc.skills.import({
        ...toIpcContext(context),
        scope: params.scope,
        sourceDir: params.sourceDir,
        overwrite: false,
      }) as Promise<SkillDocument>
    },
    onSuccess: invalidate,
  })

  const exportSkill = useMutation({
    mutationFn: async (params: { scope: SkillScope, name: string, destinationDir: string }) => {
      if (!ipc) {
        throw new Error('IPC not available')
      }
      return ipc.skills.export({
        ...toIpcContext(context),
        scope: params.scope,
        name: params.name,
        destinationDir: params.destinationDir,
        overwrite: false,
      }) as Promise<string>
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
      if (!ipc || !scope || !name) {
        return null
      }
      return ipc.skills.get({
        ...toIpcContext(context),
        scope,
        name,
      }) as Promise<SkillDocument>
    },
    enabled: !!ipc && !!scope && !!name,
  })
}
